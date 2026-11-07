import * as FileSystem from 'expo-file-system/legacy';
import { kvGet, kvRemove, kvSet } from './storage';
import { extractTextFromPdf, parseRailTicketText, type ParsedTicketMetadata } from './ticketParser';
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

function base64ToUint8Array(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
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
 */
export async function getTicketForConnection(
  connectionId: string,
): Promise<AttachedRailTicket | null> {
  const raw = await kvGet(`ticket:${connectionId}`);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as AttachedRailTicket;
    const fileInfo = await FileSystem.getInfoAsync(parsed.fileUri);
    if (!fileInfo.exists) {
      await deleteTicketForConnection(connectionId);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Usuwa dołączony bilet, kasuje plik PDF oraz czyści indeks.
 */
export async function deleteTicketForConnection(connectionId: string): Promise<void> {
  const ticketRaw = await kvGet(`ticket:${connectionId}`);
  if (ticketRaw) {
    try {
      const ticket = JSON.parse(ticketRaw) as AttachedRailTicket;
      if (ticket.fileUri) {
        await FileSystem.deleteAsync(ticket.fileUri, { idempotent: true });
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
  const dir = await ensureTicketDir();
  if (!dir) throw new Error('Tickets directory unavailable');

  const ticketId = `ticket_${Date.now()}`;
  const targetUri = `${dir}${ticketId}.pdf`;

  // Kopiowanie pliku do trwałego folderu aplikacji
  await FileSystem.copyAsync({
    from: asset.uri,
    to: targetUri,
  });

  // Odczyt zawartości i analiza tekstu
  let metadata: ParsedTicketMetadata = {};
  try {
    const base64 = await FileSystem.readAsStringAsync(targetUri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    const bytes = base64ToUint8Array(base64);
    const text = extractTextFromPdf(bytes);
    metadata = parseRailTicketText(text, asset.name);
  } catch (err) {
    console.warn('[TicketStorage] PDF parsing failed, keeping basic metadata:', err);
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
    fileSize: asset.size ?? 0,
    addedAt: now,
    tripDate: connection?.serviceDate,
    metadata,
  };

  await kvSet(`ticket:${connectionId}`, JSON.stringify(ticket));

  // Zapis do indeksu
  const current = await loadIndex();
  const filtered = current.filter((e) => e.connectionId !== connectionId);
  filtered.push({
    id: ticket.id,
    connectionId: ticket.connectionId,
    fileUri: ticket.fileUri,
    fileName: ticket.fileName,
    fileSize: ticket.fileSize,
    addedAt: ticket.addedAt,
    tripDate: ticket.tripDate,
  });
  await saveIndex(filtered);

  return ticket;
}

/**
 * Otwiera bilet za pomocą systemowej przeglądarki plików lub menu udostępniania.
 */
export async function openTicketPdf(ticket: AttachedRailTicket): Promise<boolean> {
  try {
    const Sharing = await import('expo-sharing');
    const isAvailable = await Sharing.isAvailableAsync();
    if (isAvailable) {
      await Sharing.shareAsync(ticket.fileUri, {
        mimeType: 'application/pdf',
        dialogTitle: 'Bilet kolejowy',
        UTI: 'com.adobe.pdf',
      });
      return true;
    }
  } catch (err) {
    console.warn('[TicketStorage] Sharing failed:', err);
  }
  return false;
}

/**
 * Sprawdza czy bilet przekroczył okres retencji (domyślnie 14 dni po dacie podróży lub dodania).
 */
export function isTicketExpired(
  entry: { addedAt: number; tripDate?: string },
  now = Date.now(),
  retentionDays = DEFAULT_RETENTION_DAYS,
): boolean {
  const retentionMs = retentionDays * 24 * 3600 * 1000;
  if (entry.tripDate) {
    const tripTimestamp = Date.parse(`${entry.tripDate}T23:59:59`);
    if (!isNaN(tripTimestamp)) {
      return now > tripTimestamp + retentionMs;
    }
  }
  return now > entry.addedAt + retentionMs;
}

/**
 * Usuwa przedawnione bilety z bazy i dysku.
 * Zwraca liczbę usuniętych biletów.
 */
export async function cleanupExpiredTickets(
  retentionDays = DEFAULT_RETENTION_DAYS,
  now = Date.now(),
): Promise<number> {
  const index = await loadIndex();
  let removedCount = 0;
  const remaining: TicketIndexEntry[] = [];

  for (const entry of index) {
    if (isTicketExpired(entry, now, retentionDays)) {
      try {
        await FileSystem.deleteAsync(entry.fileUri, { idempotent: true });
      } catch (err) {
        console.warn('[TicketStorage] cleanup delete file error:', err);
      }
      await kvRemove(`ticket:${entry.connectionId}`);
      removedCount++;
    } else {
      remaining.push(entry);
    }
  }

  if (removedCount > 0) {
    await saveIndex(remaining);
  }

  // Opcjonalnie: skan katalogu tickets/ w poszukiwaniu osieroconych plików PDF
  try {
    const dir = getTicketDir();
    if (dir) {
      const files = await FileSystem.readDirectoryAsync(dir);
      const activeUris = new Set(remaining.map((e) => e.fileUri));
      for (const file of files) {
        if (!file.endsWith('.pdf')) continue;
        const fullUri = `${dir}${file}`;
        if (!activeUris.has(fullUri)) {
          // Osierocony plik – sprawdź jego wiek
          const info = await FileSystem.getInfoAsync(fullUri);
          if (info.exists && info.modificationTime) {
            const modMs = info.modificationTime * 1000;
            if (now > modMs + retentionDays * 24 * 3600 * 1000) {
              await FileSystem.deleteAsync(fullUri, { idempotent: true });
            }
          }
        }
      }
    }
  } catch {
    // Katalog może nie istnieć lub readDirectory może być niedostępne
  }

  return removedCount;
}

