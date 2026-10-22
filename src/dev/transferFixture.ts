import type { Connection } from '../types/models';
import type { TransferProtectionState } from '../services/notifications/transferTypes';
import { clockFromMs } from '../services/notifications/format';

export function transferFixture(
  status: TransferProtectionState['status'],
  expired = false,
  direct = false,
) {
  const now = Date.now();
  const clock = (minutes: number) => clockFromMs(now + minutes * 60_000);
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  const connection: Connection = {
    id: 'transfer-preview',
    fromTitle: 'Biskupin',
    toTitle: 'Rynek',
    departureSec: Math.floor((now - midnight.getTime()) / 1000) - 600,
    departAt: clock(-10),
    arriveAt: clock(14),
    durationMin: 24,
    departInMin: -10,
    transfers: 1,
    delayMin: 4,
    live: false,
    legs: [
      {
        id: 'preview-4',
        mode: 'tram',
        line: '4',
        fromStop: 'Biskupin',
        toStop: 'Plac Grunwaldzki',
        departAt: clock(-10),
        arriveAt: clock(5),
        stopsCount: 5,
        live: false,
      },
      {
        id: 'preview-10',
        mode: 'tram',
        line: '10',
        fromStop: 'Plac Grunwaldzki',
        toStop: 'Rynek',
        departAt: clock(3),
        arriveAt: clock(14),
        stopsCount: 4,
        live: false,
      },
    ],
  };
  const candidate: Connection = {
    ...connection,
    arriveAt: clock(20),
    durationMin: 30,
    legs: [
      { ...connection.legs[0], toStop: 'Most Grunwaldzki', arriveAt: clock(7) },
      {
        ...connection.legs[1],
        id: 'preview-12',
        line: '12',
        fromStop: 'Most Grunwaldzki',
        departAt: clock(9),
        arriveAt: clock(20),
      },
    ],
  };
  const state: TransferProtectionState = {
    tripId: connection.id,
    status,
    revision: 0,
    updatedAt: now,
    activeLegIndex: 0,
    currentLine: '4',
    nextLine: '10',
    transferStop: 'Plac Grunwaldzki',
    delaySec: 240,
    slackSec: status === 'safe' ? 240 : -120,
    departureAtMs: now + 3 * 60_000,
    arrivalAtMs: now + 5 * 60_000,
    departureSource: 'schedule',
    scope: 'foreground',
    ...(status === 'alternative'
      ? {
          alternative: {
            id: 'preview-alternative',
            connection: candidate,
            activeLegIndex: 0,
            nextLine: '12',
            transferStop: 'Most Grunwaldzki',
            departureAtMs: now + 9 * 60_000,
            arrivalAtMs: now + 20 * 60_000,
            validUntil: expired ? now - 1 : now + 4 * 60_000,
            kind: 'stayOn' as const,
          },
        }
      : {}),
  };
  return {
    connection: direct
      ? {
          ...connection,
          transfers: 0,
          legs: [
            { ...connection.legs[0], toStop: connection.toTitle, arriveAt: connection.arriveAt },
          ],
        }
      : connection,
    state,
  };
}
