import type { Connection } from '../../types/models';

type TransferStatus =
  | 'preparing'
  | 'waiting'
  | 'safe'
  | 'risk'
  | 'rerouting'
  | 'changed'
  | 'noAlternative'
  | 'unavailable'
  | 'complete';

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
}
