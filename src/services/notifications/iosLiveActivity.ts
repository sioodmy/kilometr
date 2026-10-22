import type { Strings } from '../../i18n/pl';
import { buildLivePlan, buildTripCopy } from './content';
import type { TrackedTrip, TripProgress } from './types';
import { getLocaleSync } from '../../i18n/locale';
import { getLineColors } from '../lineIdentity';

export function buildIOSLiveActivity(p: TripProgress, trip: TrackedTrip, s: Strings): string {
  const plan = buildLivePlan(p, trip.connection, trip, s);
  const copy = buildTripCopy(p, trip.connection, s);
  const transfer = trip.transfer;
  const warning = transfer && p.computedAt - transfer.updatedAt <= 30_000 &&
    ['risk', 'rerouting', 'alternative', 'noAlternative'].includes(transfer.status);
  const nextPhase = plan.states.find(
    (state) => state.atMs > p.computedAt && state.phase !== p.phase,
  );
  const boarding =
    p.lineMode !== 'walk' &&
    (p.phase === 'walking' || p.phase === 'waiting' || p.phase === 'transfer');
  const phases = {
    walking: s.ios.walking,
    waiting: s.ios.waiting,
    riding: s.ios.riding,
    transfer: s.ios.transfer,
    arrived: s.notification.arrivedTitle,
  };
  const colors =
    p.lineMode === 'walk'
      ? { bg: '#5CDBBE', fg: '#003831' }
      : getLineColors(p.line || undefined, p.lineMode);
  const rideEnd =
    p.phase === 'riding'
      ? plan.segments.find(
          (segment) =>
            segment.mode !== 'walk' &&
            segment.startAtMs <= p.computedAt &&
            segment.endAtMs > p.computedAt,
        )?.endAtMs
      : undefined;
  return JSON.stringify({
    tripId: trip.id,
    deepLink: plan.deepLink,
    title: (warning ? transfer.nextLine ? s.transferGuard.riskTitle(transfer.nextLine) : s.transferGuard.attention : copy.title).slice(0, 160),
    subtitle: (warning ? transfer.status === 'alternative' ? s.transferGuard.alternativeBody : s.transferGuard.riskBody : copy.subtitle).slice(0, 180),
    line: (p.line || s.notification.modeWalk).slice(0, 12),
    brand: s.onboarding.brand,
    locale: getLocaleSync(),
    phase: p.phase,
    phaseLabel: phases[p.phase],
    mode: p.lineMode,
    lineBg: colors.bg,
    lineFg: colors.fg,
    destination: trip.toTitle.slice(0, 120),
    targetName: (boarding ? p.leg?.fromStop || p.stopName : p.leg?.toStop || trip.toTitle).slice(
      0,
      120,
    ),
    timerLabel: boarding ? s.ios.departure : rideEnd ? s.ios.alighting : s.ios.arrival,
    arrivalLabel: s.notification.arriveAt(p.arriveAt),
    detail: (p.live && p.nextStop ? `${s.ios.nextStop}: ${p.nextStop}` : copy.subtitle).slice(
      0,
      180,
    ),
    startAt: plan.startAtMs / 1000,
    endAt: Math.max(plan.startAtMs + 1000, p.arriveAtMs) / 1000,
    countdownAt: Math.max(p.computedAt, rideEnd ?? plan.countdownAtMs) / 1000,
    staleAt: Math.min(
      p.computedAt + 120_000,
      nextPhase?.atMs ?? p.arriveAtMs,
      rideEnd ?? plan.countdownAtMs,
    ) / 1000,
    staleLabel: s.ios.stale,
    staleTitle: s.notification.rideTitle(trip.toTitle, p.arriveAt).slice(0, 160),
    arrived: p.phase === 'arrived',
  });
}
