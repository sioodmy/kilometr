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
    live: true,
    legs: [
      {
        id: 'preview-4',
        mode: 'tram',
        line: '4',
        direction: 'OPORÓW',
        fromStop: 'Biskupin',
        fromStopId: '24526',
        toStop: 'Plac Grunwaldzki',
        toStopId: '20820',
        departAt: clock(-10),
        arriveAt: clock(5),
        stopsCount: 5,
        live: true,
        delaySec: 120,
        scheduledDepartureSec: Math.floor((now - midnight.getTime()) / 1000) - 720,
        liveNextStop: 'Kliniki',
        stopHint: 'Zatoka autobusowa obok apteki w Przychodni na Biskupinie.',
      },
      {
        id: 'preview-walk',
        mode: 'walk',
        live: false,
        fromStop: 'Plac Grunwaldzki (Peron 2)',
        toStop: 'Plac Grunwaldzki (Peron 1)',
        departAt: clock(5),
        arriveAt: clock(7),
        walkM: 140,
        stopsCount: 0,
      },
      {
        id: 'preview-10',
        mode: 'tram',
        line: '10',
        direction: 'LEŚNICA',
        fromStop: 'Plac Grunwaldzki',
        fromStopId: '20820',
        toStop: 'Rynek',
        toStopId: '10101',
        departAt: clock(3),
        arriveAt: clock(14),
        stopsCount: 4,
        live: true,
        delaySec: 0,
        liveNextStop: 'Most Grunwaldzki',
        stopHint: 'Peron 1 • Wyspa centralna Ronda Reagana od strony Pasażu Grunwaldzkiego.',
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
        id: 'preview-candidate-walk',
        mode: 'walk',
        live: false,
        fromStop: 'Most Grunwaldzki',
        toStop: 'Most Grunwaldzki',
        departAt: clock(7),
        arriveAt: clock(9),
        walkM: 50,
        stopsCount: 0,
      },
      {
        ...connection.legs[2],
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
