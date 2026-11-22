import type { Connection } from '../types/models';
import type {
  TransferAlternative,
  TransferProtectionState,
} from '../services/notifications/transferTypes';
import { clockFromMs } from '../services/notifications/format';

export function transferFixture(
  status: TransferProtectionState['status'],
  expired = false,
  direct = false,
  rail = false,
) {
  const now = Date.now();
  const clock = (minutes: number) => clockFromMs(now + minutes * 60_000);
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);

  if (rail) {
    const railConnection: Connection = {
      id: 'rail-transfer-preview',
      fromTitle: 'Legnica',
      toTitle: 'Warszawa Centralna',
      departureSec: Math.floor((now - midnight.getTime()) / 1000) - 2700,
      departAt: clock(-45),
      arriveAt: clock(240),
      durationMin: 285,
      departInMin: -45,
      transfers: 1,
      delayMin: 7,
      live: true,
      legs: [
        {
          id: 'preview-kd-d1',
          mode: 'train',
          line: 'KD D1',
          railAgency: 'KD',
          trainNumber: '69123',
          trainName: 'KACZAWA',
          direction: 'WROCŁAW GŁÓWNY',
          fromStop: 'Legnica',
          fromStopId: 'pl:5100028',
          toStop: 'Wrocław Główny',
          toStopId: 'pl:5100067',
          departAt: clock(-45),
          arriveAt: clock(7),
          stopsCount: 5,
          live: true,
          delaySec: 420,
          scheduledDepartureSec: Math.floor((now - midnight.getTime()) / 1000) - 2700,
          liveNextStop: 'Wrocław Muchobór',
          platformCode: '2',
          stopHint: 'Peron 2 przy wejściu do tunelu głównego.',
        },
        {
          id: 'preview-rail-walk',
          mode: 'walk',
          live: false,
          fromStop: 'Wrocław Główny (Peron 2)',
          toStop: 'Wrocław Główny (Peron 3)',
          departAt: clock(7),
          arriveAt: clock(11),
          walkM: 180,
          stopsCount: 0,
        },
        {
          id: 'preview-ic-hetman',
          mode: 'train',
          line: 'IC 6124',
          tripId: 'pl:ic-6124',
          direction: 'WARSZAWA CENTRALNA',
          railAgency: 'IC',
          trainNumber: '6124',
          trainName: 'HETMAN',
          fromStop: 'Wrocław Główny',
          fromStopId: 'pl:5100067',
          toStop: 'Warszawa Centralna',
          toStopId: 'pl:5100065',
          departAt: clock(5),
          arriveAt: clock(240),
          stopsCount: 6,
          live: true,
          delaySec: 0,
          platformCode: '3',
          stopHint: 'Peron 3 tor 4.',
        },
      ],
    };

    const railState: TransferProtectionState = {
      tripId: railConnection.id,
      status: status === 'alternative' ? 'conductor' : status,
      revision: 0,
      updatedAt: now,
      activeLegIndex: 0,
      currentLine: 'KD D1',
      currentMode: 'train',
      nextLine: 'IC 6124',
      nextMode: 'train',
      transferStop: 'Wrocław Główny',
      delaySec: 420,
      slackSec: status === 'safe' ? 600 : -240,
      walkSec: 180,
      walkM: 180,
      bufferSec: 300,
      departureAtMs: now + 5 * 60_000,
      arrivalAtMs: now + 7 * 60_000,
      departureSource: 'live',
      delaySource: 'live',
      scope: 'foreground',
      nextTrain: {
        label: 'IC 6200',
        trainName: 'SILESIUM',
        departAtMs: now + 48 * 60_000,
      },
      transfers: [
        {
          legIndex: 0,
          nextLegIndex: 2,
          fromLine: 'KD D1',
          fromMode: 'train',
          toLine: 'IC 6124',
          toMode: 'train',
          transferStop: 'Wrocław Główny',
          walkM: 180,
          walkSec: 180,
          arrivalAtMs: now + 7 * 60_000,
          departureAtMs: now + 5 * 60_000,
          slackSec: status === 'safe' ? 600 : -240,
          state: 'active',
          isTrainNext: true,
        },
      ],
    };

    return {
      connection: direct
        ? {
            ...railConnection,
            transfers: 0,
            legs: [
              {
                ...railConnection.legs[2],
                fromStop: 'Legnica',
                fromStopId: 'pl:5100028',
                departAt: clock(-45),
              },
            ],
          }
        : railConnection,
      state: railState,
    };
  }

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
        delaySec: 240,
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
        stopHint: 'Peron 1 · Wyspa centralna Ronda Reagana od strony Pasażu Grunwaldzkiego.',
      },
    ],
  };

  const swapCandidate: Connection = {
    ...connection,
    id: 'transfer-preview-swap-33',
    arriveAt: clock(18),
    durationMin: 28,
    legs: [
      connection.legs[0],
      connection.legs[1],
      {
        ...connection.legs[2],
        id: 'preview-33',
        line: '33',
        direction: 'PILCZYCE',
        departAt: clock(9),
        arriveAt: clock(18),
      },
    ],
  };

  const stayOnCandidate: Connection = {
    ...connection,
    id: 'transfer-preview-stay-12',
    arriveAt: clock(20),
    durationMin: 30,
    legs: [
      { ...connection.legs[0], toStop: 'Most Grunwaldzki', arriveAt: clock(7) },
      {
        ...connection.legs[2],
        id: 'preview-12',
        line: '12',
        direction: 'KOZANÓW',
        fromStop: 'Most Grunwaldzki',
        departAt: clock(10),
        arriveAt: clock(20),
      },
    ],
  };

  const alternatives: TransferAlternative[] =
    status === 'alternative'
      ? [
          {
            id: 'preview-alt-swap-33',
            connection: swapCandidate,
            activeLegIndex: 0,
            nextLine: '33',
            nextMode: 'tram',
            transferStop: 'Plac Grunwaldzki',
            departureAtMs: now + 9 * 60_000,
            arrivalAtMs: now + 18 * 60_000,
            validUntil: expired ? now - 1 : now + 4 * 60_000,
            kind: 'sameStop',
            source: 'legSwap',
            deltaArrivalMin: 4,
            slackSec: 240,
            walkM: 140,
          },
          {
            id: 'preview-alt-stay-12',
            connection: stayOnCandidate,
            activeLegIndex: 0,
            nextLine: '12',
            nextMode: 'tram',
            transferStop: 'Most Grunwaldzki',
            departureAtMs: now + 10 * 60_000,
            arrivalAtMs: now + 20 * 60_000,
            validUntil: expired ? now - 1 : now + 5 * 60_000,
            kind: 'stayOn',
            source: 'raptor',
            deltaArrivalMin: 6,
            slackSec: 180,
            walkM: 0,
          },
        ]
      : [];

  const state: TransferProtectionState = {
    tripId: connection.id,
    status,
    revision: 0,
    updatedAt: now,
    activeLegIndex: 0,
    currentLine: '4',
    currentMode: 'tram',
    nextLine: '10',
    nextMode: 'tram',
    transferStop: 'Plac Grunwaldzki',
    delaySec: status === 'safe' ? 0 : 240,
    slackSec: status === 'safe' ? 300 : status === 'risk' ? 60 : -120,
    walkSec: 115,
    walkM: 140,
    bufferSec: 120,
    departureAtMs: now + (status === 'safe' ? 10 : 3) * 60_000,
    arrivalAtMs: now + 5 * 60_000,
    departureSource: 'live',
    delaySource: 'gps',
    scope: 'background',
    transfers: [
      {
        legIndex: 0,
        nextLegIndex: 2,
        fromLine: '4',
        fromMode: 'tram',
        toLine: '10',
        toMode: 'tram',
        transferStop: 'Plac Grunwaldzki',
        walkM: 140,
        walkSec: 115,
        arrivalAtMs: now + 5 * 60_000,
        departureAtMs: now + (status === 'safe' ? 10 : 3) * 60_000,
        slackSec: status === 'safe' ? 300 : status === 'risk' ? 60 : -120,
        state: 'active',
        isTrainNext: false,
      },
    ],
    ...(alternatives.length > 0 ? { alternative: alternatives[0], alternatives } : {}),
  };

  return {
    connection: direct ? { ...connection, transfers: 0, legs: [connection.legs[0]] } : connection,
    state,
  };
}
