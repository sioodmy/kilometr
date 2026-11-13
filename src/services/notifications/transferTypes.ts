import type { Connection } from '../../types/models';

export function hasTransfer(connection: Pick<Connection, 'legs'>): boolean {
  return connection.legs.filter((leg) => leg.mode !== 'walk').length > 1;
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

/** Następny pociąg po spóźnieniu na połączenie międzyregionalne (tryb konduktora). */
export interface NextTrainInfo {
  /** Linia z kategorią (np. „IC 2522”). */
  label: string;
  /** Odjazd z tej samej stacji (ms epoki). */
  departAtMs: number;
  /** Nazwa handlowa pociągu (np. „SILESIUM”), jeśli jest. */
  trainName?: string;
}

export interface TransferAlternative {
  id: string;
  connection: Connection;
  activeLegIndex: number;
  nextLine: string;
  transferStop: string;
  departureAtMs: number;
  arrivalAtMs: number;
  validUntil: number;
  kind: 'sameStop' | 'stayOn' | 'fromHere';
}

export interface TransferProtectionState {
  tripId: string;
  status: TransferStatus;
  updatedAt: number;
  revision: number;
  activeLegIndex?: number;
  delaySec?: number;
  slackSec?: number;
  nextLine?: string;
  currentLine?: string;
  transferStop?: string;
  departureAtMs?: number;
  arrivalAtMs?: number;
  departureSource?: 'live' | 'schedule';
  reason?: 'location' | 'offRoute' | 'routing' | 'expired';
  connection?: Connection;
  alternative?: TransferAlternative;
  /** Tryb konduktora: następny pociąg po spóźnieniu na międzyregionalny. */
  nextTrain?: NextTrainInfo;
  scope?: 'foreground' | 'background';
}
