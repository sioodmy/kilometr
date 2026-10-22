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
  | 'unavailable'
  | 'complete';

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
  scope?: 'foreground' | 'background';
}
