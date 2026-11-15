import { timeStringToSeconds } from '../gtfs/geo';
import { isTrainLeg } from '../services/railIdentity';
import type { Leg } from '../types/models';

const DAY_SEC = 86400;
const WALK_DETOUR_FACTOR = 1.15;

/** Minimalny zapas na przesiadkę (15 minut), aby pokazać udogodnienia dworca. */
const MIN_TRANSFER_SLACK_FOR_AMENITIES_SEC = 15 * 60;

function parseWalkSec(walk: Leg, walkMps: number): number {
  if (walk.walkM != null && walk.walkM > 0) {
    return (walk.walkM * WALK_DETOUR_FACTOR) / Math.max(0.5, walkMps);
  }
  const dep = timeStringToSeconds(walk.departAt);
  let arr = timeStringToSeconds(walk.arriveAt);
  if (arr < dep) arr += DAY_SEC;
  return Math.max(0, arr - dep);
}

function effectiveArrivalSec(leg: Leg): number {
  if (leg.scheduledArrivalSec != null) {
    return leg.scheduledArrivalSec + (leg.arrivalDelaySec ?? leg.delaySec ?? 0);
  }
  const dep = leg.scheduledDepartureSec != null
    ? leg.scheduledDepartureSec + (leg.delaySec ?? 0)
    : timeStringToSeconds(leg.departAt);
  let arr = timeStringToSeconds(leg.arriveAt);
  if (arr < dep) arr += DAY_SEC;
  return arr;
}

function effectiveDepartureSec(leg: Leg, anchorSec: number): number {
  if (leg.scheduledDepartureSec != null) {
    let dep = leg.scheduledDepartureSec + (leg.delaySec ?? 0);
    if (dep < anchorSec - 43200) dep += DAY_SEC;
    return dep;
  }
  let dep = timeStringToSeconds(leg.departAt);
  while (dep < anchorSec - 43200) dep += DAY_SEC;
  return dep;
}

/**
 * Zwraca true, jeśli pod nazwą stacji przyjazdu tego odcinka należy pokazać
 * ikony udogodnień dworca: tylko dla pociągów, a przy przesiadce wyłącznie gdy
 * faktyczny zapas czasu wynosi co najmniej 15 minut (po odjęciu dojścia pieszego).
 */
export function shouldShowStationAmenities(
  displayLegs: readonly Leg[],
  index: number,
  walkMps = 1.3,
): boolean {
  const leg = displayLegs[index];
  if (!leg || leg.mode === 'walk' || !isTrainLeg(leg)) return false;

  const nextVehicleOffset = displayLegs.slice(index + 1).findIndex((next) => next.mode !== 'walk');
  if (nextVehicleOffset === -1) return true;

  const nextVehicleIdx = index + 1 + nextVehicleOffset;
  const nextVehicle = displayLegs[nextVehicleIdx];
  const prevArrSec = effectiveArrivalSec(leg);
  const nextDepSec = effectiveDepartureSec(nextVehicle, prevArrSec);

  let walkSec = 0;
  for (let j = index + 1; j < nextVehicleIdx; j++) {
    if (displayLegs[j].mode === 'walk') walkSec += parseWalkSec(displayLegs[j], walkMps);
  }

  const slackSec = Math.round(nextDepSec - prevArrSec - walkSec);
  return slackSec >= MIN_TRANSFER_SLACK_FOR_AMENITIES_SEC;
}
