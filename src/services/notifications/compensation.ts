import type { Connection, Leg } from '../../types/models';
import { fetchNationalRailUpdates, type NationalRailLegUpdate } from '../nationalRailUpdates';
import { isTrainLeg } from '../railIdentity';

// Reguły zwrotu za opóźnienie pociągu (rozporządzenie UE 1371/2007).
// Progi, margines bezpieczeństwa, kwalifikacja biletu i pomiar opóźnienia
// na końcu trasy; bez Expo, więc da się sprawdzić w node.

/** Margines na różnice między feedem PKP a naszą bazą. */
const COMPENSATION_MARGIN_MIN = 10;
const COMPENSATION_FIRST_THRESHOLD_MIN = 60;
const COMPENSATION_SECOND_THRESHOLD_MIN = 120;
/** Bilet musi być dodany najpóźniej tyle przed odjazdem. */
export const COMPENSATION_MIN_ADVANCE_MS = 60 * 60_000;
/** Monitor patrzy na kurs od 2 h przed odjazdem do 2 h po planowym przybyciu. */
export const COMPENSATION_WINDOW_BEFORE_MS = 2 * 60 * 60_000;
export const COMPENSATION_WINDOW_AFTER_MS = 2 * 60 * 60_000;
/** Starsze dane PKP nie mogą uruchomić alertu (np. cache z poprzedniego dnia). */
export const COMPENSATION_MAX_UPDATE_AGE_MS = 30 * 60_000;

export type CompensationLevel = 25 | 50;

export interface CompensationCandidateOptions {
  addedAt: number;
  /** Planowy odjazd bez opóźnienia, do sprawdzenia czy bilet dodano z wyprzedzeniem. */
  scheduledDepartureMs: number;
  /** Faktyczny odjazd z opóźnieniem, do okna monitorowania. */
  boardingDepartureMs: number;
  /** Planowy przyjazd na końcową stację. */
  arrivalMs: number;
  /** Opóźnienie kursu w chwili dołączenia biletu; brak wartości blokuje alert. */
  delayAtAttachSec?: number;
  now?: number;
}

export interface MeasuredCompensationDelay {
  leg: Leg;
  delaySec: number;
}

/** Poziom zwrotu dla zmierzonego opóźnienia, z marginesem na rozjazd danych. */
export function compensationLevelForDelay(delaySec: number): CompensationLevel | null {
  const delayMin = delaySec / 60;
  if (delayMin >= COMPENSATION_SECOND_THRESHOLD_MIN + COMPENSATION_MARGIN_MIN) return 50;
  if (delayMin >= COMPENSATION_FIRST_THRESHOLD_MIN + COMPENSATION_MARGIN_MIN) return 25;
  return null;
}

/** Próg w minutach pokazywany w treści powiadomienia (60 albo 120). */
export function compensationThresholdMinutes(level: CompensationLevel): number {
  return level === 50 ? COMPENSATION_SECOND_THRESHOLD_MIN : COMPENSATION_FIRST_THRESHOLD_MIN;
}

/** Ostatni odcinek kolejowy decyduje o opóźnieniu na miejscu docelowym. */
export function finalTrainLeg(connection: Connection): Leg | null {
  const trainLegs = connection.legs.filter(isTrainLeg);
  return trainLegs[trainLegs.length - 1] ?? null;
}

/** Opóźnienie ostatniego odcinka kolejowego w chwili dołączenia biletu. */
export function connectionDelayAtAttachSec(connection: Connection): number {
  const last = finalTrainLeg(connection);
  const live = last?.live || last?.delayConfidence === 'estimated';
  const delaySec = live ? (last?.arrivalDelaySec ?? last?.delaySec ?? 0) : connection.delayMin * 60;
  return Number.isFinite(delaySec) ? Math.max(0, Math.round(delaySec)) : 0;
}

/** Czy któryś odcinek kolejowy został odwołany; wtedy nie ma czego rekompensować. */
export function cancelledTrainLeg(
  connection: Connection,
  updates: ReadonlyMap<string, NationalRailLegUpdate>,
): Leg | null {
  for (const leg of connection.legs.filter(isTrainLeg)) {
    const update = leg.tripId ? updates.get(leg.tripId) : undefined;
    if (update?.cancelled) return leg;
  }
  return null;
}

/**
 * Opóźnienie na końcu trasy z feedu PKP. Najpierw ostatni odcinek kolejowy,
 * a gdy nie ma dla niego danych, wcześniejszy: spóźnienie na przesiadkę też
 * może skończyć się spóźnieniem na miejscu. Stare dane są pomijane.
 */
export function measuredCompensationDelay(
  connection: Connection,
  updates: ReadonlyMap<string, NationalRailLegUpdate>,
  now = Date.now(),
): MeasuredCompensationDelay | null {
  const trainLegs = connection.legs.filter(isTrainLeg);
  for (let i = trainLegs.length - 1; i >= 0; i--) {
    const leg = trainLegs[i];
    const update = leg.tripId ? updates.get(leg.tripId) : undefined;
    if (!update || update.cancelled) continue;
    if (now - update.fetchedAt > COMPENSATION_MAX_UPDATE_AGE_MS) continue;
    const delaySec =
      update.arrivalDelaySec ?? (update.hasRealtimeDelay ? update.delaySec : undefined);
    if (delaySec == null || !Number.isFinite(delaySec)) continue;
    return { leg, delaySec };
  }
  return null;
}

/**
 * Opóźnienie ostatniego pociągu z feedu PKP w chwili dołączania biletu.
 * Null oznacza brak świeżych danych; wtedy zostaje opóźnienie z połączenia.
 */
export async function fetchDelayAtAttachSec(connection: Connection): Promise<number | null> {
  if (!finalTrainLeg(connection)) return null;
  const updates = await fetchNationalRailUpdates(connection.legs);
  const measured = measuredCompensationDelay(connection, updates);
  return measured ? Math.max(0, Math.round(measured.delaySec)) : null;
}

/** Bilet dodany z wyprzedzeniem, bez zastanego opóźnienia, w oknie kursu. */
export function isCompensationCandidate(options: CompensationCandidateOptions): boolean {
  const now = options.now ?? Date.now();
  if (options.delayAtAttachSec == null) return false;
  if (options.addedAt > options.scheduledDepartureMs - COMPENSATION_MIN_ADVANCE_MS) return false;
  if (options.delayAtAttachSec >= COMPENSATION_FIRST_THRESHOLD_MIN * 60) return false;
  return isWithinCompensationWindow(options.boardingDepartureMs, options.arrivalMs, now);
}

/** Okno, w którym monitor w ogóle odpytuje feed dla danego biletu. */
function isWithinCompensationWindow(
  boardingDepartureMs: number,
  arrivalMs: number,
  now: number,
): boolean {
  return (
    now >= boardingDepartureMs - COMPENSATION_WINDOW_BEFORE_MS &&
    now <= Math.max(arrivalMs, boardingDepartureMs) + COMPENSATION_WINDOW_AFTER_MS
  );
}
