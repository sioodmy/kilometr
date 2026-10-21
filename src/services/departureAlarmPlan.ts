import type { Connection } from '../types/models';
import { computeLegTimeline } from './notifications/tripProgress';

/** Okno ważności dzwonka (180 s), zgodne z androidowym RINGING_WINDOW_MS. */
export const RING_WINDOW_MS = 180_000;

export interface AlarmStatusCheck {
  status: 'scheduled' | 'ringing' | 'dismissed';
  at: number;
}

/**
 * Sprawdza, czy budzik jest w aktywnym stanie:
 * - 'ringing': do 180 s po czasie uruchomienia (zabezpieczenie przed zabitym procesem)
 * - 'scheduled': przed zaplanowanym czasem uruchomienia
 */
export function isDepartureAlarmActive(
  alarm: AlarmStatusCheck | null | undefined,
  now = Date.now(),
): boolean {
  if (!alarm) return false;
  if (alarm.status === 'ringing') {
    return alarm.at + RING_WINDOW_MS > now;
  }
  if (alarm.status === 'scheduled') {
    return alarm.at > now;
  }
  return false;
}

export function departureAlarmTiming(connection: Connection, leadMin: number, now = new Date()) {
  if (!Number.isInteger(leadMin) || leadMin < 1 || leadMin > 60) return null;
  const timeline = computeLegTimeline(connection, now);
  const boarding = timeline.find((entry) => entry.leg.mode !== 'walk');
  if (!boarding || !Number.isFinite(connection.departureSec)) return null;
  const start = new Date(now);
  start.setHours(0, 0, connection.departureSec, 0);
  const journeyAt = start.getTime();
  return {
    at: journeyAt - leadMin * 60_000,
    journeyAt,
    boardAt: journeyAt + boarding.departMs - timeline[0].departMs,
    leg: boarding.leg,
  };
}
