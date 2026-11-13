import { Linking } from 'react-native';
import type { Connection, Leg } from '../types/models';
import { warsawNow } from '../gtfs/geo';
import { isTrainLeg } from './railIdentity';

function expandPolishStationAbbreviations(str: string): string {
  return str
    .replace(/(^|\s)gł\.?(?=\s|$|,)/gi, '$1 glowny')
    .replace(/(^|\s)gl\.?(?=\s|$|,)/gi, '$1 glowny')
    .replace(/(^|\s)centr\.?(?=\s|$|,)/gi, '$1 centralna')
    .replace(/(^|\s)ctr\.?(?=\s|$|,)/gi, '$1 centralna')
    .replace(/(^|\s)zach\.?(?=\s|$|,)/gi, '$1 zachodnia')
    .replace(/(^|\s)wsch\.?(?=\s|$|,)/gi, '$1 wschodnia')
    .replace(/(^|\s)płd\.?(?=\s|$|,)/gi, '$1 poludniowa')
    .replace(/(^|\s)pld\.?(?=\s|$|,)/gi, '$1 poludniowa')
    .replace(/(^|\s)płn\.?(?=\s|$|,)/gi, '$1 polnocna')
    .replace(/(^|\s)pln\.?(?=\s|$|,)/gi, '$1 polnocna')
    .replace(/(^|\s)m\.(?=\s|$|,)/gi, '$1 miasto');
}

/**
 * Zamienia nazwę stacji na format przyjazny dla wyszukiwarki KOLEO i dopasowywania biletów.
 * Rozwija powszechne skróty kolejowe (Gł. -> Główny, Centr. -> Centralna, Zach. -> Zachodnia),
 * usuwa perony, dopiski w nawiasach, polskie znaki diakrytyczne (w tym ł -> l), znaki specjalne i łączy słowa myślnikiem.
 */
export function slugifyStation(name: string): string {
  if (!name) return '';
  const expanded = expandPolishStationAbbreviations(name);
  return expanded
    .toLowerCase()
    .replace(/\s*\([^)]*\)/g, '')
    .replace(/,.*$/, '')
    .replace(/ł/g, 'l')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Porównuje nazwy stacji kolejowych pod kątem dopasowania biletu do trasy,
 * tolerując skróty dworcowe oraz warianty rodzajowe (np. Główny vs Główna).
 */
export function isStationMatch(a?: string | null, b?: string | null): boolean {
  if (!a || !b) return false;
  const slugA = slugifyStation(a);
  const slugB = slugifyStation(b);
  if (!slugA || !slugB) return false;
  if (slugA === slugB) return true;

  // Tolerancja odmiany rodzajowej (główny vs główna)
  const normA = slugA.replace(/glowna$/, 'glowny');
  const normB = slugB.replace(/glowna$/, 'glowny');
  if (normA === normB) return true;

  // Prefix check dla stacji jedno- lub wieloczłonowych (np. "Legnica" i "Legnica Dworzec")
  const minLen = Math.min(normA.length, normB.length);
  if (minLen >= 5 && (normA.startsWith(normB) || normB.startsWith(normA))) {
    return true;
  }
  return false;
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
    trainNumber: trainNumberLabel(firstTrain),
  };
}

/**
 * Etykieta numeru pociągu bez podwójnego prefiksu. Bilet PKP IC trzyma numer
 * jako "IC 6130", a odcinek z feedu ma railAgency "IC", więc sklejenie dawałoby
 * "IC IC 6130".
 */
export function trainNumberLabel(leg: Pick<Leg, 'trainNumber' | 'line' | 'railAgency'>): string | undefined {
  const number = leg.trainNumber || leg.line;
  if (!number) return undefined;
  const agency = leg.railAgency?.trim();
  if (!agency) return number;
  const prefix = `${agency} `;
  return number.toUpperCase().startsWith(prefix.toUpperCase()) ? number.slice(prefix.length) : number;
}

/** Numer bez powtórzonego prefiksu agency (do UI: "IC" + "IC 6130" → "6130"). */
export function stripAgencyPrefix(number: string, agency?: string | null): string {
  if (!agency) return number;
  const prefix = `${agency.trim()} `;
  return number.toUpperCase().startsWith(prefix.toUpperCase())
    ? number.slice(prefix.length)
    : number;
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

  // Data i godzina w Europe/Warsaw: lokalny Date psuje KOLEO poza PL / przy DST.
  const pad = (n: number) => String(n).padStart(2, '0');
  let y: number;
  let m: number;
  let d: number;
  if (connection.serviceDate) {
    const parts = connection.serviceDate.split('-').map(Number);
    y = parts[0];
    m = parts[1];
    d = parts[2];
  } else {
    const w = warsawNow();
    y = w.year;
    m = w.month;
    d = w.day;
  }

  let hh = 0;
  let mm = 0;
  const depTime = summary.departureTime || connection.departAt;
  if (depTime) {
    const [h, min] = depTime.split(':').map(Number);
    if (!isNaN(h) && !isNaN(min)) {
      hh = h;
      mm = min;
    }
  }

  if (!y || !m || !d) return null;
  const time = `${pad(hh)}:${pad(mm)}`;
  return `https://koleo.pl/rozklad-pkp/${fromSlug}/${toSlug}/${pad(d)}-${pad(m)}-${y}_${time}/all/all`;
}

/**
 * Otwiera bezpośrednie połączenie w KOLEO (aplikacja lub strona mobilna).
 * Wywołuje Linking.openURL bezpośrednio (bez canOpenURL), aby uniknąć restrykcji widoczności pakietów w Android 11+.
 */
export async function openKoleoRoute(connection: Connection): Promise<boolean> {
  const url = buildKoleoUrl(connection);
  if (!url) return false;

  try {
    await Linking.openURL(url);
    return true;
  } catch (err) {
    console.warn('[Ticketing] Failed to open KOLEO url:', err);
    return false;
  }
}
