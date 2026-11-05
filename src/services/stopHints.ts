import { useEffect, useMemo, useState } from 'react';
import type { StopHintsDataset, StopHintValue } from '../types/stopHints';

const cache = new Map<string, StopHintsDataset>();

function extractHintText(val: StopHintValue | undefined): string | null {
  if (!val) return null;
  if (typeof val === 'string') return val;
  return val.hint || null;
}

/** Dynamiczny import per miasto: 684 KB hints nie trafia do startowego bundla. */
function loadBundledStopHints(cityId: string): Promise<StopHintsDataset | null> {
  const c = cityId.toLowerCase();
  if (c === 'wroclaw' || c === 'wrocław') {
    return import('../data/stopHintsWroclaw').then((m) => m.STOP_HINTS_WROCLAW);
  }
  if (c === 'warszawa' || c === 'warsaw') {
    return import('../data/stopHintsWarszawa').then((m) => m.STOP_HINTS_WARSZAWA);
  }
  if (c === 'gzm' || c === 'katowice' || c === 'metropolia') {
    return import('../data/stopHintsGzm').then((m) => m.STOP_HINTS_GZM);
  }
  if (c === 'krakow' || c === 'kraków') {
    return import('../data/stopHintsKrakow').then((m) => m.STOP_HINTS_KRAKOW);
  }
  if (c === 'poznan' || c === 'poznań') {
    return import('../data/stopHintsPoznan').then((m) => m.STOP_HINTS_POZNAN);
  }
  return Promise.resolve(null);
}

async function fetchRemoteStopHints(
  cityId: string,
  signal?: AbortSignal,
): Promise<StopHintsDataset | null> {
  try {
    const res = await fetch(`https://data.kilometr.app/${cityId}/stop-hints.json`, { signal });
    if (!res.ok) return null;
    const remote: StopHintsDataset = await res.json();
    return remote && remote.stops ? remote : null;
  } catch {
    // Offline / fallback do bazy bundled
    return null;
  }
}

function useStopHints(cityId: string) {
  const [data, setData] = useState<StopHintsDataset | null>(() => cache.get(cityId) ?? null);

  useEffect(() => {
    let cancelled = false;
    const abortController = new AbortController();
    const apply = (next: StopHintsDataset) => {
      cache.set(cityId, next);
      if (!cancelled) setData(next);
    };

    // Bundled hints pokazujemy od razu; remote dociąga się w tle i podmienia cache.
    const load = async () => {
      const cached = cache.get(cityId);
      if (cached) {
        apply(cached);
        return;
      }
      const bundled = await loadBundledStopHints(cityId).catch(() => null);
      if (cancelled) return;
      // Równoległe karty mogły już zdążyć wpisać bundled do cache.
      const raced = cache.get(cityId);
      if (raced) {
        apply(raced);
        return;
      }
      if (bundled) {
        apply(bundled);
      } else {
        setData(null);
      }
      const remote = await fetchRemoteStopHints(cityId, abortController.signal);
      if (remote) apply(remote);
    };

    setData(cache.get(cityId) ?? null);
    void load();

    return () => {
      cancelled = true;
      abortController.abort();
    };
  }, [cityId]);

  return data;
}

function resolveStopHint(
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

  // Warianty z normalizacją kluczy (np. leading zeroes lub 5-cyfrowe dopełnienia dla przesiadek)
  if (stopId) {
    const trimmedId = stopId.trim();
    if (dataset.stops[trimmedId]) return extractHintText(dataset.stops[trimmedId]);
    const noLeadingZeros = trimmedId.replace(/^0+/, '');
    if (noLeadingZeros && dataset.stops[noLeadingZeros]) return extractHintText(dataset.stops[noLeadingZeros]);
    const pad5 = trimmedId.padStart(5, '0');
    if (dataset.stops[pad5]) return extractHintText(dataset.stops[pad5]);
  }
  if (stopCode) {
    const trimmedCode = stopCode.trim();
    if (dataset.stops[trimmedCode]) return extractHintText(dataset.stops[trimmedCode]);
    const noLeadingZeros = trimmedCode.replace(/^0+/, '');
    if (noLeadingZeros && dataset.stops[noLeadingZeros]) return extractHintText(dataset.stops[noLeadingZeros]);
    const pad5 = trimmedCode.padStart(5, '0');
    if (dataset.stops[pad5]) return extractHintText(dataset.stops[pad5]);
  }

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
