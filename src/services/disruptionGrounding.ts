// Uziemienie komunikatów pasażerskich w lokalnej bazie GTFS.
// Potok LLM zwraca linie i przystanki jako tekst (mianownik, ale nie zawsze
// identyczny z GTFS). Tutaj dopasowujemy je do route_id / stop_id, żeby
// aplikacja porównywała alert z konkretnym kursem i przystankiem na trasie
// pasażera zamiast po fuzzy stringach.
//
// Grounding jest po stronie aplikacji, nie potoku, bo GTFS zmienia się raz na
// dobę a disruptions.json co 20 minut: ID wyliczone serwerowo mogłyby chwilowo
// nie istnieć w bazie na telefonie. Tu zawsze mamy spójny stan z planerem.

import { normalizePolish } from '../gtfs/geo';
import { fuzzyMatchBatch } from '../gtfs/fuzzy';
import { gtfsStore, type LocalGtfsStore } from './routing/store';
import { UI_YIELD_BUDGET_MS, yieldToUiFrame } from './routing/yieldFrame';
import type { DisruptionAlert } from './mpkNews';

/** Przystanek uziemiony: nazwa z komunikatu -> stop_id + kanoniczna nazwa. */
export interface GroundedStop {
  /** Nazwa dokładnie taka, jakiej użył LLM. */
  raw: string;
  stop_id: string;
  /** Kanoniczna stop_name z GTFS. */
  name: string;
  lat: number;
  lon: number;
}

/** Linia uziemiona: oznaczenie z komunikatu -> route_id. */
interface GroundedLine {
  line: string;
  route_ids: string[];
}

export interface GroundedDisruption {
  /** Unikalne route_id wszystkich linii alertu. */
  routeIds: string[];
  /** Unikalne stop_id przystanków, których dotyczy alert. */
  stopIds: string[];
  /** Per-linia dopasowanie do route_id (tylko linie z trafieniem). */
  lines: GroundedLine[];
  /** Per-nazwa dopasowanie do stop_id (tylko nazwy z trafieniem). */
  stops: GroundedStop[];
}

interface StopIndex {
  /** normalized stop_name -> lista stop_id (nazwy mogą się powtarzać). */
  byName: Map<string, string[]>;
  /** Równoległe listy do fuzzyMatchBatch: nazwa i odpowiadający stop_id. */
  names: string[];
  ids: string[];
}

// Indeks budowany raz na generację sklepu (reset() przy imporcie czyści dane).
const indexCache = new WeakMap<LocalGtfsStore, { generation: number; stopCount: number; index: StopIndex }>();

// Grounding tego samego alertu liczymy raz: karta połączenia i ekran
// aktualności pytały o te same komunikaty przy każdym wejściu, a fuzzy
// dopasowanie dziesiątek nazw przystanków blokowało JS na setki ms.
// Klucz to tożsamość obiektu alertu (WeakMap), nie id: różne komunikaty
// potrafią mieć to samo id, a wtedy cache oddawał wynik innego alertu.
const groundCache = new WeakMap<
  DisruptionAlert,
  { generation: number; stopCount: number; value: GroundedDisruption }
>();

// Drugi poziom: cache po treści. fetchCityNews na każdym otwarciu ekranu
// szczegółów wymienia obiekty alertów na świeże, więc WeakMap nierelewantny,
// a grounding przelicza te same dane od zera (sekundy fuzzy na wątku JS).
// Fingerprint obejmuje tylko pola, których używa grounding.
function alertFingerprint(a: DisruptionAlert): string {
  return JSON.stringify([
    a.all_lines,
    a.line_changes ?? null,
    a.temporary_lines ?? null,
    a.impacted_lines ?? null,
    a.corridor ?? null,
    a.stops ?? null,
  ]);
}
const CONTENT_CACHE_MAX = 200;
const groundByContent = new Map<
  string,
  { fingerprint: string; generation: number; stopCount: number; value: GroundedDisruption }
>();

// Te same nazwy przystanków powtarzają się między alertami (korytarz objazdu
// i komunikat o linii wspominają te same słupki): wynik zapytania cache'ujemy
// po znormalizowanej nazwie, walidacja po generacji sklepu jak w indexCache.
const QUERY_CACHE_MAX = 1000;
const stopQueryCache = new WeakMap<
  LocalGtfsStore,
  {
    generation: number;
    stopCount: number;
    hits: Map<string, GroundedStop | null>;
  }
>();

function ensureStopQueryCache(store: LocalGtfsStore): Map<string, GroundedStop | null> {
  const cached = stopQueryCache.get(store);
  if (
    cached &&
    cached.generation === store.currentGeneration &&
    cached.stopCount === store.stops.size
  ) {
    return cached.hits;
  }
  const hits = new Map<string, GroundedStop | null>();
  stopQueryCache.set(store, {
    generation: store.currentGeneration,
    stopCount: store.stops.size,
    hits,
  });
  return hits;
}

function buildStopIndex(store: LocalGtfsStore): StopIndex {
  const byName = new Map<string, string[]>();
  const names: string[] = [];
  const ids: string[] = [];
  for (const stop of store.stops.values()) {
    const key = normalizePolish(stop.stop_name);
    const existing = byName.get(key);
    if (existing) {
      existing.push(stop.stop_id);
    } else {
      byName.set(key, [stop.stop_id]);
      // Wsadowe fuzzy szuka po unikalnych nazwach przystanków bez duplikatów słupków.
      names.push(key);
      ids.push(stop.stop_id);
    }
  }
  return { byName, names, ids };
}

function ensureStopIndex(store: LocalGtfsStore): StopIndex {
  const cached = indexCache.get(store);
  if (
    cached &&
    cached.generation === store.currentGeneration &&
    cached.stopCount === store.stops.size
  ) {
    return cached.index;
  }
  const index = buildStopIndex(store);
  indexCache.set(store, {
    generation: store.currentGeneration,
    stopCount: store.stops.size,
    index,
  });
  return index;
}

/** Próg fuzzyMatchBatch (0..100): exact=100, startsWith=90, no-space=98. */
const FUZZY_THRESHOLD = 80;

function groundStopName(raw: string, index: StopIndex, store: LocalGtfsStore): GroundedStop | null {
  const query = normalizePolish(raw);
  if (!query) return null;

  const hits = ensureStopQueryCache(store);
  const hit = hits.get(query);
  if (hit !== undefined) {
    return hit;
  }

  let stopId: string | null = null;

  const exact = index.byName.get(query);
  if (exact && exact.length > 0) {
    stopId = exact[0];
  } else {
    const scores = fuzzyMatchBatch(query, index.names);
    let bestScore = 0;
    let bestIdx = -1;
    for (let i = 0; i < scores.length; i++) {
      if (scores[i].matches && scores[i].score > bestScore) {
        bestScore = scores[i].score;
        bestIdx = i;
      }
    }
    if (bestIdx >= 0 && bestScore >= FUZZY_THRESHOLD) {
      stopId = index.ids[bestIdx];
    }
  }

  if (!stopId) {
    hits.set(query, null);
    return null;
  }
  const stop = store.stops.get(stopId);
  if (!stop) {
    hits.set(query, null);
    return null;
  }
  const value: GroundedStop = {
    raw,
    stop_id: stopId,
    name: stop.stop_name,
    lat: stop.stop_lat,
    lon: stop.stop_lon,
  };
  if (hits.size > QUERY_CACHE_MAX) hits.clear();
  hits.set(query, value);
  return value;
}
/** Synchroniczne dopasowanie pojedynczej nazwy przystanku do załadowanego sklepu GTFS. */
export function resolveGroundedStopSync(
  raw: string,
  store: LocalGtfsStore = gtfsStore,
): GroundedStop | null {
  if (!raw || store.stops.size === 0) return null;
  return groundStopName(raw, ensureStopIndex(store), store);
}

/**
 * Dopasowuje alert do GTFS. Zwraca puste listy, gdy sklep nie jest gotowy
 * (baza w imporcie) - alerty są dodatkiem, nie mogą blokować trasy.
 */
export async function groundDisruption(alert: DisruptionAlert): Promise<GroundedDisruption> {
  const cached = groundCache.get(alert);
  if (
    cached &&
    cached.generation === gtfsStore.currentGeneration &&
    cached.stopCount === gtfsStore.stops.size
  ) {
    return cached.value;
  }

  const fingerprint = alertFingerprint(alert);
  const byContent = groundByContent.get(alert.id);
  if (
    byContent &&
    byContent.fingerprint === fingerprint &&
    byContent.generation === gtfsStore.currentGeneration &&
    byContent.stopCount === gtfsStore.stops.size
  ) {
    groundCache.set(alert, {
      generation: gtfsStore.currentGeneration,
      stopCount: gtfsStore.stops.size,
      value: byContent.value,
    });
    return byContent.value;
  }

  try {
    await gtfsStore.load();
  } catch {
    return { routeIds: [], stopIds: [], lines: [], stops: [] };
  }
  const index = ensureStopIndex(gtfsStore);

  const rawLines = new Set<string>();
  for (const l of alert.all_lines ?? []) if (l) rawLines.add(l);
  for (const lc of alert.line_changes ?? []) if (lc.line) rawLines.add(lc.line);
  for (const tl of alert.temporary_lines ?? []) if (tl.line) rawLines.add(tl.line);
  for (const imp of alert.impacted_lines ?? []) if (imp.line) rawLines.add(imp.line);

  const lines: GroundedLine[] = [];
  for (const line of rawLines) {
    const route_ids = gtfsStore.getRouteIdsByShortName(line);
    if (route_ids.length > 0) lines.push({ line, route_ids });
  }

  const rawStops = new Set<string>();
  if (alert.corridor) {
    if (alert.corridor.from_stop) rawStops.add(alert.corridor.from_stop);
    if (alert.corridor.to_stop) rawStops.add(alert.corridor.to_stop);
    for (const n of alert.corridor.stops ?? []) if (n) rawStops.add(n);
  }
  for (const st of alert.stops ?? []) {
    if (st.name) rawStops.add(st.name);
    if (st.replaced_by) rawStops.add(st.replaced_by);
  }
  for (const lc of alert.line_changes ?? []) {
    if (lc.from_stop) rawStops.add(lc.from_stop);
    if (lc.to_stop) rawStops.add(lc.to_stop);
    for (const n of lc.via ?? []) if (n) rawStops.add(n);
    for (const n of lc.omitted_stops ?? []) if (n) rawStops.add(n);
    for (const n of lc.temporary_stops ?? []) if (n) rawStops.add(n);
    for (const n of lc.transfer_stops ?? []) if (n) rawStops.add(n);
  }
  for (const imp of alert.impacted_lines ?? []) {
    for (const n of imp.omitted_stops ?? []) if (n) rawStops.add(n);
    for (const n of imp.temporary_stops ?? []) if (n) rawStops.add(n);
  }
  for (const tl of alert.temporary_lines ?? []) {
    for (const n of tl.via ?? []) if (n) rawStops.add(n);
  }

  const stops: GroundedStop[] = [];
  let sliceStart = performance.now();
  for (const name of rawStops) {
    if (performance.now() - sliceStart >= UI_YIELD_BUDGET_MS) {
      await yieldToUiFrame();
      sliceStart = performance.now();
    }
    const grounded = groundStopName(name, index, gtfsStore);
    if (grounded) stops.push(grounded);
  }

  const value: GroundedDisruption = {
    routeIds: [...new Set(lines.flatMap((l) => l.route_ids))],
    stopIds: [...new Set(stops.map((s) => s.stop_id))],
    lines,
    stops,
  };
  groundCache.set(alert, {
    generation: gtfsStore.currentGeneration,
    stopCount: gtfsStore.stops.size,
    value,
  });
  if (groundByContent.size > CONTENT_CACHE_MAX) groundByContent.clear();
  groundByContent.set(alert.id, {
    fingerprint,
    generation: gtfsStore.currentGeneration,
    stopCount: gtfsStore.stops.size,
    value,
  });
  return value;
}
