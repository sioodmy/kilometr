import type { LegMode } from '../types/models';
import { getRailAgencyColor, inferRailAgencyFromLine } from './railIdentity';

// Tożsamość linii komunikacyjnej: typ pojazdu, stabilny kolor i kontrast.
// Wydzielone z komponentu LineBadge, bo zależy od nich silnik powiadomień
// (kolor linii jako akcent powiadomienia i segmentu na pasku postępu).
// Paleta M3 Expressive (Dark Theme Tone 80): wysoki kontrast na ciemnym tle
// (#111414 / #1B2120) oraz gwarantowany kontrast tekstu WCAG AAA (>= 7:1).
export const TRANSIT_PALETTE = [
  '#71D8C2', // Teal
  '#96CCFF', // Blue
  '#FFB3B6', // Red
  '#EBB2FF', // Purple
  '#FFB95A', // Amber/Orange
  '#BAC3FF', // Indigo
  '#97D77D', // Green
  '#FFAEDE', // Pink
  '#6DD5E6', // Cyan
  '#FFB596', // Deep Orange
  '#CBBEFF', // Deep Purple
  '#87CFFA', // Light Blue
  '#CECC50', // Olive/Lime
  '#FCABF7', // Berry
  '#79D6D3', // Dark Cyan
  '#AFCBD5', // Blue Grey
  '#F6BA8C', // Brown
  '#7ADA9E', // Emerald
  '#ACC7FF', // Cobalt
  '#FFB1C5', // Wine
  '#98D3B9', // Pine
  '#FFB4A7', // Rust
  '#DAB9FF', // Violet
  '#ABCAE5', // Midnight Blue
];

/**
 * Normalizuje oznaczenie linii (zwłaszcza kolejowej), usuwając zbędną redundancję
 * i przydomki pociągów, aby badge mieścił się czysto w układzie.
 */
export function normalizeLineName(line?: string, _mode?: LegMode, compact?: boolean): string {
  if (!line) return '';
  let clean = line.trim();

  // Ujednolicenie popularnych nazw przewoźników kolejowych do oficjalnych skrótów
  clean = clean
    .replace(/^POLREGIO\b/i, 'PR')
    .replace(/^KOLEJE\s+MAŁOPOLSKIE\b/i, 'KMŁ')
    .replace(/^KOLEJE\s+MAZOWIECKIE\b/i, 'KM')
    .replace(/^KOLEJE\s+DOLNOŚLĄSKIE\b/i, 'KD')
    .replace(/^KOLEJE\s+ŚLĄSKIE\b/i, 'KŚ')
    .replace(/^KOLEJE\s+WIELKOPOLSKIE\b/i, 'KW')
    .replace(/^WARSZAWSKA\s+KOLEJ\s+DOJAZDOWA\b/i, 'WKD')
    .replace(/^PKP\s+SKM\s+W\s+TRÓJMIEŚCIE\b/i, 'SKMT')
    .replace(/^SKM\s+TRÓJMIASTO\b/i, 'SKMT')
    .replace(/^SKM\s+W\s+WARSZAWIE\b/i, 'SKM')
    .replace(/^SZYBKA\s+KOLEJ\s+MIEJSKA\b/i, 'SKM');

  // Skasuj ewentualny ukośnik i wariant po nim (np. "11572/3" -> "11572")
  clean = clean.replace(/\/.*$/, '').trim();

  // IC/TLK/EIP: "IC 1620 HETMAN" -> "IC 1620"
  const icMatch = clean.match(/^(IC|TLK|EIP|EIC)\s+(\d{3,5})\b/i);
  if (icMatch) {
    return `${icMatch[1].toUpperCase()} ${icMatch[2]}`;
  }

  // Odmiany regionalne z literą relacji:
  //   KD D10, KD D1 -> D10, D1
  //   KM R1, KM RE1 -> R1, RE1
  //   KŚ S1, KŚ SPR1 -> S1, SPR1
  //   SKMT S1 -> S1
  const regionalMatch = clean.match(
    /^(?:KD|KM|KŚ|KS|SKM|SKMT)\s+([A-Z]{1,3}\d{1,4}[A-Z]?|[A-Z]\d{1,3})\b/i,
  );
  if (regionalMatch) {
    return regionalMatch[1].toUpperCase();
  }

  // W widoku compact (np. pigułka trasy na liście połączeń): pociągi oznaczamy
  // samym skrótem przewoźnika, bo numer pociągu (np. 69123) nie mieści się
  // w ciasnym rzędzie z przesiadkami, a pasażer szuka peronu po przewoźniku.
  if (compact && _mode === 'train') {
    const carrierPrefix = clean.match(/^(PR|POLREGIO|KD|KM|KMŁ|KŚ|KS|KW|WKD|SKMT|SKM|IC|TLK|EIC|EIP)\b/i);
    if (carrierPrefix) {
      const code = carrierPrefix[1].toUpperCase();
      if (code === 'POLREGIO') return 'PR';
      if (code === 'KS') return 'KŚ';
      return code;
    }
  }

  // Pozostałe pociągi: zdejmij zbędne prefiksy, zostaw sam numer/symbol
  clean = clean
    .replace(/^(?:POCIĄG|REGIO|OS|OSOBOWY)\s+/i, '')
    .trim();

  return clean;
}

/**
 * Odgaduje tryb transportu (tramwaj, autobus, pociąg, metro, kolejka),
 * gdy feed GTFS zwraca generyczny typ lub brakuje go w rozkładzie.
 */
export function inferTransitMode(
  mode?: LegMode,
  line?: string,
  cityId?: string,
): LegMode {
  if (mode && mode !== 'bus') return mode;
  if (!line) return mode ?? 'bus';

  const clean = line.trim().toUpperCase();

  // Kolej linowa (Polinka we Wrocławiu)
  if (clean === 'POLINKA' || clean === 'KOLEJ LINOWA') return 'cable';

  // Metro warszawskie (linie M1, M2, przyszłościowo M3/M4)
  if (cityId === 'warszawa' && /^M[1-4]$/i.test(clean)) return 'subway';

  // Rozpoznawanie pociągów po oficjalnych oznaczeniach przewoźników
  if (
    /^(?:KD|KM|KMŁ|KŚ|KS|KW|PR|POLREGIO|WKD|SKM|SKMT|IC|TLK|EIP|EIC)\b/i.test(clean) ||
    /^(?:IC|TLK|EIP|EIC)\s*\d+/i.test(clean) ||
    /^(?:R|RE|RP|OsP|Os)\s*\d{3,6}$/i.test(clean) ||
    /^\d{4,6}$/.test(clean)
  ) {
    return 'train';
  }

  // Regionalne linie kolejowe z literą (D1, D10 na Dolnym Śląsku, S1 na Śląsku, R1 na Mazowszu)
  // Wykluczamy jednak linie autobusowe w miastach bez tramwajów/kolei miejskiej w tych zakresach.
  if (cityId === 'wroclaw' && /^D\d{1,2}$/i.test(clean)) return 'train';
  if (cityId === 'warszawa' && /^(?:R\d{1,2}|S\d{1,2}|WKD)$/i.test(clean)) return 'train';
  if (cityId === 'krakow' && /^SKA\d$/i.test(clean)) return 'train';
  if (cityId === 'trojmiasto' && /^SKM\b/i.test(clean)) return 'train';
  if (cityId === 'poznan' && /^PKM\d$/i.test(clean)) return 'train';

  // Tramwaje w polskich miastach mają zazwyczaj numery 1-33 (GZM 0-49, Kraków do 79)
  const num = parseInt(clean, 10);

  // GZM (Katowice): autobusy mają numery od 0 wzwyż (np. 0, 11, 12, 27 to autobusy!),
  // a tramwaje mają zakres 0-49. Niska cyfra nie wystarcza do odgadnięcia tramwaju,
  // więc w GZM ufamy wyłącznie jawnemu typowi z feedu.
  if (cityId === 'gzm') return mode ?? 'bus';

  // Szczecin: tramwaje 1-12, autobusy 51+ i pospieszne A-H (feed ZDiTM ma
  // poprawne route_type, ale fallback po numerze chroni widoki bez leg.mode).
  if (cityId === 'szczecin') {
    if (!isNaN(num) && num >= 1 && num <= 12) return 'tram';
    return 'bus';
  }

  // Toruń: tramwaje 1-8 (feed MZK Toruń ma route_type 0, fallback po numerze).
  if (cityId === 'torun') {
    if (!isNaN(num) && num >= 1 && num <= 8) return 'tram';
    return 'bus';
  }

  // Olsztyn: tramwaje 1-5 (linie 1, 2, 3, 4, 5). Reszta to autobusy (100+,
  // nocne N01-N02). Odcięcie 1-5 eliminuje fałszywe tramwaje z domyślnego 1-33.
  if (cityId === 'olsztyn') {
    if (!isNaN(num) && num >= 1 && num <= 5) return 'tram';
    return 'bus';
  }

  // Grudziądz: jedyna linia tramwajowa to 2 (w porywach 1/T w remontach).
  // Autobusy to 3-26, więc domyślne 1-33 uznawałoby autobusy za tramwaje.
  if (cityId === 'grudziadz') {
    if (!isNaN(num) && (num === 1 || num === 2)) return 'tram';
    if (/^[12]T$/i.test(clean)) return 'tram';
    return 'bus';
  }

  // Gorzów Wielkopolski: tramwaje to 1-4 (w tym 1P/1W w remontach). Reszta to
  // autobusy 100+ i nocne 500+, z wyjątkiem linii zastępczych T1-T4.
  if (cityId === 'gorzow') {
    if (!isNaN(num) && num >= 1 && num <= 4) return 'tram';
    if (/^T[1-4]$/i.test(clean)) return 'bus'; // Zastępcza „za tramwaj” jedzie autobusem
    return 'bus';
  }

  // Elbląg: tramwaje to linie 1-5 (feed ZKM Elbląg). Autobusy to 6-31, więc
  // domyślne 1-33 uznawałoby elbląskie autobusy 6-31 za tramwaje.
  if (cityId === 'elblag') {
    if (!isNaN(num) && num >= 1 && num <= 5) return 'tram';
    if (/^T[1-5]$/i.test(clean)) return 'tram';
    return 'bus';
  }

  // Bydgoszcz: tramwaje to 1-11 (oraz okazjonalne warianty).
  if (cityId === 'bydgoszcz') {
    if (!isNaN(num) && num >= 1 && num <= 11) return 'tram';
    return 'bus';
  }

  // Częstochowa: tramwaje to wyłącznie 1, 2, 3. Autobusy miejskie mają
  // numery 10-39, więc domyślne 1-33 fałszywie klasyfikowało linie 10-33.
  if (cityId === 'czestochowa') {
    if (!isNaN(num) && num >= 1 && num <= 3) return 'tram';
    return 'bus';
  }

  // Poznań: tramwaje to 1-18, 97-99 (turystyczne/zastępcze) oraz nocne 201-203.
  // Autobusy to 144+, za tramwaj Txx.
  if (cityId === 'poznan') {
    if (!isNaN(num) && ((num >= 1 && num <= 18) || (num >= 97 && num <= 99))) return 'tram';
    if (/^(P1|R8|Z1)$/i.test(clean)) return 'tram';
  }
  // Kielce: same autobusy, więc niski numer nie udaje tramwaju.
  if (cityId === 'kielce') return 'bus';
  // Białystok: wyłącznie autobusy BKM (1-30, 100+, J/J1-J6, N1-N6).
  if (cityId === 'bialystok') return 'bus';
  // Opole: cała sieć MZK to autobusy.
  if (cityId === 'opole') return 'bus';
  // Rzeszów nie ma tramwajów wcale (cały GTFS ZTM to route_type 3),
  // więc heurystyka niskich numerów nie ma tu zastosowania.
  if (cityId === 'rzeszow') return 'bus';

  // Lublin: tramwajów nie ma (niskie numery to autobusy), trolejbusy to
  // 150-162 i 950 (route_type 11 w feedzie ZDiTM). Nocne N1-N3, miejskie
  // 301-303, 912/917/922 i imienne Biała/Gaj/Zielona to autobusy.
  // Zakresy się nie przecinają, więc gałąź zwraca wprost i nie spada
  // do zgadywania 1-33 (lubelskie autobusy 2-33 nie są tramwajami).
  if (cityId === 'lublin') {
    if (/^N[1-3]$/i.test(clean)) return 'bus';
    if (!isNaN(num)) {
      if (num === 950) return 'trolleybus';
      if (num >= 150 && num <= 162) return 'trolleybus';
      return 'bus';
    }
    return 'bus';
  }

  // Radom: same autobusy MZDiK (linie 1-27 i nocne N1-N3, route_type 3
  // w feedzie). Bez tej gałęzi niskie numery wpadałyby w regułę tramwajową
  // niżej (ten sam powód co wyjątek GZM).
  if (cityId === 'radom') return 'bus';

  if (!isNaN(num) && num >= 1 && num <= 33 && cityId !== 'gzm') {
    return 'tram';
  }
  return 'bus';
}

/**
 * Pociągi bez przypisanego przewoźnika lub KD mają stały bursztyn z motywu
 * (#FFB957, rodzina warning). Stała leży tutaj, a nie w theme/tokens, bo
 * lineIdentity musi się dać importować w Node (skrypty check:*), a tokens
 * ciągnie react-native. Tekst na badgu liczy reguła kontrastu niżej.
 */
export const TRAIN_BADGE_BG = '#FFB957';

/**
 * Polinka dostaje drugą stałą, niebieską z motywu (tertiary #A5CCE8): gondola
 * nad rzeką nie może wyglądać jak tramwaj z palety, a odcień musi być odrębny
 * od bursztynu pociągów. Jasne tło -> ciemny tekst, kontrast ~11:1.
 */
export const CABLE_BADGE_BG = '#A5CCE8';

/**
 * Trolejbus (GZM/Tychy, Lublin) dostaje stałą zieleń M3 Expressive Tone 80 (#97D77D):
 * sygnalizuje napęd elektryczny, a odcień jest odrębny od bursztynu pociągów
 * i błękitu kolejki. Jasne tło -> ciemny tekst, kontrast > 12:1.
 */
export const TROLLEY_BADGE_BG = '#97D77D';

/**
 * Metro Warszawy jedzie oficjalnymi kolorami z feedu WTP w wersji M3 Expressive Tone 80
 * (M1 błękit #A8C7FA, M2 koral/czerwień #FFB4AB, fallback indygo #BAC3FF):
 * pasażer natychmiast rozpoznaje linię po barwie ze schematu metra,
 * a badge zachowuje perfekcyjny kontrast (>9.5:1) na ciemnym tle aplikacji.
 */
export const SUBWAY_BADGE_BG: Record<string, string> = { M1: '#A8C7FA', M2: '#FFB4AB' };
export const SUBWAY_BADGE_FALLBACK_BG = '#BAC3FF';

/**
 * Luminancja względna koloru (WCAG). Null dla wejścia, które nie jest
 * 6-cyfrowym HEX-em, żeby wołający mógł oddać oryginał bez zmian.
 */
function relativeLuminance(hex: string): number | null {
  const clean = hex.replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(clean)) return null;
  const linear = [0, 2, 4].map((i) => {
    const c = parseInt(clean.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

/** Tło mapy, po którym idzie linia trasy (MAP_COLORS.land i NavMiniMap). */
const MAP_BG = '#101413';
/**
 * Minimalna luminancja linii trasy: kontrast 4.5:1 względem tła mapy.
 * Elementy graficzne mają w WCAG próg 3:1, ale cienka linia pod
 * przygaszeniem (opacity 0.4) potrzebuje zapasu.
 */
const MAP_LINE_MIN_LUM = (relativeLuminance(MAP_BG)! + 0.05) * 4.5 - 0.05;

/**
 * Kolor linii pod rysowanie trasy na ciemnej mapie. Część kolorów zewnętrznych
 * (np. surowe hex-y z feedów GTFS) może ginąć na ciemnym tle, więc za ciemny
 * kolor mieszamy z bielą aż osiągnie próg. Jasne kolory z palety M3 wracają
 * bez zmian i tożsamość linii zostaje ta sama co w badge'u.
 */
export function mapLineColor(bg: string): string {
  const lum = relativeLuminance(bg);
  if (lum == null || lum >= MAP_LINE_MIN_LUM) return bg;
  const hex = bg.replace('#', '');
  const channels = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  for (let t = 0.02; t < 1; t += 0.02) {
    const mixed = channels.map((c) => Math.round(c + (255 - c) * t));
    const candidate = `#${mixed.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
    if (relativeLuminance(candidate)! >= MAP_LINE_MIN_LUM) return candidate.toUpperCase();
  }
  return '#FFFFFF';
}

/** WCAG AA: ciemny albo biały tekst w zależności od luminancji tła. */
export function getContrastForeground(bg: string): string {
  const lum = relativeLuminance(bg) ?? 0;
  const whiteContrast = 1.05 / (lum + 0.05);
  const blackContrast = (lum + 0.05) / 0.05;
  return whiteContrast >= blackContrast ? '#FFFFFF' : '#000000';
}

/** Oblicza stabilny, zharmonizowany kolor linii z gwarantowanym kontrastem tekstu. */
export function getLineColors(
  line?: string,
  mode?: LegMode,
  cityId?: string,
): { bg: string; fg: string; isTram: boolean; isTrain: boolean; isCable: boolean } {
  const resolved = inferTransitMode(mode, line, cityId);
  if (resolved === 'train') {
    const agency = inferRailAgencyFromLine(line, cityId);
    const bg = (agency ? getRailAgencyColor(agency) : undefined) ?? TRAIN_BADGE_BG;
    return {
      bg,
      fg: getContrastForeground(bg),
      isTram: false,
      isTrain: true,
      isCable: false,
    };
  }
  if (resolved === 'subway') {
    const bg = SUBWAY_BADGE_BG[(line || '').trim().toUpperCase()] ?? SUBWAY_BADGE_FALLBACK_BG;
    return { bg, fg: getContrastForeground(bg), isTram: false, isTrain: false, isCable: false };
  }
  if (resolved === 'cable') {
    return {
      bg: CABLE_BADGE_BG,
      fg: getContrastForeground(CABLE_BADGE_BG),
      isTram: false,
      isTrain: false,
      isCable: true,
    };
  }
  if (resolved === 'trolleybus') {
    return {
      bg: TROLLEY_BADGE_BG,
      fg: getContrastForeground(TROLLEY_BADGE_BG),
      isTram: false,
      isTrain: false,
      isCable: false,
    };
  }
  const isTram = resolved === 'tram';
  const clean = (line || '').trim().toUpperCase();

  if (!clean) {
    const bg = isTram ? '#71D8C2' : '#96CCFF';
    return { bg, fg: getContrastForeground(bg), isTram, isTrain: false, isCable: false };
  }

  let hash = 0;
  const key = `${isTram ? 'tram' : 'bus'}:${clean}`;
  for (let i = 0; i < key.length; i++) {
    hash = ((hash << 5) - hash + key.charCodeAt(i)) | 0;
  }
  const idx = Math.abs(hash * 7) % TRANSIT_PALETTE.length;
  const bg = TRANSIT_PALETTE[idx];
  const fg = getContrastForeground(bg);

  return { bg, fg, isTram, isTrain: false, isCable: false };
}
