import {
  analyzeConnection,
  type TransferThresholds,
  type TransitLegItem,
} from '../../components/connectionInsights';
import type { Connection, Leg } from '../../types/models';
import { subscribeActiveCity } from '../cityStore';
import { normalizeConnectionId, scheduledLegDepart } from './connectionIdentity';
import { boardingDepartureSec } from './connectionTimes';

type TransferSafetyLevel = 'direct' | 'safe' | 'tight' | 'critical';

export interface ConnectionGroupOption {
  connection: Connection;
  /** Zysk czasowy względem wariantu głównego w minutach (dodatni = szybciej). */
  savedMin: number;
  /** Najmniejszy zapas na przesiadce w sekundach; null dla połączeń bezpośrednich i pieszych. */
  minSlackSec: number | null;
  safety: TransferSafetyLevel;
  /** Odcinki komunikacji zbiorowej po wspólnym pierwszym kursie. */
  continuationLegs: Leg[];
  /** Pełna sekwencja etapów komunikacji zbiorowej z ryzykiem każdej przesiadki. */
  transitSteps: TransitLegItem[];
  firstTransferStop?: string;
}

export interface ConnectionGroup {
  key: string;
  primary: Connection;
  primaryOption: ConnectionGroupOption;
  alternatives: ConnectionGroupOption[];
  options: ConnectionGroupOption[];
}

interface EvaluatedOption {
  option: ConnectionGroupOption;
  arrivalSec: number;
  totalWalkM: number;
  hasTrainContinuation: boolean;
  continuationSignature: string;
}

const MAX_GROUP_ALTERNATIVES = 3;
const GROUP_CACHE_MAX = 50;

const SAFETY_TIER: Record<TransferSafetyLevel, number> = {
  direct: 0,
  safe: 1,
  tight: 2,
  critical: 3,
};

function effectiveArrivalSec(connection: Connection): number {
  return connection.arrivalSec ?? connection.departureSec + connection.durationMin * 60;
}

function buildContinuationSignature(legs: Leg[], firstTransferStop?: string): string {
  return JSON.stringify([
    firstTransferStop ?? '',
    legs.map((leg) => [
      leg.mode,
      leg.line || leg.routeId || leg.tripId || '',
      leg.fromStopId || leg.fromStop,
      leg.toStopId || leg.toStop,
    ]),
  ]);
}

function evaluateOption(
  connection: Connection,
  walkMps: number,
  thresholds: TransferThresholds,
): EvaluatedOption {
  const insights = analyzeConnection(connection, walkMps, thresholds);
  const transitLegs = insights.transitLegs.map((item) => item.leg);
  const safety: TransferSafetyLevel =
    transitLegs.length <= 1
      ? 'direct'
      : insights.worstTransferRisk?.level === 'critical'
        ? 'critical'
        : insights.worstTransferRisk?.level === 'tight'
          ? 'tight'
          : 'safe';
  const continuationLegs = transitLegs.slice(1);
  const firstTransferStop =
    transitLegs.length > 1 ? transitLegs[0].toStop || transitLegs[1].fromStop : undefined;
  const arrivalSec = effectiveArrivalSec(connection);
  let totalWalkM = 0;
  for (const leg of connection.legs) {
    if (leg.mode === 'walk') totalWalkM += leg.walkM ?? 0;
  }
  const hasTrainContinuation = continuationLegs.some((leg) => leg.mode === 'train');

  return {
    option: {
      connection,
      savedMin: 0,
      minSlackSec: insights.minTransferSlackSec,
      safety,
      continuationLegs,
      transitSteps: insights.transitLegs,
      firstTransferStop,
    },
    arrivalSec,
    totalWalkM,
    hasTrainContinuation,
    continuationSignature: buildContinuationSignature(continuationLegs, firstTransferStop),
  };
}

/**
 * Zwraca klucz pierwszego kursu komunikacji zbiorowej używany do łączenia
 * wariantów odjeżdżających tym samym pojazdem. Trasy wyłącznie piesze zwracają null.
 */
export function boardingTripKey(connection: Connection): string | null {
  const firstLeg = connection.legs.find((leg) => leg.mode !== 'walk');
  if (!firstLeg) return null;
  const schedDep =
    firstLeg.scheduledDepartureSec ??
    connection.departureSec - (connection.delayMin ? connection.delayMin * 60 : 0);
  const day = connection.serviceDate ?? String(Math.floor(schedDep / 86400));
  const stopKey = firstLeg.fromStopId || firstLeg.fromStop;
  if (firstLeg.tripId) {
    return `trip|${day}|${firstLeg.tripId}|${stopKey}`;
  }
  const lineKey = firstLeg.line ?? firstLeg.routeId ?? '';
  return `line|${day}|${firstLeg.mode}|${lineKey}|${stopKey}|${scheduledLegDepart(firstLeg)}`;
}

function cappedSafetySlack(item: EvaluatedOption, trainMinTransferSec: number): number {
  const slack = item.option.minSlackSec;
  if (slack == null) return -9999;
  const cap = item.hasTrainContinuation ? Math.max(480, trainMinTransferSec + 180) : 360;
  return Math.min(slack, cap);
}

function compareGroupCandidates(
  a: EvaluatedOption,
  b: EvaluatedOption,
  trainMinTransferSec: number,
): number {
  const tierDiff = SAFETY_TIER[a.option.safety] - SAFETY_TIER[b.option.safety];
  if (tierDiff !== 0) return tierDiff;

  const transferDiff = a.option.connection.transfers - b.option.connection.transfers;
  if (transferDiff !== 0) return transferDiff;

  if (a.option.connection.transfers > 0 && b.option.connection.transfers > 0) {
    const slackDiff =
      cappedSafetySlack(b, trainMinTransferSec) - cappedSafetySlack(a, trainMinTransferSec);
    if (Math.abs(slackDiff) >= 30) return slackDiff;
  }

  const arrivalDiff = a.arrivalSec - b.arrivalSec;
  if (arrivalDiff !== 0) return arrivalDiff;

  return a.totalWalkM - b.totalWalkM;
}

/**
 * Grupuje połączenia startujące tym samym pierwszym kursem. Jako główną kartę wybiera
 * połączenie bezpośrednie albo najbezpieczniejszą przesiadkę, a warianty przesiadkowe
 * dokładamy wyłącznie wtedy, gdy realnie skracają czas dojazdu do celu.
 */
export function groupConnections(
  connections: Connection[],
  walkMps: number,
  thresholds: TransferThresholds,
): ConnectionGroup[] {
  const buckets = new Map<string, Connection[]>();

  for (const conn of connections) {
    const tripKey = boardingTripKey(conn);
    const key = tripKey ?? `walk|${conn.id}`;
    const list = buckets.get(key);
    if (list) {
      list.push(conn);
    } else {
      buckets.set(key, [conn]);
    }
  }

  const groups: ConnectionGroup[] = [];

  for (const [key, list] of buckets) {
    if (list.length === 1) {
      const evaluated = evaluateOption(list[0], walkMps, thresholds);
      const primaryOption = evaluated.option;
      groups.push({
        key,
        primary: list[0],
        primaryOption,
        alternatives: [],
        options: [primaryOption],
      });
      continue;
    }

    const evaluated = list.map((c) => evaluateOption(c, walkMps, thresholds));
    evaluated.sort((a, b) => compareGroupCandidates(a, b, thresholds.trainMinTransferSec));

    const primaryEval = evaluated[0];
    const primaryOption = primaryEval.option;
    const primaryArrMin = Math.floor(primaryEval.arrivalSec / 60);
    let bestAcceptedArrivalSec = primaryEval.arrivalSec;
    let bestAcceptedClockMin = primaryArrMin;
    const seenContinuations = new Set<string>([primaryEval.continuationSignature]);
    const alternatives: ConnectionGroupOption[] = [];

    for (let i = 1; i < evaluated.length; i++) {
      const cand = evaluated[i];
      if (cand.option.safety === 'critical' && (cand.option.minSlackSec ?? 0) < 0) {
        continue;
      }
      const candClockMin = Math.floor(cand.arrivalSec / 60);
      const savesEnough =
        bestAcceptedArrivalSec - cand.arrivalSec >= 60 &&
        candClockMin < bestAcceptedClockMin &&
        cand.option.connection.arriveAt !== primaryOption.connection.arriveAt;
      if (!savesEnough) continue;

      if (seenContinuations.has(cand.continuationSignature)) continue;
      seenContinuations.add(cand.continuationSignature);

      const savedMin = Math.max(1, primaryArrMin - candClockMin);
      alternatives.push({
        ...cand.option,
        savedMin,
      });
      bestAcceptedArrivalSec = cand.arrivalSec;
      bestAcceptedClockMin = candClockMin;

      if (alternatives.length >= MAX_GROUP_ALTERNATIVES) break;
    }

    groups.push({
      key,
      primary: primaryOption.connection,
      primaryOption,
      alternatives,
      options: [primaryOption, ...alternatives],
    });
  }

  groups.sort(
    (a, b) =>
      boardingDepartureSec(a.primary) - boardingDepartureSec(b.primary) ||
      effectiveArrivalSec(a.primary) - effectiveArrivalSec(b.primary),
  );

  return groups;
}

/**
 * Przelicza wszystkie warianty w szczegółach na podstawie aktualnych opóźnień live,
 * zachowując pełną listę wariantów w kolejności grupy bez wycinania aktywnej opcji.
 */
export function refreshConnectionGroupOptions(
  connections: Connection[],
  walkMps: number,
  thresholds: TransferThresholds,
): ConnectionGroupOption[] {
  if (connections.length === 0) return [];
  const primaryEval = evaluateOption(connections[0], walkMps, thresholds);
  const primaryArrMin = Math.floor(primaryEval.arrivalSec / 60);

  return connections.map((conn, index) => {
    const evalItem = index === 0 ? primaryEval : evaluateOption(conn, walkMps, thresholds);
    const savedMin = index === 0 ? 0 : primaryArrMin - Math.floor(evalItem.arrivalSec / 60);
    return {
      ...evalItem.option,
      savedMin,
    };
  });
}

const groupCache = new Map<string, ConnectionGroup>();
const idToGroupKey = new Map<string, string>();

subscribeActiveCity(() => {
  groupCache.clear();
  idToGroupKey.clear();
});

export function rememberConnectionGroup(group: ConnectionGroup): void {
  if (group.options.length < 2) return;
  if (groupCache.has(group.key)) {
    groupCache.delete(group.key);
  }
  groupCache.set(group.key, group);
  for (const opt of group.options) {
    idToGroupKey.set(normalizeConnectionId(opt.connection.id), group.key);
  }
  while (groupCache.size > GROUP_CACHE_MAX) {
    const oldestKey = groupCache.keys().next().value;
    if (oldestKey === undefined) break;
    const evicted = groupCache.get(oldestKey);
    groupCache.delete(oldestKey);
    if (evicted) {
      for (const opt of evicted.options) {
        const normId = normalizeConnectionId(opt.connection.id);
        if (idToGroupKey.get(normId) === oldestKey) {
          idToGroupKey.delete(normId);
        }
      }
    }
  }
}

export function getConnectionGroup(connectionId: string): ConnectionGroup | undefined {
  const key = idToGroupKey.get(normalizeConnectionId(connectionId));
  if (!key) return undefined;
  const found = groupCache.get(key);
  if (found) {
    groupCache.delete(key);
    groupCache.set(key, found);
  }
  return found;
}
