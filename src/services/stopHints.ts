import { useEffect, useMemo, useState } from 'react';
import type { StopHintsDataset, StopHintValue } from '../types/stopHints';

const cache = new Map<string, StopHintsDataset>();
const inflightBundled = new Map<string, Promise<StopHintsDataset | null>>();
const inflightRemote = new Map<string, Promise<void>>();
const remoteChecked = new Set<string>();
const cityListeners = new Map<string, Set<() => void>>();

function notifyCityListeners(normCity: string): void {
  const listeners = cityListeners.get(normCity);
  if (!listeners) return;
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // ignore
    }
  }
}

function subscribeCityHints(normCity: string, listener: () => void): () => void {
  let set = cityListeners.get(normCity);
  if (!set) {
    set = new Set();
    cityListeners.set(normCity, set);
  }
  set.add(listener);
  return () => {
    const current = cityListeners.get(normCity);
    if (!current) return;
    current.delete(listener);
    if (current.size === 0) cityListeners.delete(normCity);
  };
}

function shouldReplaceDataset(
  current: StopHintsDataset | undefined,
  next: StopHintsDataset,
): boolean {
  const nextStopsCount = Object.keys(next.stops || {}).length;
  const nextEntrancesCount = next.metroEntrances?.length ?? 0;
  if (nextStopsCount === 0 && nextEntrancesCount === 0) return false;
  if (!current) return true;
  const curSchema = current.schemaVersion ?? 1;
  const nextSchema = next.schemaVersion ?? 1;
  if (nextSchema < curSchema) return false;
  if (nextSchema > curSchema) return true;
  if (current.generatedAt && next.generatedAt && next.generatedAt < current.generatedAt) {
    return false;
  }
  const curStopsCount = Object.keys(current.stops || {}).length;
  if (nextStopsCount < curStopsCount && (!next.generatedAt || next.generatedAt === current.generatedAt)) {
    return false;
  }
  return true;
}

function setCityCache(normCity: string, next: StopHintsDataset): void {
  const prev = cache.get(normCity);
  if (prev === next || !shouldReplaceDataset(prev, next)) return;
  cache.set(normCity, next);
  notifyCityListeners(normCity);
}

function extractHintText(val: StopHintValue | undefined): string | null {
  if (!val) return null;
  const text = typeof val === 'string' ? val : val.hint;
  const trimmed = text?.trim();
  return trimmed ? trimmed : null;
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

/**
 * Zwraca true wyłącznie dla kodów słupków unikalnych w skali całego miasta:
 * - Wrocław: 5-cyfrowe kody słupków (np. "20820")
 * - Kraków: zespół-słupek (np. "802-01")
 * - GZM: kod z myślnikiem lub alfanumeryczny >= 5 znaków (np. "2469011-00101", "GR01201")
 *
 * Odrzuca 1-3 cyfrowe lokalne numery słupków (np. Warszawa "01", "02", "06", Poznań "41", "71"),
 * które powtarzają się w całym mieście i powodowałyby kolizje między dzielnicami.
 */
function isGloballyUniqueStopCode(code: string): boolean {
  const c = code.trim();
  if (!c) return false;
  if (/^\d{1,3}$/.test(c)) return false;
  if (/^\d{4,}$/.test(c)) return true;
  if (/^[a-z0-9]+-[a-z0-9]+$/i.test(c) && c.length >= 4) return true;
  if (/[a-z]/i.test(c) && /\d/.test(c) && c.length >= 5) return true;
  return false;
}

function stripKnownStopIdPrefixes(rawId: string): string[] {
  const out: string[] = [rawId];
  let cur = rawId;
  if (cur.startsWith('stop-')) {
    cur = cur.slice(5);
    out.push(cur);
  }
  const krkMatch = cur.match(/^KRK:[ATM]:(.+)$/);
  if (krkMatch) {
    out.push(krkMatch[1]);
  }
  // Poznań zbiorkom: "poznan-glowny73-wqjhw" -> "poznan-glowny73"
  const poznanMatch = cur.match(/^([a-z0-9-]+\d{2})-[a-z0-9]{4,6}$/i);
  if (poznanMatch) {
    out.push(poznanMatch[1]);
  }
  return out;
}

/** Dynamiczny import per miasto: hints nie trafiają do startowego bundla. */
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
    const res = await fetch(`https://data.kilometr.app/${encodeURIComponent(cityId)}/stop-hints.json`, { signal });
    if (!res.ok) return null;
    const json = (await res.json()) as StopHintsDataset;
    return json && json.stops ? json : null;
  } catch {
    // Offline / fallback do bazy bundled
    return null;
  }
}

export function getCachedStopHints(cityId: string): StopHintsDataset | null {
  const norm = (cityId || '').trim().toLowerCase();
  return norm ? cache.get(norm) ?? null : null;
}

/**
 * Ładuje statyczny pakiet wskazówek dla miasta do pamięci (bez czekania na sieć).
 * Bezpieczne do wielokrotnego wywołania przed lub w trakcie routingu.
 */
export function ensureStopHintsLoaded(cityId: string): Promise<StopHintsDataset | null> {
  const norm = (cityId || '').trim().toLowerCase();
  if (!norm) return Promise.resolve(null);
  const hit = cache.get(norm);
  if (hit) return Promise.resolve(hit);
  const pending = inflightBundled.get(norm);
  if (pending) return pending;

  const task = loadBundledStopHints(norm)
    .then((bundled) => {
      if (bundled) {
        setCityCache(norm, bundled);
      }
      return cache.get(norm) ?? bundled ?? null;
    })
    .catch(() => null)
    .finally(() => {
      inflightBundled.delete(norm);
    });
  inflightBundled.set(norm, task);
  return task;
}

function refreshRemoteStopHints(normCity: string): void {
  if (!normCity || remoteChecked.has(normCity) || inflightRemote.has(normCity)) return;
  const task = fetchRemoteStopHints(normCity)
    .then((remote) => {
      if (remote) {
        remoteChecked.add(normCity);
        setCityCache(normCity, remote);
      }
    })
    .catch(() => {})
    .finally(() => {
      inflightRemote.delete(normCity);
    });
  inflightRemote.set(normCity, task);
}

function useStopHints(cityId: string) {
  const normCity = (cityId || '').trim().toLowerCase();
  const [data, setData] = useState<StopHintsDataset | null>(() =>
    normCity ? cache.get(normCity) ?? null : null,
  );

  useEffect(() => {
    if (!normCity) {
      setData((prev) => (prev === null ? prev : null));
      return;
    }

    const syncFromCache = () => {
      const latest = cache.get(normCity) ?? null;
      setData((prev) => (prev === latest ? prev : latest));
    };

    syncFromCache();
    const unsub = subscribeCityHints(normCity, syncFromCache);

    void ensureStopHintsLoaded(normCity).then(() => {
      syncFromCache();
      refreshRemoteStopHints(normCity);
    });

    return unsub;
  }, [normCity]);

  return data;
}

function lookupGloballyUniqueCode(
  stops: Record<string, StopHintValue>,
  rawCode: string,
): string | null {
  const trimmed = rawCode.trim();
  if (!isGloballyUniqueStopCode(trimmed)) return null;
  if (stops[trimmed]) return extractHintText(stops[trimmed]);
  const lower = trimmed.toLowerCase();
  if (lower !== trimmed && stops[lower]) return extractHintText(stops[lower]);
  if (/^\d{4,5}$/.test(trimmed)) {
    const pad5 = trimmed.padStart(5, '0');
    if (stops[pad5]) return extractHintText(stops[pad5]);
    const prefixed6 = `1${pad5}`;
    if (stops[prefixed6]) return extractHintText(stops[prefixed6]);
  }
  if (/^1\d{5}$/.test(trimmed)) {
    const base5 = trimmed.slice(1);
    if (stops[base5]) return extractHintText(stops[base5]);
  }
  return null;
}

export function resolveStopHint(
  dataset: StopHintsDataset | null,
  stopCode?: string | null,
  stopId?: string | null,
  stopName?: string | null,
  mode?: string | null,
): string | null {
  if (!dataset) return null;
  // Pociągi (dworce PKP) i platformy metra nie mają wskazówek peronowych (wejścia metra mają osobny wpis)
  if (mode === 'train' || mode === 'subway') return null;

  // 1. Sprawdź po unikalnym stopId (np. Warszawa "302702", wejście metra "1003M:E1", GZM "5410", Wrocław "10101")
  if (stopId) {
    const trimmedId = stopId.trim();
    if (trimmedId.startsWith('pl:') || trimmedId.startsWith('stop-pl:')) {
      return null;
    }
    for (const candidateId of stripKnownStopIdPrefixes(trimmedId)) {
      if (candidateId && dataset.stops[candidateId]) {
        return extractHintText(dataset.stops[candidateId]);
      }
      if (candidateId) {
        const byUniqueCode = lookupGloballyUniqueCode(dataset.stops, candidateId);
        if (byUniqueCode) return byUniqueCode;
      }
      if (candidateId && dataset.metroEntrances && /:E/i.test(candidateId)) {
        const ent = dataset.metroEntrances.find((e) => e.id === candidateId);
        if (ent?.hint) return ent.hint.trim();
      }
    }
  }

  // 2. Kombinacja stopName + numer słupka (np. Poznań "Poznań Główny 73" -> "poznan-glowny73")
  let slug = '';
  let snake = '';
  let cleanName = '';
  if (stopName) {
    cleanName = stopName.replace(/\s*\([^)]*\)/g, '').trim();
    slug = normalizeSlug(cleanName);
    snake = normalizeSnake(cleanName);

    // Jeśli nazwa przystanku sama zawiera numer słupka na końcu (Poznań: "Poznań Główny 73")
    const trailingPoleMatch = cleanName.match(/^(.*?)\s+(\d{2})$/);
    if (trailingPoleMatch) {
      const baseSlug = normalizeSlug(trailingPoleMatch[1]);
      const poleNum = trailingPoleMatch[2];
      const composite = `${baseSlug}${poleNum}`;
      if (dataset.stops[composite]) return extractHintText(dataset.stops[composite]);
      if (dataset.stops[slug]) return extractHintText(dataset.stops[slug]);
    }

    const code = (
      stopCode ||
      stopName.match(/(?:peron|słupek|stanowisko)\s*(\d+)/i)?.[1] ||
      trailingPoleMatch?.[2] ||
      ''
    ).trim();

    if (code) {
      const baseName = trailingPoleMatch ? trailingPoleMatch[1] : cleanName;
      const baseSlug = normalizeSlug(baseName);
      const baseSnake = normalizeSnake(baseName);
      const pad2 = code.padStart(2, '0');
      const noZero = code.replace(/^0+/, '');
      const candidates = [
        `${baseSlug}${code}`,
        `${baseSlug}${pad2}`,
        `${baseSlug}${noZero}`,
        `${baseSlug}-${code}`,
        `${baseSlug}-${pad2}`,
        `${baseSnake}_${code}`,
        `${baseSnake}_${pad2}`,
        `${baseName} ${code}`,
        `${baseName} ${pad2}`,
      ];

      for (const cand of candidates) {
        if (dataset.stops[cand]) {
          return extractHintText(dataset.stops[cand]);
        }
      }

      // Warianty z sufiksem geohash w kluczu (np. "poznan-glowny73-wqjhw")
      const primaryPrefix = `${baseSlug}${code}-`;
      const padPrefix = `${baseSlug}${pad2}-`;
      for (const [key, val] of Object.entries(dataset.stops)) {
        if (key.startsWith(primaryPrefix) || key.startsWith(padPrefix)) {
          return extractHintText(val);
        }
      }
    }
  }

  // 3. Bezpośredni stopCode WYŁĄCZNIE gdy jest globalnie unikalny w skali miasta
  // (Wrocław "20820", GZM "2469011-00101", Kraków "901-01"; nigdy Warszawa "01"/"02"/"06" ani Poznań "41"/"71").
  if (stopCode) {
    const byCode = lookupGloballyUniqueCode(dataset.stops, stopCode);
    if (byCode) return byCode;
  }

  // 4. Fallback do jawnych klastrów (wyłącznie dataset.clusters, nigdy przypadkowy słupek z dataset.stops)
  if (cleanName && dataset.clusters) {
    if (dataset.clusters[snake]) return dataset.clusters[snake];
    if (dataset.clusters[slug]) return dataset.clusters[slug];
    const lower = cleanName.toLowerCase();
    if (dataset.clusters[lower]) return dataset.clusters[lower];
  }

  return null;
}

export function useStopHint(
  cityId: string,
  stopCode?: string | null,
  stopId?: string | null,
  stopName?: string | null,
  mode?: string | null,
): string | null {
  const skipHints =
    mode === 'train' ||
    mode === 'subway' ||
    Boolean(stopId && (stopId.startsWith('pl:') || stopId.startsWith('stop-pl:')));
  const normCity = skipHints ? '' : (cityId || '').trim().toLowerCase();
  const dataset = useStopHints(normCity);
  return useMemo(
    () => (skipHints ? null : resolveStopHint(dataset, stopCode, stopId, stopName, mode)),
    [skipHints, dataset, stopCode, stopId, stopName, mode],
  );
}
