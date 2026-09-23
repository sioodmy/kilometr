// Parsery CSV pracujące na stringach (nie na plikach) — dzięki temu te same
// funkcje działają w Node (skrypt budujący .db) i w Hermes na telefonie
// (import chunków GTFS z expo-file-system). Bez node:fs / node:readline.

import { normalizePolish, timeStringToSeconds } from './geo';
import type { GtfsCalendar, GtfsCalendarDate, GtfsRoute, GtfsStop, GtfsStopTime, GtfsTrip } from './types';

/** Dzieli linię CSV z uwzględnieniem cudzysłowów. */
export function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

function splitLines(content: string): string[] {
  return content.replace(/^\uFEFF/, '').split(/\r?\n/);
}

export function parseStopsContent(content: string): GtfsStop[] {
  const lines = splitLines(content);
  if (lines.length === 0) return [];
  const header = parseCsvLine(lines[0]);

  const idIdx = header.indexOf('stop_id');
  const codeIdx = header.indexOf('stop_code');
  const nameIdx = header.indexOf('stop_name');
  const latIdx = header.indexOf('stop_lat');
  const lonIdx = header.indexOf('stop_lon');

  const out: GtfsStop[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = parseCsvLine(line);
    const stop_id = cols[idIdx]?.trim();
    const stop_name = cols[nameIdx]?.trim();
    if (!stop_id || !stop_name) continue;
    out.push({
      stop_id,
      stop_code: cols[codeIdx]?.trim() || '',
      stop_name,
      stop_lat: Number(cols[latIdx]) || 0,
      stop_lon: Number(cols[lonIdx]) || 0,
      normalized_name: normalizePolish(stop_name),
    });
  }
  return out;
}

export function parseRoutesContent(content: string): GtfsRoute[] {
  const lines = splitLines(content);
  if (lines.length === 0) return [];
  const header = parseCsvLine(lines[0]);

  const idIdx = header.indexOf('route_id');
  const shortIdx = header.indexOf('route_short_name');
  const longIdx = header.indexOf('route_long_name');
  const typeIdx = header.indexOf('route_type');

  const out: GtfsRoute[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = parseCsvLine(line);
    const route_id = cols[idIdx]?.trim();
    if (!route_id) continue;
    const rawType = cols[typeIdx]?.trim();
    out.push({
      route_id,
      route_short_name: cols[shortIdx]?.trim() || route_id,
      route_long_name: cols[longIdx]?.trim() || '',
      route_type: rawType !== '' && rawType !== undefined && !isNaN(Number(rawType)) ? Number(rawType) : 3,
    });
  }
  return out;
}

export function parseCalendarContent(content: string): GtfsCalendar[] {
  const lines = splitLines(content);
  if (lines.length < 2) return [];
  const header = parseCsvLine(lines[0]);

  const idIdx = header.indexOf('service_id');
  const monIdx = header.indexOf('monday');
  const tueIdx = header.indexOf('tuesday');
  const wedIdx = header.indexOf('wednesday');
  const thuIdx = header.indexOf('thursday');
  const friIdx = header.indexOf('friday');
  const satIdx = header.indexOf('saturday');
  const sunIdx = header.indexOf('sunday');
  const startIdx = header.indexOf('start_date');
  const endIdx = header.indexOf('end_date');

  const out: GtfsCalendar[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = parseCsvLine(line);
    const service_id = cols[idIdx]?.trim();
    if (!service_id) continue;
    out.push({
      service_id,
      monday: Number(cols[monIdx]) || 0,
      tuesday: Number(cols[tueIdx]) || 0,
      wednesday: Number(cols[wedIdx]) || 0,
      thursday: Number(cols[thuIdx]) || 0,
      friday: Number(cols[friIdx]) || 0,
      saturday: Number(cols[satIdx]) || 0,
      sunday: Number(cols[sunIdx]) || 0,
      start_date: cols[startIdx]?.trim() || '',
      end_date: cols[endIdx]?.trim() || '',
    });
  }
  return out;
}

export function parseCalendarDatesContent(content: string): GtfsCalendarDate[] {
  const lines = splitLines(content);
  if (lines.length < 2) return [];
  const header = parseCsvLine(lines[0]);

  const serviceIdx = header.indexOf('service_id');
  const dateIdx = header.indexOf('date');
  const typeIdx = header.indexOf('exception_type');

  const out: GtfsCalendarDate[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = parseCsvLine(line);
    const service_id = cols[serviceIdx]?.trim();
    if (!service_id) continue;
    out.push({
      service_id,
      date: cols[dateIdx]?.trim() || '',
      exception_type: Number(cols[typeIdx]) || 0,
    });
  }
  return out;
}

export function parseTripsContent(content: string, activeServiceIds?: Set<string>): GtfsTrip[] {
  const lines = splitLines(content);
  if (lines.length < 2) return [];
  const header = parseCsvLine(lines[0]);

  const routeIdx = header.indexOf('route_id');
  const serviceIdx = header.indexOf('service_id');
  const tripIdx = header.indexOf('trip_id');
  const headsignIdx = header.indexOf('trip_headsign');
  const dirIdx = header.indexOf('direction_id');
  const shapeIdx = header.indexOf('shape_id');
  const brigadeIdx = header.indexOf('brigade_id');

  const out: GtfsTrip[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = parseCsvLine(line);
    const trip_id = cols[tripIdx]?.trim();
    const service_id = cols[serviceIdx]?.trim();
    const route_id = cols[routeIdx]?.trim();
    if (!trip_id || !service_id || !route_id) continue;
    if (activeServiceIds && !activeServiceIds.has(service_id)) continue;
    out.push({
      trip_id,
      service_id,
      route_id,
      trip_headsign: cols[headsignIdx]?.trim() || '',
      direction_id: Number(cols[dirIdx]) || 0,
      shape_id: cols[shapeIdx]?.trim() || '',
      brigade_id: cols[brigadeIdx]?.trim(),
    });
  }
  return out;
}

/**
 * Parsuje stop_times w chunkach — stop_times.txt ma ~46 MB, więc nie trzymamy
 * całego pliku w pamięci jako tablicy linii na telefonie. `onBatch` dostaje
 * porcje po `batchSize` rekordów; caller wrzuca je do SQLite w transakcji.
 */
export async function parseStopTimesBatched(
  content: string,
  onBatch: (batch: GtfsStopTime[]) => Promise<void> | void,
  opts?: { batchSize?: number; activeTripIds?: Set<string> },
): Promise<number> {
  const batchSize = opts?.batchSize ?? 5000;
  const activeTripIds = opts?.activeTripIds;
  const lines = splitLines(content);
  if (lines.length < 2) return 0;
  const header = parseCsvLine(lines[0]);
  const tripIdx = header.indexOf('trip_id');
  const arrIdx = header.indexOf('arrival_time');
  const depIdx = header.indexOf('departure_time');
  const stopIdx = header.indexOf('stop_id');
  const seqIdx = header.indexOf('stop_sequence');

  let batch: GtfsStopTime[] = [];
  let total = 0;
  for (let i = 1; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed) continue;
    const cols = parseCsvLine(trimmed);
    const trip_id = cols[tripIdx]?.trim();
    if (!trip_id) continue;
    if (activeTripIds && !activeTripIds.has(trip_id)) continue;
    const arrTime = cols[arrIdx]?.trim() || '00:00:00';
    const depTime = cols[depIdx]?.trim() || arrTime;
    batch.push({
      trip_id,
      arrival_time: arrTime,
      departure_time: depTime,
      arrival_sec: timeStringToSeconds(arrTime),
      departure_sec: timeStringToSeconds(depTime),
      stop_id: cols[stopIdx]?.trim(),
      stop_sequence: Number(cols[seqIdx]) || 0,
    });
    if (batch.length >= batchSize) {
      total += batch.length;
      await onBatch(batch);
      batch = [];
    }
  }
  if (batch.length > 0) {
    total += batch.length;
    await onBatch(batch);
  }
  return total;
}
