import type { Connection, Leg } from '../../types/models';

/** Ochrona przesiadek ma sens dopiero od dwóch pojazdów: dojście piesze nie jest przesiadką. */
export function hasTransfer(connection?: Pick<Connection, 'legs'> | null): boolean {
  let rides = 0;
  for (const leg of connection?.legs ?? []) {
    if (leg.mode !== 'walk' && ++rides >= 2) return true;
  }
  return false;
}

/** Pociągów (ani kursów krajowych pl:) nie podmieniamy automatyczną wymianą miejską. */
export function isProtectedTrainLeg(leg?: Pick<Leg, 'mode' | 'tripId'> | null): boolean {
  if (!leg) return false;
  return leg.mode === 'train' || Boolean(leg.tripId?.startsWith('pl:'));
}

type TransferStatus =
  | 'preparing'
  | 'waiting'
  | 'safe'
  | 'risk'
  | 'rerouting'
  | 'alternative'
  | 'changed'
  | 'noAlternative'
  | 'conductor'
  | 'unavailable'
  | 'complete';

export type TransferDelaySource = 'gps' | 'live' | 'schedule';

export interface NextTrainInfo {
  label: string;
  trainName?: string;
  departAtMs: number;
}

export interface TransferSegmentSummary {
  /** Indeks pierwszego (dojeżdżającego) odcinka w connection.legs. */
  legIndex: number;
  /** Indeks kolejnego odcinka w connection.legs. */
  nextLegIndex: number;
  fromLine: string;
  fromMode: Leg['mode'];
  toLine: string;
  toMode: Leg['mode'];
  transferStop: string;
  walkM: number;
  walkSec: number;
  arrivalAtMs: number;
  departureAtMs: number;
  slackSec: number;
  state: 'passed' | 'active' | 'upcoming';
  isTrainNext: boolean;
}

export interface TransferAlternative {
  id: string;
  connection: Connection;
  activeLegIndex: number;
  nextLine: string;
  nextMode?: Leg['mode'];
  transferStop: string;
  departureAtMs: number;
  arrivalAtMs: number;
  validUntil: number;
  kind: 'sameStop' | 'stayOn' | 'fromHere';
  source?: 'legSwap' | 'raptor';
  /** Różnica czasu przyjazdu do celu względem bieżącego planu (w minutach). */
  deltaArrivalMin?: number;
  /** Szacowany zapas czasu na przesiadkę w tej propozycji (w sekundach). */
  slackSec?: number;
  /** Dystans dojścia pieszego na przesiadce (w metrach). */
  walkM?: number;
}

export interface TransferProtectionState {
  tripId: string;
  status: TransferStatus;
  updatedAt: number;
  revision: number;
  activeLegIndex?: number;
  currentLine?: string;
  currentMode?: Leg['mode'];
  nextLine?: string;
  nextMode?: Leg['mode'];
  transferStop?: string;
  delaySec?: number;
  slackSec?: number;
  walkSec?: number;
  walkM?: number;
  bufferSec?: number;
  departureAtMs?: number;
  arrivalAtMs?: number;
  departureSource?: 'live' | 'schedule';
  delaySource?: TransferDelaySource;
  reason?: 'permission' | 'offRoute' | 'routing' | 'expired';
  scope?: 'foreground' | 'background';
  nextTrain?: NextTrainInfo;
  /** Najlepsza propozycja (utrzymana dla kompatybilności z natywnym serwisem i testami). */
  alternative?: TransferAlternative;
  /** Wszystkie aktualne, posortowane propozycje (maks. 3). */
  alternatives?: TransferAlternative[];
  /** Przegląd wszystkich przesiadek na trasie. */
  transfers?: TransferSegmentSummary[];
  /** Oznaczenie, że użytkownik ręcznie podmienił odcinek w trakcie ochrony. */
  swappedByUser?: boolean;
  /** Pole tylko po stronie serwisu natywnego: nie może nadpisywać planu bez zgody. */
  connection?: Connection;
}
