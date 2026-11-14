// Mock alertów PKP do zrzutu ekranu wideo (bez sieci).
import type { Connection, Leg } from '../../src/types/models';

export interface TrainAlertItem {
  id?: string;
  title: string;
  description: string;
  solution?: string;
  isUrgent?: boolean;
  isResolved?: boolean;
  timeframe?: string;
  source?: string;
  link?: string;
}

export interface TrainAlerts {
  leg: Leg;
  alerts: TrainAlertItem[];
}

export function resetNationalDisruptionsCache() {}

export async function alertsForConnection(connection: Connection): Promise<TrainAlerts[]> {
  const ride = connection.legs.find((l) => l.mode === 'train');
  if (!ride) return [];
  return [
    {
      leg: ride,
      alerts: [
        {
          id: 'video-speed',
          title: 'Ograniczenie prędkości pociągu',
          description: 'Na odcinku Częstochowa – Piotrków Trybunalski obowiązuje ograniczenie prędkości.',
          isUrgent: true,
          source: 'PKP PLK',
        },
      ],
    },
  ];
}

export async function alertsForLeg(_leg: Leg): Promise<TrainAlertItem[]> {
  return [
    {
      id: 'video-speed',
      title: 'Ograniczenie prędkości pociągu',
      description: 'Na odcinku Łódź Widzew – Skierniewice obowiązuje ograniczenie prędkości.',
      isUrgent: true,
      source: 'PKP PLK',
    },
  ];
}
