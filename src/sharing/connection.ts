import { deflateSync, inflateSync, strFromU8, strToU8 } from 'fflate';
import { CITIES, type CityId } from '../cities';
import type { ShareStrings } from '../i18n/share/pl';
import type { Connection, LegMode } from '../types/models';
import { decodePath, encodePath } from './geometry';

const SHARE_BASE_URL = 'https://kilometr.app/t';
const EPOCH_2026_MS = Date.UTC(2026, 0, 1);
const DAY_MS = 86_400_000;
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const modes: readonly LegMode[] = [
  'walk',
  'tram',
  'bus',
  'train',
  'cable',
  'trolleybus',
  'subway',
];
const shareCities: readonly CityId[] = CITIES.map((city) => city.id);
const shareLocales = ['pl', 'en', 'de', 'uk'] as const;
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
  platform?: string;
  track?: string;
  stops: number;
  walk?: number;
  fromLat?: number;
  fromLon?: number;
  toLat?: number;
  toLon?: number;
  path?: string;
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
  const dayMinutes = ((minutes % 1440) + 1440) % 1440;
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

let warsawDateFormatter: Intl.DateTimeFormat | null = null;
function getWarsawDateFormatter(): Intl.DateTimeFormat {
  if (!warsawDateFormatter) {
    warsawDateFormatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Warsaw',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  }
  return warsawDateFormatter;
}

export function createSharedConnection(
  connection: Connection,
  city: CityId,
  now = new Date(),
): SharedConnection {
  const date =
    connection.serviceDate && /^\d{4}-\d{2}-\d{2}$/.test(connection.serviceDate)
      ? connection.serviceDate
      : (() => {
          const dateParts = getWarsawDateFormatter().formatToParts(now);
          const part = (kind: Intl.DateTimeFormatPartTypes) =>
            Number(dateParts.find((p) => p.type === kind)?.value);
          return new Date(
            Date.UTC(
              part('year'),
              part('month') - 1,
              part('day') + Math.floor(connection.departureSec / 86400),
            ),
          )
            .toISOString()
            .slice(0, 10);
        })();
  const rawConnDep = clockMinutes(connection.departAt);
  const rawFirstLegDep =
    connection.legs.length > 0 ? clockMinutes(connection.legs[0].departAt) : rawConnDep;
  // Jeśli pierwszy odcinek (np. dojście lub korekta RT) zaczyna się do 60 min przed departAt,
  // startujemy oś czasu od niego, żeby advance() nie przerzucił odcinka na kolejną dobę (+1440 min).
  const firstLegBeforeConn = (rawConnDep - rawFirstLegDep + 1440) % 1440;
  const departure =
    firstLegBeforeConn > 0 && firstLegBeforeConn <= 60 ? rawFirstLegDep : rawConnDep;
  let cursor = departure;
  const advance = (clock: string) => {
    const dayBase = Math.floor(cursor / 1440) * 1440;
    let minutes = dayBase + clockMinutes(clock);
    if (minutes < cursor) {
      if (cursor - minutes <= 60) {
        minutes = cursor;
      } else {
        minutes += 1440;
      }
    }
    cursor = minutes;
    return minutes;
  };
  const legs = connection.legs.map((leg): SharedLeg => {
    const out: SharedLeg = {
      mode: leg.mode,
      from: leg.fromStop,
      to: leg.toStop,
      departure: advance(leg.departAt),
      arrival: advance(leg.arriveAt),
      stops: leg.stopsCount,
    };
    if (leg.line !== undefined) out.line = leg.line;
    if (leg.direction !== undefined) out.direction = leg.direction;
    const schedDep = scheduleMinute(
      leg.scheduledDepartureSec ??
        leg.intermediateStops?.find((stop) => stop.stopId === leg.fromStopId)?.departSec,
    );
    const schedArr = scheduleMinute(
      leg.scheduledArrivalSec ??
        leg.intermediateStops?.find((stop) => stop.stopId === leg.toStopId)?.arriveSec,
    );
    if (schedDep !== undefined && schedDep !== out.departure % 1440) {
      out.scheduledDeparture = schedDep;
    }
    if (schedArr !== undefined && schedArr !== out.arrival % 1440) {
      out.scheduledArrival = schedArr;
    }
    if (leg.tripId !== undefined) out.trip = leg.tripId;
    if (leg.fromStopId !== undefined) out.board = leg.fromStopId;
    if (leg.toStopId !== undefined) out.alight = leg.toStopId;
    if (leg.platformCode) out.platform = leg.platformCode;
    if (leg.trackCode) out.track = leg.trackCode;
    if (leg.walkM != null) out.walk = Math.round(leg.walkM);
    if (leg.fromLat !== undefined) out.fromLat = leg.fromLat;
    if (leg.fromLon !== undefined) out.fromLon = leg.fromLon;
    if (leg.toLat !== undefined) out.toLat = leg.toLat;
    if (leg.toLon !== undefined) out.toLon = leg.toLon;
    if (leg.geometry && leg.geometry.length >= 2) out.path = encodePath(leg.geometry);
    return out;
  });
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
  // Ścieżki przed chwilą zakodowaliśmy sami z leg.geometry: nie dekodujemy ich od razu z powrotem.
  if (!isSharedConnection(journey, false)) throw new Error('Invalid journey');
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

function coordinates(lat: unknown, lon: unknown): boolean {
  return (
    (lat === undefined && lon === undefined) ||
    (typeof lat === 'number' &&
      Number.isFinite(lat) &&
      Math.abs(lat) <= 90 &&
      typeof lon === 'number' &&
      Number.isFinite(lon) &&
      Math.abs(lon) <= 180)
  );
}

function isSharedConnection(value: unknown, validatePaths = true): value is SharedConnection {
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
      !(modes as readonly string[]).includes(leg.mode) ||
      !text(leg.from) ||
      !text(leg.to) ||
      !optionalText(leg.line) ||
      !optionalText(leg.direction) ||
      !optionalText(leg.trip) ||
      !optionalText(leg.board) ||
      !optionalText(leg.alight) ||
      !optionalText(leg.platform) ||
      !optionalText(leg.track) ||
      !integer(leg.departure, 4319) ||
      !integer(leg.arrival, 4319) ||
      (leg.scheduledDeparture !== undefined && !integer(leg.scheduledDeparture, 1439)) ||
      (leg.scheduledArrival !== undefined && !integer(leg.scheduledArrival, 1439)) ||
      leg.departure < cursor ||
      leg.arrival < leg.departure ||
      leg.arrival > value.arrival ||
      !integer(leg.stops, 1000) ||
      !coordinates(leg.fromLat, leg.fromLon) ||
      !coordinates(leg.toLat, leg.toLon) ||
      (leg.path !== undefined &&
        (typeof leg.path !== 'string' || (validatePaths && !decodePath(leg.path)))) ||
      (leg.walk !== undefined && !integer(leg.walk, 100000))
    )
      return false;
    cursor = leg.arrival;
  }
  return true;
}

class ShareWriter {
  private buf: number[] = [];

  u8(n: number): void {
    this.buf.push(n & 255);
  }

  varuint(n: number): void {
    let v = n >>> 0;
    while (v >= 128) {
      this.buf.push((v & 127) | 128);
      v >>>= 7;
    }
    this.buf.push(v);
  }

  varsint(n: number): void {
    this.varuint((n << 1) ^ (n >> 31));
  }

  str(s: string): void {
    const bytes = strToU8(s);
    this.varuint(bytes.length);
    for (let i = 0; i < bytes.length; i++) this.buf.push(bytes[i]);
  }

  bytes(): Uint8Array {
    return new Uint8Array(this.buf);
  }
}

class ShareReader {
  private pos = 0;

  constructor(private readonly buf: Uint8Array) {}

  u8(): number {
    if (this.pos >= this.buf.length) throw new Error('EOF');
    return this.buf[this.pos++];
  }

  varuint(): number {
    let value = 0;
    let shift = 0;
    while (true) {
      const byte = this.u8();
      value |= (byte & 127) << shift;
      if ((byte & 128) === 0) return value >>> 0;
      shift += 7;
      if (shift > 28) throw new Error('Overflow');
    }
  }

  varsint(): number {
    const v = this.varuint();
    return (v >>> 1) ^ -(v & 1);
  }

  str(): string {
    const len = this.varuint();
    if (len > 24000 || this.pos + len > this.buf.length) throw new Error('Invalid string');
    const slice = this.buf.subarray(this.pos, this.pos + len);
    this.pos += len;
    return strFromU8(slice);
  }

  done(): boolean {
    return this.pos === this.buf.length;
  }
}

function encodeBase64Url(bytes: Uint8Array): string {
  let encoded = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const bits = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    encoded += alphabet[(bits >>> 18) & 63] + alphabet[(bits >>> 12) & 63];
    if (i + 1 < bytes.length) encoded += alphabet[(bits >>> 6) & 63];
    if (i + 2 < bytes.length) encoded += alphabet[bits & 63];
  }
  return encoded;
}

function decodeBase64Url(encoded: string): Uint8Array {
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
  return bytes;
}

const LEG_REUSE_FROM = 1;
const LEG_HAS_LINE = 2;
const LEG_HAS_DIR = 4;
const LEG_HAS_TRIP = 8;
const LEG_HAS_BOARD = 16;
const LEG_HAS_ALIGHT = 32;
const LEG_HAS_SCHED = 64;
const LEG_HAS_WALK = 128;

const LEG_HAS_FROM_COORDS = 1;
const LEG_HAS_TO_COORDS = 2;
const LEG_HAS_PATH = 4;
const LEG_EXACT_COORDS = 8;
const LEG_HAS_PLATFORM = 16;
const LEG_HAS_TRACK = 32;

function decodeBinary(
  bytes: Uint8Array,
): { journey: SharedConnection; locale?: (typeof shareLocales)[number] } | null {
  try {
    const r = new ShareReader(bytes);
    if (r.u8() !== 1) return null;
    const city = shareCities[r.varuint()];
    if (!city) return null;
    const dateMs = EPOCH_2026_MS + r.varsint() * DAY_MS;
    if (!Number.isFinite(dateMs)) return null;
    const date = new Date(dateMs).toISOString().slice(0, 10);
    const localeCode = r.u8();
    const locale =
      localeCode >= 1 && localeCode <= shareLocales.length
        ? shareLocales[localeCode - 1]
        : undefined;
    const departure = r.varuint();
    const arrival = departure + r.varuint();
    const rawFrom = r.str();
    const rawTo = r.str();
    const legsCount = r.varuint();
    if (legsCount < 1 || legsCount > 24) return null;

    const legs: SharedLeg[] = [];
    let prevArrival = departure;
    let prevTo = '';
    let prevLat = 0;
    let prevLon = 0;

    for (let i = 0; i < legsCount; i++) {
      const mode = modes[r.u8()];
      if (!mode) return null;
      const flags1 = r.u8();
      const flags2 = r.u8();
      const legDep = prevArrival + r.varuint();
      const legArr = legDep + r.varuint();
      const stops = r.varuint();
      const from = flags1 & LEG_REUSE_FROM ? prevTo : r.str();
      const to = r.str();
      const leg: SharedLeg = {
        mode,
        from,
        to,
        departure: legDep,
        arrival: legArr,
        stops,
      };
      if (flags1 & LEG_HAS_LINE) leg.line = r.str();
      if (flags1 & LEG_HAS_DIR) leg.direction = r.str();
      if (flags1 & LEG_HAS_TRIP) leg.trip = r.str();
      if (flags1 & LEG_HAS_BOARD) leg.board = r.str();
      if (flags1 & LEG_HAS_ALIGHT) leg.alight = r.str();
      if (flags2 & LEG_HAS_PLATFORM) leg.platform = r.str();
      if (flags2 & LEG_HAS_TRACK) leg.track = r.str();
      if (flags1 & LEG_HAS_SCHED) {
        const sDep = r.varuint();
        const sArr = r.varuint();
        if (sDep < 1440) leg.scheduledDeparture = sDep;
        if (sArr < 1440) leg.scheduledArrival = sArr;
      }
      if (flags1 & LEG_HAS_WALK) leg.walk = r.varuint();
      if (flags2 & LEG_EXACT_COORDS) {
        if (flags2 & LEG_HAS_FROM_COORDS) {
          const [lat, lon] = r.str().split(',').map(Number);
          leg.fromLat = lat;
          leg.fromLon = lon;
        }
        if (flags2 & LEG_HAS_TO_COORDS) {
          const [lat, lon] = r.str().split(',').map(Number);
          leg.toLat = lat;
          leg.toLon = lon;
        }
      } else {
        if (flags2 & LEG_HAS_FROM_COORDS) {
          prevLat += r.varsint();
          prevLon += r.varsint();
          leg.fromLat = prevLat / 1e5;
          leg.fromLon = prevLon / 1e5;
        }
        if (flags2 & LEG_HAS_TO_COORDS) {
          prevLat += r.varsint();
          prevLon += r.varsint();
          leg.toLat = prevLat / 1e5;
          leg.toLon = prevLon / 1e5;
        }
      }
      if (flags2 & LEG_HAS_PATH) leg.path = r.str();
      legs.push(leg);
      prevArrival = legArr;
      prevTo = to;
    }

    if (!r.done()) return null;
    const journey: SharedConnection = {
      v: 1,
      city,
      date,
      from: rawFrom || legs[0].from,
      to: rawTo || legs[legs.length - 1].to,
      departure,
      arrival,
      legs,
    };
    return isSharedConnection(journey) ? { journey, locale } : null;
  } catch {
    return null;
  }
}

const V2_REUSE_FROM = 8;
const V2_HAS_LINE = 16;
const V2_HAS_DIR = 32;
const V2_DIR_EQ_TO = 64;
const V2_HAS_TRIP = 128;

const V2_HAS_BOARD = 1;
const V2_HAS_ALIGHT = 2;
const V2_HAS_SCHED = 4;
const V2_HAS_WALK = 8;
const V2_HAS_FROM_COORDS = 16;
const V2_HAS_TO_COORDS = 32;
const V2_REUSE_FROM_COORDS = 64;
const V2_HAS_EXTRA = 128;

const V2X_HAS_PLATFORM = 1;
const V2X_HAS_TRACK = 2;
const V2X_HAS_PATH = 4;
const V2X_EXACT_COORDS = 8;
const V2X_WALK_STOPS = 16;

const MAX_COMPACT_NUM = 0x1fff_ffff;

function writeCompactId(w: ShareWriter, value: string): void {
  if (/^(?:0|[1-9]\d{0,8})$/.test(value)) {
    const n = Number(value);
    if (n <= MAX_COMPACT_NUM) {
      w.varuint(n * 4);
      return;
    }
  }
  if (/^pl:(?:0|[1-9]\d{0,8})$/.test(value)) {
    const n = Number(value.slice(3));
    if (n <= MAX_COMPACT_NUM) {
      w.varuint(n * 4 + 1);
      return;
    }
  }
  const under = /^(0|[1-9]\d{0,3})_(0|[1-9]\d{0,8})$/.exec(value);
  if (under) {
    const a = Number(under[1]);
    const b = Number(under[2]);
    if (a <= 9999 && b <= MAX_COMPACT_NUM) {
      w.varuint(a * 4 + 2);
      w.varuint(b);
      return;
    }
  }
  const bytes = strToU8(value);
  w.varuint(bytes.length * 4 + 3);
  for (let i = 0; i < bytes.length; i++) w.u8(bytes[i]);
}

function readCompactId(r: ShareReader): string {
  const head = r.varuint();
  const tag = head & 3;
  const val = head >>> 2;
  if (tag === 0) return String(val);
  if (tag === 1) return `pl:${val}`;
  if (tag === 2) return `${val}_${r.varuint()}`;
  if (val > 24000) throw new Error('Invalid id');
  const bytes = new Uint8Array(val);
  for (let i = 0; i < val; i++) bytes[i] = r.u8();
  return strFromU8(bytes);
}

function wrapMinuteDelta(scheduled: number, actualMod: number): number {
  let delta = scheduled - actualMod;
  if (delta > 719) delta -= 1440;
  if (delta < -720) delta += 1440;
  return delta;
}

function encodeBinaryV2(
  journey: SharedConnection,
  options?: { locale?: string; includePath?: boolean; compactCoords?: boolean },
): Uint8Array {
  const cityIdx = shareCities.indexOf(journey.city);
  if (cityIdx < 0) throw new Error('Invalid city');
  const cityMeta = CITIES[cityIdx];
  const dateDays = Math.round((Date.parse(journey.date) - EPOCH_2026_MS) / DAY_MS);
  const w = new ShareWriter();

  const rawLocale = options?.locale?.toLowerCase();
  const localeIdx = rawLocale
    ? shareLocales.indexOf(rawLocale as (typeof shareLocales)[number])
    : -1;
  const localeCode = localeIdx >= 0 ? localeIdx + 1 : 0;
  const hasCustomFrom = journey.from !== journey.legs[0]?.from;
  const hasCustomTo = journey.to !== journey.legs.at(-1)?.to;
  const inlineLegs = journey.legs.length <= 7 ? journey.legs.length : 0;

  w.u8(2);
  w.u8(
    (localeCode & 7) |
      (hasCustomFrom ? 8 : 0) |
      (hasCustomTo ? 16 : 0) |
      ((inlineLegs & 7) << 5),
  );
  w.varuint(cityIdx);
  w.varsint(dateDays);
  w.varuint(journey.departure);
  w.varuint(journey.arrival - journey.departure);
  if (hasCustomFrom) w.str(journey.from);
  if (hasCustomTo) w.str(journey.to);
  if (inlineLegs === 0) w.varuint(journey.legs.length);

  let prevArrival = journey.departure;
  let prevTo = '';
  let prevLat = Math.round(cityMeta.center.lat * 1e5);
  let prevLon = Math.round(cityMeta.center.lon * 1e5);
  let hasPrevCoord = false;
  const includePath = options?.includePath ?? true;
  const compactCoords = options?.compactCoords ?? false;

  for (const leg of journey.legs) {
    const modeIdx = modes.indexOf(leg.mode);
    if (modeIdx < 0) throw new Error('Invalid leg mode');

    const reuseFrom = prevTo.length > 0 && leg.from === prevTo;
    const dirEqTo = leg.direction !== undefined && leg.direction === leg.to;
    const hasDir = leg.direction !== undefined && !dirEqTo;
    const hasSched =
      (leg.scheduledDeparture !== undefined && leg.scheduledDeparture !== leg.departure % 1440) ||
      (leg.scheduledArrival !== undefined && leg.scheduledArrival !== leg.arrival % 1440);
    const hasFromCoords = leg.fromLat !== undefined && leg.fromLon !== undefined;
    const hasToCoords = leg.toLat !== undefined && leg.toLon !== undefined;
    const path = includePath ? leg.path : undefined;

    const fromY = hasFromCoords ? Math.round(leg.fromLat! * 1e5) : 0;
    const fromX = hasFromCoords ? Math.round(leg.fromLon! * 1e5) : 0;
    const toY = hasToCoords ? Math.round(leg.toLat! * 1e5) : 0;
    const toX = hasToCoords ? Math.round(leg.toLon! * 1e5) : 0;

    const exactFrom =
      !compactCoords &&
      hasFromCoords &&
      (fromY / 1e5 !== leg.fromLat || fromX / 1e5 !== leg.fromLon);
    const exactTo =
      !compactCoords && hasToCoords && (toY / 1e5 !== leg.toLat || toX / 1e5 !== leg.toLon);
    const exactCoords = exactFrom || exactTo;

    const reuseFromCoords =
      hasFromCoords &&
      hasPrevCoord &&
      !exactCoords &&
      (compactCoords
        ? Math.abs(fromY - prevLat) <= 2 && Math.abs(fromX - prevLon) <= 2
        : fromY === prevLat && fromX === prevLon);

    const writeWalkStops = leg.mode === 'walk' && leg.stops > 0;
    let extraFlags = 0;
    if (leg.platform !== undefined) extraFlags |= V2X_HAS_PLATFORM;
    if (leg.track !== undefined) extraFlags |= V2X_HAS_TRACK;
    if (path !== undefined) extraFlags |= V2X_HAS_PATH;
    if (exactCoords) extraFlags |= V2X_EXACT_COORDS;
    if (writeWalkStops) extraFlags |= V2X_WALK_STOPS;

    let h1 = modeIdx & 7;
    if (reuseFrom) h1 |= V2_REUSE_FROM;
    if (leg.line !== undefined) h1 |= V2_HAS_LINE;
    if (hasDir) h1 |= V2_HAS_DIR;
    if (dirEqTo) h1 |= V2_DIR_EQ_TO;
    if (leg.trip !== undefined) h1 |= V2_HAS_TRIP;

    let h2 = 0;
    if (leg.board !== undefined) h2 |= V2_HAS_BOARD;
    if (leg.alight !== undefined) h2 |= V2_HAS_ALIGHT;
    if (hasSched) h2 |= V2_HAS_SCHED;
    if (leg.walk !== undefined) h2 |= V2_HAS_WALK;
    if (hasFromCoords && !reuseFromCoords) h2 |= V2_HAS_FROM_COORDS;
    if (hasToCoords) h2 |= V2_HAS_TO_COORDS;
    if (reuseFromCoords) h2 |= V2_REUSE_FROM_COORDS;
    if (extraFlags !== 0) h2 |= V2_HAS_EXTRA;

    w.u8(h1);
    w.u8(h2);
    if (extraFlags !== 0) w.u8(extraFlags);

    w.varuint(leg.departure - prevArrival);
    w.varuint(leg.arrival - leg.departure);
    if (leg.mode !== 'walk' || writeWalkStops) w.varuint(leg.stops);
    if (!reuseFrom) w.str(leg.from);
    w.str(leg.to);
    if (h1 & V2_HAS_LINE) w.str(leg.line!);
    if (h1 & V2_HAS_DIR) w.str(leg.direction!);
    if (h1 & V2_HAS_TRIP) writeCompactId(w, leg.trip!);
    if (h2 & V2_HAS_BOARD) writeCompactId(w, leg.board!);
    if (h2 & V2_HAS_ALIGHT) writeCompactId(w, leg.alight!);
    if (extraFlags & V2X_HAS_PLATFORM) w.str(leg.platform!);
    if (extraFlags & V2X_HAS_TRACK) w.str(leg.track!);
    if (h2 & V2_HAS_SCHED) {
      const depDelta =
        leg.scheduledDeparture === undefined
          ? 720
          : wrapMinuteDelta(leg.scheduledDeparture, leg.departure % 1440);
      const arrDelta =
        leg.scheduledArrival === undefined
          ? 720
          : wrapMinuteDelta(leg.scheduledArrival, leg.arrival % 1440);
      w.varsint(depDelta);
      w.varsint(arrDelta);
    }
    if (h2 & V2_HAS_WALK) w.varuint(leg.walk!);

    if (exactCoords) {
      if (hasFromCoords) w.str(`${leg.fromLat},${leg.fromLon}`);
      if (hasToCoords) w.str(`${leg.toLat},${leg.toLon}`);
      if (hasToCoords) {
        prevLat = toY;
        prevLon = toX;
        hasPrevCoord = true;
      } else if (hasFromCoords) {
        prevLat = fromY;
        prevLon = fromX;
        hasPrevCoord = true;
      }
    } else {
      if (h2 & V2_HAS_FROM_COORDS) {
        w.varsint(fromY - prevLat);
        w.varsint(fromX - prevLon);
        prevLat = fromY;
        prevLon = fromX;
        hasPrevCoord = true;
      }
      if (h2 & V2_HAS_TO_COORDS) {
        w.varsint(toY - prevLat);
        w.varsint(toX - prevLon);
        prevLat = toY;
        prevLon = toX;
        hasPrevCoord = true;
      }
    }
    if (extraFlags & V2X_HAS_PATH) w.str(path!);

    prevArrival = leg.arrival;
    prevTo = leg.to;
  }

  return w.bytes();
}

function decodeBinaryV2(
  bytes: Uint8Array,
): { journey: SharedConnection; locale?: (typeof shareLocales)[number] } | null {
  try {
    const r = new ShareReader(bytes);
    if (r.u8() !== 2) return null;
    const meta = r.u8();
    const localeCode = meta & 7;
    const locale =
      localeCode >= 1 && localeCode <= shareLocales.length
        ? shareLocales[localeCode - 1]
        : undefined;
    const hasCustomFrom = (meta & 8) !== 0;
    const hasCustomTo = (meta & 16) !== 0;
    const inlineLegs = (meta >>> 5) & 7;

    const cityIdx = r.varuint();
    const city = shareCities[cityIdx];
    if (!city) return null;
    const cityMeta = CITIES[cityIdx];
    const dateMs = EPOCH_2026_MS + r.varsint() * DAY_MS;
    if (!Number.isFinite(dateMs)) return null;
    const date = new Date(dateMs).toISOString().slice(0, 10);
    const departure = r.varuint();
    const arrival = departure + r.varuint();
    const rawFrom = hasCustomFrom ? r.str() : '';
    const rawTo = hasCustomTo ? r.str() : '';
    const legsCount = inlineLegs > 0 ? inlineLegs : r.varuint();
    if (legsCount < 1 || legsCount > 24) return null;

    const legs: SharedLeg[] = [];
    let prevArrival = departure;
    let prevTo = '';
    let prevLat = Math.round(cityMeta.center.lat * 1e5);
    let prevLon = Math.round(cityMeta.center.lon * 1e5);

    for (let i = 0; i < legsCount; i++) {
      const h1 = r.u8();
      const h2 = r.u8();
      const extra = h2 & V2_HAS_EXTRA ? r.u8() : 0;
      const mode = modes[h1 & 7];
      if (!mode) return null;

      const legDep = prevArrival + r.varuint();
      const legArr = legDep + r.varuint();
      const stops = mode !== 'walk' || extra & V2X_WALK_STOPS ? r.varuint() : 0;
      const from = h1 & V2_REUSE_FROM ? prevTo : r.str();
      const to = r.str();
      const leg: SharedLeg = {
        mode,
        from,
        to,
        departure: legDep,
        arrival: legArr,
        stops,
      };
      if (h1 & V2_HAS_LINE) leg.line = r.str();
      if (h1 & V2_HAS_DIR) leg.direction = r.str();
      else if (h1 & V2_DIR_EQ_TO) leg.direction = to;
      if (h1 & V2_HAS_TRIP) leg.trip = readCompactId(r);
      if (h2 & V2_HAS_BOARD) leg.board = readCompactId(r);
      if (h2 & V2_HAS_ALIGHT) leg.alight = readCompactId(r);
      if (extra & V2X_HAS_PLATFORM) leg.platform = r.str();
      if (extra & V2X_HAS_TRACK) leg.track = r.str();
      if (h2 & V2_HAS_SCHED) {
        const depDelta = r.varsint();
        const arrDelta = r.varsint();
        if (depDelta !== 720) {
          leg.scheduledDeparture = (((legDep % 1440) + depDelta) % 1440 + 1440) % 1440;
        }
        if (arrDelta !== 720) {
          leg.scheduledArrival = (((legArr % 1440) + arrDelta) % 1440 + 1440) % 1440;
        }
      }
      if (h2 & V2_HAS_WALK) leg.walk = r.varuint();

      if (extra & V2X_EXACT_COORDS) {
        if (h2 & V2_HAS_FROM_COORDS) {
          const [lat, lon] = r.str().split(',').map(Number);
          leg.fromLat = lat;
          leg.fromLon = lon;
          prevLat = Math.round(lat * 1e5);
          prevLon = Math.round(lon * 1e5);
        }
        if (h2 & V2_HAS_TO_COORDS) {
          const [lat, lon] = r.str().split(',').map(Number);
          leg.toLat = lat;
          leg.toLon = lon;
          prevLat = Math.round(lat * 1e5);
          prevLon = Math.round(lon * 1e5);
        }
      } else {
        if (h2 & V2_REUSE_FROM_COORDS) {
          leg.fromLat = prevLat / 1e5;
          leg.fromLon = prevLon / 1e5;
        } else if (h2 & V2_HAS_FROM_COORDS) {
          prevLat += r.varsint();
          prevLon += r.varsint();
          leg.fromLat = prevLat / 1e5;
          leg.fromLon = prevLon / 1e5;
        }
        if (h2 & V2_HAS_TO_COORDS) {
          prevLat += r.varsint();
          prevLon += r.varsint();
          leg.toLat = prevLat / 1e5;
          leg.toLon = prevLon / 1e5;
        }
      }
      if (extra & V2X_HAS_PATH) leg.path = r.str();

      legs.push(leg);
      prevArrival = legArr;
      prevTo = to;
    }

    if (!r.done()) return null;
    const journey: SharedConnection = {
      v: 1,
      city,
      date,
      from: rawFrom || legs[0].from,
      to: rawTo || legs[legs.length - 1].to,
      departure,
      arrival,
      legs,
    };
    return isSharedConnection(journey) ? { journey, locale } : null;
  } catch {
    return null;
  }
}

export function encodeSharedConnection(
  journey: SharedConnection,
  options?: { locale?: string; includePath?: boolean; compactCoords?: boolean },
): string {
  if (!isSharedConnection(journey, options?.includePath !== false)) {
    throw new Error('Invalid journey');
  }
  const raw = encodeBinaryV2(journey, options);
  // Poziom 6 daje niemal identyczną długość linku przy wielokrotnie mniejszym czasie CPU na JS.
  const deflated = deflateSync(raw, { level: 6 });
  const encoded = encodeBase64Url(deflated.length < raw.length ? deflated : raw);
  if (encoded.length > maxEncodedLength) throw new Error('Journey link too long');
  return encoded;
}

export function decodeSharedPayload(
  encoded: string,
): { journey: SharedConnection; locale?: 'pl' | 'en' | 'de' | 'uk' } | null {
  if (!encoded || encoded.length > maxEncodedLength || !/^[A-Za-z0-9_-]+$/.test(encoded))
    return null;
  const bytes = decodeBase64Url(encoded);
  try {
    // Stały bufor ogranicza rozpakowywanie danych pochodzących z URL-a.
    const decoded = inflateSync(bytes, { out: new Uint8Array(maxDecodedLength) });
    const parsed =
      decoded[0] === 2 ? decodeBinaryV2(decoded) : decodeBinary(decoded);
    if (parsed) return parsed;
  } catch {
    /* Krótszy token v2 może być zapisany bez deflate. */
  }
  if (bytes[0] === 2) return decodeBinaryV2(bytes);
  return null;
}

export function decodeSharedConnection(encoded: string): SharedConnection | null {
  return decodeSharedPayload(encoded)?.journey ?? null;
}

export function extractShareTripToken(rawHashOrQuery: string): {
  trip: string | null;
  lang: string | null;
} {
  const clean = rawHashOrQuery.replace(/^[#?]/, '');
  if (!clean) return { trip: null, lang: null };
  if (!clean.includes('=')) {
    return /^[A-Za-z0-9_-]+$/.test(clean) ? { trip: clean, lang: null } : { trip: null, lang: null };
  }
  const params = new URLSearchParams(clean);
  return {
    trip: params.get('t') ?? params.get('trip'),
    lang: params.get('l') ?? params.get('lang'),
  };
}

export function buildShareUrl(journey: SharedConnection, locale: string): string {
  // Pomijamy geometrię kształtu (dociąganą ze statycznych shardów GTFS) oraz
  // zaokrąglamy współrzędne przystanków do ~1 m, dzięki czemu link jest możliwie krótki.
  const encoded = encodeSharedConnection(journey, {
    locale,
    includePath: false,
    compactCoords: true,
  });
  return `${SHARE_BASE_URL}#${encoded}`;
}

export function shareMessage(journey: SharedConnection, s: ShareStrings): string {
  const lines = journey.legs
    .filter((leg) => leg.mode !== 'walk')
    .map((leg) => `${s.modes[leg.mode]}${leg.line ? ` ${leg.line}` : ''}`)
    .join(', ');
  return `${s.message(journey.from, journey.to, formatShareTime(journey.departure), formatShareTime(journey.arrival), lines)}\n${journey.date}`;
}
