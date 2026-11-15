import { distanceMeters, normalizePolish } from '../gtfs/geo';
import { getLocaleSync, tr } from '../i18n/locale';
import { resolveGroundedStopSync } from './disruptionGrounding';
import type { DisruptionAlert, DisruptionStopCoord, MpkNewsItem } from './mpkNews';
import type { DayIndex, LocalGtfsStore } from './routing/store';

export interface LiveMapDisruptionStopPoint {
  name: string;
  lat: number;
  lon: number;
  action?: string;
}

export interface LiveMapDisruptionMarker {
  id: string;
  itemId: string;
  headline: string;
  shortLabel: string;
  severity: DisruptionAlert['severity'];
  disruptionType: DisruptionAlert['disruption_type'];
  isEmergency: boolean;
  lat: number;
  lon: number;
  /** Kolejne współrzędne [lon, lat] zablokowanego lub zmienionego odcinka. */
  corridorCoords: [number, number][];
  /** Punkty przystanków objętych utrudnieniem. */
  affectedStops: LiveMapDisruptionStopPoint[];
  corridorLabel: string | null;
  fromStop: string | null;
  toStop: string | null;
  lines: string[];
  problem: string;
  solution: string | null;
  timeframe: string;
  replacementLine: string | null;
  newsItem: MpkNewsItem;
}

interface ResolvedPoint {
  name: string;
  lat: number;
  lon: number;
}

const MAX_CORRIDOR_SPAN_STOPS = 25;
const MAX_DIRECT_SEGMENT_M = 25_000;
const MIN_CORRIDOR_SEGMENT_M = 15;

export function isDisruptionActiveForMap(
  alert: DisruptionAlert | undefined,
  nowMs: number = Date.now(),
): alert is DisruptionAlert {
  if (!alert) return false;
  if (alert.is_transit_alert === false) return false;
  if (alert.is_resolved === true) return false;
  if (alert.disruption_type === 'fare' && !alert.corridor && (alert.stops?.length ?? 0) === 0) {
    return false;
  }
  if (alert.valid_to) {
    const validToMs = Date.parse(alert.valid_to);
    if (Number.isFinite(validToMs) && validToMs < nowMs) {
      return false;
    }
  }
  return true;
}

function sanitizeShortLabel(raw: string): string {
  const cleaned = raw
    .replace(/\u2014/g, ' ')
    .replace(/\s+--?\s+/g, ' ')
    .replace(/[.,:;!?]+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (!cleaned) return '';
  const words = cleaned.split(/\s+/).slice(0, 3);
  let out = '';
  for (const w of words) {
    const next = out ? `${out} ${w}` : w;
    if (next.length > 26 && out) break;
    out = next;
  }
  return (out.length > 26 ? out.slice(0, 26) : out).toLowerCase().trim();
}

export function resolveDisruptionMapLabel(alert: DisruptionAlert): string {
  const fromModel = typeof alert.map_label === 'string' ? sanitizeShortLabel(alert.map_label) : '';
  if (fromModel) return fromModel;

  const s = tr().liveMap;
  if (getLocaleSync() === 'pl') {
    const text = normalizePolish(`${alert.headline} ${alert.glance?.problem ?? ''}`);
    if (/\bwykolej/.test(text)) return 'wykolejenie';
    if (/(siec[i]?\s+trakcyj|zerwan.*siec|brak\s+napiecia|pantograf)/.test(text)) {
      return 'awaria sieci';
    }
    if (/(kolizj|zderz|potrac|wypadek|wypadk)/.test(text)) return 'wypadek';
    if (/(remont|przebudow|modernizac|wymian.*tor|prace\s+torow)/.test(text)) return 'remont';
    if (/\bobjazd/.test(text) && alert.disruption_type !== 'planned_works') return 'objazd';
  }

  switch (alert.disruption_type) {
    case 'accident':
      return s.disruptionFallbackAccident;
    case 'infrastructure_failure':
      return s.disruptionFallbackFailure;
    case 'planned_works':
      return s.disruptionFallbackWorks;
    case 'event':
      return s.disruptionFallbackEvent;
    case 'weather':
      return s.disruptionFallbackWeather;
    case 'fare':
      return s.disruptionFallbackFare;
    default:
      return s.disruptionFallbackOther;
  }
}

function buildStopCoordLookup(
  stopCoords?: Record<string, DisruptionStopCoord>,
): Map<string, DisruptionStopCoord> {
  const map = new Map<string, DisruptionStopCoord>();
  if (!stopCoords) return map;
  for (const [name, coord] of Object.entries(stopCoords)) {
    if (!coord || !Number.isFinite(coord.lat) || !Number.isFinite(coord.lon)) continue;
    const norm = normalizePolish(name);
    if (norm && !map.has(norm)) map.set(norm, coord);
  }
  return map;
}

function resolvePoint(
  rawName: string | null | undefined,
  store: LocalGtfsStore | null | undefined,
  coordLookup: Map<string, DisruptionStopCoord>,
  exactCoords?: Record<string, DisruptionStopCoord>,
): ResolvedPoint | null {
  if (!rawName || rawName === 'both') return null;

  if (store && store.stops.size > 0) {
    const grounded = resolveGroundedStopSync(rawName, store);
    if (grounded && Number.isFinite(grounded.lat) && Number.isFinite(grounded.lon)) {
      return { name: grounded.name, lat: grounded.lat, lon: grounded.lon };
    }
  }

  const direct = exactCoords?.[rawName];
  if (direct && Number.isFinite(direct.lat) && Number.isFinite(direct.lon)) {
    return { name: rawName, lat: direct.lat, lon: direct.lon };
  }

  const norm = normalizePolish(rawName);
  const byNorm = coordLookup.get(norm);
  if (byNorm && Number.isFinite(byNorm.lat) && Number.isFinite(byNorm.lon)) {
    return { name: rawName, lat: byNorm.lat, lon: byNorm.lon };
  }

  return null;
}

function resolveCorridorViaDayIndex(
  fromName: string,
  toName: string,
  candidateLines: string[],
  store: LocalGtfsStore,
  dayIndex: DayIndex,
): ResolvedPoint[] | null {
  const fromGrounded = resolveGroundedStopSync(fromName, store);
  const toGrounded = resolveGroundedStopSync(toName, store);
  if (!fromGrounded || !toGrounded) return null;

  const fromNorm = normalizePolish(fromGrounded.name);
  const toNorm = normalizePolish(toGrounded.name);
  if (!fromNorm || !toNorm || fromNorm === toNorm) return null;

  const routeIdSet = new Set<string>();
  for (const line of candidateLines) {
    if (!line) continue;
    for (const rid of store.getRouteIdsByShortName(line)) {
      routeIdSet.add(rid);
    }
  }

  let bestSeq: string[] | null = null;
  for (const pattern of dayIndex.patterns.values()) {
    if (routeIdSet.size > 0 && !routeIdSet.has(pattern.routeId)) continue;
    const seq = pattern.stopSequence;
    let idxA = -1;
    let idxB = -1;
    for (let i = 0; i < seq.length; i++) {
      const st = store.stops.get(seq[i]);
      if (!st) continue;
      const n = normalizePolish(st.stop_name);
      if (idxA === -1 && n === fromNorm) idxA = i;
      if (idxB === -1 && n === toNorm) idxB = i;
    }
    if (idxA === -1 || idxB === -1 || idxA === idxB) continue;
    const span = Math.abs(idxB - idxA);
    if (span > MAX_CORRIDOR_SPAN_STOPS) continue;
    const slice = idxA < idxB ? seq.slice(idxA, idxB + 1) : seq.slice(idxB, idxA + 1).reverse();
    if (!bestSeq || slice.length < bestSeq.length) {
      bestSeq = slice;
    }
  }

  if (!bestSeq || bestSeq.length < 2) return null;
  const points: ResolvedPoint[] = [];
  for (const stopId of bestSeq) {
    const st = store.stops.get(stopId);
    if (st && Number.isFinite(st.stop_lat) && Number.isFinite(st.stop_lon)) {
      points.push({ name: st.stop_name, lat: st.stop_lat, lon: st.stop_lon });
    }
  }
  return points.length >= 2 ? points : null;
}

function dedupeCoords(points: ResolvedPoint[]): [number, number][] {
  const out: [number, number][] = [];
  for (const p of points) {
    const prev = out[out.length - 1];
    if (prev && Math.abs(prev[0] - p.lon) < 1e-5 && Math.abs(prev[1] - p.lat) < 1e-5) {
      continue;
    }
    out.push([p.lon, p.lat]);
  }
  return out;
}

function polylineMidpoint(coords: [number, number][]): { lat: number; lon: number } {
  if (coords.length === 1) return { lon: coords[0][0], lat: coords[0][1] };
  let total = 0;
  const segLens: number[] = [];
  for (let i = 1; i < coords.length; i++) {
    const len = distanceMeters(coords[i - 1][1], coords[i - 1][0], coords[i][1], coords[i][0]);
    segLens.push(len);
    total += len;
  }
  if (total <= 0) {
    const mid = coords[Math.floor(coords.length / 2)];
    return { lon: mid[0], lat: mid[1] };
  }
  const half = total / 2;
  let acc = 0;
  for (let i = 0; i < segLens.length; i++) {
    const len = segLens[i];
    if (acc + len >= half && len > 0) {
      const t = (half - acc) / len;
      const a = coords[i];
      const b = coords[i + 1];
      return {
        lon: a[0] + (b[0] - a[0]) * t,
        lat: a[1] + (b[1] - a[1]) * t,
      };
    }
    acc += len;
  }
  const last = coords[coords.length - 1];
  return { lon: last[0], lat: last[1] };
}

function collectLines(alert: DisruptionAlert, fallbackLines: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (val?: string | null) => {
    const clean = String(val ?? '').trim();
    if (!clean) return;
    const key = clean.toUpperCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(clean);
  };
  for (const l of alert.all_lines ?? []) push(l);
  for (const lc of alert.line_changes ?? []) push(lc.line);
  for (const l of fallbackLines) push(l);
  return out;
}

export function buildLiveMapDisruptions(
  items: MpkNewsItem[],
  store: LocalGtfsStore | null | undefined,
  dayIndex: DayIndex | null | undefined,
  nowMs: number = Date.now(),
): LiveMapDisruptionMarker[] {
  const markers: LiveMapDisruptionMarker[] = [];

  for (const item of items) {
    const alert = item.disruption;
    if (!isDisruptionActiveForMap(alert, nowMs)) continue;

    const coordLookup = buildStopCoordLookup(alert.stop_coords);
    const lines = collectLines(alert, item.lines);
    let corridorPoints: ResolvedPoint[] = [];

    // 1. Gotowa sekwencja przystanków z serwera (corridor.stops)
    if (alert.corridor?.stops && alert.corridor.stops.length >= 2) {
      for (const name of alert.corridor.stops) {
        const pt = resolvePoint(name, store, coordLookup, alert.stop_coords);
        if (pt) corridorPoints.push(pt);
      }
    }

    // 2. Lokalna rekonstrukcja sekwencji GTFS między corridor.from_stop i to_stop
    if (
      corridorPoints.length < 2 &&
      alert.corridor?.from_stop &&
      alert.corridor?.to_stop &&
      store &&
      store.stops.size > 0 &&
      dayIndex
    ) {
      const resolved = resolveCorridorViaDayIndex(
        alert.corridor.from_stop,
        alert.corridor.to_stop,
        lines,
        store,
        dayIndex,
      );
      if (resolved) corridorPoints = resolved;
    }

    // 3. Odcinek bezpośredni from_stop -> to_stop z corridor lub line_changes
    if (corridorPoints.length < 2 && alert.corridor?.from_stop && alert.corridor?.to_stop) {
      const a = resolvePoint(alert.corridor.from_stop, store, coordLookup, alert.stop_coords);
      const b = resolvePoint(alert.corridor.to_stop, store, coordLookup, alert.stop_coords);
      if (a && b) {
        const dist = distanceMeters(a.lat, a.lon, b.lat, b.lon);
        if (dist >= MIN_CORRIDOR_SEGMENT_M && dist <= MAX_DIRECT_SEGMENT_M) {
          corridorPoints = [a, b];
        }
      }
    }

    if (corridorPoints.length < 2) {
      for (const lc of alert.line_changes ?? []) {
        const segNames: string[] = [];
        if (lc.from_stop) segNames.push(lc.from_stop);
        for (const omitted of lc.omitted_stops ?? []) segNames.push(omitted);
        if (lc.to_stop) segNames.push(lc.to_stop);
        if (segNames.length >= 2) {
          const pts: ResolvedPoint[] = [];
          for (const n of segNames) {
            const p = resolvePoint(n, store, coordLookup, alert.stop_coords);
            if (p) pts.push(p);
          }
          if (pts.length >= 2) {
            const span = distanceMeters(
              pts[0].lat,
              pts[0].lon,
              pts[pts.length - 1].lat,
              pts[pts.length - 1].lon,
            );
            if (span <= MAX_DIRECT_SEGMENT_M) {
              corridorPoints = pts;
              break;
            }
          }
        }
      }
    }

    const corridorCoords = dedupeCoords(corridorPoints);

    // Zbierz wszystkie przystanki dotknięte utrudnieniem
    const affectedStops: LiveMapDisruptionStopPoint[] = [];
    const seenStopKeys = new Set<string>();
    const addStop = (pt: ResolvedPoint | null, action?: string) => {
      if (!pt) return;
      const key = normalizePolish(pt.name);
      if (!key || seenStopKeys.has(key)) return;
      seenStopKeys.add(key);
      affectedStops.push({ name: pt.name, lat: pt.lat, lon: pt.lon, action });
    };

    for (const pt of corridorPoints) addStop(pt);
    for (const st of alert.stops ?? []) {
      addStop(resolvePoint(st.name, store, coordLookup, alert.stop_coords), st.action);
    }
    if (alert.corridor?.from_stop) {
      addStop(resolvePoint(alert.corridor.from_stop, store, coordLookup, alert.stop_coords));
    }
    if (alert.corridor?.to_stop) {
      addStop(resolvePoint(alert.corridor.to_stop, store, coordLookup, alert.stop_coords));
    }
    for (const lc of alert.line_changes ?? []) {
      addStop(resolvePoint(lc.from_stop, store, coordLookup, alert.stop_coords));
      addStop(resolvePoint(lc.to_stop, store, coordLookup, alert.stop_coords));
      for (const n of lc.omitted_stops ?? []) {
        addStop(resolvePoint(n, store, coordLookup, alert.stop_coords), 'omitted');
      }
      for (const n of lc.temporary_stops ?? []) {
        addStop(resolvePoint(n, store, coordLookup, alert.stop_coords), 'temporary');
      }
      for (const n of lc.transfer_stops ?? []) {
        addStop(resolvePoint(n, store, coordLookup, alert.stop_coords), 'transfer');
      }
    }

    // Fallback: jeśli żaden przystanek ani korytarz nie miał nazwy, użyj dowolnego stop_coords z alertu
    if (affectedStops.length === 0 && alert.stop_coords) {
      for (const [name, coord] of Object.entries(alert.stop_coords)) {
        if (coord && Number.isFinite(coord.lat) && Number.isFinite(coord.lon)) {
          addStop({ name, lat: coord.lat, lon: coord.lon });
        }
      }
    }

    let anchor: { lat: number; lon: number } | null = null;
    if (corridorCoords.length >= 2) {
      anchor = polylineMidpoint(corridorCoords);
    } else if (affectedStops.length > 0) {
      anchor = { lat: affectedStops[0].lat, lon: affectedStops[0].lon };
    }

    if (!anchor) continue;

    const replacementLine =
      alert.line_changes?.find((lc) => Boolean(lc.replacement_line))?.replacement_line ??
      alert.temporary_lines?.find((tl) => (tl.serves?.length ?? 0) > 0)?.line ??
      null;

    markers.push({
      id: alert.id || item.id,
      itemId: item.id,
      headline: alert.headline || item.title,
      shortLabel: resolveDisruptionMapLabel(alert),
      severity: alert.severity,
      disruptionType: alert.disruption_type,
      isEmergency: alert.is_emergency,
      lat: anchor.lat,
      lon: anchor.lon,
      corridorCoords,
      affectedStops,
      corridorLabel: alert.corridor?.label || null,
      fromStop: alert.corridor?.from_stop || null,
      toStop: alert.corridor?.to_stop || null,
      lines,
      problem: alert.glance?.problem || item.description,
      solution: alert.glance?.solution || null,
      timeframe: alert.glance?.timeframe || item.dateLabel,
      replacementLine,
      newsItem: item,
    });
  }

  return markers;
}
