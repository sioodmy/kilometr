import type { Strings } from '../i18n';
import type { Leg } from '../types/models';

export function reliabilityNotice(legs: Leg[], t: Strings): string | undefined {
  if (legs.some((leg) => leg.cancelled)) return t.routeDetails.cancelledTrain;
  const estimated = legs.filter((leg) => leg.delayConfidence === 'estimated');
  if (estimated.length) {
    const delay = Math.max(...estimated.map((leg) => Math.round((leg.delaySec ?? 0) / 60)));
    return t.routeDetails.estimatedDelay(delay);
  }
  if (legs.some((leg) => leg.delayConfidence === 'untracked'))
    return t.routeDetails.untrackedVehicle;
  return undefined;
}
