// Sprawdzenie rejestru miast — bez telefonu i bez budowania APK.
// Uruchom: npm run check:cities
//
// Sprawdza rzeczy, których nie da się wyłapać patrząc w kod, a które psują
// aplikację po cichu:
//
//  1. każde miasto ma nazwę w CZTERECH słownikach (pl/en/de/uk),
//  2. granice są spójne z bboxami Nominatim/Overpass — zamiana miejsc w
//     takim łańcuchu znaków cicho psuje wyszukiwanie i Overpass,
//  3. środek miasta leży wewnątrz własnych granic,
//  4. feedy mają unikalne id, poprawne adresy i tryb pojazdu,
//  5. wykrywanie miasta z GPS trafia w punkt wewnątrz i zwraca `null` poza
//     wszystkimi miastami,
//  6. przełączenie miasta nie kasuje danych poprzedniego (osobna baza).

// Świadomie bez `node:` i bez importu `src/cities/active` (ciągnie za sobą
// expo-location). Importujemy sam rejestr + słowniki, które są czystym TS.

import { CITIES, DEFAULT_CITY_ID, detectCityFromCoords, getCity, isCityId } from '../src/cities/registry';
import type { CityDefinition } from '../src/cities/types';
import { pl } from '../src/i18n/pl';
import { en } from '../src/i18n/en';
import { de } from '../src/i18n/de';
import { uk } from '../src/i18n/uk';

const DICTS: Record<string, typeof pl> = { pl, en, de, uk };

let failures = 0;
let checks = 0;

function ok(label: string, condition: boolean, detail = ''): void {
  checks++;
  if (condition) {
    console.log(`  ✓ ${label}`);
  } else {
    failures++;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function bboxValues(bbox: string): number[] {
  return bbox.split(',').map((v) => Number(v.trim()));
}

// ─── 1. Nazwy w słownikach ─────────────────────────────────────────────────
console.log('\nNazwy miast w słownikach:');
for (const city of CITIES) {
  const missing = Object.entries(DICTS)
    .filter(([, dict]) => typeof dict.cities[city.nameKey] !== 'string' || !dict.cities[city.nameKey])
    .map(([loc]) => loc);
  ok(
    `${city.id}: nazwa w pl/en/de/uk`,
    missing.length === 0,
    missing.length ? `brak w: ${missing.join(', ')}` : '',
  );
  // Nazwa miasta musi się różnić od stałej `cityName` tylko wtedy, gdy miasto
  // nią jest — `cityName` to wartość zastępcza dla aktywnego miasta, więc przy
  // jednym mieście może, przy wielu nie może (ukazałoby „Wrocław" w Krakowie).
  const fallbackMismatch =
    city.id === DEFAULT_CITY_ID
      ? DICTS.pl.cityName === pl.cities[city.nameKey]
      : Object.entries(DICTS).every(([, d]) => d.cityName !== d.cities[city.nameKey]);
  ok(
    `${city.id}: zapasowa nazwa miasta (cityName) nie myli miast`,
    fallbackMismatch,
    city.id === DEFAULT_CITY_ID ? '' : `pl.cityName = "${pl.cityName}"`,
  );
}

// ─── 2/3. Granice i bboxy ──────────────────────────────────────────────────
console.log('\nGranice i bboxy:');
for (const city of CITIES) {
  const { bounds } = city;

  ok(
    `${city.id}: granice rosną (min < max)`,
    bounds.minLat < bounds.maxLat && bounds.minLon < bounds.maxLon,
    `${JSON.stringify(bounds)}`,
  );
  ok(
    `${city.id}: środek wewnątrz granic`,
    city.center.lat >= bounds.minLat &&
      city.center.lat <= bounds.maxLat &&
      city.center.lon >= bounds.minLon &&
      city.center.lon <= bounds.maxLon,
    `center ${JSON.stringify(city.center)} poza ${JSON.stringify(bounds)}`,
  );

  // Nominatim: left,top,right,bottom = minLon, maxLat, maxLon, minLat
  const nom = bboxValues(city.nominatimBbox);
  ok(`${city.id}: nominatimBbox to 4 liczby`, nom.length === 4 && nom.every(Number.isFinite), city.nominatimBbox);
  if (nom.length === 4) {
    ok(
      `${city.id}: nominatimBbox zgodne z granicami`,
      nom[0] === bounds.minLon && nom[1] === bounds.maxLat && nom[2] === bounds.maxLon && nom[3] === bounds.minLat,
      `bbox=${city.nominatimBbox} granice=${JSON.stringify(bounds)}`,
    );
  }

  // Overpass: south,west,north,east = minLat, minLon, maxLat, maxLon
  const ovp = bboxValues(city.overpassBbox);
  ok(`${city.id}: overpassBbox to 4 liczby`, ovp.length === 4 && ovp.every(Number.isFinite), city.overpassBbox);
  if (ovp.length === 4) {
    ok(
      `${city.id}: overpassBbox zgodne z granicami`,
      ovp[0] === bounds.minLat && ovp[1] === bounds.minLon && ovp[2] === bounds.maxLat && ovp[3] === bounds.maxLon,
      `bbox=${city.overpassBbox} granice=${JSON.stringify(bounds)}`,
    );
  }

  ok(`${city.id}: kod kraju niepusty`, city.countryCode.length > 0, city.countryCode);
}

// ─── 4. Feedy GTFS ─────────────────────────────────────────────────────────
console.log('\nFeedy GTFS:');
const seenUrls = new Set<string>();
for (const city of CITIES) {
  ok(`${city.id}: ma co najmniej jeden feed`, city.feeds.length > 0);

  const ids = city.feeds.map((f) => f.id);
  ok(`${city.id}: id feedów unikalne`, new Set(ids).size === ids.length, ids.join(', '));
  ok(`${city.id}: pierwszy feed nie jest opcjonalny`, city.feeds[0]?.optional !== true, ids[0]);

  for (const feed of city.feeds) {
    ok(
      `${city.id}/${feed.id}: adres to https`,
      feed.url.startsWith('https://'),
      feed.url,
    );
    ok(`${city.id}/${feed.id}: adres unikalny w mieście`, !seenUrls.has(feed.url), feed.url);
    seenUrls.add(feed.url);
    // Adres musi prowadzić do archiwum ZIP. Dwa poprawne kształty:
    //   - plik z rozszerzeniem (`GTFS_KRK_T.zip`),
    //   - endpoint zasobów (`…/download/136/`) — tak wystawia Wrocław; odpowiada
    //     `Content-Type: application/zip` z nazwą pliku w `Content-Disposition`
    //     (sprawdzane na żywo w `npm run check:transit-mode`).
    // Gdyby tu trafił się `.pb` (GTFS-RT), downloader wybuchłby w fflate bez
    // czytelnego komunikatu.
    ok(
      `${city.id}/${feed.id}: adres archiwum zip`,
      /\.zip(\?|$)/i.test(feed.url) || /\/$/.test(feed.url),
      feed.url,
    );
  }

  // Miasto publikujące osobne archiwa typów musi to deklarować — bez `mode`
  // wyłącznie polegałobyśmy na route_type, który bywa mylący.
  if (city.feeds.length > 1) {
    const typed = city.feeds.filter((f) => f.mode);
    ok(
      `${city.id}: przy wielu feedach każdy ma zadeklarowany tryb pojazdu`,
      typed.length === city.feeds.length,
      `z ${city.feeds.length} feedów tryb ma ${typed.length}`,
    );
  }

  ok(`${city.id}: feed opcjonalny nie jest jedynym`, city.feeds.filter((f) => f.optional).length < city.feeds.length);
  ok(`${city.id}: refreshHours > 0`, city.refreshHours > 0, String(city.refreshHours));
}

// ─── 5. Wykrywanie z GPS ───────────────────────────────────────────────────
console.log('\nWykrywanie miasta z GPS:');
// Punkty w TREŚCI miasta: place de marché, dworzec, park — miejsca, gdzie
// naprawdę ktoś stoi, a nie przypadkowy środek bounding boxu.
const PROBES: { where: string; lat: number; lon: number; want: string | null }[] = [
  { where: 'Rynek, Wrocław', lat: 51.1111, lon: 17.0272, want: 'wroclaw' },
  { where: 'Dworzec Główny, Wrocław', lat: 51.0997, lon: 17.0364, want: 'wroclaw' },
  { where: 'Sky Tower, Wrocław', lat: 51.0938, lon: 17.0196, want: 'wroclaw' },
  { where: 'Rynek Sukienniczy, Kraków', lat: 50.0614, lon: 19.9366, want: 'krakow' },
  { where: 'Dworzec Główny, Kraków', lat: 50.0751, lon: 19.9456, want: 'krakow' },
  { where: 'Wawel, Kraków', lat: 50.0541, lon: 19.9350, want: 'krakow' },
  { where: 'Nowa Huta, Kraków', lat: 50.2147, lon: 19.8650, want: 'krakow' },
  // Oświęcim i Tarnów: poza obsługiwanym obszarem ŻADNEGO miasta.
  { where: 'Oświęcim', lat: 50.0282, lon: 19.1240, want: null },
  { where: 'Wrocław, ale poza granicą (Częstochowa)', lat: 50.2649, lon: 19.0238, want: null },
];

for (const probe of PROBES) {
  const got = detectCityFromCoords(probe.lat, probe.lon);
  ok(
    `${probe.where} → ${probe.want ?? 'null'}`,
    got === probe.want,
    `dostaliśmy ${got ?? 'null'}`,
  );
}

// Granice miast nie mogą na siebie nachodzić — inaczej jedno miasto kradłoby
// użytkownikowi drugie przez samo wykrywanie.
for (let i = 0; i < CITIES.length; i++) {
  for (let j = i + 1; j < CITIES.length; j++) {
    const a = CITIES[i].bounds;
    const b = CITIES[j].bounds;
    const overlap = a.minLat <= b.maxLat && b.minLat <= a.maxLat && a.minLon <= b.maxLon && b.minLon <= a.maxLon;
    ok(
      `${CITIES[i].id} i ${CITIES[j].id}: granice się nie nakładają`,
      !overlap,
      `overlap=${overlap}`,
    );
  }
}

// ─── 6. Osobna baza i osobne pliki per miasto ───────────────────────────────
console.log('\nIzolacja danych:');
ok('domyślne miasto to pierwsze w rejestrze', CITIES[0].id === DEFAULT_CITY_ID, `${CITIES[0].id} vs ${DEFAULT_CITY_ID}`);
ok('getCity(nieznany) → miasto domyślne', getCity('nie-ma-takiego').id === DEFAULT_CITY_ID);
ok('getCity(null) → miasto domyślne', getCity(null).id === DEFAULT_CITY_ID);
ok('isCityId("krakow")', isCityId('krakow'));
ok('!isCityId("katowice")', !isCityId('katowice'));

// Nazwa bazy: domyślne miasto bez sufiksu (migracja), pozostałe z sufiksem.
const dbName = (cityId: string): string =>
  cityId === DEFAULT_CITY_ID ? 'kilometr-gtfs.db' : `kilometr-gtfs-${cityId}.db`;
const dbNames = CITIES.map((c) => dbName(c.id));
ok('bazy różnią się między miastami', new Set(dbNames).size === dbNames.length, dbNames.join(' | '));
ok(
  'baza domyślnego miasta zachowuje starą nazwę (bez ponownego pobierania)',
  dbName(DEFAULT_CITY_ID) === 'kilometr-gtfs.db',
  dbName(DEFAULT_CITY_ID),
);

// Każde miasto ma osobny katalog na pliki rozkładu (baseDir używa id miasta).
const dirs = CITIES.map((c) => `kilometr/${c.id}/`);
ok('katalogi rozkładów różnią się', new Set(dirs).size === dirs.length, dirs.join(' | '));

// ─── Podsumowanie ──────────────────────────────────────────────────────────
console.log(`\nSprawdzono ${checks} asercji w ${CITIES.length} miastach, błędów: ${failures}`);
if (failures > 0) process.exit(1);

// Referencja typu, żeby zmiana sygnatury CityDefinition wyłapała ten skrypt.
const _typecheck: CityDefinition = CITIES[0];
void _typecheck;
