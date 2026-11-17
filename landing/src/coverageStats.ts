import raw from './data/coverageStats.json';

/** Liczby pokazywane w spotlightcie miasta; snapshot z GitHub Actions. */
export interface CoverageCityStats {
  live: { available: boolean; vehicles: number | null };
  news: { available: boolean };
  stopHints: { available: boolean; stops: number | null };
}

interface CoverageStatsFile {
  generatedAt?: string;
  cities?: Record<string, CoverageCityStats | undefined>;
}

const EMPTY_STATS: CoverageCityStats = {
  live: { available: false, vehicles: null },
  news: { available: false },
  stopHints: { available: false, stops: null },
};

const file = raw as CoverageStatsFile;

export function getCoverageStats(city: string): CoverageCityStats {
  return file.cities?.[city] ?? EMPTY_STATS;
}

export function getCoverageStatsGeneratedAt(): string | null {
  return file.generatedAt ?? null;
}
