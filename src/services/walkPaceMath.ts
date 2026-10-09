/**
 * Czysta matematyka tempa chodzenia: zero `expo-*`, zero storage.
 * Da się uruchomić pod `tsx` bez telefonu.
 */

export type WalkSpeedSource = 'place' | 'area' | 'overall' | 'profile';

/** Ile pomiarów potrzeba, żeby zaufać miejscu albo okolicy. */
export const MIN_PLACE_SAMPLES = 3;
/** Ile pomiarów potrzeba, żeby zaufać medianie overall. */
export const MIN_OVERALL_SAMPLES = 3;

export const MAX_OVERALL = 60;
export const MAX_PER_PLACE = 12;
export const MAX_PLACES = 40;

/**
 * Domyślne tempo zapasowe dla profili (m/s). Spokojny spacer ok. 3,6 km/h,
 * typowy chód miejski ok. 4,8 km/h, szybki marsz ok. 6,0 km/h.
 */
export const WALK_PACE_DEFAULTS_MPS: Record<WalkPaceProfile, number> = {
  slow: 1.0,
  normal: 1.34,
  fast: 1.67,
};

export type WalkPaceProfile = 'slow' | 'normal' | 'fast';

export interface WalkPacePlaceBin {
  s: number[];
  u: number;
}

export interface WalkPaceSnapshot {
  overall: number[];
  places: Record<string, WalkPacePlaceBin>;
  updatedAt: number;
}

/** Mediana, odporna na pojedyncze skoki GPS. Dlatego mediana, nie średnia. */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371e3;
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dp = ((lat2 - lat1) * Math.PI) / 180;
  const dl = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Komórka startu, ok. 110 m. Ciasna na „spod domu", luźna na szum GPS. */
export function placeCellKey(lat: number, lon: number): string {
  return `${lat.toFixed(3)},${lon.toFixed(3)}`;
}

/** Slug przystanku docelowego: małe litery, bez ogonków, max 40 znaków. */
export function destSlug(dest: string | undefined | null): string {
  if (!dest) return '*';
  const slug = dest
    .toLowerCase()
    .replace(/ł/g, 'l')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return slug || '*';
}

/** Klucz miejsca: komórka startu plus docelowy przystanek. */
export function placeKeyFor(originLat: number, originLon: number, dest?: string | null): string {
  return `${placeCellKey(originLat, originLon)}|${destSlug(dest)}`;
}

export function sanitizeSpeed(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  if (v < 0.4 || v > 2.8) return null;
  return Math.round(v * 100) / 100;
}

export interface ResolvedWalkSpeed {
  speedMps: number;
  source: WalkSpeedSource;
  samples: number;
}

/**
 * Łańcuch: dokładne miejsce -> okolica startu -> mediana overall -> profil.
 * Czysta funkcja, snapshot podaje wołający (magazyn albo test).
 */
export function resolveWalkSpeed(
  snapshot: WalkPaceSnapshot,
  args: { fromLat?: number; fromLon?: number; dest?: string | null; fallbackMps: number },
): ResolvedWalkSpeed {
  const profileOnly: ResolvedWalkSpeed = { speedMps: args.fallbackMps, source: 'profile', samples: 0 };

  if (args.fromLat == null || args.fromLon == null) {
    if (snapshot.overall.length >= MIN_OVERALL_SAMPLES) {
      const m = median(snapshot.overall);
      if (m !== null) return { speedMps: m, source: 'overall', samples: snapshot.overall.length };
    }
    return profileOnly;
  }

  const exact = snapshot.places[placeKeyFor(args.fromLat, args.fromLon, args.dest)];
  if (exact && exact.s.length >= MIN_PLACE_SAMPLES) {
    const m = median(exact.s);
    if (m !== null) return { speedMps: m, source: 'place', samples: exact.s.length };
  }

  const cell = placeCellKey(args.fromLat, args.fromLon);
  const areaSamples = Object.entries(snapshot.places)
    .filter(([k]) => k.startsWith(`${cell}|`))
    .flatMap(([, bin]) => bin.s);
  if (areaSamples.length >= MIN_PLACE_SAMPLES) {
    const m = median(areaSamples);
    if (m !== null) return { speedMps: m, source: 'area', samples: areaSamples.length };
  }

  if (snapshot.overall.length >= MIN_OVERALL_SAMPLES) {
    const m = median(snapshot.overall);
    if (m !== null) return { speedMps: m, source: 'overall', samples: snapshot.overall.length };
  }
  return profileOnly;
}
