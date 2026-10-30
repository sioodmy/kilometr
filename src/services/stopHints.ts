import { useEffect, useState } from 'react';
import { TIMETABLE } from './gtfsConfig';
import { WROCLAW_STOP_HINTS } from '../data/stopHintsWroclaw';
import type { StopHintsDataset } from '../types/stopHints';

const cache = new Map<string, StopHintsDataset>();

export function normalizeClusterKey(value?: string | null): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[ąćęłńóśźż]/g, (c) => ({ ą: 'a', ć: 'c', ę: 'e', ł: 'l', ń: 'n', ó: 'o', ś: 's', ź: 'z', ż: 'z' })[c] || c)
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function getBundledStopHints(cityId: string): StopHintsDataset | null {
  if (cityId === 'wroclaw') {
    return WROCLAW_STOP_HINTS;
  }
  return null;
}

export async function fetchStopHints(cityId: string, signal?: AbortSignal): Promise<StopHintsDataset | null> {
  if (cache.has(cityId)) {
    return cache.get(cityId)!;
  }

  const bundled = getBundledStopHints(cityId);
  if (bundled) {
    cache.set(cityId, bundled);
  }

  // Próba pobrania świeższych danych z R2 w tle
  if (TIMETABLE?.baseUrl) {
    try {
      const url = `${TIMETABLE.baseUrl}/${cityId}/stop-hints.json`;
      const res = await fetch(url, { signal });
      if (res.ok) {
        const remote: StopHintsDataset = await res.json();
        if (remote && remote.schemaVersion === 1) {
          cache.set(cityId, remote);
          return remote;
        }
      }
    } catch {
      // Offline fallback: zostajemy przy cache lub bundle
    }
  }

  return cache.get(cityId) ?? null;
}

export function resolveStopHint(
  dataset: StopHintsDataset | null,
  stopCode?: string | null,
  stopId?: string | null,
  stopName?: string | null,
): string | null {
  if (!dataset) return null;

  // 1. Dopasowanie po kodzie słupka (np. "20820")
  if (stopCode) {
    const item = dataset.stops[stopCode];
    if (item) return typeof item === 'string' ? item : (item as any).hint;
  }

  // 2. Dopasowanie po stop_id z GTFS
  if (stopId) {
    const item = dataset.stops[stopId];
    if (item) return typeof item === 'string' ? item : (item as any).hint;
  }

  // 3. Fallback po nazwie zespołu przystankowego (np. "pl_grunwaldzki")
  if (stopName) {
    const key = normalizeClusterKey(stopName);
    const clusterHint =
      dataset.clusters[key] ??
      dataset.clusters[key.replace(/^plac_/, 'pl_')] ??
      dataset.clusters[key.replace(/^pl_/, 'plac_')] ??
      dataset.clusters[key.replace(/^aleja_/, 'al_')] ??
      dataset.clusters[key.replace(/^al_/, 'aleja_')];

    if (clusterHint) return clusterHint;
  }

  return null;
}

/** Hook do pobierania wskazówki dla danego przystanku */
export function useStopHint(
  cityId: string,
  stopCode?: string | null,
  stopId?: string | null,
  stopName?: string | null,
): string | null {
  const [hint, setHint] = useState<string | null>(() =>
    resolveStopHint(getBundledStopHints(cityId), stopCode, stopId, stopName),
  );

  useEffect(() => {
    let active = true;
    const ctrl = new AbortController();

    // Sprawdź czy mamy w pamięci podręcznej lub offline bundle
    const syncResult = resolveStopHint(cache.get(cityId) ?? getBundledStopHints(cityId), stopCode, stopId, stopName);
    setHint(syncResult);

    // W tle sprawdź aktualizację z R2
    void fetchStopHints(cityId, ctrl.signal).then((dataset) => {
      if (!active || !dataset) return;
      const updated = resolveStopHint(dataset, stopCode, stopId, stopName);
      if (updated !== syncResult) {
        setHint(updated);
      }
    });

    return () => {
      active = false;
      ctrl.abort();
    };
  }, [cityId, stopCode, stopId, stopName]);

  return hint;
}
