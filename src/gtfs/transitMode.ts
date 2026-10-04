// Klasyfikacja pojazdu (tramwaj / autobus) z danych GTFS.
//
// ─── Dlaczego NIE zgadujemy po numerze linii ─────────────────────────────────
// `route_type` w routes.txt jest jedynym autorytatywnym źródłem i jest obecny
// w feedzie KAŻDEGO miasta. Numeracja `route_type` różni się jednak między
// operatorami, bo część z nich stosuje rozszerzone typy GTFS (Hierarchical
// Vehicle Type, TPEG):
//
//   Wrocław (Open Data Wrocław, 137 linii) → tramwaj route_type = 0    (oryginalny GTFS)
//   Kraków  (ZTP Kraków,     23+195 linii) → tramwaj route_type = 900  (extended GTFS)
//
// Poprzednia wersja znała wyłącznie `0` i ratowała się heurystyką
// „numer 1–33 = tramwaj” (zapisana pod kątem Wrocławia). W Krakowie łapie ona
// 16 z 23 linii tramwajowych, a 49, 62, 69, 70, 74, 76, 77 pokazywały się jako
// autobusy: zły kolor i ikona, i znikają z filtra „tylko tramwaje”. Ta sama
// heurystyka gubiła zresztą wrocławską linię „0” (warunek `>= 1`).
//
// ─── Kolejność rozstrzygania ────────────────────────────────────────────────
// 1. `routeMode` z definicji miasta — najmocniejszy sygnał, bo wskazuje go
//    sam operator danych. Kraków publikuje osobne archiwa (tramwaje / autobusy),
//    więc sam fakt pochodzenia linii z archiwum `_T` mówi, że to tramwaj.
// 2. `route_type` przez tabelę poniej (oryginalny GTFS + extended GTFS).
// 3. Lista linii-tramwajów z definicji miasta — ostatnia deska ratunku dla
//    feedów, w których `route_type` jest pusty albo zawsze `3`.
// 4. Domyślnie `bus` (zachowanie sprzed refaktoru).

/** Środek transportu w rozumieniu aplikacji (render ikonka, filtr, kolor). */
export type VehicleMode = 'tram' | 'bus';

/**
 * `route_type` = tramwaj / kolej miejska.
 *
 * 0      – oryginalny GTFS: Tram, Streetcar, Light rail
 * 5      – oryginalny GTFS: Cable tram (wąskotorowa kolej linowa)
 * 900–906 – extended GTFS: Tram Service (900 Tram, 901 City, 902 Local,
 *           903 Regional, 904 Sightseeing, 905 Shuttle, 906 All Tram Services)
 *
 * Kraków (ZTP) używa tu `900`. Wrocław używa `0`.
 */
const TRAM_ROUTE_TYPES: ReadonlySet<number> = new Set([
  0,
  5,
  900, 901, 902, 903, 904, 905, 906,
]);

/**
 * `route_type` = autobus (wliczając autobus elektryczny / trollleybus, bo
 * aplikacja nie odróżnia ich ikonką).
 *
 * 3       – oryginalny GTFS: Bus
 * 11      – oryginalny GTFS: Trolleybus
 * 700–716 – extended GTFS: Bus Service (700 Bus, 701 Regional, 702 Express,
 *           703 Stopping, 704 Local, 705 Night, 706 Post, 707 Special Needs,
 *           708 Mobility, 709 Mobility for Registered Disabled,
 *           710 Sightseeing, 711 Shuttle, 712 School, 713 School and Public,
 *           714 Rail Replacement, 715 Demand and Response, 716 All Bus)
 * 800     – extended GTFS: Trolleybus Service
 */
const BUS_ROUTE_TYPES: ReadonlySet<number> = new Set([
  3,
  11,
  700, 701, 702, 703, 704, 705, 706, 707, 708,
  709, 710, 711, 712, 713, 714, 715, 716,
  800,
]);

/**
 * Typ pojazdu po `route_type`, albo `null` gdy typ jest nieznany albo nie
 * dotyczy komunikacji miejskiej (kolej, prom, metro, winda).
 *
 * `null` to nie błąd — to sygnał dla wywołującego, żeby zastosować regułę
 * miasta zamiast zgadywać. Koleje regionalne i promy nie są ani tramwajem, ani
 * autobusem, a aplikacja nie ma dla nich osobnej ikony.
 */
export function modeFromRouteType(routeType: number | null | undefined): VehicleMode | null {
  if (typeof routeType !== 'number' || !Number.isFinite(routeType)) return null;
  const t = Math.trunc(routeType);
  if (TRAM_ROUTE_TYPES.has(t)) return 'tram';
  if (BUS_ROUTE_TYPES.has(t)) return 'bus';
  return null;
}

/** Sygnał o trybie pojazdu nadany przez definicję miasta (patrz `CityFeed.mode`). */
export interface VehicleClassificationInput {
  /** `route_type` prosto z feedu. */
  routeType?: number | null;
  /** Numer/nazwa linii (`route_short_name`) — tylko do podpowiedzi. */
  line?: string | null;
  /**
   * Tryb przypisany archiwum, z którego pochodzi linia. Wygrywa wszystko:
   * operator, który wystawia osobne feedy na tramwaje i autobusy, właśnie
   * w ten sposób mówi „to jest tramwaj”.
   */
  feedMode?: VehicleMode | null;
  /**
   * Numer linii z feedu, z którego pochodzi — potrzebny, żeby dopasować
   * podpowiedź `feedMode` do konkretnej linii (np. gdyby miasto mieszało
   * oba typy w jednym archiwum).
   */
  feedLine?: string | null;
  /** Ostateczna podpowiedź z definicji miasta (lista linii-tramwajów). */
  tramLines?: readonly string[];
}

function normalizeLine(line: string | null | undefined): string {
  return (line ?? '').trim().toUpperCase();
}

/**
 * Pełna klasyfikacja pojazdu dla konkretnego miasta. Kolejność i uzasadnienie
 * w nagłówku pliku.
 */
export function classifyVehicle(input: VehicleClassificationInput): VehicleMode {
  const { routeType, line, feedMode, feedLine, tramLines } = input;
  const cleanLine = normalizeLine(line);

  // 1. Tryb nadany przez definicję archiwum — i tylko dla linii faktycznie
  //    z tego archiwum (gdyby miasto mieszało typy w jednym pliku).
  if (feedMode) {
    if (!feedLine || normalizeLine(feedLine) === cleanLine) return feedMode;
  }

  // 2. `route_type` — prawdziwe źródło, wspólne dla wszystkich miast.
  const fromType = modeFromRouteType(routeType);
  if (fromType) return fromType;

  // 3. Podpowiedź miasta: porównanie numeru linii, nie przedziału liczb.
  //    Numery bywają literowe („N10”, „A”, „K”), a tramwaje dostają numery
  //    spoza zakresu autobusów — dlatego zbiór, nie `1..33`.
  if (tramLines && tramLines.length > 0 && cleanLine) {
    if (tramLines.some((t) => t.trim().toUpperCase() === cleanLine)) return 'tram';
  }

  // 4. Bez sygnałów — autobus, jak przed refaktorem.
  return 'bus';
}
