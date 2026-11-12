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
import { gtfsStore } from './routing/store';
import type { DisruptionAlert } from './mpkNews';

/** Przystanek uziemiony: nazwa z komunikatu -> stop_id + kanoniczna nazwa. */
interface GroundedStop {
  /** Nazwa dokładnie taka, jakiej użył LLM. */
  raw: string;
  stop_id: string;
  /** Kanoniczna stop_name z GTFS. */
  name: string;
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
let stopIndex: StopIndex | null = null;
let stopIndexGeneration = -1;

function buildStopIndex(): StopIndex {
  const byName = new Map<string, string[]>();
  const names: string[] = [];
  const ids: string[] = [];
  for (const stop of gtfsStore.stops.values()) {
    const key = normalizePolish(stop.stop_name);
    const existing = byName.get(key);
    if (existing) existing.push(stop.stop_id);
    else byName.set(key, [stop.stop_id]);
    names.push(key);
    ids.push(stop.stop_id);
  }
  return { byName, names, ids };
}

function ensureStopIndex(): StopIndex {
  if (!stopIndex || stopIndexGeneration !== gtfsStore.currentGeneration) {
    stopIndex = buildStopIndex();
    stopIndexGeneration = gtfsStore.currentGeneration;
  }
  return stopIndex;
}

/** Próg fuzzyMatchBatch (0..100): exact=100, startsWith=90, no-space=98. */
const FUZZY_THRESHOLD = 80;

function groundStopName(raw: string, index: StopIndex): GroundedStop | null {
  const query = normalizePolish(raw);
  if (!query) return null;

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

  if (!stopId) return null;
  const stop = gtfsStore.stops.get(stopId);
  if (!stop) return null;
  return { raw, stop_id: stopId, name: stop.stop_name };
}

/**
 * Dopasowuje alert do GTFS. Zwraca puste listy, gdy sklep nie jest gotowy
 * (baza w imporcie) - alerty są dodatkiem, nie mogą blokować trasy.
 */
export async function groundDisruption(alert: DisruptionAlert): Promise<GroundedDisruption> {
  try {
    await gtfsStore.load();
  } catch {
    return { routeIds: [], stopIds: [], lines: [], stops: [] };
  }
  const index = ensureStopIndex();

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
  for (const st of alert.stops ?? []) {
    if (st.name) rawStops.add(st.name);
    if (st.replaced_by) rawStops.add(st.replaced_by);
  }
  for (const lc of alert.line_changes ?? []) {
    for (const n of lc.via ?? []) if (n) rawStops.add(n);
    for (const n of lc.omitted_stops ?? []) if (n) rawStops.add(n);
    for (const n of lc.temporary_stops ?? []) if (n) rawStops.add(n);
  }
  for (const imp of alert.impacted_lines ?? []) {
    for (const n of imp.omitted_stops ?? []) if (n) rawStops.add(n);
    for (const n of imp.temporary_stops ?? []) if (n) rawStops.add(n);
  }
  for (const tl of alert.temporary_lines ?? []) {
    for (const n of tl.via ?? []) if (n) rawStops.add(n);
  }

  const stops: GroundedStop[] = [];
  for (const name of rawStops) {
    const grounded = groundStopName(name, index);
    if (grounded) stops.push(grounded);
  }

  return {
    routeIds: [...new Set(lines.flatMap((l) => l.route_ids))],
    stopIds: [...new Set(stops.map((s) => s.stop_id))],
    lines,
    stops,
  };
}
