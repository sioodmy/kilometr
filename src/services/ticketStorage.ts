import { Alert } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { kvGet, kvRemove, kvSet } from './storage';
import {
  base64ToUint8Array,
  extractBarcodesFromPdf,
  extractTextFromPdf,
  isLikelyRailTicket,
  parseRailTicketText,
  uint8ArrayToBase64,
  type ParsedTicketMetadata,
} from './ticketParser';
import type { Connection } from '../types/models';
import { getTrainLegSummary } from './ticketing';

export interface AttachedRailTicket {
  id: string;
  connectionId: string;
  fileName: string;
  fileUri: string;
  fileSize: number;
  addedAt: number;
  tripDate?: string;
  barcodeUri?: string | null;
  barcodeUris?: string[]; // Wsparcie dla biletów wieloodcinkowych z przesiadką (wiele kodów Aztec)
  metadata: ParsedTicketMetadata;
}

interface TicketIndexEntry {
  id: string;
  connectionId: string;
  fileUri: string;
  fileName: string;
  fileSize: number;
  addedAt: number;
  tripDate?: string;
}

const TICKET_INDEX_KEY = 'rail_tickets:index';
const DEFAULT_RETENTION_DAYS = 14;
const MAX_TICKET_FILE_SIZE = 10 * 1024 * 1024; // 10 MB limit bezpieczeństwa (ochrona pamięci i storage)

function getTicketDir(): string | null {
  const base = FileSystem.documentDirectory ?? FileSystem.cacheDirectory;
  if (!base) return null;
  return base.endsWith('/') ? `${base}tickets/` : `${base}/tickets/`;
}

async function ensureTicketDir(): Promise<string | null> {
  const dir = getTicketDir();
  if (!dir) return null;
  try {
    const info = await FileSystem.getInfoAsync(dir);
    if (!info.exists) {
      await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
    }
    return dir;
  } catch {
    return dir;
  }
}

async function loadIndex(): Promise<TicketIndexEntry[]> {
  const raw = await kvGet(TICKET_INDEX_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as TicketIndexEntry[];
  } catch {
    return [];
  }
}

async function saveIndex(entries: TicketIndexEntry[]): Promise<void> {
  await kvSet(TICKET_INDEX_KEY, JSON.stringify(entries));
}

/**
 * Pobiera bilet przypisany do danego połączenia.
 * Posiada odporny mechanizm odzyskiwania: jeśli connectionId uległo zmianie
 * (np. przesunięcie godziny przez opóźnienie pociągu), bilet jest dopasowywany po dacie i numerze pociągu.
 */
export async function getTicketForConnection(
  connectionId: string,
  connection?: Connection,
): Promise<AttachedRailTicket | null> {
  // 1. Sprawdź bezpośrednio po identyfikatorze połączenia
  const raw = await kvGet(`ticket:${connectionId}`);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as AttachedRailTicket;
      const fileInfo = await FileSystem.getInfoAsync(parsed.fileUri);
      if (fileInfo.exists) {
        return parsed;
      }
      await deleteTicketForConnection(connectionId);
    } catch {}
  }

  // 2. Fallback na wypadek zmiany ID przez opóźnienie lub restart plannera
  if (connection) {
    const summary = getTrainLegSummary(connection);
    const trainNum = summary?.trainNumber?.replace(/\s+/g, '').toUpperCase();
    const serviceDate = connection.serviceDate;

    if (trainNum || serviceDate) {
      const index = await loadIndex();
      for (const entry of index) {
        const candidateRaw = await kvGet(`ticket:${entry.connectionId}`);
        if (!candidateRaw) continue;
        try {
          const cand = JSON.parse(candidateRaw) as AttachedRailTicket;
          const candTrain = cand.metadata.trainNumber?.replace(/\s+/g, '').toUpperCase();
          const matchTrain = Boolean(
            trainNum && candTrain && (trainNum.includes(candTrain) || candTrain.includes(trainNum)),
          );
          const matchDate = !serviceDate || !cand.tripDate || serviceDate === cand.tripDate;

          if (matchTrain && matchDate) {
            const fileInfo = await FileSystem.getInfoAsync(cand.fileUri);
            if (fileInfo.exists) {
              // Zmapuj na bieżący connectionId dla natychmiastowego dostępu
              await kvSet(`ticket:${connectionId}`, candidateRaw);
              return cand;
            }
          }
        } catch {}
      }
    }
  }

  return null;
}

/**
 * Usuwa dołączony bilet, kasuje plik PDF, wyekstrahowane kody kreskowe oraz czyści indeks.
 */
export async function deleteTicketForConnection(connectionId: string): Promise<void> {
  const ticketRaw = await kvGet(`ticket:${connectionId}`);
  if (ticketRaw) {
    try {
      const ticket = JSON.parse(ticketRaw) as AttachedRailTicket;
      if (ticket.fileUri) {
        await FileSystem.deleteAsync(ticket.fileUri, { idempotent: true });
      }
      if (ticket.barcodeUri) {
        await FileSystem.deleteAsync(ticket.barcodeUri, { idempotent: true });
      }
      if (ticket.barcodeUris) {
        for (const uri of ticket.barcodeUris) {
          if (uri !== ticket.barcodeUri) {
            await FileSystem.deleteAsync(uri, { idempotent: true });
          }
        }
      }
    } catch (err) {
      console.warn('[TicketStorage] Delete file failed:', err);
    }
  }

  await kvRemove(`ticket:${connectionId}`);

  // Aktualizacja indeksu
  const current = await loadIndex();
  const filtered = current.filter((e) => e.connectionId !== connectionId);
  await saveIndex(filtered);
}

/**
 * Otwiera selektor plików i dołącza wybrany bilet PDF do połączenia.
 * Posiada walidację rozmiaru (< 10 MB), czyszczenie cache oraz rozpoznawanie czy dokument jest biletem.
 */
export async function importTicketPdf(
  connectionId: string,
  connection?: Connection,
): Promise<AttachedRailTicket | null> {
  let DocumentPicker: typeof import('expo-document-picker');
  try {
    DocumentPicker = await import('expo-document-picker');
  } catch (err) {
    console.warn('[TicketStorage] DocumentPicker unavailable:', err);
    return null;
  }

  const picked = await DocumentPicker.getDocumentAsync({
    type: ['application/pdf', 'application/octet-stream'],
    copyToCacheDirectory: true,
    multiple: false,
  });

  if (picked.canceled || !picked.assets?.[0]?.uri) {
    return null;
  }

  const asset = picked.assets[0];

  // 1. Bezpiecznik rozmiaru: natychmiastowe odrzucenie gigantycznych plików (np. 100 MB ebook)
  let declaredSize = asset.size ?? 0;
  if (!declaredSize) {
    try {
      const fileInfo = await FileSystem.getInfoAsync(asset.uri);
      if (fileInfo.exists && typeof fileInfo.size === 'number') {
        declaredSize = fileInfo.size;
      }
    } catch {}
  }

  if (declaredSize > MAX_TICKET_FILE_SIZE) {
    // Sprzątnij plik z cache DocumentPicker
    try {
      await FileSystem.deleteAsync(asset.uri, { idempotent: true });
    } catch {}

    Alert.alert(
      'Plik jest zbyt duży',
      'Wybrany dokument przekracza 10 MB. Bilety kolejowe w formacie PDF mają zazwyczaj od kilkudziesięciu KB do maksymalnie 2 MB.',
    );
    return null;
  }

  const dir = await ensureTicketDir();
  if (!dir) throw new Error('Tickets directory unavailable');

  const ticketId = `ticket_${Date.now()}`;
  const targetUri = `${dir}${ticketId}.pdf`;

  // Kopiowanie pliku do trwałego folderu aplikacji
  await FileSystem.copyAsync({
    from: asset.uri,
    to: targetUri,
  });

  // Usuwamy plik z tymczasowego cache DocumentPicker, aby zapobiec wyciekom pamięci
  try {
    await FileSystem.deleteAsync(asset.uri, { idempotent: true });
  } catch {}

  // Odczyt zawartości, analiza tekstu i ekstrakcja kodu kreskowego/Aztec
  let metadata: ParsedTicketMetadata = {};
  let barcodeUri: string | null = null;
  const barcodeUris: string[] = [];
  let text = '';

  try {
    const base64 = await FileSystem.readAsStringAsync(targetUri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    const bytes = base64ToUint8Array(base64);

    // 1. Metadane tekstowe (wagon, miejsce, pasażer, ulga)
    text = extractTextFromPdf(bytes);
    metadata = parseRailTicketText(text, asset.name);

    // 2. Oryginalne rastry kodów Aztec/QR z PDF (wsparcie wielu kodów dla przesiadek)
    try {
      const barcodes = extractBarcodesFromPdf(bytes);
      for (let i = 0; i < barcodes.length; i++) {
        const bc = barcodes[i];
        const bcUri = `${dir}${ticketId}_barcode_${i}.${bc.extension}`;
        const bcBase64 = uint8ArrayToBase64(bc.bytes);
        await FileSystem.writeAsStringAsync(bcUri, bcBase64, {
          encoding: FileSystem.EncodingType.Base64,
        });
        barcodeUris.push(bcUri);
      }
      if (barcodeUris.length > 0) {
        barcodeUri = barcodeUris[0];
      }
    } catch (barcodeErr) {
      console.warn('[TicketStorage] Barcode extraction error:', barcodeErr);
    }
  } catch (err) {
    console.warn('[TicketStorage] PDF parsing failed, keeping basic metadata:', err);
  }

  // 2. Bezpiecznik semantyczny: czy to faktycznie jest bilet kolejowy?
  const hasBarcode = Boolean(barcodeUri);
  const looksLikeTicket = isLikelyRailTicket(text, asset.name, hasBarcode);

  if (!looksLikeTicket) {
    // Sprzątamy skopiowane pliki
    try {
      await FileSystem.deleteAsync(targetUri, { idempotent: true });
      for (const uri of barcodeUris) {
        await FileSystem.deleteAsync(uri, { idempotent: true });
      }
    } catch {}

    Alert.alert(
      'To nie wygląda na bilet kolejowy',
      'Wybrany dokument PDF nie zawiera kodu do kontroli ani danych podróży kolejowej. Upewnij się, że wybierasz właściwy bilet.',
    );
    return null;
  }

  // Wzbogać metadane z samego połączenia, jeśli nie zostały znalezione w tekście PDF
  if (connection) {
    const summary = getTrainLegSummary(connection);
    if (summary) {
      if (!metadata.trainNumber && summary.trainNumber) {
        metadata.trainNumber = summary.trainNumber;
      }
      if (!metadata.fromStation) {
        metadata.fromStation = summary.fromStation;
      }
      if (!metadata.toStation) {
        metadata.toStation = summary.toStation;
      }
      if (!metadata.departTime && summary.departureTime) {
        metadata.departTime = summary.departureTime;
      }
    }
  }

  const now = Date.now();
  const ticket: AttachedRailTicket = {
    id: ticketId,
    connectionId,
    fileName: asset.name || 'bilet.pdf',
    fileUri: targetUri,
    fileSize: declaredSize,
    addedAt: now,
    tripDate: connection?.serviceDate,
    barcodeUri,
    barcodeUris,
    metadata,
  };

  await kvSet(`ticket:${connectionId}`, JSON.stringify(ticket));

  // Zapis do indeksu
  const current = await loadIndex();
  const updated = current.filter((e) => e.connectionId !== connectionId);
  updated.push({
    id: ticketId,
    connectionId,
    fileUri: targetUri,
    fileName: ticket.fileName,
    fileSize: ticket.fileSize,
    addedAt: now,
    tripDate: ticket.tripDate,
  });
  await saveIndex(updated);

  // Uruchomienie czyszczenia przedawnionych biletów w tle
  void cleanupExpiredTickets().catch((err) =>
    console.warn('[TicketStorage] cleanupExpiredTickets background error:', err),
  );

  return ticket;
}

/**
 * Sprawdza czy bilet kwalifikuje się do usunięcia wg polityki retencji (domyślnie 14 dni).
 */
export function isTicketExpired(
  entry: { addedAt: number; tripDate?: string },
  now = Date.now(),
  retentionDays = DEFAULT_RETENTION_DAYS,
): boolean {
  const maxAgeMs = retentionDays * 24 * 3600 * 1000;

  if (entry.tripDate) {
    const tripTimestamp = Date.parse(`${entry.tripDate}T23:59:59`);
    if (!Number.isNaN(tripTimestamp)) {
      return now > tripTimestamp + maxAgeMs;
    }
  }

  return now > entry.addedAt + maxAgeMs;
}

/**
 * Usuwa przedawnione bilety z bazy i dysku w operacji atomowej.
 */
export async function cleanupExpiredTickets(
  retentionDays = DEFAULT_RETENTION_DAYS,
  now = Date.now(),
): Promise<number> {
  const index = await loadIndex();
  if (index.length === 0) return 0;

  const remaining: TicketIndexEntry[] = [];
  let removedCount = 0;

  for (const entry of index) {
    if (isTicketExpired(entry, now, retentionDays)) {
      try {
        const ticketRaw = await kvGet(`ticket:${entry.connectionId}`);
        if (ticketRaw) {
          const ticket = JSON.parse(ticketRaw) as AttachedRailTicket;
          if (ticket.fileUri) await FileSystem.deleteAsync(ticket.fileUri, { idempotent: true });
          if (ticket.barcodeUri) await FileSystem.deleteAsync(ticket.barcodeUri, { idempotent: true });
          if (ticket.barcodeUris) {
            for (const uri of ticket.barcodeUris) {
              await FileSystem.deleteAsync(uri, { idempotent: true });
            }
          }
        }
        await kvRemove(`ticket:${entry.connectionId}`);
        removedCount++;
      } catch (err) {
        console.warn(`[TicketStorage] Failed to prune ticket for ${entry.connectionId}:`, err);
      }
    } else {
      remaining.push(entry);
    }
  }

  if (removedCount > 0) {
    await saveIndex(remaining);
  }

  return removedCount;
}

/**
 * Otwiera bilet PDF za pomocą natywnego mechanizmu udostępniania / podglądu systemu.
 */
export async function openTicketPdf(ticket: AttachedRailTicket): Promise<boolean> {
  let Sharing: typeof import('expo-sharing');
  try {
    Sharing = await import('expo-sharing');
  } catch (err) {
    console.warn('[TicketStorage] expo-sharing unavailable:', err);
    return false;
  }

  try {
    const isAvailable = await Sharing.isAvailableAsync();
    if (!isAvailable) {
      console.warn('[TicketStorage] Sharing is not available on this platform');
      return false;
    }

    await Sharing.shareAsync(ticket.fileUri, {
      mimeType: 'application/pdf',
      dialogTitle: ticket.fileName || 'Bilet kolejowy',
      UTI: 'com.adobe.pdf',
    });
    return true;
  } catch (err) {
    console.warn('[TicketStorage] Open ticket PDF failed:', err);
    return false;
  }
}
