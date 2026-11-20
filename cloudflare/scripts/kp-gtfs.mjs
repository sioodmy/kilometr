// GTFS synthesizer for kiedyprzyjedzie.pl municipal portals.
// Scrapes /stops, 7 days of /api/timetables, and deduplicated /api/trip calls
// into standard GTFS CSV files consumed by build-timetable.mjs.

import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const KP_UA = {
  'User-Agent': 'KilometrTimetableBot/1.0 (build; contact: dev@kilometr.local)',
  Accept: 'application/json',
};

const FIXED_PL_HOLIDAYS = new Set([
  '01-01',
  '01-06',
  '05-01',
  '05-03',
  '08-15',
  '11-01',
  '11-11',
  '12-25',
  '12-26',
]);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function easterSundayYmd(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return Date.UTC(year, month - 1, day, 12, 0, 0);
}

const holidayCache = new Map();
function getMovableHolidays(year) {
  let s = holidayCache.get(year);
  if (s) return s;
  const easterMs = easterSundayYmd(year);
  const fmt = (ms) => new Date(ms).toISOString().slice(0, 10);
  s = new Set([
    fmt(easterMs),
    fmt(easterMs + 86_400_000), // Easter Monday
    fmt(easterMs + 49 * 86_400_000), // Pentecost
    fmt(easterMs + 60 * 86_400_000), // Corpus Christi
  ]);
  holidayCache.set(year, s);
  return s;
}

export function isPolishHoliday(isoDate) {
  if (FIXED_PL_HOLIDAYS.has(isoDate.slice(5))) return true;
  const year = Number(isoDate.slice(0, 4));
  return getMovableHolidays(year).has(isoDate);
}

/** Returns YYYY-MM-DD strings in Europe/Warsaw starting today. */
export function getWarsawDates(count = 7) {
  const todayStr = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Warsaw',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const [y, m, d] = todayStr.split('-').map(Number);
  const baseMs = Date.UTC(y, m - 1, d, 12, 0, 0);
  const out = [];
  for (let i = 0; i < count; i++) {
    out.push(new Date(baseMs + i * 86_400_000).toISOString().slice(0, 10));
  }
  return out;
}

/** Monday=0 .. Sunday=6 for YYYY-MM-DD. */
function isoDowIndex(isoDate) {
  const [y, m, d] = isoDate.split('-').map(Number);
  const day = new Date(Date.UTC(y, m - 1, d, 12, 0, 0)).getUTCDay();
  return day === 0 ? 6 : day - 1;
}

function toGtfsDate(isoDate) {
  return isoDate.replace(/-/g, '');
}

async function fetchKpJson(url, fetchImpl = fetch, timeoutMs = 15_000) {
  let lastErr;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetchImpl(url, {
        headers: KP_UA,
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.ok) return await res.json();
      if (res.status === 404) return null;
      if (res.status !== 429 && res.status < 500) {
        throw new Error(`HTTP ${res.status} for ${url}`);
      }
      lastErr = new Error(`HTTP ${res.status} for ${url}`);
      const retryAfter = Number(res.headers.get('retry-after')) || 0;
      const backoff = Math.max(retryAfter * 1000, 300 * 2 ** attempt + Math.random() * 250);
      await sleep(backoff);
    } catch (err) {
      lastErr = err;
      if (attempt < 3) await sleep(300 * 2 ** attempt + Math.random() * 250);
    }
  }
  throw lastErr;
}

async function mapPool(items, concurrency, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

function parseStops(rawStops) {
  const valid = [];
  const byId = new Map();
  for (const s of rawStops || []) {
    if (!Array.isArray(s) || s.length < 5) continue;
    const id = String(s[0] ?? '').trim();
    const code = String(s[1] ?? '').trim();
    const name = String(s[2] ?? '').trim();
    const lon = Number(s[3]) / 1e6;
    const lat = Number(s[4]) / 1e6;
    if (!id || !name) continue;
    if (lat < 48.5 || lat > 55.5 || lon < 13.5 || lon > 24.5) continue;
    const stop = {
      id,
      code,
      name,
      lat,
      lon,
      onlyDisembarking: s[5] === 1,
      isStation: s[6] === 1,
    };
    valid.push(stop);
    byId.set(id, stop);
  }
  return { valid, byId };
}

function pickSampleStops(stops, count = 3) {
  const boarding = stops.filter((s) => !s.onlyDisembarking);
  if (boarding.length === 0) return [];
  const stations = boarding.filter((s) => s.isStation);
  const pool = stations.length >= count ? stations : boarding;
  if (pool.length <= count) return pool;
  const picked = [];
  for (let i = 0; i < count; i++) {
    picked.push(pool[Math.floor((i * (pool.length - 1)) / (count - 1))]);
  }
  return picked;
}

export async function getKpFingerprint(prefix, fetchImpl = fetch) {
  const base = `https://${prefix}.kiedyprzyjedzie.pl`;
  const data = await fetchKpJson(`${base}/stops`, fetchImpl);
  if (!data || !Array.isArray(data.stops)) return null;
  const { valid } = parseStops(data.stops);
  const sampleStops = pickSampleStops(valid, 3);
  const dates7 = getWarsawDates(7);
  // Pick a weekday, Saturday, and Sunday within the upcoming 7-day window.
  const probeDates = [
    dates7.find((d) => isoDowIndex(d) < 5 && !isPolishHoliday(d)) || dates7[0],
    dates7.find((d) => isoDowIndex(d) === 5) || dates7[0],
    dates7.find((d) => isoDowIndex(d) === 6) || dates7[0],
  ];
  const h = createHash('sha1');
  h.update(`rev:${data.revision ?? ''};n:${valid.length};`);
  for (const s of sampleStops) {
    for (const d of probeDates) {
      const tt = await fetchKpJson(
        `${base}/api/timetables/${encodeURIComponent(s.id)}?date=${d}`,
        fetchImpl,
      ).catch(() => null);
      const trips = (tt?.departures || []).map((dep) => `${dep.trip_id}@${dep.departure}`).join(',');
      h.update(`${s.id}|${d}|${trips};`);
    }
  }
  return h.digest('hex').slice(0, 16);
}

function csvField(v) {
  const s = String(v ?? '');
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function parseHhMmToSec(raw) {
  const parts = String(raw || '').trim().split(':');
  const h = Number(parts[0]) || 0;
  const m = Number(parts[1]) || 0;
  const s = Number(parts[2]) || 0;
  return h * 3600 + m * 60 + s;
}

function secToHms(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function mapKpRouteType(lineType, vehicleType) {
  const t = String(lineType || '').toLowerCase();
  if (t === 'tram' || vehicleType === 4) return 0;
  if (t === 'trolleybus') return 11;
  if (t === 'train' || t === 'rail') return 2;
  return 3;
}

export async function scrapeKpToGtfsDir(prefix, outDir, opts = {}) {
  const fetchImpl = opts.fetchImpl || fetch;
  const concurrency = opts.concurrency || 20;
  const log = opts.log || console.log;
  const base = `https://${prefix}.kiedyprzyjedzie.pl`;

  log(`KP (${prefix}): fetching /stops...`);
  const stopsResp = await fetchKpJson(`${base}/stops`, fetchImpl, 20_000);
  if (!stopsResp || !Array.isArray(stopsResp.stops)) {
    throw new Error(`KP (${prefix}): /stops returned no stops`);
  }
  const { valid: validStops, byId: stopById } = parseStops(stopsResp.stops);
  if (validStops.length === 0) {
    throw new Error(`KP (${prefix}): 0 valid Polish coordinates in /stops`);
  }
  const boardingStops = validStops.filter((s) => !s.onlyDisembarking);
  const scrapeDates = getWarsawDates(7);
  const windowDates = getWarsawDates(31);

  const tasks = [];
  for (const s of boardingStops) {
    for (const d of scrapeDates) {
      tasks.push({ stopId: s.id, date: d });
    }
  }

  log(`KP (${prefix}): querying ${tasks.length} stop-day timetables (${boardingStops.length} stops x 7 days)...`);
  const tripsSeen = new Map();
  let ttErrors = 0;
  await mapPool(tasks, concurrency, async ({ stopId, date }) => {
    try {
      const tt = await fetchKpJson(
        `${base}/api/timetables/${encodeURIComponent(stopId)}?date=${date}`,
        fetchImpl,
      );
      if (!tt || !Array.isArray(tt.departures)) return;
      for (const dep of tt.departures) {
        const tid = String(dep?.trip_id ?? '').trim();
        if (!tid) continue;
        let rec = tripsSeen.get(tid);
        if (!rec) {
          rec = { sampleIndex: Number(dep.index) || 0, dates: new Set() };
          tripsSeen.set(tid, rec);
        }
        rec.dates.add(date);
      }
    } catch {
      ttErrors++;
    }
  });
  if (tasks.length > 0 && ttErrors / tasks.length > 0.05) {
    throw new Error(`KP (${prefix}): too many timetable errors (${ttErrors}/${tasks.length})`);
  }
  if (tripsSeen.size === 0) {
    throw new Error(`KP (${prefix}): 0 trips discovered across 7 days`);
  }

  const tripEntries = [...tripsSeen.entries()];
  log(`KP (${prefix}): fetching ${tripEntries.length} unique trip definitions...`);
  const routesMap = new Map();
  const parsedTrips = [];
  let tripErrors = 0;

  await mapPool(tripEntries, concurrency, async ([tid, meta]) => {
    try {
      const tr = await fetchKpJson(
        `${base}/api/trip/${encodeURIComponent(tid)}/${meta.sampleIndex}`,
        fetchImpl,
      );
      if (!tr || !Array.isArray(tr.times) || tr.times.length < 2) return;
      const lineName = String(tr.line?.name || '').trim();
      if (!lineName) return;
      const routeType = mapKpRouteType(tr.line?.type, tr.vehicle_type);
      const routeKey = `${lineName}\0${routeType}`;
      let route = routesMap.get(routeKey);
      if (!route) {
        route = { id: `R_${routesMap.size + 1}`, short: lineName, type: routeType };
        routesMap.set(routeKey, route);
      }

      const sortedTimes = [...tr.times].sort((a, b) => (Number(a.index) || 0) - (Number(b.index) || 0));
      const stopTimes = [];
      let dayOffset = 0;
      let prevRawSec = -1;
      for (let i = 0; i < sortedTimes.length; i++) {
        const t = sortedTimes[i];
        const rawSec = parseHhMmToSec(t.departure_time);
        if (prevRawSec >= 0 && rawSec + dayOffset < prevRawSec) {
          dayOffset += 86400;
        }
        const absSec = rawSec + dayOffset;
        prevRawSec = absSec;
        const pid = String(t.place_id ?? '').trim();
        if (!stopById.has(pid)) continue;
        stopTimes.push({ stopId: pid, sec: absSec, seq: stopTimes.length + 1 });
      }
      if (stopTimes.length < 2) return;

      parsedTrips.push({
        tripId: tid,
        routeId: route.id,
        headsign: String(tr.direction || '').trim(),
        dates: meta.dates,
        stopTimes,
      });
    } catch {
      tripErrors++;
    }
  });
  if (tripEntries.length > 0 && tripErrors / tripEntries.length > 0.05) {
    throw new Error(`KP (${prefix}): too many trip errors (${tripErrors}/${tripEntries.length})`);
  }
  if (parsedTrips.length === 0) {
    throw new Error(`KP (${prefix}): 0 usable trips after parsing`);
  }

  // Build compact calendar + calendar_dates grouped by exact 7-day active signature.
  const serviceMap = new Map();
  const startDate = toGtfsDate(windowDates[0]);
  const endDate = toGtfsDate(windowDates[windowDates.length - 1]);
  const nonHolidayMonFriDows = scrapeDates
    .filter((d) => isoDowIndex(d) < 5 && !isPolishHoliday(d))
    .map((d) => isoDowIndex(d));

  function getOrCreateService(datesSet) {
    const sig = scrapeDates.map((d) => (datesSet.has(d) ? '1' : '0')).join('');
    let svc = serviceMap.get(sig);
    if (svc) return svc.id;

    const mask = [0, 0, 0, 0, 0, 0, 0];
    for (const d of scrapeDates) {
      if (isPolishHoliday(d)) continue;
      if (datesSet.has(d)) mask[isoDowIndex(d)] = 1;
    }
    // Fill any Mon-Fri weekday that fell on a public holiday during the scrape window
    // if all observed non-holiday Mon-Fri days ran this trip.
    if (nonHolidayMonFriDows.length > 0) {
      const allObservedWeekdaysRun = nonHolidayMonFriDows.every((dow) => mask[dow] === 1);
      if (allObservedWeekdaysRun) {
        for (const d of scrapeDates) {
          const dow = isoDowIndex(d);
          if (dow < 5 && isPolishHoliday(d)) mask[dow] = 1;
        }
      }
    }

    const id = `S_${sig}`;
    const exceptions = [];
    for (const d of scrapeDates) {
      const dow = isoDowIndex(d);
      const expected = mask[dow] === 1;
      const actual = datesSet.has(d);
      if (actual && !expected) exceptions.push({ date: toGtfsDate(d), exc: 1 });
      else if (!actual && expected) exceptions.push({ date: toGtfsDate(d), exc: 2 });
    }
    // Propagate Sunday schedule to Polish holidays later in the 31-day rolling window.
    for (let i = scrapeDates.length; i < windowDates.length; i++) {
      const d = windowDates[i];
      if (!isPolishHoliday(d)) continue;
      const dow = isoDowIndex(d);
      const runsSun = mask[6] === 1;
      const expected = mask[dow] === 1;
      if (runsSun && !expected) exceptions.push({ date: toGtfsDate(d), exc: 1 });
      else if (!runsSun && expected) exceptions.push({ date: toGtfsDate(d), exc: 2 });
    }
    svc = { id, mask, exceptions };
    serviceMap.set(sig, svc);
    return id;
  }

  mkdirSync(outDir, { recursive: true });

  const stopsLines = ['stop_id,stop_code,stop_name,stop_lat,stop_lon'];
  for (const s of validStops) {
    stopsLines.push(
      [s.id, s.code, s.name, s.lat.toFixed(6), s.lon.toFixed(6)].map(csvField).join(','),
    );
  }
  writeFileSync(join(outDir, 'stops.txt'), stopsLines.join('\n') + '\n');

  const routeLines = ['route_id,route_short_name,route_long_name,route_type'];
  for (const r of routesMap.values()) {
    routeLines.push([r.id, r.short, '', r.type].map(csvField).join(','));
  }
  writeFileSync(join(outDir, 'routes.txt'), routeLines.join('\n') + '\n');

  const tripLines = ['trip_id,route_id,service_id,trip_headsign,direction_id,shape_id'];
  const stLines = ['trip_id,arrival_time,departure_time,stop_id,stop_sequence'];
  for (const t of parsedTrips) {
    const sid = getOrCreateService(t.dates);
    tripLines.push([t.tripId, t.routeId, sid, t.headsign, 0, ''].map(csvField).join(','));
    for (const st of t.stopTimes) {
      const hms = secToHms(st.sec);
      stLines.push([t.tripId, hms, hms, st.stopId, st.seq].map(csvField).join(','));
    }
  }
  writeFileSync(join(outDir, 'trips.txt'), tripLines.join('\n') + '\n');
  writeFileSync(join(outDir, 'stop_times.txt'), stLines.join('\n') + '\n');

  const calLines = ['service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date'];
  const calDateLines = ['service_id,date,exception_type'];
  for (const svc of serviceMap.values()) {
    calLines.push([svc.id, ...svc.mask, startDate, endDate].map(csvField).join(','));
    for (const ex of svc.exceptions) {
      calDateLines.push([svc.id, ex.date, ex.exc].map(csvField).join(','));
    }
  }
  writeFileSync(join(outDir, 'calendar.txt'), calLines.join('\n') + '\n');
  writeFileSync(join(outDir, 'calendar_dates.txt'), calDateLines.join('\n') + '\n');

  log(
    `KP (${prefix}): wrote GTFS (${validStops.length} stops, ${routesMap.size} routes, ${parsedTrips.length} trips, ${stLines.length - 1} stop_times, ${serviceMap.size} services)`,
  );
  return {
    stops: validStops.length,
    routes: routesMap.size,
    trips: parsedTrips.length,
    stopTimes: stLines.length - 1,
    revision: stopsResp.revision ?? null,
  };
}
