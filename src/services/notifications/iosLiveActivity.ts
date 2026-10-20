import type { Strings } from '../../i18n/pl';
import { buildLivePlan, buildTripCopy } from './content';
import type { TrackedTrip, TripProgress } from './types';

export function buildIOSLiveActivity(p: TripProgress, trip: TrackedTrip, s: Strings): string {
  const plan = buildLivePlan(p, trip.connection, trip, s);
  const copy = buildTripCopy(p, trip.connection, s);
  const nextPhase = plan.states.find((state) => state.atMs > p.computedAt && state.phase !== p.phase);
  return JSON.stringify({
    tripId: trip.id,
    deepLink: plan.deepLink,
    title: copy.title.slice(0, 160),
    subtitle: copy.subtitle.slice(0, 180),
    line: (p.line || s.notification.modeWalk).slice(0, 12),
    brand: s.onboarding.brand,
    startAt: plan.startAtMs / 1000,
    endAt: Math.max(plan.startAtMs + 1000, p.arriveAtMs) / 1000,
    countdownAt: plan.countdownAtMs / 1000,
    staleAt: Math.min(p.computedAt + 120_000, nextPhase?.atMs ?? p.arriveAtMs) / 1000,
    staleLabel: s.ios.stale,
    staleTitle: s.notification.rideTitle(trip.toTitle, p.arriveAt).slice(0, 160),
    arrived: p.phase === 'arrived',
  });
}
