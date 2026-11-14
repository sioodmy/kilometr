// Mock biletu IC na zrzut ekranu wideo (bez FS / PDF).
import type { Connection } from '../../src/types/models';

export interface AttachedRailTicket {
  id: string;
  connectionId: string;
  fileName: string;
  fileUri: string;
  fileSize: number;
  addedAt: number;
  tripDate?: string;
  barcodeUri?: string | null;
  barcodeUris?: string[];
  delayAtAttachSec?: number;
  metadata: {
    trainNumber?: string;
    wagon?: string;
    seat?: string;
    seatType?: string;
    passenger?: string;
  };
}

export type TicketImportRejected = {
  status: 'rejected';
  reason: 'tooLarge' | 'notTicket' | 'wrongTrain' | 'wrongDate';
  ticketTrainNumber?: string;
  connectionTrainNumber?: string;
  ticketDate?: string;
  connectionDate?: string;
};

export type TicketImportResult =
  | { status: 'attached'; ticket: AttachedRailTicket }
  | { status: 'cancelled' }
  | TicketImportRejected;

export interface TicketIndexEntry {
  id: string;
  connectionId: string;
}

const MOCK: AttachedRailTicket = {
  id: 'video-ticket-6150',
  connectionId: 'video-train',
  fileName: 'bilet-ic-6150.pdf',
  fileUri: 'file:///video/mock-ticket.pdf',
  fileSize: 12_000,
  addedAt: Date.now(),
  tripDate: '2026-10-20',
  metadata: {
    trainNumber: '6150',
    wagon: '7',
    seat: '42',
    seatType: 'okno',
    passenger: 'Jan K.',
  },
};

export function getTicketDir(): string | null {
  return null;
}
export function resolveTicketUri(): string | null {
  return null;
}
export async function getTicketIndex(): Promise<TicketIndexEntry[]> {
  return [{ id: MOCK.id, connectionId: MOCK.connectionId }];
}
export async function saveIndex(): Promise<void> {}
export async function getTicketForConnection(
  connectionId: string,
  _connection?: Connection,
): Promise<AttachedRailTicket | null> {
  if (connectionId === 'video-train' || connectionId.includes('video-train')) return MOCK;
  return null;
}
export async function deleteTicketForConnection(): Promise<void> {}
export async function importTicketPdf(): Promise<TicketImportResult> {
  return { status: 'cancelled' };
}
export async function getTicketConnectionIds(): Promise<Set<string>> {
  return new Set(['video-train']);
}
export function isTicketExpired(): boolean {
  return false;
}
export async function cleanupExpiredTickets(): Promise<void> {}
export async function openTicketPdf(): Promise<boolean> {
  return false;
}
