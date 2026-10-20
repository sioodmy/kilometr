import type { LegMode } from '../types/models';

// Tożsamość linii komunikacyjnej: typ pojazdu, stabilny kolor i kontrast.
// Wydzielone z komponentu LineBadge, bo zależy od nich silnik powiadomień
// (kolor linii jako akcent powiadomienia i segmentu na pasku postępu).
export const TRANSIT_PALETTE = [
  '#00897B', // Teal
  '#1976D2', // Blue
  '#D32F2F', // Red
  '#7B1FA2', // Purple
  '#F57C00', // Amber/Orange
  '#303F9F', // Indigo
  '#2E7D32', // Green
  '#C2185B', // Pink
  '#0097A7', // Cyan
  '#E64A19', // Deep Orange
  '#512DA8', // Deep Purple
  '#0288D1', // Light Blue
  '#558B2F', // Olive/Lime
  '#AD1457', // Berry
  '#00838F', // Dark Cyan
  '#455A64', // Blue Grey
  '#5D4037', // Brown
  '#388E3C', // Emerald
  '#0D47A1', // Cobalt
  '#880E4F', // Wine
  '#00695C', // Pine
  '#BF360C', // Rust
  '#311B92', // Violet
  '#1A237E', // Midnight Blue
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
    .replace(/^SZYBKA\s+KOLEJ\s+MIEJSKA\b/i, 'SKM');

  // Warianty kursu z ukośnikiem (np. "11572/3" -> "11572")
  if (/^\d+\/\d+$/.test(clean)) {
    clean = clean.split('/')[0];
  }

  // Pociągi dalekobieżne: obcięcie przydomka pociągu (np. "IC 1620 HETMAN" -> "IC 1620")
  const icMatch = /^(IC|TLK|EIP|EIC)\s*(\d+)(?:\s+[A-ZĄĆĘŁŃÓŚŹŻa-ząćęłńóśźż\s-]+)?$/i.exec(clean);
  if (icMatch) {
    return `${icMatch[1].toUpperCase()} ${icMatch[2]}`;
  }

  // Pociągi z oznaczeniem linii handlowej po prefiksie przewoźnika:
  // np. "KD D10" -> "D10", "KM R1" -> "R1", "KŚ S1" -> "S1", "KD D1" -> "D1"
  const lineCodeMatch =
    /^(?:KD|KM|KW|KS|KŚ|KML|KMŁ|ŁKA|PR)[\s:_-]+([A-Z]{1,2}\d{1,3}[A-Z]?)$/i.exec(clean);
  if (lineCodeMatch) {
    return lineCodeMatch[1].toUpperCase();
  }

  // W widoku kompaktowym (np. JourneyStrip):
  // jeśli mamy długi numer pociągu z prefiksem przewoźnika (np. "KD 69123", "KM 19302"),
  // skracamy do samego przewoźnika ("KD", "KM"), bo konkretny 5-cyfrowy numer relacji
  // i tak widać w szczegółach połączenia.
  if (compact) {
    const carrierNumMatch = /^(KD|KM|KW|KS|KŚ|KML|KMŁ|ŁKA|PR|WKD|SKM)[\s:_-]+(?:\d{4,6})$/i.exec(
      clean,
    );
    if (carrierNumMatch) {
      return carrierNumMatch[1].toUpperCase();
    }
  }

  return clean;
}

/**
 * Rozpoznaje typ pojazdu po nazwie linii. Moduł musi się dać importować
 * w Node (skrypty check:*), więc `cityId` jest opcjonalnym parametrem, a nie
 * odczytem aktywnego miasta. Badge newsów nie zna trybu z planera, więc linie
 * rozpoznaje po nazwie; RAPTOR ma osobny `classifyTransitMode` (route_type).
 *
 * Reguła bazowa: niski numer (1-33) to tramwaj, o ile miasto nie ma własnej
 * gałęzi (patrz niżej) albo niskich numerów autobusów (GZM). Miasta bez
 * własnej gałęzi opierają się na tej regule, bo ich rozkład numerów jest z nią
 * zgodny: Szczecin i Olsztyn (tramwaje w niskim zakresie, autobusy od 51 / 101).
 *
 * Własne gałęzie (numeracja odbiega od reguły bazowej, gałąź zwraca wprost):
 * - Warszawa: M1/M2 to metro, S1...S40 to pociąg.
 * - Trójmiasto: trolejbusy 21-33, 710 i 723; tramwaje 1-12; reszta to autobus.
 * - Poznań: T6/T7 to autobus, 97/201/203 to tramwaj (reszta wg reguły bazowej).
 * - Łódź: "6." z kropką to autobus, 41/43/45 oraz P1/R8/Z1 to tramwaj.
 * - Lublin: trolejbusy 150-162 i 950, N1-N3 to autobus, reszta to autobus.
 * - Kielce, Białystok, Opole, Rzeszów, Radom: wyłącznie autobusy, więc każda
 *   linia jest autobusem i niski numer nigdy nie udaje tramwaju.
 */
export function inferTransitMode(
  mode?: LegMode,
  line?: string,
  cityId?: string,
): 'tram' | 'bus' | 'train' | 'cable' | 'trolleybus' | 'subway' | 'walk' {
  if (mode === 'walk') return 'walk';
  if (mode === 'tram') return 'tram';
  if (mode === 'train') return 'train';
  if (mode === 'cable') return 'cable';
  if (mode === 'trolleybus') return 'trolleybus';
  if (mode === 'subway') return 'subway';
  if (mode === 'bus') return 'bus';
  if (!line) return 'bus';
  const clean = line.trim();
  if (cityId === 'warszawa') {
    if (/^M[12]$/i.test(clean)) return 'subway';
    if (/^S\d{1,2}$/i.test(clean)) return 'train';
  }
  if (
    /^(?:KD|KM|KW|KS|KŚ|KML|KMŁ|ŁKA|WKD|SKM|PR|POLREGIO|IC|TLK|EIP|EIC)(?:[\s:_-]|$)/i.test(clean)
  ) {
    return 'train';
  }
  if (/^D\d{1,2}$/i.test(clean) && (cityId === 'wroclaw' || !cityId)) {
    return 'train';
  }
  const num = parseInt(clean, 10);
  // Poznań: tramwaje to 1-19 plus 97, 201 i 203 (wszystkie z route_type 0
  // w feedzie ZTM), a T6/T7 to autobusy turystyczne. Numery > 33 poza
  // wymienionymi to autobusy (nocne 2xx też, oprócz 201/203).
  // Trójmiasto: gdańskie tramwaje to 1-12 (route_type 900 w feedzie),
  // gdyńskie trolejbusy to 21-33, 710 i 723 (route_type 800). Nocne N1-N89
  // i zastępcze T8/T9 to autobusy. Zakresy się nie przecinają, więc gałąź
  // zwraca wprost i nie spada do zgadywania 1-33.
  if (cityId === 'trojmiasto') {
    if (/^(710|723)$/.test(clean)) return 'trolleybus';
    if (!isNaN(num)) {
      if (num >= 21 && num <= 33) return 'trolleybus';
      if (num >= 1 && num <= 12) return 'tram';
      return 'bus';
    }
    return 'bus';
  }
  if (cityId === 'poznan') {
    if (/^T\d{1,2}$/i.test(clean)) return 'bus';
    if (num === 97 || num === 201 || num === 203) return 'tram';
  }
  // Łódź: tramwaje to 1-19 plus podmiejskie 41/43/45 i jednoliterowe P1, R8,
  // Z1 (wszystkie z route_type 0 w feedzie ZDiT). "6." z kropką to autobus.
  if (cityId === 'lodz') {
    if (/^6\.$/.test(clean)) return 'bus';
    if (num === 41 || num === 43 || num === 45) return 'tram';
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
 * Pociągi KD mają STAŁY kolor zamiast losowanego z palety: bursztyn z motywu
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
 * Trolejbus (GZM/Tychy) dostaje stałą zieleń: sygnalizuje napęd elektryczny,
 * a odcień jest odrębny od bursztynu pociągów i błękitu kolejki. Ciemne
 * tło -> biały tekst, kontrast ~5:1.
 */
export const TROLLEY_BADGE_BG = '#2E7D32';

/**
 * Metro Warszawy jedzie kolorami z feedu WTP (M1 niebieskie #0000BB,
 * M2 czerwone #BB0000, zweryfikowane w routes.txt): pasażer poznaje linię
 * po barwie ze schematu, nie po losie z palety. Oba ciemne -> biały tekst.
 */
export const SUBWAY_BADGE_BG: Record<string, string> = { M1: '#0000BB', M2: '#BB0000' };
export const SUBWAY_BADGE_FALLBACK_BG = '#1A237E';

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
 * Kolor linii pod rysowanie trasy na ciemnej mapie. Część palety ginie na
 * niej całkowicie (brąz #5D4037 tramwaju 19 ma kontrast 2:1, granat metra
 * 1.4:1), więc za ciemny kolor mieszamy z bielą aż osiągnie próg. Jasne
 * kolory wracają bez zmian i tożsamość linii zostaje ta sama co w badge'u.
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
function contrastFg(bg: string): string {
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
    return {
      bg: TRAIN_BADGE_BG,
      fg: contrastFg(TRAIN_BADGE_BG),
      isTram: false,
      isTrain: true,
      isCable: false,
    };
  }
  if (resolved === 'subway') {
    const bg = SUBWAY_BADGE_BG[(line || '').trim().toUpperCase()] ?? SUBWAY_BADGE_FALLBACK_BG;
    return { bg, fg: contrastFg(bg), isTram: false, isTrain: false, isCable: false };
  }
  if (resolved === 'cable') {
    return {
      bg: CABLE_BADGE_BG,
      fg: contrastFg(CABLE_BADGE_BG),
      isTram: false,
      isTrain: false,
      isCable: true,
    };
  }
  if (resolved === 'trolleybus') {
    return {
      bg: TROLLEY_BADGE_BG,
      fg: contrastFg(TROLLEY_BADGE_BG),
      isTram: false,
      isTrain: false,
      isCable: false,
    };
  }
  const isTram = resolved === 'tram';
  const clean = (line || '').trim().toUpperCase();

  if (!clean) {
    const bg = isTram ? '#00897B' : '#1976D2';
    return { bg, fg: contrastFg(bg), isTram, isTrain: false, isCable: false };
  }

  let hash = 0;
  const key = `${isTram ? 'tram' : 'bus'}:${clean}`;
  for (let i = 0; i < key.length; i++) {
    hash = ((hash << 5) - hash + key.charCodeAt(i)) | 0;
  }
  const idx = Math.abs(hash * 7) % TRANSIT_PALETTE.length;
  const bg = TRANSIT_PALETTE[idx];
  const fg = contrastFg(bg);

  return { bg, fg, isTram, isTrain: false, isCable: false };
}
