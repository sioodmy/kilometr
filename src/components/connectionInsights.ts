import { timeStringToSeconds } from '../gtfs/geo';
import { walkMinutesFor } from '../services/settings';
import type { Connection, Leg } from '../types/models';

const DAY_SEC = 86400;
const WALK_DETOUR_FACTOR = 1.15;

/** Próg długiego dojścia pieszo do celu (w minutach, ściśle powyżej). */
const LONG_DESTINATION_WALK_MIN = 5;

export interface TransferThresholds {
  minTransferSec: number;
  trainMinTransferSec: number;
}

export interface TransferRiskInfo {
  /** Indeks odcinka transit w tablicy transitLegs, po którym następuje przesiadka. */
  afterTransitIndex: number;
  stopName: string;
  /** Faktyczny zapas czasu w sekundach po odjęciu dojścia pieszego. */
  slackSec: number;
  /** Zaokrąglony w dół zapas minut (0 oznacza < 1 min lub spóźnienie). */
  slackMin: number;
  level: 'tight' | 'critical';
}

interface TransitLegItem {
  key: string;
  leg: Leg;
  durationMin: number;
  transferWalkMinAfter: number;
  transferRiskAfter?: TransferRiskInfo;
}

export interface ConnectionInsights {
  initialWalkMin: number;
  transitLegs: TransitLegItem[];
  finalWalkMin: number;
  finalWalkM: number;
  firstBoardingStop?: string;
  lastTransitStop?: string;
  /** Minuty marszu do celu (końcowy odcinek lub cała trasa piesza). */
  destinationWalkMin: number;
  hasLongDestinationWalk: boolean;
  riskyTransfers: TransferRiskInfo[];
  worstTransferRisk?: TransferRiskInfo;
}

function alignClock(seconds: number, anchor: number): number {
  return seconds + Math.round((anchor - seconds) / DAY_SEC) * DAY_SEC;
}

function parseHMtoSec(hm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(hm || '');
  if (!m) return null;
  return Number(m[1]) * 3600 + Number(m[2]) * 60;
}

function getLegWalkMin(leg: Leg | undefined, walkMps: number): number {
  if (!leg) return 1;
  if (leg.walkM != null && leg.walkM > 0) {
    return walkMinutesFor(leg.walkM, walkMps);
  }
  const dep = parseHMtoSec(leg.departAt);
  const arr = parseHMtoSec(leg.arriveAt);
  if (dep != null && arr != null && arr > dep) {
    return Math.max(1, Math.round((arr - dep) / 60));
  }
  return 1;
}

function legWalkDurationSec(legs: Leg[], walkMps: number): number {
  let totalSec = 0;
  for (const walk of legs) {
    if (walk.walkM != null && walk.walkM > 0) {
      totalSec += (walk.walkM * WALK_DETOUR_FACTOR) / Math.max(0.5, walkMps);
      continue;
    }
    const dep = parseHMtoSec(walk.departAt);
    let arr = parseHMtoSec(walk.arriveAt);
    if (dep != null && arr != null) {
      if (arr < dep) arr += DAY_SEC;
      totalSec += Math.max(0, arr - dep);
    }
  }
  return totalSec;
}

function resolveLegIntervalSec(
  leg: Leg,
  cursor: number,
): { depSec: number; arrSec: number } {
  const rawDep =
    leg.scheduledDepartureSec != null && leg.delaySec != null
      ? leg.scheduledDepartureSec + leg.delaySec
      : alignClock(timeStringToSeconds(leg.departAt), cursor);
  const depSec = Number.isFinite(rawDep) ? rawDep : cursor;

  let rawArr =
    leg.scheduledArrivalSec != null && leg.arrivalDelaySec != null
      ? leg.scheduledArrivalSec + leg.arrivalDelaySec
      : alignClock(timeStringToSeconds(leg.arriveAt), depSec);
  if (!Number.isFinite(rawArr)) rawArr = depSec;
  if (rawArr < depSec) rawArr += DAY_SEC;

  return { depSec, arrSec: rawArr };
}

/**
 * Analizuje trasę pod kątem proporcjonalnego paska etapów, długiego dojścia pieszo do celu (> 5 min)
 * oraz ryzykownych przesiadek (uwzględniając czas przejścia, bufor użytkownika i opóźnienia live).
 */
export function analyzeConnection(
  connection: Connection,
  walkMps: number,
  thresholds: TransferThresholds,
): ConnectionInsights {
  const rawLegs = connection.legs ?? [];
  const legs =
    rawLegs.length > 1
      ? rawLegs.filter(
          (leg) =>
            !(
              leg.mode === 'walk' &&
              (leg.walkM ?? 0) <= 0 &&
              (leg.departAt === leg.arriveAt || leg.fromStop === leg.toStop)
            ),
        )
      : rawLegs;

  const legTimes: { depSec: number; arrSec: number }[] = [];
  let cursor = connection.departureSec || 0;
  for (const leg of legs) {
    const interval = resolveLegIntervalSec(leg, cursor);
    legTimes.push(interval);
    cursor = interval.arrSec;
  }

  const transitIndices: number[] = [];
  for (let i = 0; i < legs.length; i++) {
    if (legs[i].mode !== 'walk') {
      transitIndices.push(i);
    }
  }

  if (transitIndices.length === 0) {
    const walkM = legs.reduce((acc, l) => acc + (l.walkM ?? 0), 0);
    const walkOnlyMin =
      connection.durationMin || (walkM > 0 ? walkMinutesFor(walkM, walkMps) : 1);
    return {
      initialWalkMin: 0,
      transitLegs: [],
      finalWalkMin: 0,
      finalWalkM: walkM,
      destinationWalkMin: walkOnlyMin,
      hasLongDestinationWalk: walkOnlyMin > LONG_DESTINATION_WALK_MIN,
      riskyTransfers: [],
    };
  }

  let initialWalkMin = 0;
  const firstTransitIdx = transitIndices[0];
  if (firstTransitIdx > 0) {
    const initialWalks = legs.slice(0, firstTransitIdx);
    const walkM = initialWalks.reduce((acc, l) => acc + (l.walkM ?? 0), 0);
    initialWalkMin =
      walkM > 0 ? walkMinutesFor(walkM, walkMps) : getLegWalkMin(initialWalks[0], walkMps);
  }

  let finalWalkMin = 0;
  let finalWalkM = 0;
  const lastTransitIdx = transitIndices[transitIndices.length - 1];
  if (lastTransitIdx < legs.length - 1) {
    const finalWalks = legs.slice(lastTransitIdx + 1);
    finalWalkM = finalWalks.reduce((acc, l) => acc + (l.walkM ?? 0), 0);
    finalWalkMin =
      finalWalkM > 0
        ? walkMinutesFor(finalWalkM, walkMps)
        : getLegWalkMin(finalWalks[0], walkMps);
  }

  const firstBoardingStop = legs[firstTransitIdx]?.fromStop || undefined;
  const lastTransitStop = legs[lastTransitIdx]?.toStop || undefined;

  const transitLegs: TransitLegItem[] = [];
  const riskyTransfers: TransferRiskInfo[] = [];

  for (let i = 0; i < transitIndices.length; i++) {
    const curIdx = transitIndices[i];
    const leg = legs[curIdx];
    const legInterval = legTimes[curIdx];
    const durationMin = Math.max(
      1,
      Math.round((legInterval.arrSec - legInterval.depSec) / 60) ||
        (leg.stopsCount || 1) * 2,
    );
    let transferWalkMinAfter = 0;
    let transferRiskAfter: TransferRiskInfo | undefined;

    if (i < transitIndices.length - 1) {
      const nextIdx = transitIndices[i + 1];
      const nextLeg = legs[nextIdx];
      const intermediateWalks =
        nextIdx > curIdx + 1
          ? legs.slice(curIdx + 1, nextIdx).filter((l) => l.mode === 'walk')
          : [];

      const transferM = intermediateWalks.reduce((acc, l) => acc + (l.walkM ?? 0), 0);
      if (transferM > 0) {
        transferWalkMinAfter = walkMinutesFor(transferM, walkMps);
      } else if (intermediateWalks.length > 0) {
        transferWalkMinAfter = getLegWalkMin(intermediateWalks[0], walkMps);
      }

      const prevArrSec = legTimes[curIdx].arrSec;
      const nextDepSec = legTimes[nextIdx].depSec;
      const walkSec = legWalkDurationSec(intermediateWalks, walkMps);
      const slackSec = Math.round(nextDepSec - prevArrSec - walkSec);

      const requiredBufferSec =
        nextLeg.mode === 'train'
          ? Math.max(120, thresholds.trainMinTransferSec)
          : Math.max(60, thresholds.minTransferSec);
      const tightCeilingSec =
        nextLeg.mode === 'train'
          ? Math.max(300, thresholds.trainMinTransferSec)
          : 180;

      if (slackSec < 60 || slackSec < requiredBufferSec || slackSec <= tightCeilingSec) {
        const level: TransferRiskInfo['level'] = slackSec < 60 ? 'critical' : 'tight';
        const slackMin = slackSec <= 0 ? 0 : Math.floor(slackSec / 60);
        transferRiskAfter = {
          afterTransitIndex: i,
          stopName: leg.toStop || nextLeg.fromStop,
          slackSec,
          slackMin,
          level,
        };
        riskyTransfers.push(transferRiskAfter);
      }
    }

    transitLegs.push({
      key: `transit-${leg.id || i}`,
      leg,
      durationMin,
      transferWalkMinAfter,
      transferRiskAfter,
    });
  }

  let worstTransferRisk: TransferRiskInfo | undefined;
  for (const risk of riskyTransfers) {
    if (!worstTransferRisk || risk.slackSec < worstTransferRisk.slackSec) {
      worstTransferRisk = risk;
    }
  }

  return {
    initialWalkMin,
    transitLegs,
    finalWalkMin,
    finalWalkM,
    firstBoardingStop,
    lastTransitStop,
    destinationWalkMin: finalWalkMin,
    hasLongDestinationWalk: finalWalkMin > LONG_DESTINATION_WALK_MIN,
    riskyTransfers,
    worstTransferRisk,
  };
}
