import { awaitImportSettled, importInProgress } from '../dataManager';
import {
  getActiveServices,
  getNationalActiveServices,
  isNationalDbSwapPending,
  openGtfsDbHandle,
  type GtfsDbHandle,
} from '../gtfsDatabase';
import { distanceMeters } from '../../gtfs/geo';
import {
  BinaryReader,
  BinaryWriter,
  CMD_LOAD_STOPS,
  CMD_STOPS_QUERY,
  invokeRustSync,
} from '../../../modules/kilometr-raptor';
import { clearRaptorNetCache } from './network';
import { UI_YIELD_BUDGET_MS, yieldToUiFrame } from './yieldFrame';
import { getCity } from '../../cities';
import { getActiveCityIdSync } from '../cityStore';
import { isFareBoundary } from '../../gtfs/fareBoundary';
import type { GtfsRoute, GtfsStop, GtfsStopTime, GtfsTrip } from '../../gtfs/types';
import {
  POLINKA_ROUTE_ID,
  polinkaRoute,
  polinkaStops,
  polinkaTripsOverlapping,
} from '../../data/polinka';

/** Kolej linowa istnieje tylko w miastach z featurem (Wrocław / Polinka). */
function cableInCity(): boolean {
  try {
    return getCity(getActiveCityIdSync()).features.cable;
  } catch {
    return true;
  }
}

const WALK_SPEED_MPS = 1.45;
const WALK_DETOUR_FACTOR = 1.15;
const MAX_TRANSFER_METERS = 800;
const MIN_FOOTPATH_SEC = 45;

/** Stop w sklepie; `weight` to opcjonalna waga z indeksu wyszukiwania. */
type StoreStop = GtfsStop & { weight?: number };

/** Przejście piesze w jednostkach GTFS; `fixed` = czas z bazy (przesiadki MPK-KD). */
export interface Footpath {
  from_stop_id: string;
  to_stop_id: string;
  distance_m: number;
  duration_sec: number;
  fixed?: boolean;
}

/** Wzorzec kursu: wspólna sekwencja przystanków i rozkład odjazdów dla RAPTOR-a. */
interface Pattern {
  patternId: string;
  routeId: string;
  stopSequence: string[];
  trips: GtfsTrip[];
  departures: number[][];
  tripIndices: number[][];
}

/**
 * Źródło danych magazynu: miasto (domyślnie) albo ogólnopolska baza kolejowa.
 * Pozwala trzymać dwa niezależne magazyny (i dwie sieci RAPTOR) bez scalania
 * baz: planer kolejowy liczy nogę kolejową wyłącznie na magazynie `polska`.
 */
export interface GtfsStoreBackend {
  /** Uchwyt bazy (aktywne miasto albo plik kilometr-gtfs-polska.db). */
  getDb(): Promise<GtfsDbHandle>;
  /** Serwisy aktywne w danym dniu (kalendarz + wyjątki). */
  getActiveServices(weekday: number, dateStr?: string): Promise<Set<string>>;
  /** Czeka, aż bezpiecznie otwierać bazę (import / podmiana pliku). */
  awaitReady(): Promise<void>;
  /** Czy import danych tego magazynu trwa (pusty wycinek zamiast błędów). */
  isImporting(): boolean;
  /** Kolej linowa (Polinka) istnieje tylko w magazynie miasta. */
  cable: boolean;
  /**
   * Natywny indeks przystanków Rusta jest JEDEN globalny: synchronizuje go
   * wyłącznie magazyn miasta. Magazyn kolejowy (3k stacji) liczy najbliższe
   * przystanki pętlą w JS.
   */
  rustStopIndex: boolean;
}

const cityBackend = (): GtfsStoreBackend => ({
  getDb: () => openGtfsDbHandle(),
  getActiveServices,
  awaitReady: () => (importInProgress ? awaitImportSettled() : Promise.resolve()),
  isImporting: () => importInProgress,
  get cable() {
    return cableInCity();
  },
  rustStopIndex: true,
});

/**
 * Backend ogólnopolski: brak Polinki, brak rustowego indeksu przystanków.
 * Podmianę pliku pilnuje bramka beginNationalDbSwap w gtfsDatabase
 * (getNationalDb sam czeka, aż bramka puszczona).
 */
const polskaBackend = (): GtfsStoreBackend => ({
  getDb: () => openGtfsDbHandle('national'),
  getActiveServices: getNationalActiveServices,
  awaitReady: () =>
    isNationalDbSwapPending() ? openGtfsDbHandle('national').then(() => undefined) : Promise.resolve(),
  isImporting: () => false,
  cable: false,
  rustStopIndex: false,
});

export interface DayIndex {
  stopRoutes: Map<string, Set<string>>;
  routeStops: Map<string, string[]>;
  routeTrips: Map<string, GtfsTrip[]>;
  patterns: Map<string, Pattern>;
}

// Wartość bajtu dla każdego znaku hex. Slice+parseInt tworzył 4 podciągi na
// każdą liczbę; przy wycinku 7 tys. kursów to miliony alokacji na JS thread.
const HEX_DIGITS = new Int8Array(256);
for (let i = 0; i < 10; i++) HEX_DIGITS[48 + i] = i;
for (let i = 0; i < 6; i++) {
  HEX_DIGITS[65 + i] = 10 + i;
  HEX_DIGITS[97 + i] = 10 + i;
}

/** Odczytuje pojedynczy Int32 little-endian spod indeksu słowa w SQLite hex(). */
function readInt32HexAt(hex: string, idx: number): number {
  const offset = idx * 8;
  const b0 = (HEX_DIGITS[hex.charCodeAt(offset)] << 4) | HEX_DIGITS[hex.charCodeAt(offset + 1)];
  const b1 =
    (HEX_DIGITS[hex.charCodeAt(offset + 2)] << 4) | HEX_DIGITS[hex.charCodeAt(offset + 3)];
  const b2 =
    (HEX_DIGITS[hex.charCodeAt(offset + 4)] << 4) | HEX_DIGITS[hex.charCodeAt(offset + 5)];
  const b3 =
    (HEX_DIGITS[hex.charCodeAt(offset + 6)] << 4) | HEX_DIGITS[hex.charCodeAt(offset + 7)];
  return b0 | (b1 << 8) | (b2 << 16) | (b3 << 24);
}

/** Maksymalna liczba kursów z blobami pobierana z SQLite w jednym rzucie przez mostek JSI. */
const TRIP_BLOB_PAGE_SIZE = 300;

/** Dokłada kursy Polinki do mapy kursów wycinka (własna linia, brak konfliktu id). */
function mergePolinkaTrips(
  tripsByRouteId: Map<string, GtfsTrip[]>,
  extra: Map<string, GtfsTrip[]>,
): Map<string, GtfsTrip[]> {
  for (const [routeId, group] of extra) {
    const existing = tripsByRouteId.get(routeId);
    if (existing) existing.push(...group);
    else tripsByRouteId.set(routeId, group);
  }
  return tripsByRouteId;
}

export class LocalGtfsStore {
  stops = new Map<string, StoreStop>();
  routes = new Map<string, GtfsRoute>();
  trips = new Map<string, GtfsTrip>();
  stopTimes = new Map<string, GtfsStopTime[]>();
  footpaths = new Map<string, Footpath[]>();

  /** Źródło danych: miasto (default) albo ogólnopolska baza kolejowa. */
  private backend: GtfsStoreBackend;

  constructor(backend: GtfsStoreBackend = cityBackend()) {
    this.backend = backend;
  }

  private getDb(): Promise<GtfsDbHandle> {
    return this.backend.getDb();
  }

  private getActiveServices(weekday: number, dateStr?: string): Promise<Set<string>> {
    return this.backend.getActiveServices(weekday, dateStr);
  }

  private get cableEnabled(): boolean {
    return this.backend.cable;
  }

  private get rustStopIndex(): boolean {
    return this.backend.rustStopIndex;
  }

  private dayIndexes = new Map<string, DayIndex>();
  /** Wycinki horyzontu (szybkie): klucz dzien+kubelki godzin, max 4 w pamięci. */
  private sliceIndexes = new Map<string, DayIndex>();
  private slicePromises = new Map<string, Promise<DayIndex>>();
  /**
   * Zbudowany horyzont wycinka [from, to] (z marginesami kubelków). Wycinek
   * pokrywający szersze zapytanie może je obsłużyć bez przebudowy i bez nowej
   * kompilacji sieci RAPTOR-a, np. wycinek z rozgrzewki na "teraz" obsługuje
   * wyszukiwanie z godzinę później, mimo innej godziny w kluczu.
   */
  private sliceHorizons = new WeakMap<DayIndex, { from: number; to: number }>();
  // Liczenie referencji kursów per wycinek: kurs bywa we wielu wycinkach, więc
  // `trips`/`stopTimes` zwalniamy dopiero, gdy ostatni wycinek go puści.
  private sliceTripIds = new Map<string, string[]>();
  private tripRefs = new Map<string, Set<string>>();
  // Kursy z pełnego indeksu dnia trzymamy na stałe (nie są zwalniane przez
  // ewangelizację wycinków, która dotyczy wyłącznie sliceIndexes).
  private retainedTrips = new Set<string>();
  private rustStopIds: string[] = [];
  private rustStopCount = -1;
  // Lekki grid przestrzenny dla ścieżki JS (polskaStore / brak indeksu Rusta).
  private jsStopGrid: Map<number, StoreStop[]> | null = null;
  private jsStopGridSize = -1;
  // Schemat bazy i kolejność refów stopów (patrz buildSlice).
  private tripBlobSchema: boolean | null = null;
  private stopRefsCache: string[] | null = null;
  isLoaded = false;
  /** Wspólny load w locie: ekrany startują równolegle, a bazę czytamy raz. */
  private loadPromise: Promise<void> | null = null;
  /** Podbijane przy resecie: wycinki budowane wcześniej nie trafiają do cache. */
  private generation = 0;
  get currentGeneration(): number { return this.generation; }

  /**
   * Czyści pamięć podręczną po imporcie (seed / sieć): bez tego store
   * załadowany na pustej bazie zostaje pusty aż do restartu apki.
   */
  reset(): void {
    this.stops.clear();
    this.routes.clear();
    this.trips.clear();
    this.stopTimes.clear();
    this.footpaths.clear();
    this.dayIndexes.clear();
    this.sliceIndexes.clear();
    this.slicePromises.clear();
    this.sliceTripIds.clear();
    this.tripRefs.clear();
    this.retainedTrips.clear();
    this.rustStopIds = [];
    this.rustStopCount = -1;
    this.jsStopGrid = null;
    this.jsStopGridSize = -1;
    this.tripBlobSchema = null;
    this.stopRefsCache = null;
    this.isLoaded = false;
    this.loadPromise = null;
    this.generation++;
    clearRaptorNetCache();
  }

  /**
   * Ładuje przystanki, trasy i przesiadki aktywnej bazy. Wywołania z wielu
   * ekranów dzielą jeden przebieg: bez tego start apki i zmiana miasta
   * uruchamiały 6 równoległych odczytów i sześć razy liczyły przesiadki.
   */
  load(): Promise<void> {
    if (this.isLoaded) return Promise.resolve();
    if (this.loadPromise) return this.loadPromise;
    const p = this.loadOnce();
    this.loadPromise = p;
    p.then(
      () => {
        if (this.loadPromise === p) this.loadPromise = null;
      },
      () => {
        if (this.loadPromise === p) this.loadPromise = null;
      },
    );
    return p;
  }

  private async loadOnce(): Promise<void> {
    // Import/podmiana w toku = sklep musi zostać pusty do jego końca (reset()
    // czyści go na końcu). Bez czekania load() wracał „wstecz" z pustymi
    // przystankami, a planer oddawał zero połączeń zamiast „rozkład się
    // importuje" - ekran pokazywał wtedy „nie znaleziono połączeń".
    if (this.backend.isImporting()) {
      await this.backend.awaitReady();
      if (this.isLoaded) return;
    }
    console.log(`[LocalGtfsStore] Initializing (${this.backend.cable ? 'miasto' : 'polska'})...`);
    if (this.backend.isImporting()) return;
    await this.backend.awaitReady();
    const generation = this.generation;
    const db = await this.getDb();

    // Dane lądują w lokalnych mapach i trafiają do sklepu dopiero na końcu.
    // Zmiana miasta w trakcie czytania unieważnia wynik (generation): stary
    // load nie może podmienić map nowego miasta ani zostawić mieszanki dwóch
    // baz, bo przystanki obu feedów mają te same id.
    const stops = new Map<string, StoreStop>();
    const routes = new Map<string, GtfsRoute>();
    const footpaths = new Map<string, Footpath[]>();

    // 1. Load stops (ORDER BY stop_id wykorzystuje klucz główny i od razu daje kolejność stopRefs).
    const stopsRows = await db.getAllAsync<{stop_id: string, code: string, name: string, lat: number, lon: number, norm: string}>('SELECT * FROM stops ORDER BY stop_id');
    const stopRefs = new Array<string>(stopsRows.length);
    for (let i = 0; i < stopsRows.length; i++) {
      const r = stopsRows[i];
      stopRefs[i] = r.stop_id;
      stops.set(r.stop_id, {
        stop_id: r.stop_id,
        stop_code: r.code,
        stop_name: r.name,
        stop_lat: r.lat,
        stop_lon: r.lon,
        normalized_name: r.norm
      });
    }

    // 2. Load routes
    const routesRows = await db.getAllAsync<{route_id: string, short: string, long_name: string, type: number}>('SELECT * FROM routes');
    for (const r of routesRows) {
      routes.set(r.route_id, {
        route_id: r.route_id,
        route_short_name: r.short,
        route_long_name: r.long_name,
        route_type: r.type
      });
    }

    if (generation !== this.generation) return;

    // 3. Kolej linowa Polinka: stacje i linia zanim powstaną przesiadki
    // (tylko miasta z koleją linową, Kraków jej nie ma i nie dostaje atrapy)
    if (this.cableEnabled) this.injectPolinkaStopsAndRoute(stops, routes);

    // 4. Przesiadki piesze: blob z buildera (liczony natywnie w buildzie), a gdy
    // go nie ma, dawny grid w JS. Miasta z koleją linową zostają na JS, bo
    // stacje Polinki dokładamy dopiero tutaj i nie ma ich w blobie.
    let footpathsFromBlob = false;
    if (!this.cableEnabled) {
      footpathsFromBlob = await this.loadFootpathsBlob(db, stops, footpaths, stopRefs).catch((err) => {
        console.warn('[LocalGtfsStore] footpaths blob nie wyszedł, liczę w JS:', err);
        return false;
      });
    }
    if (!footpathsFromBlob) this.buildFootpaths(stops, footpaths);

    if (generation !== this.generation) return;

    // 5. Przesiadki na pociągi (tabela z prebuilt; brak = baza bez KD)
    await this.loadInterchanges(db, stops, footpaths).catch(() => {});

    if (generation !== this.generation) return;
    this.stops = stops;
    this.routes = routes;
    this.footpaths = footpaths;
    this.stopRefsCache = stopRefs;
    this.isLoaded = true;
    console.log(`[LocalGtfsStore] Loaded ${this.stops.size} stops, ${this.routes.size} routes.`);
  }

/**
   * Polinka to kolej uczelniana, nie MPK, więc nie ma jej w GTFS i dokładamy
   * stacje i linię syntetycznie. Wstrzyknięcie PRZED buildFootpaths jest
   * kluczowe: grid przesiadek traktuje stacje Polinki jak zwykłe przystanki
   * i sam podepina pod nie najbliższe słupki MPK (przy Urzędzie Wojewódzkim
   * i Poczcie Głównej obok Na Grobli, przy Wyspiańskiego przy C-13) w realnych
   * odległościach, bez ręcznie spisanych linków.
   */
  private injectPolinkaStopsAndRoute(
    stops = this.stops,
    routes = this.routes,
  ): void {
    for (const s of polinkaStops()) {
      if (stops.has(s.stop_id)) continue;
      stops.set(s.stop_id, s);
    }
    if (!routes.has(POLINKA_ROUTE_ID)) {
      routes.set(POLINKA_ROUTE_ID, polinkaRoute());
    }
  }

  /**
   * Kursy Polinki nachodzące na horyzont [fromSec, toSec], w formacie GTFS,
   * więc buildPatterns traktuje je jak każdy inny wzorzec i RAPTOR nie wie,
   * że to nie MPK.
   *
   * Dni: Polinka jeździ pon.–pt. W dni bez aktywnego serwisu MPK (święta)
   * wycnek kończy się wcześniej, więc Polinka też nie wjeżdża. Wyjątek
   * świąteczny, na który MPK uruchamia kursy dodatkowe, zostaje pominięty:
   * bez kalendarza świątecznego w bazie nie odróżnimy go od dnia zwykłego.
   */
  private injectPolinkaTrips(
    day: number,
    fromSec: number,
    toSec: number,
  ): { tripIds: string[]; byRouteId: Map<string, GtfsTrip[]> } {
    const empty = { tripIds: [] as string[], byRouteId: new Map<string, GtfsTrip[]>() };
    if (!this.cableEnabled) return empty;
    if (day < 1 || day > 5) return empty;

    const bundles = polinkaTripsOverlapping(fromSec, toSec);
    if (bundles.length === 0) return empty;

    const group: GtfsTrip[] = [];
    const tripIds: string[] = [];
    for (const b of bundles) {
      this.trips.set(b.trip.trip_id, b.trip);
      this.stopTimes.set(b.trip.trip_id, b.times);
      group.push(b.trip);
      tripIds.push(b.trip.trip_id);
    }
    return { tripIds, byRouteId: new Map([[POLINKA_ROUTE_ID, group]]) };
  }

  private buildFootpaths(
    stops = this.stops,
    footpaths = this.footpaths,
  ) {
    const GRID_DEG_LAT = 0.001;
    const GRID_DEG_LON = 0.0015;
    // Liczbowy klucz komórki siatki eliminuje ~700 tys. alokacji stringów na starcie.
    const cellKey = (gx: number, gy: number) => (gy + 100000) * 262144 + (gx + 100000);

    const grid = new Map<number, StoreStop[]>();
    const stopArray: StoreStop[] = [];
    for (const stop of stops.values()) {
      if (!isFareBoundary(stop.stop_name ?? '')) stopArray.push(stop);
    }

    for (let i = 0; i < stopArray.length; i++) {
      const s = stopArray[i];
      const gx = Math.floor(s.stop_lon / GRID_DEG_LON);
      const gy = Math.floor(s.stop_lat / GRID_DEG_LAT);
      const key = cellKey(gx, gy);
      let cell = grid.get(key);
      if (!cell) {
        cell = [];
        grid.set(key, cell);
      }
      cell.push(s);
    }

    const SEARCH_RADIUS = 8;
    const MAX_DLAT = 0.0075;
    const MAX_DLON = 0.014;
    const invSpeed = WALK_DETOUR_FACTOR / WALK_SPEED_MPS;

    for (let i = 0; i < stopArray.length; i++) {
      const s1 = stopArray[i];
      const paths: Footpath[] = [];
      const gx = Math.floor(s1.stop_lon / GRID_DEG_LON);
      const gy = Math.floor(s1.stop_lat / GRID_DEG_LAT);
      const lat1 = s1.stop_lat;
      const lon1 = s1.stop_lon;

      for (let dx = -SEARCH_RADIUS; dx <= SEARCH_RADIUS; dx++) {
        for (let dy = -SEARCH_RADIUS; dy <= SEARCH_RADIUS; dy++) {
          const cell = grid.get(cellKey(gx + dx, gy + dy));
          if (!cell) continue;

          for (let j = 0; j < cell.length; j++) {
            const s2 = cell[j];
            if (s1.stop_id === s2.stop_id) continue;
            if (Math.abs(lat1 - s2.stop_lat) > MAX_DLAT || Math.abs(lon1 - s2.stop_lon) > MAX_DLON) continue;
            const dist = distanceMeters(lat1, lon1, s2.stop_lat, s2.stop_lon);
            if (dist <= MAX_TRANSFER_METERS) {
              paths.push({
                from_stop_id: s1.stop_id,
                to_stop_id: s2.stop_id,
                distance_m: Math.round(dist),
                duration_sec: Math.max(MIN_FOOTPATH_SEC, Math.round(dist * invSpeed)),
              });
            }
          }
        }
      }

      if (paths.length > 0) {
        footpaths.set(s1.stop_id, paths);
      }
    }
  }

  /**
   * Przesiadki MPK<->KD z tabeli `interchanges` (liczone w buildzie, bo
   * stacja kolejowa to nie słupek: perony, hala, schody). Doklejamy je do
   * footpaths i ZASTĘPUJEMY nimi gridowe linki między tymi samymi parami-
   * grid liczy sam dystans w linii prostej, bez zapasu na peron.
   * Stare bazy (legacy ZIP, bez tabeli i bez pociągów) przechodzą cicho.
   */
  private async loadInterchanges(
    db: GtfsDbHandle,
    stops = this.stops,
    footpaths = this.footpaths,
  ): Promise<void> {
    let rows: { from_stop_id: string; to_stop_id: string; walk_sec: number }[] = [];
    try {
      rows = await db.getAllAsync('SELECT from_stop_id, to_stop_id, walk_sec FROM interchanges');
    } catch {
      return;
    }
    let applied = 0;
    for (const r of rows) {
      if (!stops.has(r.from_stop_id) || !stops.has(r.to_stop_id)) continue;
      const dur = Math.max(30, Math.round(r.walk_sec));
      const distM = Math.round(dur * 1.3);
      for (const [from, to] of [
        [r.from_stop_id, r.to_stop_id],
        [r.to_stop_id, r.from_stop_id],
      ] as const) {
        const list = footpaths.get(from) ?? [];
        const filtered = list.filter((fp) => fp.to_stop_id !== to);
        filtered.push({ from_stop_id: from, to_stop_id: to, distance_m: distM, duration_sec: dur, fixed: true });
        footpaths.set(from, filtered);
      }
      applied++;
    }
    if (applied > 0) console.log(`[LocalGtfsStore] Interchanges MPK<->KD: ${applied}.`);
  }

  /** route_ids dla oznaczenia linii ("4", "K") - case-insensitive. */
  getRouteIdsByShortName(shortName: string): string[] {
    const key = shortName.trim().toUpperCase();
    const out: string[] = [];
    for (const [id, r] of this.routes.entries()) {
      if (String(r.route_short_name ?? '').trim().toUpperCase() === key) out.push(id);
    }
    return out;
  }

  /**
   * Wycinkowy indeks na horyzont [fromSec, toSec] (sekundy, mogą >86400).
   * Ładuje tylko kursy nachodzące na horyzont - ~6× mniej wierszy przez mostek
   * JS niż pełny indeks dobowy. Cache kubelkowany po godzinach (max 4).
   */
  async getDayIndexSlice(
    weekday: number,
    dateStr: string | undefined,
    fromSec: number,
    toSec: number,
  ): Promise<DayIndex> {
    const day = ((weekday % 7) + 7) % 7;
    const qFrom = Math.floor(fromSec / 3600);
    const qTo = Math.floor(toSec / 3600);
    const cacheKey = `${day}|${dateStr ?? ''}|${qFrom}|${qTo}`;
    const hit = this.sliceIndexes.get(cacheKey);
    if (hit) {
      // LRU: odśwież kolejność
      this.sliceIndexes.delete(cacheKey);
      this.sliceIndexes.set(cacheKey, hit);
      return hit;
    }
    const inFlight = this.slicePromises.get(cacheKey);
    if (inFlight) return inFlight;

    // Wycinek, który budował SZERSZY horyzont (np. rozgrzewka godzinę
    // wcześniej), obsługuje to zapytanie bez przebudowy. Bez tego pierwsze
    // wyszukiwanie po przekroczeniu kubłka płaci za nowy SQL, buildPatterns,
    // pakowanie sieci i wczytanie jej do Rusta, choć dane już leżą w pamięci.
    const wantFrom = qFrom * 3600 - 1800;
    const wantTo = (qTo + 1) * 3600 + 1800;
    const dayPrefix = `${day}|${dateStr ?? ''}|`;
    for (const [key, idx] of this.sliceIndexes) {
      if (!key.startsWith(dayPrefix)) continue;
      const horizon = this.sliceHorizons.get(idx);
      if (!horizon || horizon.from > wantFrom || horizon.to < wantTo) continue;
      // LRU: odśwież kolejność, żeby wybrany wycinek nie wyleciał z LRU (≤4 wpisy).
      this.sliceIndexes.delete(key);
      this.sliceIndexes.set(key, idx);
      return idx;
    }

    const promise = this.buildSlice(day, dateStr, qFrom, qTo).finally(() => {
      this.slicePromises.delete(cacheKey);
    });
    this.slicePromises.set(cacheKey, promise);
    return promise;
  }

  private async buildSlice(
    day: number,
    dateStr: string | undefined,
    qFrom: number,
    qTo: number,
  ): Promise<DayIndex> {
    const cacheKey = `${day}|${dateStr ?? ''}|${qFrom}|${qTo}`;
    const genAtStart = this.generation;
    // Wycinek budujemy z marginesem całego kubła - zapytania z tej samej
    // godziny (i ticker co minutę) trafiają w ten sam klucz.
    const bFrom = qFrom * 3600 - 1800;
    const bTo = (qTo + 1) * 3600 + 1800;
    const t0 = performance.now();

    const emptyIdx: DayIndex = {
      stopRoutes: new Map(), routeStops: new Map(), routeTrips: new Map(), patterns: new Map(),
    };
    if (this.backend.isImporting()) return emptyIdx;
    const activeServices = await this.getActiveServices(day, dateStr);
    if (this.generation !== genAtStart) return emptyIdx;
    const db = await this.getDb();
    if (this.generation !== genAtStart) return emptyIdx;
    const serviceIds = Array.from(activeServices);
    if (serviceIds.length === 0) {
      this.rememberSlice(cacheKey, emptyIdx, genAtStart);
      // Pusty wycinek (np. noc, brak serwisów) nadaje się tylko na dokładnie
      // swój klucz - pokrycia nie rejestrujemy, żeby inny horyzont go nie
      // uznał za wystarczający.
      this.sliceHorizons.delete(emptyIdx);
      return emptyIdx;
    }
    const servicePlaceholders = serviceIds.map(() => '?').join(',');

    // Polinkę dokładamy obok: ten sam warunek przecięcia horyzontu, bez SQL-a.
    const polinka = this.injectPolinkaTrips(day, bFrom, bTo);
    const tripsByRouteId = new Map<string, GtfsTrip[]>();
    const tripIds: string[] = [];
    const tripPatternMeta = new Map<string, { key: string; stopIds: string[] }>();

    if (await this.hasTripBlobs(db)) {
      if (this.generation !== genAtStart) return emptyIdx;
      const stopRefs = await this.getStopRefs(db);
      if (this.generation !== genAtStart) return emptyIdx;
      const missing: string[] = [];
      // Wiele kursów współdzieli ten sam seq_blob: dekodujemy sekwencję raz na wzorzec.
      const seqCache = new Map<string, { key: string; stopIds: string[] }>();
      // Czytamy kursy stronami po rowid: jedno zapytanie na 5 tys. wierszy z trzema
      // hex-blobami zamrażało wątek JS podczas deserializacji mostka i wywoływało GC spike.
      let lastRowId = 0;
      let sliceStart = performance.now();
      while (true) {
        const rows = await db.getAllAsync<{
          _rowid?: number;
          trip_id: string;
          route_id: string;
          service_id: string;
          headsign: string;
          direction: number;
          shape: string;
          seq_blob: string | null;
          arr_blob: string | null;
          dep_blob: string | null;
        }>(
          `SELECT rowid AS _rowid, trip_id, route_id, service_id, headsign, direction, shape,
                  CASE WHEN seq_blob IS NOT NULL THEN hex(seq_blob) END AS seq_blob,
                  CASE WHEN arr_blob IS NOT NULL THEN hex(arr_blob) END AS arr_blob,
                  CASE WHEN dep_blob IS NOT NULL THEN hex(dep_blob) END AS dep_blob
           FROM trips
           WHERE service_id IN (${servicePlaceholders}) AND start_sec <= ? AND end_sec >= ? AND rowid > ?
           ORDER BY rowid
           LIMIT ${TRIP_BLOB_PAGE_SIZE}`,
          ...serviceIds,
          bTo,
          bFrom,
          lastRowId,
        );
        if (this.generation !== genAtStart) return emptyIdx;
        if (rows.length === 0) break;
        for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
          const r = rows[rowIdx];
          const t = {
            trip_id: r.trip_id,
            route_id: r.route_id,
            service_id: r.service_id,
            trip_headsign: r.headsign,
            direction_id: r.direction,
            shape_id: r.shape,
          };
          this.trips.set(r.trip_id, t);
          let group = tripsByRouteId.get(r.route_id);
          if (!group) {
            group = [];
            tripsByRouteId.set(r.route_id, group);
          }
          group.push(t);
          tripIds.push(r.trip_id);
          if (r.seq_blob !== null && r.arr_blob !== null && r.dep_blob !== null) {
            let seqEntry = seqCache.get(r.seq_blob);
            if (!seqEntry) {
              const nSeq = r.seq_blob.length >>> 3;
              const stopIds = new Array<string>(nSeq);
              for (let i = 0; i < nSeq; i++) {
                stopIds[i] = stopRefs[readInt32HexAt(r.seq_blob, i)];
              }
              seqEntry = { key: stopIds.join(','), stopIds };
              seqCache.set(r.seq_blob, seqEntry);
            }
            const stopIds = seqEntry.stopIds;
            const n = Math.min(stopIds.length, r.arr_blob.length >>> 3, r.dep_blob.length >>> 3);
            const times = new Array<GtfsStopTime>(n);
            const arrHex = r.arr_blob;
            const depHex = r.dep_blob;
            for (let i = 0; i < n; i++) {
              times[i] = {
                trip_id: r.trip_id,
                stop_id: stopIds[i],
                arrival_sec: readInt32HexAt(arrHex, i),
                departure_sec: readInt32HexAt(depHex, i),
                stop_sequence: i,
              };
            }
            this.stopTimes.set(r.trip_id, times);
            if (n === stopIds.length) {
              tripPatternMeta.set(r.trip_id, seqEntry);
            }
          } else {
            // Kurs bez bloba (nieznany stop_id w buildzie): stara ścieżka.
            missing.push(r.trip_id);
          }
          if ((rowIdx & 31) === 31 && performance.now() - sliceStart >= UI_YIELD_BUDGET_MS) {
            await yieldToUiFrame();
            sliceStart = performance.now();
            // Reset/import mógł wyczyścić mapy w trakcie porcji.
            if (this.generation !== genAtStart) return emptyIdx;
          }
        }
        const tailRowId = rows[rows.length - 1]._rowid;
        if (rows.length < TRIP_BLOB_PAGE_SIZE || tailRowId == null || tailRowId <= lastRowId) {
          break;
        }
        lastRowId = tailRowId;
        await yieldToUiFrame();
        sliceStart = performance.now();
        if (this.generation !== genAtStart) return emptyIdx;
      }
      if (missing.length > 0) {
        await this.loadStopTimesChunked(db, missing);
        if (this.generation !== genAtStart) return emptyIdx;
      }
    } else {
      // Stara ścieżka (bazy bez indeksu czasowego): agregacja natywnie w SQL,
      // potem szczegóły kursów + czasy porcjami (IN z tysiącami id dławi mostek).
      const overlapping = await db.getAllAsync<{ trip_id: string }>(
        `SELECT st.trip_id AS trip_id
         FROM stop_times st
         JOIN trips t ON st.trip_id = t.trip_id
         WHERE t.service_id IN (${servicePlaceholders})
         GROUP BY st.trip_id
         HAVING MIN(st.dep_sec) <= ? AND MAX(st.arr_sec) >= ?`,
        ...serviceIds,
        bTo,
        bFrom,
      );
      if (this.generation !== genAtStart) return emptyIdx;
      for (const r of overlapping) tripIds.push(r.trip_id);

      const CHUNK = 400;
      for (let i = 0; i < tripIds.length; i += CHUNK) {
        const chunk = tripIds.slice(i, i + CHUNK);
        const placeholders = chunk.map(() => '?').join(',');
        const tripsRows = await db.getAllAsync<{trip_id: string, route_id: string, service_id: string, headsign: string, direction: number, shape: string}>(
          `SELECT trip_id, route_id, service_id, headsign, direction, shape FROM trips WHERE trip_id IN (${placeholders})`,
          ...chunk,
        );
        if (this.generation !== genAtStart) return emptyIdx;
        for (const r of tripsRows) {
          const t = {
            trip_id: r.trip_id,
            route_id: r.route_id,
            service_id: r.service_id,
            trip_headsign: r.headsign,
            direction_id: r.direction,
            shape_id: r.shape,
          };
          this.trips.set(r.trip_id, t);
          let group = tripsByRouteId.get(r.route_id);
          if (!group) {
            group = [];
            tripsByRouteId.set(r.route_id, group);
          }
          group.push(t);
        }
        await this.loadStopTimesChunked(db, chunk);
        if (this.generation !== genAtStart) return emptyIdx;
      }
    }

    if (tripIds.length === 0 && polinka.tripIds.length === 0) {
      this.rememberSlice(cacheKey, emptyIdx, genAtStart);
      return emptyIdx;
    }

    if (this.generation !== genAtStart) return emptyIdx;

    // Kolejność kursów i linii w patternach ustala kolejność wierszy z SQL (plan
    // zapytania bywa różny między bazami/urządzeniami), a od niej zależy numeracja
    // p0/p1... i kolejność wzorców w sieci RAPTOR-a, więc i dobór równorzędnych
    // połączeń w wyniku. Sortowanie daje ten sam wynik wszędzie.
    let sortSliceStart = performance.now();
    let sortedGroups = 0;
    for (const group of tripsByRouteId.values()) {
      group.sort((a, b) => (a.trip_id < b.trip_id ? -1 : a.trip_id > b.trip_id ? 1 : 0));
      if ((++sortedGroups & 31) === 0 && performance.now() - sortSliceStart >= UI_YIELD_BUDGET_MS) {
        await yieldToUiFrame();
        sortSliceStart = performance.now();
        if (this.generation !== genAtStart) return emptyIdx;
      }
    }
    const sortedByRoute = new Map(
      [...tripsByRouteId.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)),
    );

    const idx = await this.buildPatternsAsync(
      mergePolinkaTrips(sortedByRoute, polinka.byRouteId),
      tripPatternMeta.size > 0 ? tripPatternMeta : undefined,
    );
    if (this.generation !== genAtStart) return emptyIdx;
    this.registerSliceTrips(cacheKey, [...tripIds, ...polinka.tripIds]);
    this.rememberSlice(cacheKey, idx, genAtStart);
    if (genAtStart === this.generation) this.sliceHorizons.set(idx, { from: bFrom, to: bTo });
    console.log(`[LocalGtfsStore] Slice ${cacheKey} in ${(performance.now() - t0).toFixed(0)} ms. Trips: ${tripIds.length + polinka.tripIds.length}`);
    return idx;
  }

  /** Czy baza ma blob wzorca kursu (nowy builder); wynik cache'owany na sesję. */
  private async hasTripBlobs(db: GtfsDbHandle): Promise<boolean> {
    if (this.tripBlobSchema === null) {
      try {
        const cols = await db.getAllAsync<{ name: string }>('PRAGMA table_info(trips)');
        this.tripBlobSchema = cols.some((c) => c.name === 'seq_blob');
      } catch {
        this.tripBlobSchema = false;
      }
    }
    return this.tripBlobSchema;
  }

  /** Refy stopów: pozycja stop_id po `ORDER BY stop_id` (tak numeruje builder). */
  private async getStopRefs(db: GtfsDbHandle): Promise<string[]> {
    if (!this.stopRefsCache) {
      const rows = await db.getAllAsync<{ stop_id: string }>('SELECT stop_id FROM stops ORDER BY stop_id');
      this.stopRefsCache = rows.map((r) => r.stop_id);
    }
    return this.stopRefsCache;
  }

  /**
   * Przesiadki piesze z buildera: jeden blob zamiast siatki 17×17 liczonej
   * wokół każdego przystanku na starcie. false = brak blobu (stara baza albo
   * inna wersja danych) i wołający liczy po staremu.
   */
  private async loadFootpathsBlob(
    db: GtfsDbHandle,
    stops: Map<string, StoreStop>,
    footpaths: Map<string, Footpath[]>,
    knownStopRefs?: string[],
  ): Promise<boolean> {
    const row = await db.getFirstAsync<{ blob: Uint8Array | ArrayBuffer }>(
      'SELECT blob FROM footpaths WHERE id = 1',
    );
    if (!row?.blob) return false;
    const bytes = row.blob instanceof Uint8Array ? row.blob : new Uint8Array(row.blob);
    if (bytes.byteLength < 8) return false;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let w = 0;
    if (view.getUint32(w, true) !== 0x464f4f54) return false;
    w += 4;
    const stopCount = view.getUint32(w, true);
    w += 4;
    // Inna liczba przystanków niż w bazie = blob z innej wersji danych.
    if (stopCount !== stops.size) return false;
    const stopRefs =
      knownStopRefs && knownStopRefs.length === stops.size
        ? knownStopRefs
        : (
            await db.getAllAsync<{ stop_id: string }>(
              'SELECT stop_id FROM stops ORDER BY stop_id',
            )
          ).map((r) => r.stop_id);
    while (w + 8 <= bytes.byteLength) {
      const fromRef = view.getInt32(w, true);
      w += 4;
      const n = view.getInt32(w, true);
      w += 4;
      const fromId = stopRefs[fromRef];
      if (fromId === undefined || n < 0 || w + n * 12 > bytes.byteLength) {
        footpaths.clear();
        return false;
      }
      const list = new Array<Footpath>(n);
      for (let i = 0; i < n; i++) {
        const toRef = view.getInt32(w, true);
        const distance_m = view.getInt32(w + 4, true);
        const duration_sec = view.getInt32(w + 8, true);
        w += 12;
        list[i] = { from_stop_id: fromId, to_stop_id: stopRefs[toRef], distance_m, duration_sec };
      }
      if (!isFareBoundary(stops.get(fromId)?.stop_name ?? '')) {
        footpaths.set(fromId, list.filter((path) => !isFareBoundary(stops.get(path.to_stop_id)?.stop_name ?? '')));
      }
    }
    console.log(`[LocalGtfsStore] Footpaths z bloba: ${footpaths.size} przystanków.`);
    return true;
  }

  /** Wczytuje stop_times porcjami do mapy kursów (nadpisuje wpisy). */
  private async loadStopTimesChunked(
    db: GtfsDbHandle,
    ids: string[],
  ): Promise<void> {
    const CHUNK = 400;
    for (let i = 0; i < ids.length; i += CHUNK) {
      const chunk = ids.slice(i, i + CHUNK);
      const placeholders = chunk.map(() => '?').join(',');
      const stRows = await db.getAllAsync<{trip_id: string, stop_id: string, arr_sec: number, dep_sec: number, seq: number}>(
        `SELECT trip_id, stop_id, arr_sec, dep_sec, seq FROM stop_times WHERE trip_id IN (${placeholders}) ORDER BY trip_id, seq`,
        ...chunk,
      );
      this.ingestStopTimeRows(stRows);
    }
  }

  /**
   * Wrzuca wiersze stop_times do mapy kursów. Zastępujemy, nie dopisujemy: te
   * same kursy trafiają do kolejnych wycinków (o innej godzinie), a dopisanie
   * duplikowało wiersze stop_times. Wzorzec budowany z podwojonej sekwencji
   * przystanków psuł RAPTOR-a (wsiądź i wysiądź na tym samym przystanku),
   * a wszystkie podróże leciały do odrzucenia jako bezsensowne.
   */
  private ingestStopTimeRows(
    rows: { trip_id: string; stop_id: string; arr_sec: number; dep_sec: number; seq: number }[],
  ): void {
    const timesByTrip = new Map<string, GtfsStopTime[]>();
    for (const r of rows) {
      let group = timesByTrip.get(r.trip_id);
      if (!group) {
        group = [];
        timesByTrip.set(r.trip_id, group);
      }
      group.push({
        trip_id: r.trip_id,
        stop_id: r.stop_id,
        arrival_sec: r.arr_sec,
        departure_sec: r.dep_sec,
        stop_sequence: r.seq,
      });
    }
    for (const [tripId, group] of timesByTrip) {
      this.stopTimes.set(tripId, group);
    }
  }

  /** Rejestruje kursy wycinka w liczeniu referencji (patrz releaseSlice). */
  private registerSliceTrips(key: string, tripIds: string[]): void {
    this.sliceTripIds.set(key, tripIds);
    for (const id of tripIds) {
      let refs = this.tripRefs.get(id);
      if (!refs) {
        refs = new Set();
        this.tripRefs.set(id, refs);
      }
      refs.add(key);
    }
  }

  /** Zwalnia kursy wycinka; usuwa je dopiero, gdy żaden wycinek ich nie trzyma. */
  private releaseSlice(key: string): void {
    const ids = this.sliceTripIds.get(key);
    if (!ids) return;
    this.sliceTripIds.delete(key);
    for (const id of ids) {
      const refs = this.tripRefs.get(id);
      if (!refs) continue;
      refs.delete(key);
      if (refs.size === 0) {
        this.tripRefs.delete(id);
        if (!this.retainedTrips.has(id)) {
          this.trips.delete(id);
          this.stopTimes.delete(id);
        }
      }
    }
  }

  private rememberSlice(key: string, idx: DayIndex, gen: number): void {
    // Reset/import w trakcie budowania: stary wycinek do pamięci nowego miasta
    // nie skacze (po resecie zapytania budują świeży).
    if (gen !== this.generation) return;
    this.sliceIndexes.set(key, idx);
    if (this.sliceIndexes.size > 4) {
      const oldest = this.sliceIndexes.keys().next().value;
      if (oldest) {
        this.sliceIndexes.delete(oldest);
        this.releaseSlice(oldest);
      }
    }
  }

  /**
   * Buduje patterns/stopRoutes z mapy kursów (wspólne dla indeksu i wycinków).
   * Wersja sync dla testów; buildSlice używa kroków z yieldami, bo na 7 tys.
   * kursów sama pętla blokowała JS thread na kilka sekund.
   */
  private buildPatterns(tripsByRouteId: Map<string, GtfsTrip[]>): DayIndex {
    const steps = this.buildPatternSteps(tripsByRouteId);
    let next = steps.next();
    while (!next.done) next = steps.next();
    return next.value;
  }

  /** Wersja przepuszczająca kolejkę JS między porcjami (dla buildSlice). */
  private async buildPatternsAsync(
    tripsByRouteId: Map<string, GtfsTrip[]>,
    tripPatternMeta?: Map<string, { key: string; stopIds: string[] }>,
  ): Promise<DayIndex> {
    const steps = this.buildPatternSteps(tripsByRouteId, tripPatternMeta);
    let sliceStart = performance.now();
    let next = steps.next();
    while (!next.done) {
      if (performance.now() - sliceStart >= UI_YIELD_BUDGET_MS) {
        await yieldToUiFrame();
        sliceStart = performance.now();
      }
      next = steps.next();
    }
    return next.value;
  }

  private *buildPatternSteps(
    tripsByRouteId: Map<string, GtfsTrip[]>,
    tripPatternMeta?: Map<string, { key: string; stopIds: string[] }>,
  ): Generator<void, DayIndex, void> {
    const stopRoutes = new Map<string, Set<string>>();
    const routeStops = new Map<string, string[]>();
    const routeTrips = new Map<string, GtfsTrip[]>();
    const patterns = new Map<string, Pattern>();
    let routeIdx = 0;

    for (const [routeId, trips] of tripsByRouteId.entries()) {
      const patternGroups = new Map<string, { trips: GtfsTrip[]; stopIds?: string[] }>();
      for (let tripIdx = 0; tripIdx < trips.length; tripIdx++) {
        const trip = trips[tripIdx];
        const meta = tripPatternMeta?.get(trip.trip_id);
        let key: string;
        let stopIds: string[] | undefined;
        if (meta) {
          if (meta.stopIds.length === 0) continue;
          key = meta.key;
          stopIds = meta.stopIds;
        } else {
          const times = this.stopTimes.get(trip.trip_id);
          if (!times || times.length === 0) continue;
          const seq = new Array<string>(times.length);
          for (let i = 0; i < times.length; i++) seq[i] = times[i].stop_id;
          key = seq.join(',');
          stopIds = seq;
        }
        let group = patternGroups.get(key);
        if (!group) {
          group = { trips: [], stopIds };
          patternGroups.set(key, group);
        }
        group.trips.push(trip);
        if ((tripIdx & 63) === 63) yield;
      }

      let patIdx = 0;
      for (const [stopKey, group] of patternGroups.entries()) {
        const patTrips = group.trips;
        const patternId = `${routeId}_p${patIdx++}`;
        const stopSequence = group.stopIds ?? stopKey.split(',');

        if (patTrips.length > 1) {
          const firstDeps = new Map<string, number>();
          for (let i = 0; i < patTrips.length; i++) {
            const id = patTrips[i].trip_id;
            firstDeps.set(id, this.stopTimes.get(id)![0].departure_sec);
          }
          patTrips.sort((a, b) => firstDeps.get(a.trip_id)! - firstDeps.get(b.trip_id)!);
        }

        // RAPTOR nie czyta pattern.departures/tripIndices (buduje Int32Array w network.ts),
        // więc tablice odjazdów per przystanek powstają leniwie dopiero dla tablicy/alternatyw.
        const stopTimesRef = this.stopTimes;
        let cachedTables: { departures: number[][]; tripIndices: number[][] } | null = null;
        const getTables = () => {
          if (!cachedTables) {
            const seqLen = stopSequence.length;
            const depTables: number[][] = Array.from({ length: seqLen }, () => []);
            const idxTables: number[][] = Array.from({ length: seqLen }, () => []);
            for (let tIdx = 0; tIdx < patTrips.length; tIdx++) {
              const times = stopTimesRef.get(patTrips[tIdx].trip_id);
              if (!times) continue;
              const lim = Math.min(seqLen, times.length);
              for (let sIdx = 0; sIdx < lim; sIdx++) {
                depTables[sIdx].push(times[sIdx].departure_sec);
                idxTables[sIdx].push(tIdx);
              }
            }
            cachedTables = { departures: depTables, tripIndices: idxTables };
          }
          return cachedTables;
        };

        const pattern: Pattern = {
          patternId,
          routeId,
          stopSequence,
          trips: patTrips,
          get departures() {
            return getTables().departures;
          },
          get tripIndices() {
            return getTables().tripIndices;
          },
        };

        patterns.set(patternId, pattern);
        routeStops.set(patternId, stopSequence);
        routeTrips.set(patternId, patTrips);

        for (let i = 0; i < stopSequence.length; i++) {
          const stopId = stopSequence[i];
          let routesSet = stopRoutes.get(stopId);
          if (!routesSet) {
            routesSet = new Set();
            stopRoutes.set(stopId, routesSet);
          }
          routesSet.add(patternId);
        }
      }
      if ((routeIdx++ & 3) === 3) yield;
    }

    return { stopRoutes, routeStops, routeTrips, patterns };
  }

  private syncRustStops(): boolean {
    if (!this.rustStopIndex) return false;
    if (this.rustStopCount === this.stops.size) {
      return this.rustStopIds.length > 0 || this.stops.size === 0;
    }
    const ids: string[] = [];
    const w = new BinaryWriter(32 + this.stops.size * 64);
    const stops = Array.from(this.stops.values()).filter((stop) => !isFareBoundary(stop.stop_name ?? ''));
    w.u32(stops.length);
    for (const stop of stops) {
      ids.push(stop.stop_id);
      w.str(String(stop.stop_id))
        .str(String(stop.stop_code ?? ''))
        .str(String(stop.stop_name ?? ''))
        .f64(Number(stop.stop_lat))
        .f64(Number(stop.stop_lon))
        .i32(Number(stop.weight) || 0);
    }
    const res = invokeRustSync(CMD_LOAD_STOPS, w.finish());
    if (!res || res.byteLength < 4) return false;
    this.rustStopIds = ids;
    this.rustStopCount = this.stops.size;
    return true;
  }

  private getJsStopGrid(): Map<number, StoreStop[]> {
    if (this.jsStopGrid && this.jsStopGridSize === this.stops.size) {
      return this.jsStopGrid;
    }
    const grid = new Map<number, StoreStop[]>();
    const CELL_LAT = 0.008;
    const CELL_LON = 0.012;
    for (const stop of this.stops.values()) {
      if (isFareBoundary(stop.stop_name ?? '')) continue;
      const gx = Math.floor(stop.stop_lon / CELL_LON);
      const gy = Math.floor(stop.stop_lat / CELL_LAT);
      const key = (gy + 100000) * 262144 + (gx + 100000);
      let bucket = grid.get(key);
      if (!bucket) {
        bucket = [];
        grid.set(key, bucket);
      }
      bucket.push(stop);
    }
    this.jsStopGrid = grid;
    this.jsStopGridSize = this.stops.size;
    return grid;
  }

  findNearestStops(lat: number, lon: number, maxDistanceMeters = 800, limit = 12) {
    if (this.syncRustStops()) {
      const w = new BinaryWriter(32);
      w.u8Val(0).f64(lat).f64(lon).f64(maxDistanceMeters).u32(limit);
      const res = invokeRustSync(CMD_STOPS_QUERY, w.finish());
      if (res && res.byteLength >= 4) {
        const r = new BinaryReader(res);
        const count = r.u32();
        const results: { stop: StoreStop; distanceM: number }[] = [];
        for (let i = 0; i < count; i++) {
          const idx = r.u32();
          const distanceM = r.i32();
          const stop = this.stops.get(this.rustStopIds[idx]);
          if (stop) results.push({ stop, distanceM });
        }
        return results;
      }
    }

    const results: { stop: StoreStop; distanceM: number }[] = [];
    const latRange = maxDistanceMeters / 111000;
    const cosLat = Math.max(0.1, Math.cos((lat * Math.PI) / 180));
    const lonRange = maxDistanceMeters / (111000 * cosLat);
    const CELL_LAT = 0.008;
    const CELL_LON = 0.012;
    const minGy = Math.floor((lat - latRange) / CELL_LAT);
    const maxGy = Math.floor((lat + latRange) / CELL_LAT);
    const minGx = Math.floor((lon - lonRange) / CELL_LON);
    const maxGx = Math.floor((lon + lonRange) / CELL_LON);
    const cellCount = (maxGy - minGy + 1) * (maxGx - minGx + 1);

    if (cellCount <= 256) {
      const grid = this.getJsStopGrid();
      for (let gy = minGy; gy <= maxGy; gy++) {
        const rowBase = (gy + 100000) * 262144;
        for (let gx = minGx; gx <= maxGx; gx++) {
          const bucket = grid.get(rowBase + (gx + 100000));
          if (!bucket) continue;
          for (let i = 0; i < bucket.length; i++) {
            const stop = bucket[i];
            if (Math.abs(stop.stop_lat - lat) > latRange) continue;
            if (Math.abs(stop.stop_lon - lon) > lonRange) continue;
            const dist = distanceMeters(lat, lon, stop.stop_lat, stop.stop_lon);
            if (dist <= maxDistanceMeters) {
              results.push({ stop, distanceM: Math.round(dist) });
            }
          }
        }
      }
    } else {
      for (const stop of this.stops.values()) {
        if (isFareBoundary(stop.stop_name ?? '')) continue;
        if (Math.abs(stop.stop_lat - lat) > latRange) continue;
        if (Math.abs(stop.stop_lon - lon) > lonRange) continue;
        const dist = distanceMeters(lat, lon, stop.stop_lat, stop.stop_lon);
        if (dist <= maxDistanceMeters) {
          results.push({ stop, distanceM: Math.round(dist) });
        }
      }
    }

    results.sort((a, b) => a.distanceM - b.distanceM);
    return results.slice(0, limit);
  }
}

/** Magazyn aktywnego miasta (MPK + KD + Polinka). */
export const gtfsStore = new LocalGtfsStore();

/**
 * Magazyn ogólnopolskiej kolei (dataset `polska`). Nigdy nie scalany z
 * gtfsStore: planer intercity liczy nogę kolejową wyłącznie na nim,
 * a nogę miejską wyłącznie na gtfsStore (patrz routing/intercity.ts).
 */
export const polskaStore = new LocalGtfsStore(polskaBackend());
