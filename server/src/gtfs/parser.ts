import fs from 'node:fs';
import readline from 'node:readline';
import {
  GtfsCalendar,
  GtfsCalendarDate,
  GtfsRoute,
  GtfsShapePoint,
  GtfsStop,
  GtfsStopTime,
  GtfsTrip,
} from './types';
import { normalizePolish, timeStringToSeconds } from './geo';

/** Split CSV line taking quotes into account */
function parseCsvLine(line: string): string[] {
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

export function parseStops(filePath: string): Map<string, GtfsStop> {
  const content = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  const lines = content.split(/\r?\n/);
  const header = parseCsvLine(lines[0]);

  const idIdx = header.indexOf('stop_id');
  const codeIdx = header.indexOf('stop_code');
  const nameIdx = header.indexOf('stop_name');
  const latIdx = header.indexOf('stop_lat');
  const lonIdx = header.indexOf('stop_lon');

  const stops = new Map<string, GtfsStop>();

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = parseCsvLine(line);
    const stop_id = cols[idIdx]?.trim();
    const stop_name = cols[nameIdx]?.trim();
    if (!stop_id || !stop_name) continue;

    stops.set(stop_id, {
      stop_id,
      stop_code: cols[codeIdx]?.trim() || '',
      stop_name,
      stop_lat: Number(cols[latIdx]) || 0,
      stop_lon: Number(cols[lonIdx]) || 0,
      normalized_name: normalizePolish(stop_name),
    });
  }

  return stops;
}

export function parseRoutes(filePath: string): Map<string, GtfsRoute> {
  const content = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  const lines = content.split(/\r?\n/);
  const header = parseCsvLine(lines[0]);

  const idIdx = header.indexOf('route_id');
  const shortIdx = header.indexOf('route_short_name');
  const longIdx = header.indexOf('route_long_name');
  const typeIdx = header.indexOf('route_type');

  const routes = new Map<string, GtfsRoute>();

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = parseCsvLine(line);
    const route_id = cols[idIdx]?.trim();
    if (!route_id) continue;

    const rawType = cols[typeIdx]?.trim();
    routes.set(route_id, {
      route_id,
      route_short_name: cols[shortIdx]?.trim() || route_id,
      route_long_name: cols[longIdx]?.trim() || '',
      route_type: rawType !== '' && rawType !== undefined && !isNaN(Number(rawType)) ? Number(rawType) : 3,
    });
  }

  return routes;
}

export function parseCalendar(filePath: string): Map<string, GtfsCalendar> {
  const content = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  const lines = content.split(/\r?\n/);
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

  const calendar = new Map<string, GtfsCalendar>();

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = parseCsvLine(line);
    const service_id = cols[idIdx]?.trim();
    if (!service_id) continue;

    calendar.set(service_id, {
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

  return calendar;
}

export function parseCalendarDates(filePath: string): GtfsCalendarDate[] {
  if (!fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  const lines = content.split(/\r?\n/);
  if (lines.length < 2) return [];
  const header = parseCsvLine(lines[0]);

  const serviceIdx = header.indexOf('service_id');
  const dateIdx = header.indexOf('date');
  const typeIdx = header.indexOf('exception_type');

  const results: GtfsCalendarDate[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = parseCsvLine(line);
    const service_id = cols[serviceIdx]?.trim();
    if (!service_id) continue;

    results.push({
      service_id,
      date: cols[dateIdx]?.trim() || '',
      exception_type: Number(cols[typeIdx]) || 0,
    });
  }

  return results;
}

export function parseTrips(
  filePath: string,
  activeServiceIds?: Set<string>
): { tripsById: Map<string, GtfsTrip>; tripsByRouteId: Map<string, GtfsTrip[]> } {
  const content = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  const lines = content.split(/\r?\n/);
  const header = parseCsvLine(lines[0]);

  const routeIdx = header.indexOf('route_id');
  const serviceIdx = header.indexOf('service_id');
  const tripIdx = header.indexOf('trip_id');
  const headsignIdx = header.indexOf('trip_headsign');
  const dirIdx = header.indexOf('direction_id');
  const shapeIdx = header.indexOf('shape_id');
  const brigadeIdx = header.indexOf('brigade_id');

  const tripsById = new Map<string, GtfsTrip>();
  const tripsByRouteId = new Map<string, GtfsTrip[]>();

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = parseCsvLine(line);
    const trip_id = cols[tripIdx]?.trim();
    const service_id = cols[serviceIdx]?.trim();
    const route_id = cols[routeIdx]?.trim();

    if (!trip_id || !service_id || !route_id) continue;
    if (activeServiceIds && !activeServiceIds.has(service_id)) continue;

    const trip: GtfsTrip = {
      trip_id,
      service_id,
      route_id,
      trip_headsign: cols[headsignIdx]?.trim() || '',
      direction_id: Number(cols[dirIdx]) || 0,
      shape_id: cols[shapeIdx]?.trim() || '',
      brigade_id: cols[brigadeIdx]?.trim(),
    };

    tripsById.set(trip_id, trip);
    let list = tripsByRouteId.get(route_id);
    if (!list) {
      list = [];
      tripsByRouteId.set(route_id, list);
    }
    list.push(trip);
  }

  return { tripsById, tripsByRouteId };
}

export async function parseStopTimes(
  filePath: string,
  activeTripIds?: Set<string>
): Promise<Map<string, GtfsStopTime[]>> {
  const stopTimesByTrip = new Map<string, GtfsStopTime[]>();

  const fileStream = fs.createReadStream(filePath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  let headerRead = false;
  let tripIdx = -1;
  let arrIdx = -1;
  let depIdx = -1;
  let stopIdx = -1;
  let seqIdx = -1;

  for await (const line of rl) {
    if (!headerRead) {
      headerRead = true;
      const header = parseCsvLine(line.replace(/^\uFEFF/, ''));
      tripIdx = header.indexOf('trip_id');
      arrIdx = header.indexOf('arrival_time');
      depIdx = header.indexOf('departure_time');
      stopIdx = header.indexOf('stop_id');
      seqIdx = header.indexOf('stop_sequence');
      continue;
    }

    const trimmed = line.trim();
    if (!trimmed) continue;
    const cols = parseCsvLine(trimmed);
    const trip_id = cols[tripIdx]?.trim();

    if (!trip_id) continue;
    if (activeTripIds && !activeTripIds.has(trip_id)) continue;

    const arrTime = cols[arrIdx]?.trim() || '00:00:00';
    const depTime = cols[depIdx]?.trim() || arrTime;
    const stop_id = cols[stopIdx]?.trim();
    const stop_sequence = Number(cols[seqIdx]) || 0;

    const stopTime: GtfsStopTime = {
      trip_id,
      arrival_time: arrTime,
      departure_time: depTime,
      arrival_sec: timeStringToSeconds(arrTime),
      departure_sec: timeStringToSeconds(depTime),
      stop_id,
      stop_sequence,
    };

    let list = stopTimesByTrip.get(trip_id);
    if (!list) {
      list = [];
      stopTimesByTrip.set(trip_id, list);
    }
    list.push(stopTime);
  }

  // Ensure stop sequences are sorted
  for (const list of stopTimesByTrip.values()) {
    list.sort((a, b) => a.stop_sequence - b.stop_sequence);
  }

  return stopTimesByTrip;
}

export async function parseShapes(
  filePath: string
): Promise<Map<string, { lat: number; lon: number }[]>> {
  const shapes = new Map<string, { lat: number; lon: number; seq: number }[]>();

  if (!fs.existsSync(filePath)) return new Map();

  const fileStream = fs.createReadStream(filePath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  let headerRead = false;
  let shapeIdx = -1;
  let latIdx = -1;
  let lonIdx = -1;
  let seqIdx = -1;

  for await (const line of rl) {
    if (!headerRead) {
      headerRead = true;
      const header = parseCsvLine(line.replace(/^\uFEFF/, ''));
      shapeIdx = header.indexOf('shape_id');
      latIdx = header.indexOf('shape_pt_lat');
      lonIdx = header.indexOf('shape_pt_lon');
      seqIdx = header.indexOf('shape_pt_sequence');
      continue;
    }

    const trimmed = line.trim();
    if (!trimmed) continue;
    const cols = parseCsvLine(trimmed);
    const shape_id = cols[shapeIdx]?.trim();
    if (!shape_id) continue;

    let list = shapes.get(shape_id);
    if (!list) {
      list = [];
      shapes.set(shape_id, list);
    }
    list.push({
      lat: Number(cols[latIdx]) || 0,
      lon: Number(cols[lonIdx]) || 0,
      seq: Number(cols[seqIdx]) || 0,
    });
  }

  const result = new Map<string, { lat: number; lon: number }[]>();
  for (const [shape_id, pts] of shapes.entries()) {
    pts.sort((a, b) => a.seq - b.seq);
    result.set(
      shape_id,
      pts.map((p) => ({ lat: p.lat, lon: p.lon }))
    );
  }

  return result;
}
