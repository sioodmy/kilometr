/**
 * Dane do launch video: rozkład MPK Wrocław (GTFS), styl mapy aplikacji
 * i lista miast. Wynik trafia do video/.cache/data.json (poza repo).
 *
 * Użycie: nix develop .#ci -c 'npm run video:prepare'
 *
 * Podróż odpowiada screenom z landing/public/screenshots: Sky Tower o 20:25,
 * tramwaj 9 z Sanockiej do Pl. Wróblewskiego. Fala to najwcześniejszy
 * dojazd do każdego przystanku (connection scan po rozkładzie dnia roboczego).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { strFromU8, unzipSync } from 'fflate';
import { CITIES } from '../../src/cities';
import { buildMapStyle } from '../../src/map/mapStyle';
import { getLineColors } from '../../src/services/lineIdentity';
import type { Mode, VideoData } from '../src/data';

// Archiwum Otwartego Wrocławia z 17.10.2026: ten sam rozkład co na screenach
// (później linia 9 jeździ objazdem i nie mija Pl. Wróblewskiego).
const GTFS_URL = 'https://open-data.cui.wroclaw.pl/hdb/download/146/';
const CACHE = join(__dirname, '../.cache');

const ORIGIN = { name: 'Sky Tower', lat: 51.0944, lon: 17.0192 };
const DEPART = hms('20:25:00');
const WAVE_END = DEPART + 75 * 60;
const JOURNEY = { line: '9', from: 'Sanocka', to: 'Pl. Wróblewskiego', at: hms('20:34:00') };
const VEHICLE_WINDOW = [hms('20:30:00'), hms('21:00:00')] as const;
const WALK_MPS = 1.0;
const ORIGIN_WALK_M = 900;
const TRANSFER_WALK_M = 350;
const TRANSFER_PENALTY_S = 60;

type P = [number, number];
type Zip = Record<string, Uint8Array>;

const MX = 111_320 * Math.cos((51.1 * Math.PI) / 180);
const MY = 110_540;

function hms(text: string): number {
  const [h, m, s] = text.split(':').map(Number);
  return h * 3600 + m * 60 + (s || 0);
}

function splitCsv(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch !== '"') cur += ch;
      else if (line[i + 1] === '"') {
        cur += '"';
        i++;
      } else quoted = false;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

function* rows(zip: Zip, file: string, cols: readonly string[]): Generator<string[]> {
  const data = zip[file];
  if (!data) throw new Error(`GTFS bez pliku ${file}`);
  const lines = strFromU8(data).replace(/^\uFEFF/, '').split(/\r?\n/);
  const header = splitCsv(lines[0]);
  const idx = cols.map((c) => {
    const i = header.indexOf(c);
    if (i < 0) throw new Error(`${file}: brak kolumny ${c}`);
    return i;
  });
  for (let n = 1; n < lines.length; n++) {
    const line = lines[n];
    if (!line) continue;
    const all = line.includes('"') ? splitCsv(line) : line.split(',');
    yield idx.map((i) => all[i] ?? '');
  }
}

const meters = (a: P, b: P) => Math.hypot((a[0] - b[0]) * MX, (a[1] - b[1]) * MY);

function toSegment(p: P, a: P, b: P): { d: number; t: number } {
  const ax = (b[0] - a[0]) * MX;
  const ay = (b[1] - a[1]) * MY;
  const px = (p[0] - a[0]) * MX;
  const py = (p[1] - a[1]) * MY;
  const len = ax * ax + ay * ay;
  const t = len ? Math.max(0, Math.min(1, (px * ax + py * ay) / len)) : 0;
  return { d: Math.hypot(px - t * ax, py - t * ay), t };
}

function simplify(pts: P[], tolerance: number): P[] {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = 1;
  keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  for (let seg = stack.pop(); seg; seg = stack.pop()) {
    const [a, b] = seg;
    let worst = 0;
    let at = -1;
    for (let i = a + 1; i < b; i++) {
      const { d } = toSegment(pts[i], pts[a], pts[b]);
      if (d > worst) {
        worst = d;
        at = i;
      }
    }
    if (at >= 0 && worst > tolerance) {
      keep[at] = 1;
      stack.push([a, at], [at, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

function cumulative(pts: P[]): number[] {
  const out = [0];
  for (let i = 1; i < pts.length; i++) out.push(out[i - 1] + meters(pts[i - 1], pts[i]));
  return out;
}

/** Pozycje przystanków wzdłuż trasy (m), monotonicznie w kolejności kursu. */
function locate(line: P[], cum: number[], stops: P[]): number[] {
  const out: number[] = [];
  let from = 0;
  for (const s of stops) {
    let best = Infinity;
    let bestSeg = from;
    let bestPos = cum[from];
    for (let i = from; i < line.length - 1; i++) {
      const { d, t } = toSegment(s, line[i], line[i + 1]);
      if (d < best) {
        best = d;
        bestSeg = i;
        bestPos = cum[i] + t * (cum[i + 1] - cum[i]);
      } else if (best < 40 && d > best + 400) break;
    }
    out.push(bestPos);
    from = bestSeg;
  }
  return out;
}

/** Czas dotarcia fali w każdym wierzchołku: interpolacja między przystankami. */
function reachAlong(cum: number[], pos: number[], reach: number[]): number[] {
  let k = 0;
  return cum.map((x) => {
    while (k < pos.length - 2 && pos[k + 1] < x) k++;
    if (x <= pos[0]) return reach[0];
    if (x >= pos[pos.length - 1]) return reach[reach.length - 1];
    const a = reach[k];
    const b = reach[k + 1];
    if (a < 0 || b < 0) return -1;
    const span = pos[k + 1] - pos[k];
    return Math.round(span > 0 ? a + ((b - a) * (x - pos[k])) / span : Math.min(a, b));
  });
}

const flat = (pts: P[]) => pts.flatMap(([lon, lat]) => [+lon.toFixed(5), +lat.toFixed(5)]);

async function loadZip(): Promise<Zip> {
  mkdirSync(CACHE, { recursive: true });
  const file = join(CACHE, 'gtfs-wroclaw-146.zip');
  if (!existsSync(file)) {
    const res = await fetch(GTFS_URL);
    if (!res.ok) throw new Error(`GTFS: HTTP ${res.status}`);
    writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  }
  const wanted = new Set(['routes.txt', 'trips.txt', 'stops.txt', 'shapes.txt', 'stop_times.txt', 'calendar.txt', 'feed_info.txt']);
  return unzipSync(readFileSync(file), { filter: (f) => wanted.has(f.name) });
}

async function main() {
  const zip = await loadZip();

  const [feedRow] = [...rows(zip, 'feed_info.txt', ['feed_publisher_name', 'feed_start_date', 'feed_end_date'])];
  const service = [...rows(zip, 'calendar.txt', ['service_id', 'tuesday', 'wednesday'])].find(
    ([, tue, wed]) => tue === '1' && wed === '1',
  )?.[0];
  if (!service) throw new Error('Brak kalendarza dnia roboczego');

  const routes = new Map<string, { line: string; mode: Mode }>();
  for (const [id, line, type] of rows(zip, 'routes.txt', ['route_id', 'route_short_name', 'route_type'])) {
    routes.set(id, { line, mode: type === '0' ? 'tram' : 'bus' });
  }

  const trips = new Map<string, { route: string; shape: string }>();
  for (const [route, sid, trip, shape] of rows(zip, 'trips.txt', ['route_id', 'service_id', 'trip_id', 'shape_id'])) {
    if (sid === service && routes.has(route)) trips.set(trip, { route, shape });
  }

  const stopIds: string[] = [];
  const stopIndex = new Map<string, number>();
  const stopName: string[] = [];
  const stopPos: P[] = [];
  for (const [id, name, lat, lon] of rows(zip, 'stops.txt', ['stop_id', 'stop_name', 'stop_lat', 'stop_lon'])) {
    stopIndex.set(id, stopIds.length);
    stopIds.push(id);
    stopName.push(name);
    stopPos.push([Number(lon), Number(lat)]);
  }

  const times = new Map<string, { stop: number; arr: number; dep: number; seq: number }[]>();
  for (const [trip, arr, dep, stop, seq] of rows(zip, 'stop_times.txt', ['trip_id', 'arrival_time', 'departure_time', 'stop_id', 'stop_sequence'])) {
    if (!trips.has(trip)) continue;
    const s = stopIndex.get(stop);
    if (s === undefined) continue;
    let list = times.get(trip);
    if (!list) times.set(trip, (list = []));
    list.push({ stop: s, arr: hms(arr), dep: hms(dep), seq: Number(seq) });
  }
  for (const list of times.values()) list.sort((a, b) => a.seq - b.seq);

  const usedShapes = new Set([...trips.values()].map((t) => t.shape));
  const rawShapes = new Map<string, { seq: number; p: P }[]>();
  for (const [id, lat, lon, seq] of rows(zip, 'shapes.txt', ['shape_id', 'shape_pt_lat', 'shape_pt_lon', 'shape_pt_sequence'])) {
    if (!usedShapes.has(id)) continue;
    let list = rawShapes.get(id);
    if (!list) rawShapes.set(id, (list = []));
    list.push({ seq: Number(seq), p: [Number(lon), Number(lat)] });
  }
  const shapeGeo = new Map<string, { pts: P[]; cum: number[] }>();
  for (const [id, list] of rawShapes) {
    list.sort((a, b) => a.seq - b.seq);
    const pts = simplify(
      list.map((x) => x.p),
      3,
    );
    shapeGeo.set(id, { pts, cum: cumulative(pts) });
  }

  // Connection scan: najwcześniejszy dojazd z Sky Tower do każdego przystanku.
  const neighbours: { to: number; s: number }[][] = stopPos.map(() => []);
  for (let a = 0; a < stopPos.length; a++) {
    for (let b = a + 1; b < stopPos.length; b++) {
      const d = meters(stopPos[a], stopPos[b]);
      if (d > TRANSFER_WALK_M) continue;
      const s = d / WALK_MPS + TRANSFER_PENALTY_S;
      neighbours[a].push({ to: b, s });
      neighbours[b].push({ to: a, s });
    }
  }
  const arrival = new Float64Array(stopPos.length).fill(Infinity);
  const relax = (stop: number, t: number) => {
    if (t >= arrival[stop]) return;
    arrival[stop] = t;
    for (const n of neighbours[stop]) arrival[n.to] = Math.min(arrival[n.to], t + n.s);
  };
  const origin: P = [ORIGIN.lon, ORIGIN.lat];
  stopPos.forEach((p, i) => {
    const d = meters(origin, p);
    if (d <= ORIGIN_WALK_M) arrival[i] = Math.min(arrival[i], DEPART + d / WALK_MPS);
  });
  const connections: { dep: number; arr: number; from: number; to: number; trip: string }[] = [];
  for (const [trip, list] of times) {
    for (let i = 0; i < list.length - 1; i++) {
      const dep = list[i].dep;
      if (dep >= DEPART && dep <= WAVE_END) {
        connections.push({ dep, arr: list[i + 1].arr, from: list[i].stop, to: list[i + 1].stop, trip });
      }
    }
  }
  connections.sort((a, b) => a.dep - b.dep || a.arr - b.arr);
  const boarded = new Set<string>();
  for (const c of connections) {
    if (!boarded.has(c.trip) && arrival[c.from] > c.dep) continue;
    boarded.add(c.trip);
    relax(c.to, c.arr);
  }
  const reachOf = (stop: number) =>
    arrival[stop] <= WAVE_END ? Math.round(arrival[stop] - DEPART) : -1;

  // Kształty: wspólna tablica dla linii i pojazdów.
  const shapeOut: number[][] = [];
  const shapeSlot = new Map<string, number>();
  const slotOf = (id: string) => {
    let slot = shapeSlot.get(id);
    if (slot === undefined) {
      const geo = shapeGeo.get(id);
      if (!geo) throw new Error(`Brak kształtu ${id}`);
      slot = shapeOut.length;
      shapeOut.push(flat(geo.pts));
      shapeSlot.set(id, slot);
    }
    return slot;
  };

  // Linie: najczęstsze warianty każdej trasy (zwykle oba kierunki i odgałęzienia).
  const byRoute = new Map<string, Map<string, string[]>>();
  for (const [trip, t] of trips) {
    if (!times.has(trip) || !shapeGeo.has(t.shape)) continue;
    let shapes = byRoute.get(t.route);
    if (!shapes) byRoute.set(t.route, (shapes = new Map()));
    const list = shapes.get(t.shape) ?? [];
    list.push(trip);
    shapes.set(t.shape, list);
  }
  const lines: VideoData['lines'] = [];
  const servedStops = new Set<number>();
  for (const [route, shapes] of byRoute) {
    const ranked = [...shapes].sort((a, b) => b[1].length - a[1].length);
    const top = ranked[0][1].length;
    for (const [shape, tripIds] of ranked.slice(0, 4)) {
      if (tripIds.length < top * 0.15) continue;
      const geo = shapeGeo.get(shape);
      const list = times.get(tripIds[0]);
      const meta = routes.get(route);
      if (!geo || !list || !meta) continue;
      const pos = locate(geo.pts, geo.cum, list.map((x) => stopPos[x.stop]));
      list.forEach((x) => servedStops.add(x.stop));
      lines.push({ shape: slotOf(shape), mode: meta.mode, reach: reachAlong(geo.cum, pos, list.map((x) => reachOf(x.stop))) });
    }
  }
  const stops = [...servedStops].flatMap((s) => [
    +stopPos[s][0].toFixed(5),
    +stopPos[s][1].toFixed(5),
    reachOf(s),
  ]);

  // Podróż ze screena: kurs linii 9 z Sanockiej najbliżej 20:36.
  let best: { trip: string; a: number; b: number; gap: number } | undefined;
  for (const [trip, t] of trips) {
    if (routes.get(t.route)?.line !== JOURNEY.line) continue;
    const list = times.get(trip) ?? [];
    const a = list.findIndex((x) => stopName[x.stop] === JOURNEY.from);
    const b = list.findIndex((x, i) => i > a && stopName[x.stop] === JOURNEY.to);
    if (a < 0 || b < 0) continue;
    const gap = Math.abs(list[a].dep - JOURNEY.at);
    if (!best || gap < best.gap) best = { trip, a, b, gap };
  }
  if (!best) throw new Error(`Brak kursu ${JOURNEY.line} ${JOURNEY.from} -> ${JOURNEY.to}`);
  const jTrip = trips.get(best.trip);
  const jList = times.get(best.trip);
  const jGeo = jTrip && shapeGeo.get(jTrip.shape);
  if (!jTrip || !jList || !jGeo) throw new Error('Niepełny kurs podróży');
  const jStops = jList.slice(best.a, best.b + 1);
  const jPos = locate(jGeo.pts, jGeo.cum, jStops.map((x) => stopPos[x.stop]));
  const ride: P[] = [];
  const start = jPos[0];
  const end = jPos[jPos.length - 1];
  const pointAt = (x: number): P => {
    let i = 0;
    while (i < jGeo.cum.length - 2 && jGeo.cum[i + 1] < x) i++;
    const span = jGeo.cum[i + 1] - jGeo.cum[i];
    const t = span > 0 ? (x - jGeo.cum[i]) / span : 0;
    const [a, b] = [jGeo.pts[i], jGeo.pts[i + 1]];
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  };
  ride.push(pointAt(start));
  jGeo.pts.forEach((p, i) => {
    if (jGeo.cum[i] > start && jGeo.cum[i] < end) ride.push(p);
  });
  ride.push(pointAt(end));
  const journey: VideoData['journey'] = {
    line: JOURNEY.line,
    color: getLineColors(JOURNEY.line, 'tram', 'wroclaw').bg,
    walk: flat([origin, stopPos[jStops[0].stop]]),
    ride: flat(ride),
    stops: jStops.map((x) => ({
      name: stopName[x.stop],
      lon: +stopPos[x.stop][0].toFixed(5),
      lat: +stopPos[x.stop][1].toFixed(5),
      time: x.dep,
    })),
  };

  // Pojazdy: kursy jadące w oknie animacji.
  const vehicles: VideoData['vehicles'] = [];
  for (const [trip, t] of trips) {
    const list = times.get(trip);
    const geo = shapeGeo.get(t.shape);
    const meta = routes.get(t.route);
    if (!list || !geo || !meta || list.length < 2) continue;
    if (list[list.length - 1].arr < VEHICLE_WINDOW[0] || list[0].dep > VEHICLE_WINDOW[1]) continue;
    const pos = locate(geo.pts, geo.cum, list.map((x) => stopPos[x.stop]));
    const tt: number[] = [];
    const dd: number[] = [];
    list.forEach((x, i) => {
      const d = Math.round(pos[i]);
      tt.push(x.arr);
      dd.push(d);
      if (x.dep > x.arr) {
        tt.push(x.dep);
        dd.push(d);
      }
    });
    vehicles.push({ shape: slotOf(t.shape), mode: meta.mode, line: meta.line, t: tt, d: dd, focus: trip === best.trip });
  }

  const data: VideoData = {
    feed: { publisher: feedRow[0], start: feedRow[1], end: feedRow[2] },
    style: buildMapStyle(null, { poi: false }),
    depart: DEPART,
    origin: ORIGIN,
    shapes: shapeOut,
    lines,
    stops,
    journey,
    vehicles,
    cities: CITIES.map((c) => ({ id: c.id, name: c.name, lon: c.center.lon, lat: c.center.lat })),
  };
  const out = join(CACHE, 'data.json');
  writeFileSync(out, JSON.stringify(data));
  const reached = stops.filter((_, i) => i % 3 === 2 && stops[i] >= 0).length;
  console.log(
    `data.json: ${lines.length} wariantów linii, ${stops.length / 3} przystanków (${reached} w zasięgu fali), ` +
      `${vehicles.length} kursów, podróż ${journey.line} ${journey.stops[0].name} ${clock(journey.stops[0].time)} -> ` +
      `${journey.stops[journey.stops.length - 1].name} ${clock(journey.stops[journey.stops.length - 1].time)}, ` +
      `${(JSON.stringify(data).length / 1e6).toFixed(1)} MB`,
  );
}

function clock(s: number): string {
  return `${String(Math.floor(s / 3600) % 24).padStart(2, '0')}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}`;
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
