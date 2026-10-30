import { useEffect, useMemo, useState } from 'react';
import { STOP_HINTS_WROCLAW, WROCLAW_STOP_HINTS } from '../data/stopHintsWroclaw';
import { STOP_HINTS_WARSZAWA } from '../data/stopHintsWarszawa';
import { STOP_HINTS_GZM } from '../data/stopHintsGzm';
import { STOP_HINTS_KRAKOW } from '../data/stopHintsKrakow';
import type { StopHintsDataset, StopHintValue } from '../types/stopHints';

const cache = new Map<string, StopHintsDataset>();

function extractHintText(val: StopHintValue | undefined): string | null {
  if (!val) return null;
  if (typeof val === 'string') return val;
  return val.hint || null;
}

export function getBundledStopHints(cityId: string): StopHintsDataset | null {
  const c = cityId.toLowerCase();
  if (c === 'wroclaw' || c === 'wrocław') {
    return STOP_HINTS_WROCLAW;
  }
  if (c === 'warszawa' || c === 'warsaw') {
    return STOP_HINTS_WARSZAWA;
  }
  if (c === 'gzm' || c === 'katowice' || c === 'metropolia') {
    return STOP_HINTS_GZM;
  }
  if (c === 'krakow' || c === 'kraków') {
    return STOP_HINTS_KRAKOW;
  }
  return null;
}

export async function fetchStopHints(
  cityId: string,
  signal?: AbortSignal,
): Promise<StopHintsDataset | null> {
  const cached = cache.get(cityId);
  if (cached) return cached;

  const bundled = getBundledStopHints(cityId);
  if (bundled) {
    cache.set(cityId, bundled);
  }

  try {
    const res = await fetch(`https://data.kilometr.app/${cityId}/stop-hints.json`, { signal });
    if (res.ok) {
      const remote: StopHintsDataset = await res.json();
      if (remote && remote.stops) {
        cache.set(cityId, remote);
        return remote;
      }
    }
  } catch {
    // Offline / fallback do bazy bundled
  }

  return bundled;
}

export function useStopHints(cityId: string) {
  const [data, setData] = useState<StopHintsDataset | null>(() => getBundledStopHints(cityId));

  useEffect(() => {
    let cancelled = false;
    const bundled = getBundledStopHints(cityId);
    if (bundled) {
      setData(bundled);
    }

    const abortController = new AbortController();
    fetchStopHints(cityId, abortController.signal).then((loaded) => {
      if (!cancelled && loaded) {
        setData(loaded);
      }
    });

    return () => {
      cancelled = true;
      abortController.abort();
    };
  }, [cityId]);

  return data;
}

export function resolveStopHint(
  dataset: StopHintsDataset | null,
  stopCode?: string | null,
  stopId?: string | null,
  _stopName?: string | null,
): string | null {
  if (!dataset) return null;

  // 1. Sprawdź po unikalnym stopId (np. Warszawa "700201", GZM "3220", Wrocław "10101", Kraków "stop_322_117319")
  if (stopId && dataset.stops[stopId]) {
    return extractHintText(dataset.stops[stopId]);
  }
  // 2. Sprawdź po stopCode (np. Wrocław "20820", GZM "2470011-08702", Kraków "901-01", Warszawa "01")
  if (stopCode && dataset.stops[stopCode]) {
    return extractHintText(dataset.stops[stopCode]);
  }

  // UWAGA: Świadomie NIE robimy fallbacku do ogólnych opisów węzłów (clusters).
  // Pasażer musi mieć pewność z którego konkretnie peronu/słupka odjeżdża.
  // Ogólny opis całego węzła nie daje mu odpowiedzi na pytanie "skąd odjeżdża mój pojazd".
  return null;
}

export function useStopHint(
  cityId: string,
  stopCode?: string | null,
  stopId?: string | null,
  stopName?: string | null,
): string | null {
  const dataset = useStopHints(cityId);
  return useMemo(
    () => resolveStopHint(dataset, stopCode, stopId, stopName),
    [dataset, stopCode, stopId, stopName],
  );
}

export { WROCLAW_STOP_HINTS };
