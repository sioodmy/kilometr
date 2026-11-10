import * as FileSystem from 'expo-file-system/legacy';
import * as DocumentPicker from 'expo-document-picker';
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
import type { Connection, Leg } from '../types/models';
import { getTrainLegSummary, isStationMatch } from './ticketing';
import { isTrainLeg } from './railIdentity';
import { normalizeConnectionId, stableConnectionId, scheduledLegDepart } from './routing/connectionIdentity';
import { secondsToTimeString, timeStringToSeconds } from '../gtfs/geo';
import { connectionDelayAtAttachSec, fetchDelayAtAttachSec } from './notifications/compensation';

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
  /** Opóźnienie kursu w chwili dołączenia biletu; blokuje alert o zastanym opóźnieniu. */
  delayAtAttachSec?: number;
  metadata: ParsedTicketMetadata;
}

export interface TicketIndexEntry {
  id: string;
  connectionId: string;
  normalizedConnectionId?: string;
  stableConnectionId?: string;
  fileUri: string;
  fileName: string;
  fileSize: number;
  addedAt: number;
  tripDate?: string;
  trainNumber?: string;
  departTime?: string;
  fromStation?: string;
  toStation?: string;
  delayAtAttachSec?: number;
}

/** Dlaczego bilet nie został dołączony; UI pokazuje dla tego dialog M3. */
type TicketRejectionReason = 'tooLarge' | 'notTicket' | 'wrongTrain' | 'wrongDate';

export interface TicketImportRejected {
  status: 'rejected';
  reason: TicketRejectionReason;
  /** Numer pociągu z biletu (wrongTrain). */
  ticketTrainNumber?: string;
  /** Numer pociągu łączenia (wrongTrain). */
  connectionTrainNumber?: string;
  /** Data z biletu, format YYYY-MM-DD (wrongDate). */
  ticketDate?: string;
  /** Data połączenia, format YYYY-MM-DD (wrongDate). */
  connectionDate?: string;
}

export type TicketImportResult =
  | { status: 'attached'; ticket: AttachedRailTicket }
  | { status: 'cancelled' }
  | TicketImportRejected;

const TICKET_INDEX_KEY = 'rail_tickets:index';
const DEFAULT_RETENTION_DAYS = 14;
const MAX_TICKET_FILE_SIZE = 10 * 1024 * 1024; // 10 MB limit bezpieczeństwa (ochrona pamięci i storage)
// Bilet dodany w ciągu doby od teraz nigdy nie jest sprzątany: retencja czyta
// stare pliki, a nie walczy z użytkownikiem, który właśnie dołączył bilet.
const RETENTION_GRACE_MS = 24 * 3600 * 1000;

export function getTicketDir(): string | null {
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

/**
 * Rozwiązuje ścieżkę do biletu/kodu dynamicznie względem bieżącego kontenera aplikacji.
 * Na iOS UUID kontenera sandboxu aplikacji zmienia się pomiędzy restartami aplikacji.
 */
export function resolveTicketUri(storedUri?: string | null, fallbackFileName?: string): string | null {
  if (!storedUri && !fallbackFileName) return null;
  const dir = getTicketDir();
  if (!dir) return storedUri ?? null;
  const rawFileName = storedUri ? storedUri.split('/').pop()?.split('?')[0] : fallbackFileName;
  if (!rawFileName) return storedUri ?? null;
  return `${dir}${rawFileName}`;
}

async function checkTicketFileExists(
  uri: string,
  fallbackFileName?: string,
): Promise<{ exists: boolean; resolvedUri: string }> {
  try {
    const directInfo = await FileSystem.getInfoAsync(uri);
    if (directInfo.exists) {
      return { exists: true, resolvedUri: uri };
    }
  } catch {}

  const resolved = resolveTicketUri(uri, fallbackFileName);
  if (resolved && resolved !== uri) {
    try {
      const resolvedInfo = await FileSystem.getInfoAsync(resolved);
      if (resolvedInfo.exists) {
        return { exists: true, resolvedUri: resolved };
      }
    } catch {}
  }

  return { exists: false, resolvedUri: resolved ?? uri };
}

function resolveTicketUrisInPlace(ticket: AttachedRailTicket, resolvedFileUri?: string): AttachedRailTicket {
  if (resolvedFileUri) {
    ticket.fileUri = resolvedFileUri;
  }
  if (ticket.barcodeUri) {
    const resolvedBarcode = resolveTicketUri(ticket.barcodeUri);
    if (resolvedBarcode) ticket.barcodeUri = resolvedBarcode;
  }
  if (ticket.barcodeUris && ticket.barcodeUris.length > 0) {
    ticket.barcodeUris = ticket.barcodeUris.map((u) => resolveTicketUri(u) ?? u);
  }
  return ticket;
}

function normalizeTrainStr(str?: string | null): string {
  if (!str) return '';
  return str.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
}

function parseTrainTokens(trainStr?: string | null): string[] {
  if (!trainStr) return [];
  const clean = trainStr.trim().toUpperCase();
  const tokens = new Set<string>();
  const normalized = normalizeTrainStr(clean);
  if (normalized) tokens.add(normalized);

  const parts = clean.split(/[\s/]+/);
  for (const part of parts) {
    const norm = normalizeTrainStr(part);
    if (norm) tokens.add(norm);
  }

  const digitsMatch = clean.match(/\d{3,6}/g);
  if (digitsMatch) {
    for (const d of digitsMatch) {
      tokens.add(d);
    }
  }

  return Array.from(tokens);
}

function timeMatches(leg: Leg, ticketDepartTime?: string): boolean {
  if (!ticketDepartTime) return false;
  const target = ticketDepartTime.trim();
  if (leg.departAt === target) return true;

  if (leg.scheduledDepartureSec != null) {
    const scheduled = secondsToTimeString(leg.scheduledDepartureSec);
    if (scheduled === target) return true;
  }

  const sched = scheduledLegDepart(leg);
  if (sched && sched === target) return true;

  try {
    const legSec = timeStringToSeconds(leg.departAt);
    const targetSec = timeStringToSeconds(target);
    const diffSec = legSec - targetSec;
    // Pociąg ma opóźnienie (od 0 do 180 min, dopuszczamy też minimalne różnice rozkładowe do 2 min)
    if (diffSec >= -120 && diffSec <= 180 * 60) {
      if (leg.delaySec && Math.abs(diffSec - leg.delaySec) <= 180) {
        return true;
      }
      if (diffSec >= 0 && diffSec <= 90 * 60) {
        return true;
      }
    }
  } catch {}

  return false;
}

function ticketMatchesTrainConnection(
  ticket: AttachedRailTicket,
  connection: Connection,
): boolean {
  const trainLegs = connection.legs.filter(isTrainLeg);
  if (trainLegs.length === 0) return false;

  const serviceDate = connection.serviceDate;
  if (serviceDate && ticket.tripDate && serviceDate !== ticket.tripDate) {
    return false;
  }

  const ticketTrainTokens = parseTrainTokens(ticket.metadata.trainNumber);
  const ticketDigits = ticket.metadata.trainNumber?.match(/\d{3,6}/g) ?? [];

  for (const leg of trainLegs) {
    const legTokens = [
      ...parseTrainTokens(leg.trainNumber),
      ...parseTrainTokens(leg.line),
      ...parseTrainTokens(leg.railLine),
      ...parseTrainTokens(leg.trainName),
      ...parseTrainTokens(leg.tripId),
      ...parseTrainTokens(leg.direction),
    ];

    const legDigits = [
      ...(leg.trainNumber?.match(/\d{3,6}/g) ?? []),
      ...(leg.line?.match(/\d{3,6}/g) ?? []),
      ...(leg.railLine?.match(/\d{3,6}/g) ?? []),
      ...(leg.tripId?.match(/\d{3,6}/g) ?? []),
      ...(leg.direction?.match(/\d{3,6}/g) ?? []),
    ];

    // 1. Dokładne dopasowanie numeru operacyjnego pociągu (ciągi 3-6 cyfr, np. 69123 / 65100)
    const hasExactDigitMatch = ticketDigits.length > 0 && ticketDigits.some((td) => legDigits.includes(td));
    if (hasExactDigitMatch) {
      if (ticket.metadata.fromStation && !isStationMatch(ticket.metadata.fromStation, leg.fromStop)) {
        // Stacja początkowa ewidentnie inna - pomiń ten leg
      } else {
        return true;
      }
    }

    // 2. Dopasowanie ogólnych tokenów (np. nazwa pociągu "HEWELIUSZ", pełny kod "KD 69123")
    if (ticketTrainTokens.length > 0 && legTokens.length > 0) {
      const match = ticketTrainTokens.some((tToken) => {
        const isCarrierOnly = /^[A-ZŁŚĆŹŻĄĘÓŃa-złśćźżąęón]{1,3}$/.test(tToken);
        if (isCarrierOnly) return false;
        return legTokens.some((lToken) => {
          if (tToken === lToken) return true;
          if (tToken.length >= 4 && lToken.includes(tToken)) return true;
          if (lToken.length >= 4 && tToken.includes(lToken)) return true;
          return false;
        });
      });
      if (match) {
        if (!ticket.metadata.fromStation || isStationMatch(ticket.metadata.fromStation, leg.fromStop)) {
          return true;
        }
      }
    }

    // 3. Dopasowanie po stacjach i godzinie odjazdu (bardzo częste dla pociągów regionalnych D1/S1/KM/PR
    // zanim zbiorkom / live feed zaktualizuje numer operacyjny)
    if (ticket.metadata.departTime && ticket.metadata.fromStation) {
      const fromStationOk = isStationMatch(ticket.metadata.fromStation, leg.fromStop);
      const toStationOk =
        !ticket.metadata.toStation || isStationMatch(ticket.metadata.toStation, leg.toStop);
      const timeOk = timeMatches(leg, ticket.metadata.departTime);
      if (fromStationOk && toStationOk && timeOk) {
        return true;
      }
    }
  }

  return false;
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

/** Surowy indeks biletów; monitor rekompensat czyta z niego daty i opóźnienie bazowe. */
export async function getTicketIndex(): Promise<TicketIndexEntry[]> {
  return loadIndex();
}

export async function saveIndex(entries: TicketIndexEntry[]): Promise<void> {
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
  const normalizedId = normalizeConnectionId(connectionId);

  // 1. Sprawdź bezpośrednio po identyfikatorze połączenia
  const candidateKeys = [
    `ticket:${connectionId}`,
    ...(normalizedId !== connectionId ? [`ticket:${normalizedId}`] : []),
    ...(connection ? [`ticket:${stableConnectionId(connection)}`] : []),
  ];

  for (const key of candidateKeys) {
    const raw = await kvGet(key);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as AttachedRailTicket;
        const { exists, resolvedUri } = await checkTicketFileExists(parsed.fileUri, `${parsed.id}.pdf`);
        if (exists) {
          resolveTicketUrisInPlace(parsed, resolvedUri);
          return parsed;
        }
      } catch {}
    }
  }

  // 2. Wyszukanie w indeksie biletów (po connectionId lub stableConnectionId)
  const index = await loadIndex();
  const stableId = connection ? stableConnectionId(connection) : null;

  for (const entry of index) {
    const isDirectMatch =
      entry.connectionId === connectionId ||
      entry.connectionId === normalizedId ||
      entry.normalizedConnectionId === normalizedId ||
      Boolean(
        stableId &&
          (entry.connectionId === stableId ||
            entry.normalizedConnectionId === stableId ||
            entry.stableConnectionId === stableId),
      );

    if (isDirectMatch) {
      const candidateRaw =
        (await kvGet(`ticket_by_id:${entry.id}`)) ??
        (await kvGet(`ticket:${entry.connectionId}`));
      if (candidateRaw) {
        try {
          const cand = JSON.parse(candidateRaw) as AttachedRailTicket;
          const { exists, resolvedUri } = await checkTicketFileExists(cand.fileUri, `${cand.id}.pdf`);
          if (exists) {
            resolveTicketUrisInPlace(cand, resolvedUri);
            await kvSet(`ticket:${connectionId}`, JSON.stringify(cand));
            return cand;
          }
        } catch {}
      }
    }
  }

  // 3. Fallback: dopasowanie po numerze pociągu / relacji / dacie z indeksu
  if (connection) {
    for (const entry of index) {
      const candidateRaw =
        (await kvGet(`ticket_by_id:${entry.id}`)) ??
        (await kvGet(`ticket:${entry.connectionId}`));
      if (!candidateRaw) continue;
      try {
        const cand = JSON.parse(candidateRaw) as AttachedRailTicket;
        if (ticketMatchesTrainConnection(cand, connection)) {
          const { exists, resolvedUri } = await checkTicketFileExists(cand.fileUri, `${cand.id}.pdf`);
          if (exists) {
            resolveTicketUrisInPlace(cand, resolvedUri);
            await kvSet(`ticket:${connectionId}`, JSON.stringify(cand));
            return cand;
          }
        }
      } catch {}
    }
  }

  return null;
}

/**
 * Usuwa dołączony bilet, kasuje plik PDF, wyekstrahowane kody kreskowe oraz czyści indeks.
 */
export async function deleteTicketForConnection(connectionId: string): Promise<void> {
  const normalizedId = normalizeConnectionId(connectionId);
  const candidateKeys = [
    `ticket:${connectionId}`,
    ...(normalizedId !== connectionId ? [`ticket:${normalizedId}`] : []),
  ];

  let foundTicket: AttachedRailTicket | null = null;
  for (const key of candidateKeys) {
    const ticketRaw = await kvGet(key);
    if (ticketRaw) {
      try {
        foundTicket = JSON.parse(ticketRaw) as AttachedRailTicket;
        break;
      } catch {}
    }
  }

  const index = await loadIndex();
  const matchedEntry = index.find(
    (e) =>
      e.connectionId === connectionId ||
      e.connectionId === normalizedId ||
      e.normalizedConnectionId === normalizedId,
  );

  if (!foundTicket && matchedEntry) {
    const raw =
      (await kvGet(`ticket_by_id:${matchedEntry.id}`)) ??
      (await kvGet(`ticket:${matchedEntry.connectionId}`));
    if (raw) {
      try {
        foundTicket = JSON.parse(raw) as AttachedRailTicket;
      } catch {}
    }
  }

  if (foundTicket) {
    const targetFile = resolveTicketUri(foundTicket.fileUri, `${foundTicket.id}.pdf`) ?? foundTicket.fileUri;
    try {
      await FileSystem.deleteAsync(targetFile, { idempotent: true });
    } catch {}

    const barcodes = [
      ...(foundTicket.barcodeUri ? [foundTicket.barcodeUri] : []),
      ...(foundTicket.barcodeUris ?? []),
    ];
    for (const bUri of barcodes) {
      const resolved = resolveTicketUri(bUri) ?? bUri;
      try {
        await FileSystem.deleteAsync(resolved, { idempotent: true });
      } catch {}
    }

    if (foundTicket.id) {
      await kvRemove(`ticket_by_id:${foundTicket.id}`);
    }
  }

  for (const key of candidateKeys) {
    await kvRemove(key);
  }

  // Aktualizacja indeksu
  const ticketId = foundTicket?.id ?? matchedEntry?.id;
  const filtered = index.filter(
    (e) =>
      e.connectionId !== connectionId &&
      e.connectionId !== normalizedId &&
      e.normalizedConnectionId !== normalizedId &&
      (!ticketId || e.id !== ticketId),
  );
  await saveIndex(filtered);
}

/**
 * Otwiera selektor plików i dołącza wybrany bilet PDF do połączenia.
 *
 * Walidacja: rozmiar (< 10 MB), wygląd biletu kolejowego oraz zgodność
 * z połączeniem (data i numer pociągu). Brak wagonu/miejsca/ulgi w tekście
 * NIE blokuje dodania: to dane opcjonalne. Odrzucenia zwracamy jako
 * TicketImportRejected (komunikat pokazuje UI), bez alertów w serwisie.
 */
export async function importTicketPdf(
  connectionId: string,
  connection?: Connection,
): Promise<TicketImportResult> {
  const picked = await DocumentPicker.getDocumentAsync({
    type: ['application/pdf', 'application/octet-stream'],
    copyToCacheDirectory: true,
    multiple: false,
  });

  if (picked.canceled) {
    return { status: 'cancelled' };
  }

  const asset = picked.assets?.[0];
  if (!asset?.uri) {
    throw new Error('DocumentPicker returned no file uri');
  }

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
    try {
      await FileSystem.deleteAsync(asset.uri, { idempotent: true });
    } catch {}
    return { status: 'rejected', reason: 'tooLarge' };
  }

  // Baseline liczony równolegle z kopiowaniem i parsowaniem PDF, żeby
  // dołączenie biletu nie czekało na feed PKP dłużej niż to konieczne.
  const liveDelayPromise: Promise<number | null> = connection
    ? fetchDelayAtAttachSec(connection).catch(() => null)
    : Promise.resolve(null);

  const dir = await ensureTicketDir();
  if (!dir) throw new Error('Tickets directory unavailable');

  const ticketId = `ticket_${Date.now()}`;
  const targetUri = `${dir}${ticketId}.pdf`;

  // Kopiowanie pliku do trwałego folderu aplikacji
  await FileSystem.copyAsync({
    from: asset.uri,
    to: targetUri,
  });

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

    text = extractTextFromPdf(bytes);
    metadata = parseRailTicketText(text, asset.name);

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
    await discardImportedFiles(targetUri, barcodeUris);
    return { status: 'rejected', reason: 'notTicket' };
  }

  // 3. Zgodność z połączeniem. Sprawdzamy tylko dane, które udało się
  // odczytać z biletu: nieczytelny numer czy data nie blokuje dodania.
  if (connection) {
    const summary = getTrainLegSummary(connection);
    const trainLegs = connection.legs.filter(isTrainLeg);

    if (metadata.departDate && connection.serviceDate && summary) {
      const dateOk =
        metadata.departDate === connection.serviceDate ||
        metadata.departDate === nextCalendarDay(connection.serviceDate);
      if (!dateOk) {
        await discardImportedFiles(targetUri, barcodeUris);
        return {
          status: 'rejected',
          reason: 'wrongDate',
          ticketDate: metadata.departDate,
          connectionDate: connection.serviceDate,
        };
      }
    }

    const ticketDigits = metadata.trainNumber?.match(/\d{3,6}/g) ?? [];
    if (summary && ticketDigits.length > 0) {
      const legDigits = trainLegs.flatMap((leg) => [
        ...(leg.trainNumber?.match(/\d{3,6}/g) ?? []),
        ...(leg.line?.match(/\d{3,6}/g) ?? []),
        ...(leg.railLine?.match(/\d{3,6}/g) ?? []),
        ...(leg.tripId?.match(/\d{3,6}/g) ?? []),
      ]);
      const digitsMatch = ticketDigits.some((d) => legDigits.includes(d));
      // Ten sam odcinek i godzina: numer mógł się różnić zapisem (np. sam numer
      // operacyjny vs pełny kod), więc nie odrzucamy.
      const stationTimeMatch =
        metadata.fromStation && metadata.departTime
          ? trainLegs.some(
              (leg) =>
                isStationMatch(metadata.fromStation, leg.fromStop) &&
                timeMatches(leg, metadata.departTime),
            )
          : false;

      if (!digitsMatch && !stationTimeMatch) {
        await discardImportedFiles(targetUri, barcodeUris);
        return {
          status: 'rejected',
          reason: 'wrongTrain',
          ticketTrainNumber: metadata.trainNumber,
          connectionTrainNumber: summary.trainNumber,
        };
      }
    }
  }

  // Wzbogać metadane z samego połączenia, jeśli nie zostały znalezione w tekście PDF.
  // Te dane napędzają odzyskiwanie biletu po powrocie (zmienne ID połączeń).
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
  // Feed PKP jest dokładniejszy niż opóźnienie zapisane w połączeniu; offline
  // zostaje wartość z połączenia, a brak jakichkolwiek danych blokuje alert.
  const delayAtAttachSec = connection
    ? ((await liveDelayPromise) ?? connectionDelayAtAttachSec(connection))
    : undefined;
  let tripDate = connection?.serviceDate;
  if (!tripDate && metadata.departDate) {
    tripDate = metadata.departDate;
  }

  const ticket: AttachedRailTicket = {
    id: ticketId,
    connectionId,
    fileName: asset.name || 'bilet.pdf',
    fileUri: targetUri,
    fileSize: declaredSize,
    addedAt: now,
    tripDate,
    barcodeUri,
    barcodeUris,
    delayAtAttachSec,
    metadata,
  };

  const serialized = JSON.stringify(ticket);
  await kvSet(`ticket:${connectionId}`, serialized);
  const normalizedId = normalizeConnectionId(connectionId);
  if (normalizedId !== connectionId) {
    await kvSet(`ticket:${normalizedId}`, serialized);
  }
  const stableId = connection ? stableConnectionId(connection) : null;
  if (stableId && stableId !== connectionId && stableId !== normalizedId) {
    await kvSet(`ticket:${stableId}`, serialized);
  }
  await kvSet(`ticket_by_id:${ticketId}`, serialized);

  // Zapis do indeksu
  const current = await loadIndex();
  const updated = current.filter(
    (e) =>
      e.connectionId !== connectionId &&
      e.connectionId !== normalizedId &&
      e.normalizedConnectionId !== normalizedId &&
      (!stableId || (e.connectionId !== stableId && e.stableConnectionId !== stableId)) &&
      e.id !== ticketId,
  );
  updated.push({
    id: ticketId,
    connectionId,
    normalizedConnectionId: normalizedId,
    stableConnectionId: stableId ?? undefined,
    fileUri: targetUri,
    fileName: ticket.fileName,
    fileSize: ticket.fileSize,
    addedAt: now,
    tripDate: ticket.tripDate,
    trainNumber: metadata.trainNumber,
    departTime: metadata.departTime,
    fromStation: metadata.fromStation,
    toStation: metadata.toStation,
    delayAtAttachSec,
  });
  await saveIndex(updated);

  void cleanupExpiredTickets().catch((err) =>
    console.warn('[TicketStorage] cleanupExpiredTickets background error:', err),
  );

  return { status: 'attached', ticket };
}

/** Usuwa plik biletu i wyekstrahowane kody po odrzuconym imporcie. */
async function discardImportedFiles(targetUri: string, barcodeUris: string[]): Promise<void> {
  try {
    await FileSystem.deleteAsync(targetUri, { idempotent: true });
    for (const uri of barcodeUris) {
      await FileSystem.deleteAsync(uri, { idempotent: true });
    }
  } catch {}
}

/** Następny dzień kalendarzowy w formacie YYYY-MM-DD (podróże po północy). */
function nextCalendarDay(dateStr: string): string | null {
  const ts = Date.parse(`${dateStr}T12:00:00Z`);
  if (Number.isNaN(ts)) return null;
  const next = new Date(ts + 24 * 3600 * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
}

/**
 * Identyfikatory połączeń z dołączonym biletem: napędza ikonę biletu
 * i kolejność w sekcji „Twoje trasy” na ekranie głównym.
 */
export async function getTicketConnectionIds(): Promise<Set<string>> {
  const index = await loadIndex();
  const set = new Set<string>();
  for (const entry of index) {
    if (entry.connectionId) {
      set.add(entry.connectionId);
      set.add(normalizeConnectionId(entry.connectionId));
    }
    if (entry.normalizedConnectionId) {
      set.add(entry.normalizedConnectionId);
    }
  }
  return set;
}

/**
 * Sprawdza czy bilet kwalifikuje się do usunięcia wg polityki retencji (domyślnie 14 dni).
 * Bilet dodany w ciągu ostatniej doby nigdy nie jest przedawniony.
 */
export function isTicketExpired(
  entry: { addedAt: number; tripDate?: string },
  now = Date.now(),
  retentionDays = DEFAULT_RETENTION_DAYS,
): boolean {
  if (now < entry.addedAt + RETENTION_GRACE_MS) {
    return false;
  }

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
        const ticketRaw =
          (await kvGet(`ticket_by_id:${entry.id}`)) ??
          (await kvGet(`ticket:${entry.connectionId}`));
        if (ticketRaw) {
          const ticket = JSON.parse(ticketRaw) as AttachedRailTicket;
          const targetFile = resolveTicketUri(ticket.fileUri, `${ticket.id}.pdf`) ?? ticket.fileUri;
          await FileSystem.deleteAsync(targetFile, { idempotent: true });
          const barcodes = [
            ...(ticket.barcodeUri ? [ticket.barcodeUri] : []),
            ...(ticket.barcodeUris ?? []),
          ];
          for (const uri of barcodes) {
            const resolved = resolveTicketUri(uri) ?? uri;
            await FileSystem.deleteAsync(resolved, { idempotent: true });
          }
        }
        await kvRemove(`ticket:${entry.connectionId}`);
        if (entry.normalizedConnectionId) {
          await kvRemove(`ticket:${entry.normalizedConnectionId}`);
        }
        await kvRemove(`ticket_by_id:${entry.id}`);
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

    const resolvedUri = resolveTicketUri(ticket.fileUri, `${ticket.id}.pdf`) ?? ticket.fileUri;
    await Sharing.shareAsync(resolvedUri, {
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
