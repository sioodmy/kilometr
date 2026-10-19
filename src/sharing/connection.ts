import { deflateSync, inflateSync, strFromU8, strToU8 } from 'fflate';
import { CITIES, type CityId } from '../cities';
import type { ShareStrings } from '../i18n/share/pl';
import type { Connection, LegMode } from '../types/models';

export const SHARE_BASE_URL = 'https://kilometr.app/';
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const modes: readonly string[] = ['walk', 'tram', 'bus', 'train', 'cable', 'trolleybus', 'subway'];
const maxEncodedLength = 8192;
const maxDecodedLength = 32768;

export interface SharedLeg {
  mode: LegMode;
  line?: string;
  direction?: string;
  from: string;
  to: string;
  departure: number;
  arrival: number;
  scheduledDeparture?: number;
  scheduledArrival?: number;
  trip?: string;
  board?: string;
  alight?: string;
  stops: number;
  walk?: number;
}

export interface SharedConnection {
  v: 1;
  city: CityId;
  date: string;
  from: string;
  to: string;
  departure: number;
  arrival: number;
  legs: SharedLeg[];
}

export function formatShareTime(minutes: number): string {
  const dayMinutes = minutes % 1440;
  return `${String(Math.floor(dayMinutes / 60)).padStart(2, '0')}:${String(dayMinutes % 60).padStart(2, '0')}`;
}

export function transferCount(journey: SharedConnection): number {
  return Math.max(0, journey.legs.filter((leg) => leg.mode !== 'walk').length - 1);
}

function clockMinutes(clock: string): number {
  const match = /^(\d{1,2}):([0-5]\d)$/.exec(clock);
  if (!match || Number(match[1]) > 47) throw new Error('Invalid journey time');
  return (Number(match[1]) * 60 + Number(match[2])) % 1440;
}

function scheduleMinute(seconds: number | undefined): number | undefined {
  return seconds == null || !Number.isFinite(seconds)
    ? undefined
    : ((Math.floor(seconds / 60) % 1440) + 1440) % 1440;
}

export function createSharedConnection(
  connection: Connection,
  city: CityId,
  now = new Date(),
): SharedConnection {
  const dateParts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Warsaw',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const part = (kind: Intl.DateTimeFormatPartTypes) =>
    Number(dateParts.find((p) => p.type === kind)?.value);
  const date = new Date(
    Date.UTC(
      part('year'),
      part('month') - 1,
      part('day') + Math.floor(connection.departureSec / 86400),
    ),
  )
    .toISOString()
    .slice(0, 10);
  const departure = clockMinutes(connection.departAt);
  let cursor = departure;
  const advance = (clock: string) => {
    let minutes = clockMinutes(clock);
    while (minutes < cursor) minutes += 1440;
    cursor = minutes;
    return minutes;
  };
  const legs = connection.legs.map((leg): SharedLeg => ({
    mode: leg.mode,
    line: leg.line,
    direction: leg.direction,
    from: leg.fromStop,
    to: leg.toStop,
    departure: advance(leg.departAt),
    arrival: advance(leg.arriveAt),
    scheduledDeparture: scheduleMinute(
      leg.intermediateStops?.find((stop) => stop.stopId === leg.fromStopId)?.departSec,
    ),
    scheduledArrival: scheduleMinute(
      leg.intermediateStops?.find((stop) => stop.stopId === leg.toStopId)?.arriveSec,
    ),
    trip: leg.tripId,
    board: leg.fromStopId,
    alight: leg.toStopId,
    stops: leg.stopsCount,
    walk: leg.walkM == null ? undefined : Math.round(leg.walkM),
  }));
  const journey: SharedConnection = {
    v: 1,
    city,
    date,
    from: connection.fromTitle,
    to: connection.toTitle,
    departure,
    arrival: advance(connection.arriveAt),
    legs,
  };
  if (!isSharedConnection(journey)) throw new Error('Invalid journey');
  return journey;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 300;
}

function optionalText(value: unknown): boolean {
  return value === undefined || (typeof value === 'string' && value.length <= 300);
}

function integer(value: unknown, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= max;
}

export function isSharedConnection(value: unknown): value is SharedConnection {
  if (
    !isRecord(value) ||
    value.v !== 1 ||
    !CITIES.some((city) => city.id === value.city) ||
    !text(value.date) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value.date) ||
    !Number.isFinite(Date.parse(value.date)) ||
    new Date(value.date).toISOString().slice(0, 10) !== value.date ||
    !text(value.from) ||
    !text(value.to) ||
    !integer(value.departure, 1439) ||
    !integer(value.arrival, 4319) ||
    value.arrival < value.departure ||
    value.arrival - value.departure > 1440 ||
    !Array.isArray(value.legs) ||
    value.legs.length < 1 ||
    value.legs.length > 24
  )
    return false;
  let cursor = value.departure;
  for (const leg of value.legs) {
    if (
      !isRecord(leg) ||
      typeof leg.mode !== 'string' ||
      !modes.includes(leg.mode) ||
      !text(leg.from) ||
      !text(leg.to) ||
      !optionalText(leg.line) ||
      !optionalText(leg.direction) ||
      !optionalText(leg.trip) ||
      !optionalText(leg.board) ||
      !optionalText(leg.alight) ||
      !integer(leg.departure, 4319) ||
      !integer(leg.arrival, 4319) ||
      (leg.scheduledDeparture !== undefined && !integer(leg.scheduledDeparture, 1439)) ||
      (leg.scheduledArrival !== undefined && !integer(leg.scheduledArrival, 1439)) ||
      leg.departure < cursor ||
      leg.arrival < leg.departure ||
      leg.arrival > value.arrival ||
      !integer(leg.stops, 1000) ||
      (leg.walk !== undefined && !integer(leg.walk, 100000))
    )
      return false;
    cursor = leg.arrival;
  }
  return true;
}

export function encodeSharedConnection(journey: SharedConnection): string {
  if (!isSharedConnection(journey)) throw new Error('Invalid journey');
  const bytes = deflateSync(strToU8(JSON.stringify(journey)), { level: 9 });
  let encoded = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const bits = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    encoded += alphabet[(bits >>> 18) & 63] + alphabet[(bits >>> 12) & 63];
    if (i + 1 < bytes.length) encoded += alphabet[(bits >>> 6) & 63];
    if (i + 2 < bytes.length) encoded += alphabet[bits & 63];
  }
  if (encoded.length > maxEncodedLength) throw new Error('Journey link too long');
  return encoded;
}

export function decodeSharedConnection(encoded: string): SharedConnection | null {
  if (!encoded || encoded.length > maxEncodedLength || !/^[A-Za-z0-9_-]+$/.test(encoded))
    return null;
  try {
    const bytes = new Uint8Array(Math.floor((encoded.length * 6) / 8));
    let bits = 0;
    let count = 0;
    let index = 0;
    for (const char of encoded) {
      bits = (bits << 6) | alphabet.indexOf(char);
      count += 6;
      if (count >= 8) {
        count -= 8;
        bytes[index++] = (bits >>> count) & 255;
      }
    }
    // Stały bufor ogranicza rozpakowywanie danych pochodzących z URL-a.
    const decoded = inflateSync(bytes, { out: new Uint8Array(maxDecodedLength) });
    const journey: unknown = JSON.parse(strFromU8(decoded));
    return isSharedConnection(journey) ? journey : null;
  } catch {
    return null;
  }
}

export function buildShareUrl(journey: SharedConnection, locale: string): string {
  return `${SHARE_BASE_URL}#trip=${encodeSharedConnection(journey)}&lang=${encodeURIComponent(locale)}`;
}

export function shareMessage(journey: SharedConnection, s: ShareStrings): string {
  const lines = journey.legs
    .filter((leg) => leg.mode !== 'walk')
    .map((leg) => `${s.modes[leg.mode]}${leg.line ? ` ${leg.line}` : ''}`)
    .join(', ');
  return `${s.message(journey.from, journey.to, formatShareTime(journey.departure), formatShareTime(journey.arrival), lines)}\n${journey.date}`;
}
