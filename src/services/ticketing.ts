import { Linking } from 'react-native';
import type { Connection, Leg } from '../types/models';

/**
 * Sprawdza czy dany odcinek jest odcinkiem kolejowym.
 */
export function isTrainLeg(leg: Leg): boolean {
  return leg.mode === 'train' || Boolean(leg.tripId?.startsWith('pl:')) || Boolean(leg.trainNumber && leg.railAgency);
}

/**
 * Zamienia nazwę stacji na format przyjazny dla wyszukiwarki KOLEO.
 * Usuwa perony, dopiski w nawiasach, polskie znaki diakrytyczne (w tym ł -> l), znaki specjalne i łączy słowa myślnikiem.
 */
export function slugifyStation(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s*\([^)]*\)/g, '')
    .replace(/,.*$/, '')
    .replace(/ł/g, 'l')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export interface TrainLegSummary {
  firstTrain: Leg;
  lastTrain: Leg;
  trainLegs: Leg[];
  transferCount: number;
  fromStation: string;
  toStation: string;
  departureTime: string;
  agency?: string;
  trainNumber?: string;
}

/**
 * Wyciąga podsumowanie odcinków kolejowych z danego połączenia.
 */
export function getTrainLegSummary(connection: Connection): TrainLegSummary | null {
  const trainLegs = connection.legs.filter(isTrainLeg);
  if (trainLegs.length === 0) return null;

  const firstTrain = trainLegs[0];
  const lastTrain = trainLegs[trainLegs.length - 1];

  return {
    firstTrain,
    lastTrain,
    trainLegs,
    transferCount: trainLegs.length - 1,
    fromStation: firstTrain.fromStop,
    toStation: lastTrain.toStop,
    departureTime: firstTrain.departAt || connection.departAt,
    agency: firstTrain.railAgency,
    trainNumber: firstTrain.trainNumber,
  };
}

/**
 * Sprawdza czy połączenie zawiera co najmniej jeden odcinek kolejowy.
 */
export function hasTrainLegs(connection: Connection): boolean {
  return connection.legs.some(isTrainLeg);
}

/**
 * Buduje gotowy link URL do wyszukiwarki KOLEO dla danej relacji kolejowej.
 * Uwzględnia stację początkową i końcową odcinka kolejowego oraz datę i czas odjazdu.
 */
export function buildKoleoUrl(connection: Connection): string | null {
  const summary = getTrainLegSummary(connection);
  if (!summary) return null;

  const fromSlug = slugifyStation(summary.fromStation);
  const toSlug = slugifyStation(summary.toStation);
  if (!fromSlug || !toSlug) return null;

  const dateObj = new Date();
  if (connection.serviceDate) {
    const [y, m, d] = connection.serviceDate.split('-').map(Number);
    if (y && m && d) dateObj.setFullYear(y, m - 1, d);
  }

  const depTime = summary.departureTime || connection.departAt;
  if (depTime) {
    const [hh, mm] = depTime.split(':').map(Number);
    if (!isNaN(hh) && !isNaN(mm)) {
      dateObj.setHours(hh, mm, 0, 0);
    }
  }

  const pad = (n: number) => String(n).padStart(2, '0');
  const d = pad(dateObj.getDate());
  const m = pad(dateObj.getMonth() + 1);
  const y = dateObj.getFullYear();
  const time = `${pad(dateObj.getHours())}:${pad(dateObj.getMinutes())}`;

  return `https://koleo.pl/rozklad-pkp/${fromSlug}/${toSlug}/${d}-${m}-${y}_${time}/all/all`;
}

/**
 * Otwiera bezpośrednie połączenie w KOLEO (aplikacja lub strona mobilna).
 * Wywołuje Linking.openURL bezpośrednio (bez canOpenURL), aby uniknąć restrykcji widoczności pakietów w Android 11+.
 */
export async function openKoleoRoute(connection: Connection): Promise<boolean> {
  const url = buildKoleoUrl(connection);
  if (!url) {
    console.warn('[Ticketing] Could not build KOLEO URL for connection:', connection.id);
    return false;
  }

  try {
    await Linking.openURL(url);
    return true;
  } catch (err) {
    console.warn('[Ticketing] Failed to open KOLEO URL:', err);
    return false;
  }
}
