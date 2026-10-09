import { useEffect, useState } from 'react';
import { kvGet, kvSet } from './storage';
import { getSettingsSync, useRoutingSettings, profileWalkSpeedMps } from './settings';
import {
  MAX_OVERALL,
  MAX_PER_PLACE,
  MAX_PLACES,
  destSlug,
  median,
  placeCellKey,
  placeKeyFor,
  resolveWalkSpeed,
  sanitizeSpeed,
  type WalkPacePlaceBin,
  type WalkPaceProfile,
  type WalkPaceSnapshot,
  type WalkSpeedSource,
} from './walkPaceMath';

export type { WalkPaceSnapshot, WalkSpeedSource };
export { destSlug, median, placeCellKey, placeKeyFor } from './walkPaceMath';

/**
 * Zmierzone tempo chodzenia (magazyn).
 *
 * Podczas śledzenia kursu („Śledź ten kurs") telefon i tak trzyma foreground
 * service z trwałym powiadomieniem, więc `walkTracking` dopina do niego
 * obserwator GPS: mierzy efektywne tempo dojść pieszych i zapisuje je tutaj.
 *
 * Rozdzielczość miejsce po miejscu: ta sama osoba idzie inaczej spod domu
 * (prosto, bez świateł) a inaczej spod uczelni (światła, tłum). Matematykę
 * fallbacku (miejsce -> okolica -> overall -> profil) trzyma `walkPaceMath`.
 */

const STORE_KEY = 'kilometr.walkPace.v1';

const EMPTY: WalkPaceSnapshot = { overall: [], places: {}, updatedAt: 0 };

let cached: WalkPaceSnapshot = { ...EMPTY, overall: [], places: {} };
let loaded = false;
const listeners = new Set<() => void>();

function notify() {
  for (const l of listeners) l();
}

function sanitizeSnapshot(raw: unknown): WalkPaceSnapshot {
  if (typeof raw !== 'object' || raw === null) return { ...EMPTY, overall: [], places: {} };
  const r = raw as Partial<WalkPaceSnapshot>;
  const overall = Array.isArray(r.overall)
    ? r.overall.map(sanitizeSpeed).filter((v): v is number => v !== null).slice(-MAX_OVERALL)
    : [];
  const places: Record<string, WalkPacePlaceBin> = {};
  if (r.places && typeof r.places === 'object') {
    for (const [k, bin] of Object.entries(r.places)) {
      if (typeof k !== 'string' || k.length > 96) continue;
      if (typeof bin !== 'object' || bin === null) continue;
      const s = Array.isArray((bin as WalkPacePlaceBin).s)
        ? (bin as WalkPacePlaceBin).s.map(sanitizeSpeed).filter((v): v is number => v !== null).slice(-MAX_PER_PLACE)
        : [];
      if (s.length === 0) continue;
      places[k] = { s, u: typeof (bin as WalkPacePlaceBin).u === 'number' ? (bin as WalkPacePlaceBin).u : 0 };
    }
  }
  return { overall, places, updatedAt: typeof r.updatedAt === 'number' ? r.updatedAt : 0 };
}

export async function loadWalkPace(): Promise<WalkPaceSnapshot> {
  if (loaded) return { ...cached, overall: [...cached.overall], places: { ...cached.places } };
  try {
    const raw = await kvGet(STORE_KEY);
    if (raw) cached = sanitizeSnapshot(JSON.parse(raw));
  } catch {
    // storage niedostępny, zostaje pusto (fallback do profilu)
  }
  loaded = true;
  notify();
  return { ...cached, overall: [...cached.overall], places: { ...cached.places } };
}

function persist() {
  cached.updatedAt = Date.now();
  notify();
  void kvSet(STORE_KEY, JSON.stringify(cached)).catch(() => {});
}

export function subscribeWalkPace(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export interface WalkSample {
  originLat: number;
  originLon: number;
  /** Nazwa albo id przystanku docelowego. */
  dest?: string | null;
  /** Efektywne tempo dojścia (m/s), razem z postojami. */
  speedMps: number;
  distanceM: number;
  durationSec: number;
}

/** Dopisuje jeden zakończony spacer. Niewiarygodne pomiary odpadają po cichu. */
export async function recordWalkSample(sample: WalkSample): Promise<boolean> {
  const speed = sanitizeSpeed(sample.speedMps);
  if (speed === null) return false;
  if (!Number.isFinite(sample.originLat) || !Number.isFinite(sample.originLon)) return false;
  if (!(sample.distanceM >= 40) || !(sample.durationSec >= 30) || sample.durationSec > 30 * 60) return false;
  await loadWalkPace();

  cached.overall.push(speed);
  if (cached.overall.length > MAX_OVERALL) cached.overall.splice(0, cached.overall.length - MAX_OVERALL);

  const key = placeKeyFor(sample.originLat, sample.originLon, sample.dest);
  const bin = cached.places[key] ?? { s: [], u: 0 };
  bin.s.push(speed);
  if (bin.s.length > MAX_PER_PLACE) bin.s.splice(0, bin.s.length - MAX_PER_PLACE);
  bin.u = Date.now();
  cached.places[key] = bin;

  const keys = Object.keys(cached.places);
  if (keys.length > MAX_PLACES) {
    keys
      .sort((a, b) => (cached.places[a]?.u ?? 0) - (cached.places[b]?.u ?? 0))
      .slice(0, keys.length - MAX_PLACES)
      .forEach((k) => delete cached.places[k]);
  }
  persist();
  return true;
}

export interface ResolvedWalkSpeed {
  speedMps: number;
  source: WalkSpeedSource;
  /** Ile pomiarów stoi za wybranym źródłem. */
  samples: number;
  /** Mediana overall, do pokazania w ustawieniach (null gdy brak). */
  overallMedian: number | null;
  overallCount: number;
  placeCount: number;
}

export function resolveWalkSpeedSync(args: {
  fromLat?: number;
  fromLon?: number;
  dest?: string | null;
  profile?: WalkPaceProfile;
}): ResolvedWalkSpeed {
  const profile = args.profile ?? getSettingsSync().walkPace ?? 'normal';
  const r = resolveWalkSpeed(cached, {
    fromLat: args.fromLat,
    fromLon: args.fromLon,
    dest: args.dest,
    fallbackMps: profileWalkSpeedMps(profile),
  });
  return {
    ...r,
    overallMedian: median(cached.overall),
    overallCount: cached.overall.length,
    placeCount: Object.keys(cached.places).length,
  };
}

/** Jedna liczba do planera i ETA: miejsce, okolica, overall albo profil. */
export function getEffectiveWalkSpeedSync(args?: {
  fromLat?: number;
  fromLon?: number;
  dest?: string | null;
  profile?: WalkPaceProfile;
}): number {
  return resolveWalkSpeedSync(args ?? {}).speedMps;
}

/** Hook do kart i osi czasu: efektywne tempo, odświeżane po każdym spacerze. */
export function useEffectiveWalkSpeedMps(args?: {
  fromLat?: number;
  fromLon?: number;
  dest?: string | null;
}): number {
  const { settings } = useRoutingSettings();
  useWalkPaceStats();
  return resolveWalkSpeedSync({ ...args, profile: settings.walkPace }).speedMps;
}

export interface WalkPaceStats {
  loaded: boolean;
  overallMedian: number | null;
  overallCount: number;
  placeCount: number;
}

/** Hook do ustawień: podsumowanie pomiarów, odświeżane przy każdym spacerze. */
export function useWalkPaceStats(): WalkPaceStats {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    loadWalkPace().then(() => {
      if (alive) setTick((t) => t + 1);
    });
    const unsub = subscribeWalkPace(() => setTick((t) => t + 1));
    return () => {
      alive = false;
      unsub();
    };
  }, []);
  void tick;
  return {
    loaded,
    overallMedian: median(cached.overall),
    overallCount: cached.overall.length,
    placeCount: Object.keys(cached.places).length,
  };
}
