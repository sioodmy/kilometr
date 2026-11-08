import { useEffect, useMemo, useState } from 'react';
import type { StopHintsDataset, StopHintValue } from '../types/stopHints';

const cache = new Map<string, StopHintsDataset>();

function extractHintText(val: StopHintValue | undefined): string | null {
  if (!val) return null;
  if (typeof val === 'string') return val;
  return val.hint || null;
}

function normalizePolishText(value: string | null | undefined): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(
      /[ąćęłńóśźż]/g,
      (c) =>
        ({
          ą: 'a',
          ć: 'c',
          ę: 'e',
          ł: 'l',
          ń: 'n',
          ó: 'o',
          ś: 's',
          ź: 'z',
          ż: 'z',
        })[c] || c,
    );
}

function normalizeSlug(value: string | null | undefined): string {
  return normalizePolishText(value)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeSnake(value: string | null | undefined): string {
  return normalizePolishText(value)
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
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
  const normCity = (cityId || '').trim().toLowerCase();
  const [data, setData] = useState<StopHintsDataset | null>(() => cache.get(normCity) ?? null);

  useEffect(() => {
    let cancelled = false;
    const abortController = new AbortController();
    const apply = (next: StopHintsDataset) => {
      cache.set(normCity, next);
      if (!cancelled) setData(next);
    };

    // Bundled hints pokazujemy od razu; remote dociąga się w tle i podmienia cache.
    const load = async () => {
      const cached = cache.get(normCity);
      if (cached) {
        apply(cached);
        return;
      }
      const bundled = await loadBundledStopHints(normCity).catch(() => null);
      if (cancelled) return;
      // Równoległe karty mogły już zdążyć wpisać bundled do cache.
      const raced = cache.get(normCity);
      if (raced) {
        apply(raced);
        return;
      }
      if (bundled) {
        apply(bundled);
      } else {
        setData(null);
      }
      const remote = await fetchRemoteStopHints(normCity, abortController.signal);
      if (remote) apply(remote);
    };

    const currentCached = cache.get(normCity) ?? null;
    setData(currentCached);
    void load();

    return () => {
      cancelled = true;
      abortController.abort();
    };
  }, [normCity]);

  return data;
}

export function resolveStopHint(
  dataset: StopHintsDataset | null,
  stopCode?: string | null,
  stopId?: string | null,
  stopName?: string | null,
): string | null {
  if (!dataset) return null;

  // 1. Sprawdź po unikalnym stopId (np. Warszawa "700201", GZM "3220", Wrocław "10101", Kraków "stop_322_117319")
  if (stopId) {
    const trimmedId = stopId.trim();
    if (dataset.stops[trimmedId]) return extractHintText(dataset.stops[trimmedId]);

    // Odrzuć prefiksy krajowe i relacyjne (np. "pl:5100028" -> "5100028", "stop-pl:5100028" -> "5100028")
    const strippedPl = trimmedId.startsWith('pl:')
      ? trimmedId.slice(3)
      : trimmedId.startsWith('stop-pl:')
        ? trimmedId.slice(8)
        : trimmedId.startsWith('stop-')
          ? trimmedId.slice(5)
          : null;
    if (strippedPl && dataset.stops[strippedPl]) return extractHintText(dataset.stops[strippedPl]);
  }

  // 2. Kombinacja stopName + stopCode (np. Poznań "poznan-glowny73", "poznan-glowny01")
  // Sprawdzamy PRZED czystym 1-2 cyfrowym stopCode, żeby uniknąć kolizji z odległymi słupkami o tym samym numerze.
  let slug = '';
  let snake = '';
  let cleanName = '';
  if (stopName) {
    cleanName = stopName.replace(/\s*\([^)]*\)/g, '').trim();
    slug = normalizeSlug(cleanName);
    snake = normalizeSnake(cleanName);
    const code = (
      stopCode ||
      stopName.match(/(?:peron|słupek|stanowisko)\s*(\d+)/i)?.[1] ||
      ''
    ).trim();

    if (code) {
      const pad2 = code.padStart(2, '0');
      const noZero = code.replace(/^0+/, '');
      const candidates = [
        `${slug}${code}`,
        `${slug}${pad2}`,
        `${slug}${noZero}`,
        `${slug}-${code}`,
        `${slug}-${pad2}`,
        `${slug}-${noZero}`,
        `${snake}_${code}`,
        `${snake}_${pad2}`,
        `${snake}_${noZero}`,
        `${snake}${code}`,
        `${snake}${pad2}`,
        `${snake}${noZero}`,
        `${cleanName} ${code}`,
        `${cleanName} ${pad2}`,
      ];

      for (const cand of candidates) {
        if (dataset.stops[cand]) {
          return extractHintText(dataset.stops[cand]);
        }
      }

      // Warianty z sufiksem geohash w kluczu (np. "poznan-glowny73-wqjhw")
      const primaryPrefix = `${slug}${code}-`;
      const padPrefix = `${slug}${pad2}-`;
      for (const [key, val] of Object.entries(dataset.stops)) {
        if (key.startsWith(primaryPrefix) || key.startsWith(padPrefix)) {
          return extractHintText(val);
        }
      }
    }
  }

  // 3. Bezpośredni stopCode (np. Wrocław "20820", GZM "2470011-08702", Kraków "901-01", Warszawa "01")
  if (stopCode) {
    const trimmedCode = stopCode.trim();
    if (dataset.stops[trimmedCode]) return extractHintText(dataset.stops[trimmedCode]);
  }

  // 4. Warianty z normalizacją kluczy (leading zeroes, pad5, pad2)
  if (stopId) {
    const trimmedId = stopId.trim();
    const noLeadingZeros = trimmedId.replace(/^0+/, '');
    if (noLeadingZeros && dataset.stops[noLeadingZeros]) {
      return extractHintText(dataset.stops[noLeadingZeros]);
    }
    const pad5 = trimmedId.padStart(5, '0');
    if (dataset.stops[pad5]) return extractHintText(dataset.stops[pad5]);
  }
  if (stopCode) {
    const trimmedCode = stopCode.trim();
    const noLeadingZeros = trimmedCode.replace(/^0+/, '');
    if (noLeadingZeros && dataset.stops[noLeadingZeros]) {
      return extractHintText(dataset.stops[noLeadingZeros]);
    }
    const pad5 = trimmedCode.padStart(5, '0');
    if (dataset.stops[pad5]) return extractHintText(dataset.stops[pad5]);
    const pad2 = trimmedCode.padStart(2, '0');
    if (dataset.stops[pad2]) return extractHintText(dataset.stops[pad2]);
  }

  // 5. Fallback do klastrów / węzłów przesiadkowych (dataset.clusters lub bezpośredni klucz w stops)
  if (cleanName) {
    if (dataset.clusters) {
      if (dataset.clusters[snake]) return dataset.clusters[snake];
      if (dataset.clusters[slug]) return dataset.clusters[slug];
      const lower = cleanName.toLowerCase();
      if (dataset.clusters[lower]) return dataset.clusters[lower];
    }
    if (dataset.stops[snake]) return extractHintText(dataset.stops[snake]);
    if (dataset.stops[slug]) return extractHintText(dataset.stops[slug]);
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
