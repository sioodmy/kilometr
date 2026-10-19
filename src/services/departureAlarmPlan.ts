import type { Connection } from '../types/models';
import { computeLegTimeline } from './notifications/tripProgress';

export function departureAlarmTiming(connection: Connection, leadMin: number, now = new Date()) {
  if (!Number.isInteger(leadMin) || leadMin < 1 || leadMin > 60) return null;
  const timeline = computeLegTimeline(connection, now);
  const boarding = timeline.find((entry) => entry.leg.mode !== 'walk');
  if (!boarding || !Number.isFinite(connection.departureSec)) return null;
  const boardAt = new Date(now);
  boardAt.setHours(0, 0, connection.departureSec, 0);
  const journeyAt = boardAt.getTime() - (boarding.departMs - timeline[0].departMs);
  return {
    at: journeyAt - leadMin * 60_000,
    journeyAt,
    boardAt: boardAt.getTime(),
    leg: boarding.leg,
  };
}
