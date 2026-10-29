// Lokalny tracker pojazdów: poll pozycji (główne źródło: zbiorkom.live, wszędzie)
// + dopasowanie kursów do rozkładu (opóźnienia). Zasilanie RAPTOR-a (tripDelays)
// i flag live w UI. Działa w całości na telefonie, bez serwera pośredniczącego.
// Uzasadnienie przy fetchAll.
//
// Matcher rzutuje pozycję GPS na geometrię trasy kursu (odcinki między
// kolejnymi przystankami) oraz sprawdza oczekiwany czas w rozkładzie.
// Eliminuje to błędy pojazdów w ruchu między przystankami i fałszywe dopasowania.
// Pomiar z feedu weryfikujemy względem GPS i historii pojazdu.

import {
  BinaryReader,
  BinaryWriter,
  CMD_LIVE_LOAD_SCHEDULE,
  CMD_LIVE_MATCH_BATCH,
  invokeRustSync,
} from '../../modules/kilometr-raptor';
import { MPK, WROCLAW_BUS_LINES, WROCLAW_TRAM_LINES } from './gtfsConfig';
import { AppState, type AppStateStatus } from 'react-native';
import { getCity } from '../cities';
import { getActiveCityIdSync } from './cityStore';
import { DayIndex, gtfsStore } from './routing/store';
import { distanceMeters, projectPointToPolyline } from '../gtfs/geo';
import { kvGet, kvSet } from './storage';
import { fetchZbBialystokRows, fetchZbGzmRails, fetchZbGzmRows, fetchZbKd, fetchZbKielceRows, fetchZbKml, fetchZbKrakowRows, fetchZbLodzRails, fetchZbLodzRows, fetchZbLublinRows, fetchZbOlsztynRows, fetchZbOpoleRows, fetchZbPoznanRails, fetchZbPoznanRows, fetchZbRadomRows, fetchZbRzeszowRows, fetchZbSkmtRails, fetchZbSzczecinRows, fetchZbTricityRows, fetchZbWarsawRails, fetchZbWarsawRows, fetchZbWroclawRows, matchZbKd, type ZbKdVehicle } from './zbiorkom';
import type { VehiclePosition } from '../types/models';
import { MAX_DELAY_SEC, MAX_SAMPLE_AGE_MS, sampleTime, matchHints, matchScore, fusedDelay } from './liveQuality';
import { buildRoutingSnapshot, type RoutingSnapshot } from './routing/reliability';
import { normalizeName } from './vehiclePosition';

/**
 * Tempo polla na ekranie. Pomiar feedu zbiorkom.live: treść zmienia się co
 * ~4-30 s, więc 5 s łapie każdą aktualizację (1 s = 5x transferu za te same
 * dane). W tle wolniej, bo tam liczy się bateria.
 */
const POLL_MS = 5000;
/** Tempo polla w tle: apka nieaktywna, ale śledzenie podróży potrzebuje danych. */
const BACKGROUND_POLL_MS = 20000;
/**
 * Dane uznajemy za wartościowe tak długo, ile minęło od ostatniego sukcesu.
 *
 * Wcześniej okno świeżości stało równe interwałowi pollingu (30 s = 30 s), a
 * odstęp między udanymi pollami to POLL_MS plus czas dopasowania. Stan
 * przeskakiwał więc w „stale” tuż przed każdym kolejnym sukcesem i aplikacja
 * regularnie pokazywała „brak danych live”, choć dane były. Teraz granica jest
 * niezależna od interwału i do tego dużo wyższa, więc toleruje kilka zawodnych
 * polli z rzędu zamiast gasić live po pierwszym potknięciu.
 */
const GIVE_UP_MS = 150000;
/** Ile sekund w tył i przód wokół „teraz" bierzemy kursy z rozkładu. */
const WINDOW_SEC = MAX_DELAY_SEC + 3600;
const MAX_CORRIDOR_DIST_M = 350;
const DELAY_CAP_SEC = MAX_DELAY_SEC;
/** Ostatni udany snapshot na dysku, żeby restart apki nie startował od zera. */
function snapshotKey(cityId?: string): string {
  const id = cityId ?? safeCityId();
  // Legacy klucz Wrocławia bez sufiksu (kompat ze starymi instalacjami).
  return id === 'wroclaw' ? 'live.snapshot.v1' : `live.snapshot.${id}.v1`;
}

function safeCityId(): string {
  try {
    return getActiveCityIdSync();
  } catch {
    return 'wroclaw';
  }
}
/** Snapshot v3 dokłada listę feedów kolei (starszy format z jednym `kd` dalej się wczytuje). */
interface StoredSnapshot {
  at: number;
  rows: RawVehicleRow[];
  kd?: ZbKdVehicle[];
  /** Prefiks pojazdów kolei (`KD:` / `KML:`); brak = legacy `KD:`. */
  railPrefix?: string;
  rails?: RailFeed[];
}

/** Jeden feed kolei: pojazdy plus prefiks ich identyfikatorów. */
interface RailFeed {
  vehicles: ZbKdVehicle[];
  prefix: string;
}
/** Ile wytrzymujemy snapshot z dysku bez odświeżenia. */
const SNAPSHOT_MAX_AGE_MS = 15 * 60 * 1000;

/** Czy snapshot z dysku mieści się w oknie świeżości i ma sensowny znacznik czasu. */
export function snapshotIsUsable(at: unknown, now: number): boolean {
  if (typeof at !== 'number' || !Number.isFinite(at)) return false;
  // Znacznik z przyszłości (przestawiony zegar, uszkodzony plik) odrzucamy:
  // bez tego ujemny wiek zawsze mieściłby się w oknie świeżości.
  return at <= now && now - at <= SNAPSHOT_MAX_AGE_MS;
}

export interface RawVehicleRow {
  name: string;
  type: string;
  x: number;
  y: number;
  k: number | string;
  /** Sekundy z API, weryfikowane względem GPS. */
  delaySec?: number;
  /** Czas pomiaru GPS w milisekundach epoch. */
  timestamp?: number;
  headsign?: string;
  brigade?: string;
  upcomingStops?: { name: string; schedSec: number }[];
}

/**
 * Zdrowie pojedynczego źródła live w obrębie sesji. `lastError` to ostatni
 * powód porażki, a `lastSuccessAt` znacznik ostatniej udanej odpowiedzi, żeby
 * dało się odróżnić „źródło padło” od „źródło nigdy nie odpowiedziało”.
 */
interface SourceHealth {
  attempts: number;
  failures: number;
  lastSuccessAt: number | null;
  lastError: string | null;
}

export interface TrackedVehicle extends VehiclePosition {
  type: 'bus' | 'tram' | 'train' | 'trolleybus' | 'subway';
}

interface PatternPolylineNode {
  lat: number;
  lon: number;
  stopId: string;
  name: string;
  schedulePos: number;
}

function toDateStr(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

class LiveTracker {
  private byId = new Map<string, TrackedVehicle>();
  private byLine = new Map<string, TrackedVehicle[]>();
  private tripDelays = new Map<string, number>();
  /** Kiedy ostatni raz przyszły dane (albo odtwarzamy je z dysku). 0 = jeszcze nigdy. */
  private lastOk = 0;
  private inFlight = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private restored = false;
  private health = new Map<string, SourceHealth>();
  /** Czy ticker ma aktywnie chodzić (false po stop(), true po start()). */
  private wantPoll = false;
  /** Kto sam tego wymaga, bo działa w tle (śledzenie podróży). Pin > 0 = poll i na tle. */
  private pinned = 0;
  private appStateSub: { remove(): void } | null = null;
  private listeners = new Set<() => void>();

  /** Subskrypcja na zdarzenia aktualizacji live (nowe dane po udanym poll/restore). */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (err) {
        console.warn('[LiveTracker] listener error:', err);
      }
    }
  }

  /**
   * Stan danych live: 'fresh' (mamy świeże opóźnienia), 'stale' (od dawna
   * nie ma udanego response'a, więc opóźnień nie będzie), 'unknown' (jeszcze
   * nie wiadomo). Bez tego użytkownik widzi połączenia bez żadnej informacji,
   * dlaczego nie ma ani kropki, ani opóźnienia.
   */
  getLiveState(): 'fresh' | 'stale' | 'unknown' {
    if (this.lastOk === 0) return 'unknown';
    // Dane przestają być „na żywo” dopiero po GIVE_UP_MS bez sukcesu. Jeden
    // przeterminowany poll nie znaczy, że feed umarł.
    return Date.now() - this.lastOk < GIVE_UP_MS ? 'fresh' : 'stale';
  }

  /**
   * Znacznik ostatniej udanej dostawy danych (0 = nigdy). UI porównuje go
   * między tickami: zmiana = przyszły nowe opóźnienia, można przerysować.
   */
  getLastOk(): number {
    return this.lastOk;
  }

  /**
   * Czyści stan w pamięci (zmiana miasta, nowy import). Snapshotu na dysku NIE
   * kasujemy: klucze są per-miasto, a wpis, który tam jest, należy do miasta,
   * z którego właśnie wyszliśmy. Nadpisze go następny udany poll.
   */
  reset(): void {
    this.byId.clear();
    this.byLine.clear();
    this.tripDelays.clear();
    this.liveScheduleKey = null;
    this.latestDayIndex = null;
    this.sampleHistory.clear();
    this.lastOk = 0;
    this.restored = false;
    // Nowe miasto: pierwszy udany poll ma od razu pójść na dysk pod nowy klucz.
    this.lastPersistAt = 0;
    this.notify();
  }

  /** Idempotentny start tickera (pierwsze ensureFresh też go stawia). */
  start(): void {
    this.wantPoll = true;
    this.ensureAppStateListener();
    if (this.pinned === 0 && AppState.currentState !== 'active') return;
    this.armTimer();
  }

  /** Zatrzymuje ticker: apka ma iść bez polla, dopóki czegoś nie potrzebuje. */
  stop(): void {
    this.wantPoll = false;
    this.disarmTimer();
  }

  /** Śledzenie podróży potrzebuje polla nawet w tle: pin zamiast twardego start(). */
  pin(value: boolean): void {
    this.pinned += value ? 1 : -1;
    if (this.pinned < 0) this.pinned = 0;
    this.ensureAppStateListener();
    if (this.pinned > 0) {
      this.armTimer();
      void this.poll();
    } else if (AppState.currentState !== 'active' || !this.wantPoll) {
      this.disarmTimer();
    }
  }

  /**
   * Tylko jeden listener na żywotność modułu: w tle ticker ginie (bateria), na
   * ekranie wraca, jeśli ktoś go właśnie chce. Pinned (śledzenie podróży)
   * omija pauzę, bo powiadomienia o odjazdach potrzebują świeżych pozycji.
   */
  private ensureAppStateListener(): void {
    if (this.appStateSub) return;
    this.appStateSub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') {
        if (this.wantPoll || this.pinned > 0) this.armTimer();
      } else if (this.pinned > 0) {
        // Pin w tle zostaje, ale przechodzi na rzadsze tempo (bateria).
        this.armTimer();
      } else {
        this.disarmTimer();
      }
    });
  }

  private timerMs = 0;

  /**
   * Tempo polla zależy od stanu aplikacji (na ekranie co 5 s, w tle co 20 s),
   * więc przy każdej zmianie stanu przestawiamy interval. Wywołanie z tym
   * samym tempem jest no-op (nie Restartujemy polla co re-render).
   */
  private armTimer(): void {
    const ms = AppState.currentState === 'active' ? POLL_MS : BACKGROUND_POLL_MS;
    if (this.timer && this.timerMs === ms) return;
    this.disarmTimer();
    void this.poll();
    this.timerMs = ms;
    this.timer = setInterval(() => {
      void this.poll();
    }, ms);
  }

  private disarmTimer(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Szybka ścieżka przed planowaniem: gdy snapshot świeży - nic nie robi,
   * w przeciwnym razie odpala poll W TLE i wraca od razu (planowanie nigdy
   * nie czeka na sieć; najwyżej użyje opóźnień sprzed ≤5 s).
   */
  async ensureFresh(): Promise<void> {
    this.start();
    void this.restoreSnapshot();
    if (this.lastOk > 0 || this.inFlight) return;
    void this.poll();
  }

  /**
   * Opóźnienia kursów: tripId -> sekundy. Do RAPTOR-a.
   *
   * Kopia, nie referencja: konsument dostaje stan, którego nie może zepsuć
   * następny poll (matchSingle pisał do tej samej mapy co poprzedni snapshot).
   */
  getTripDelays(): Map<string, number> {
    const now = Date.now();
    return new Map(this.snapshot().filter(v => v.matchedTripId && v.delaySec != null && now - v.updatedAt <= MAX_SAMPLE_AGE_MS).map(v => [v.matchedTripId!, v.delaySec!]));
  }

  private latestDayIndex: DayIndex | null = null;
  private sampleHistory = new Map<string, { lat: number; lon: number; since: number }>();

  getRoutingSnapshot(index = this.latestDayIndex, offsets?: Map<string, number>): RoutingSnapshot {
    return buildRoutingSnapshot(index, gtfsStore, this.snapshot(), this.getLiveState() === 'fresh', Date.now(), offsets);
  }

  private previousFor(row: RawVehicleRow): TrackedVehicle | undefined {
    const v = this.byId.get(`${row.name.trim().toUpperCase()}-${row.k}`);
    const at = sampleTime(row, Date.now());
    const headsign: string | undefined = v?.matchedTripId ? gtfsStore.trips.get(v.matchedTripId)?.trip_headsign : undefined;
    if (row.headsign && headsign && normalizeName(row.headsign) !== normalizeName(headsign)) return undefined;
    return v && at != null && at - v.updatedAt >= 0 && at - v.updatedAt <= MAX_SAMPLE_AGE_MS ? v : undefined;
  }

  /** Zdrowie źródeł live w tej sesji (do diagnostyki i canary). */
  getSourceHealth(): Record<string, SourceHealth> {
    const out: Record<string, SourceHealth> = {};
    for (const [name, h] of this.health) out[name] = { ...h };
    return out;
  }

  private recordSource(name: string, ok: boolean, error?: unknown): void {
    const h =
      this.health.get(name) ??
      { attempts: 0, failures: 0, lastSuccessAt: null, lastError: null };
    h.attempts += 1;
    if (ok) {
      h.lastSuccessAt = Date.now();
      h.lastError = null;
    } else {
      h.failures += 1;
      if (error !== undefined) h.lastError = error instanceof Error ? error.message : String(error);
    }
    this.health.set(name, h);
  }

  /** Ostatni snapshot (np. do spinania pozycji z kartą przejazdu). */
  lookup(vehicleId: string): TrackedVehicle | undefined {
    const vehicle = this.byId.get(vehicleId);
    const now = Date.now();
    return vehicle && vehicle.updatedAt <= now && now - vehicle.updatedAt <= MAX_SAMPLE_AGE_MS ? vehicle : undefined;
  }

  snapshot(line?: string): TrackedVehicle[] {
    const vehicles = line ? (this.byLine.get(line.trim().toUpperCase()) ?? []) : Array.from(this.byId.values());
    const now = Date.now();
    return vehicles.filter(v => v.updatedAt <= now && now - v.updatedAt <= MAX_SAMPLE_AGE_MS);
  }

  /** Bezstanowe odpytanie źródła MPK (canary/diagnostyka), bez zapisu snapshotu. */
  async probeMpkDirect(): Promise<RawVehicleRow[] | null> {
    return this.fetchDirect();
  }

  async poll(): Promise<void> {
    if (this.inFlight) return;
    this.inFlight = true;
    const cityAtStart = safeCityId();
    try {
      const [rows, rail] = await Promise.all([this.fetchAll(), this.fetchRailSafe()]);
      // Użytkownik zmienił miasto w trakcie pobierania (do 10 s na zapytanie).
      // Odpowiedź dotyczy poprzedniego miasta: nie wolno jej dopasowywać do
      // nowego rozkładu ani zapisywać pod kluczem nowego miasta.
      if (safeCityId() !== cityAtStart) {
        this.inFlight = false;
        return;
      }
      let ok = false;
      const rails = rail ?? [];
      if (rows && rows.length > 0) {
        await this.matchAll(rows);
        ok = true;
        void this.persistSnapshot(rows, rails, cityAtStart);
      } else {
        // Pusta odpowiedź to nie awaria: po północy miasto milknie. Ostatni
        // dobry snapshot zostaje w pamięci, a stan przejdzie na „stale” dopiero
        // po GIVE_UP_MS, więc noc nie miga komunikatem o braku danych.
      }
      let railOk = false;
      for (const feed of rails) {
        if (feed.vehicles.length === 0) continue;
        await this.matchRailAll(feed.vehicles, feed.prefix);
        railOk = true;
      }
      if (railOk) {
        ok = true;
        if (!rows || rows.length === 0) void this.persistSnapshot([], rails, cityAtStart);
      }
      if (ok && safeCityId() === cityAtStart) {
        this.lastOk = Date.now();
        this.notify();
      }
    } catch (err) {
      console.warn('[LiveTracker] poll failed:', err);
    } finally {
      this.inFlight = false;
    }
  }

  /**
   * Pociągi regionalne nigdy nie rzucają: brak live dla kolei to nie awaria
   * miasta. Wrocław: KD, Kraków: Koleje Małopolskie (agencja KML),
   * GZM: Koleje Śląskie, PKP Intercity i POLREGIO (agencje KS, IC, PR),
   * Warszawa: Koleje Mazowieckie i WKD (agencje KM, WKD), Poznań: Koleje
   * Wielkopolskie i POLREGIO (agencje KW, PR), Trójmiasto: SKM (agencja
   * SKMT), Łódź: ŁKA (agencja LKA). SKA nie ma feedu live, więc zostaje
   * na rozkładzie. Szczecin, Kielce, Olsztyn, Białystok, Opole, Rzeszów, Lublin i Radom nie mają kolei wcale
   * (features.regionalRail gaśnie i fetchRailSafe zwraca pustą listę bez zapytań).
   */
  private async fetchRailSafe(): Promise<RailFeed[] | null> {
    const id = safeCityId();
    try {
      if (!getCity(id).features.regionalRail) return [];
    } catch {
      return null;
    }
    try {
      const feeds = await this.fetchRailByCity(id);
      this.recordSource('rail', feeds !== null, feeds === null ? 'brak odpowiedzi' : undefined);
      return feeds;
    } catch (err) {
      this.recordSource('rail', false, err);
      console.warn('[LiveTracker] rail fetch failed:', err);
      return null;
    }
  }

  private async fetchRailByCity(id: string): Promise<RailFeed[] | null> {
    if (id === 'krakow') {
      const rows = await fetchZbKml();
      return rows ? [{ vehicles: rows, prefix: 'KML:' }] : null;
    }
    if (id === 'gzm') {
      const feeds = await fetchZbGzmRails();
      if (feeds === null) return null;
      const prefixes: Record<string, string> = { KS: 'KŚ:', IC: 'IC:', PR: 'PR:' };
      return feeds.map((f) => ({ vehicles: f.vehicles, prefix: prefixes[f.agency] ?? `${f.agency}:` }));
    }
    if (id === 'warszawa') {
      const feeds = await fetchZbWarsawRails();
      if (feeds === null) return null;
      return feeds.map((f) => ({ vehicles: f.vehicles, prefix: `${f.agency}:` }));
    }
    if (id === 'poznan') {
      const feeds = await fetchZbPoznanRails();
      if (feeds === null) return null;
      return feeds.map((f) => ({ vehicles: f.vehicles, prefix: `${f.agency}:` }));
    }
    if (id === 'trojmiasto') {
      const feeds = await fetchZbSkmtRails();
      if (feeds === null) return null;
      return feeds.map((f) => ({ vehicles: f.vehicles, prefix: `${f.agency}:` }));
    }
    if (id === 'lodz') {
      const feeds = await fetchZbLodzRails();
      if (feeds === null) return null;
      return feeds.map((f) => ({ vehicles: f.vehicles, prefix: `${f.agency}:` }));
    }
    const rows = await fetchZbKd();
    return rows ? [{ vehicles: rows, prefix: 'KD:' }] : null;
  }

  /** Dopasowanie pojedynczego pojazdu na żądanie (np. przy wejściu w kartę przejazdu). */
  async matchSingle(row: RawVehicleRow): Promise<TrackedVehicle | null> {
    if (!row.x || !row.y || !row.name || sampleTime(row, Date.now()) == null) return null;
    const line = row.name.trim().toUpperCase();
    const vehicleId = `${line}-${row.k}`;

    const existing = this.byId.get(vehicleId);
    if (existing && Date.now() - existing.updatedAt < 10000) {
      return existing;
    }

    try {
      if (!gtfsStore.isLoaded) await gtfsStore.load();
      const now = new Date();
      const nowSec = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
      const dayIndex = await gtfsStore.getDayIndexSlice(
        now.getDay(),
        toDateStr(now),
        nowSec - WINDOW_SEC,
        nowSec + 3600,
      );

      const patternPolylines = new Map<string, PatternPolylineNode[]>();
      const { tracked } = this.matchRow(row, dayIndex, nowSec, patternPolylines);

      this.byId.set(vehicleId, tracked);
      if (tracked.matchedTripId && tracked.delaySec !== null) {
        this.tripDelays.set(tracked.matchedTripId, tracked.delaySec);
      }
      let list = this.byLine.get(line);
      if (!list) {
        list = [];
        this.byLine.set(line, list);
      }
      const idx = list.findIndex((v) => v.vehicleId === vehicleId);
      if (idx >= 0) list[idx] = tracked;
      else list.push(tracked);

      return tracked;
    } catch (err) {
      console.warn('[LiveTracker] matchSingle error:', err);
      return null;
    }
  }

  /**
   * Pozycje pojazdów per-miasto: główne źródło zbiorkom.live dla wszystkich
   * miast (żaden z operatorów nie ma publicznego bus_position).
   * Fallback: POST bus_position MPK (tylko Wrocław), gdy zbiorkom nie odpowie.
   * Jedno ponowienie po krótkiej przerwie łapie przejściowy timeout.
   */
  private async fetchAll(): Promise<RawVehicleRow[] | null> {
    const first = await this.fetchZbCity();
    if (first) return first;
    await new Promise((r) => setTimeout(r, 1200));
    const second = await this.fetchZbCity();
    if (second) return second;
    try {
      if (!getCity(safeCityId()).features.directBusPosition) return null;
    } catch {
      // Nieznane miasto: próbujemy fallbacku i tak (getCity domyślnie daje Wrocław).
    }
    const fallback = await this.fetchDirect();
    if (fallback) console.warn('[LiveTracker] zbiorkom down, fallback bus_position MPK');
    return fallback;
  }

  private async fetchZbCity(): Promise<RawVehicleRow[] | null> {
    try {
      const id = safeCityId();
      let rows: RawVehicleRow[] | null;
      if (id === 'krakow') rows = await fetchZbKrakowRows();
      else if (id === 'gzm') rows = await fetchZbGzmRows();
      else if (id === 'warszawa') rows = await fetchZbWarsawRows();
      else if (id === 'poznan') rows = await fetchZbPoznanRows();
      else if (id === 'trojmiasto') rows = await fetchZbTricityRows();
      else if (id === 'lodz') rows = await fetchZbLodzRows();
      else if (id === 'szczecin') rows = await fetchZbSzczecinRows();
      else if (id === 'kielce') rows = await fetchZbKielceRows();
      else if (id === 'olsztyn') rows = await fetchZbOlsztynRows();
      else if (id === 'bialystok') rows = await fetchZbBialystokRows();
      else if (id === 'opole') rows = await fetchZbOpoleRows();
      else if (id === 'rzeszow') rows = await fetchZbRzeszowRows();
      else if (id === 'lublin') rows = await fetchZbLublinRows();
      else if (id === 'radom') rows = await fetchZbRadomRows();
      else rows = await fetchZbWroclawRows();
      this.recordSource('zbiorkom', rows !== null, rows === null ? 'brak odpowiedzi' : undefined);
      return rows;
    } catch (err) {
      this.recordSource('zbiorkom', false, err);
      console.warn('[LiveTracker] zbiorkom city fetch failed:', err);
      return null;
    }
  }

  private async fetchDirect(): Promise<RawVehicleRow[] | null> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), MPK.timeoutMs);
    try {
      const body = new URLSearchParams();
      for (const t of WROCLAW_TRAM_LINES) body.append('busList[tram][]', t);
      for (const b of WROCLAW_BUS_LINES) body.append('busList[bus][]', b);
      const res = await fetch(MPK.busPositionUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'User-Agent': 'Mozilla/5.0',
        },
        body: body.toString(),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        this.recordSource('mpk', false, `HTTP ${res.status}`);
        return null;
      }
      const rows = this.parseRows(await res.text());
      this.recordSource('mpk', rows !== null, rows === null ? 'nieoczekiwany schemat' : undefined);
      return rows;
    } catch (err) {
      this.recordSource('mpk', false, err);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Pusta odpowiedź (noc) to nie błąd, więc rozróżniamy „nic nie jeździ”
   * od „serwer zwrócił śmieci”. W obu przypadkach nie psujemy poprzedniego
   * snapshotu.
   */
  private parseRows(text: string): RawVehicleRow[] | null {
    if (!text.trim()) return [];
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return null;
    }
    if (!Array.isArray(parsed)) return null;
    if (parsed.length === 0) return [];
    const rows: RawVehicleRow[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue;
      const r = item as Record<string, unknown>;
      if (typeof r.name !== 'string' || !r.name.trim()) continue;
      if (typeof r.x !== 'number' || typeof r.y !== 'number') continue;
      if (!Number.isFinite(r.x) || !Number.isFinite(r.y)) continue;
      if (typeof r.k !== 'number' && typeof r.k !== 'string') continue;
      rows.push(r as unknown as RawVehicleRow);
    }
    // Niepusta odpowiedź bez ani jednego poprawnego wiersza to zmiana schematu,
    // nie noc. Zwracamy null, żeby uruchomił się fallback zamiast cichej pustki.
    return rows.length > 0 ? rows : null;
  }

  /** Ostatni zapis snapshotu: przy polli co 5 s zapis na dysk co raz to tarcie. */
  private lastPersistAt = 0;
  /** Minimalna przerwa między zapisami snapshotu na dysk. */
  private static PERSIST_MIN_MS = 30000;

  private persistSnapshot(rows: RawVehicleRow[], rails?: RailFeed[], cityId?: string): void {
    // Snapshot służy tylko odtworzeniu po restarcie (okno 15 min), więc wolno
    // mu gubić intermediate polle. Bez throttlingu pisalibyśmy ~600 KB na dysk
    // co 5 s.
    const now = Date.now();
    if (now - this.lastPersistAt < LiveTracker.PERSIST_MIN_MS) return;
    this.lastPersistAt = now;
    void kvSet(snapshotKey(cityId), JSON.stringify({ at: now, rows, rails: rails ?? [] } satisfies StoredSnapshot));
  }

  /**
   * Po restarcie apki mamy zero danych, dopóki pierwszy poll nie wróci (~8 s).
   * Odtwarzamy więc ostatni udany snapshot z dysku: opóźnione dane są lepsze
   * niż „brak danych live”. Świeży poll i tak nadpisze je w tle.
   */
  private async restoreSnapshot(): Promise<void> {
    if (this.restored) return;
    this.restored = true;
    try {
      const raw = await kvGet(snapshotKey());
      if (!raw) return;
      const parsed = JSON.parse(raw) as StoredSnapshot;
      if (!parsed || (!Array.isArray(parsed.rows) && !Array.isArray(parsed.kd) && !Array.isArray(parsed.rails))) return;
      // Stary snapshot to nie „live”: bez tego apka po dłuższej przerwie
      // pokazywałaby nieaktualne pojazdy, dopóki nie wróci pierwszy poll.
      if (!snapshotIsUsable(parsed.at, Date.now())) return;
      if (Array.isArray(parsed.rows) && parsed.rows.length > 0) {
        await this.matchAll(parsed.rows.map(row => ({ ...row, timestamp: row.timestamp ?? parsed.at })));
      }
      const rails: RailFeed[] = Array.isArray(parsed.rails)
        ? parsed.rails
        : Array.isArray(parsed.kd)
          ? [{ vehicles: parsed.kd, prefix: parsed.railPrefix || 'KD:' }]
          : [];
      for (const feed of rails) {
        if (feed.vehicles.length > 0) await this.matchRailAll(feed.vehicles, feed.prefix);
      }
      if (this.byId.size === 0) return;
      // Wiek liczymy od chwili snapshotu, nie od teraz, żeby stare dane nie udawały świeżych.
      this.lastOk = parsed.at;
      this.notify();
    } catch (err) {
      console.warn('[LiveTracker] snapshot restore failed:', err);
    }
  }

  /**
   * Pociągi regionalne z zbiorkom.live do lokalnych kursów (tripDelays dla RAPTOR-a).
   * Numer pociągu (brygada) to nasz route_short_name; matchZbKd weryfikuje
   * go jeszcze nazwami i czasami najbliższych postojów, bo identyfikatory
   * tripów obu źródeł są różne. Dopasowuje się addytywnie do wyniku matchAll
   * (przestrzeń tripId kolei nie koliduje z miejską).
   */
  private async matchRailAll(vehicles: ZbKdVehicle[], prefix: string): Promise<void> {
    try {
      if (!gtfsStore.isLoaded) await gtfsStore.load();
    } catch (err) {
      throw new Error(`gtfs load failed: ${String(err)}`);
    }
    const now = new Date();
    const nowSec = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
    let dayIndex: DayIndex;
    try {
      dayIndex = await gtfsStore.getDayIndexSlice(
        now.getDay(),
        toDateStr(now),
        nowSec - WINDOW_SEC,
        nowSec + 3600,
      );
    } catch (err) {
      throw new Error(`day index failed: ${String(err)}`);
    }

    for (const veh of vehicles) {
      if (!veh.lat || !veh.lon || !veh.trainNumber) continue;
      const vehicleId = `${prefix}${veh.trainNumber}:${veh.id}`;
      const match = matchZbKd(veh, dayIndex);
      const outOfRange = match != null && Math.abs(veh.delaySec) > DELAY_CAP_SEC;
      if (outOfRange) {
        console.warn(
          `[LiveTracker] KD ${veh.trainNumber}: odrzucone opóźnienie ${Math.round(veh.delaySec / 60)} min (> ${DELAY_CAP_SEC / 60})`,
        );
      }
      // Ta sama zasada uczciwości co w matchRow: podejrzane opóźnienie to
      // delaySec = null (pozycja znana, pomiar nie), nie fałszywe „na czas”.
      const tracked: TrackedVehicle = {
        vehicleId,
        line: veh.trainNumber,
        lat: veh.lat,
        lon: veh.lon,
        type: 'train',
        delaySec: match && !outOfRange ? veh.delaySec : null,
        matchedTripId: match && !outOfRange ? match.tripId : undefined,
        currentStopName: veh.currentStopName,
        nextStopName: veh.nextStopName,
        updatedAt: veh.updatedAt,
      };
      // Najświeższy odczyt wygrywa: gdy pociąg zniknie z feedu, jego wpis
      // zniknie przy następnej przebudowie matchAll tak samo jak wpisy MPK.
      const prev = this.byId.get(vehicleId);
      if (prev?.matchedTripId && tracked.matchedTripId !== prev.matchedTripId) {
        this.tripDelays.delete(prev.matchedTripId);
      }
      this.byId.set(vehicleId, tracked);
      let list = this.byLine.get(tracked.line);
      if (!list) {
        list = [];
        this.byLine.set(tracked.line, list);
      }
      const idx = list.findIndex((v) => v.vehicleId === vehicleId);
      if (idx >= 0) list[idx] = this.byId.get(vehicleId)!;
      else list.push(this.byId.get(vehicleId)!);
      if (tracked.matchedTripId && tracked.delaySec !== null) {
        this.tripDelays.set(tracked.matchedTripId, tracked.delaySec);
      }
    }
  }

  private matchRow(
    row: RawVehicleRow,
    dayIndex: DayIndex,
    nowSec: number,
    patternPolylines: Map<string, PatternPolylineNode[]>,
  ): { tracked: TrackedVehicle; score: number } {
    const line = row.name.trim().toUpperCase();
    const vehicleId = `${line}-${row.k}`;
    const lat = row.x;
    const lon = row.y;
    const previous = this.previousFor(row);
    const hints = matchHints(row, previous);
    const at = sampleTime(row, Date.now()) ?? Date.now();
    const sampleSec = nowSec - Math.round((Date.now() - at) / 1000);
    let type: 'bus' | 'tram' | 'trolleybus' | 'subway' | 'train' =
      row.type === 'tram' ? 'tram' : row.type === 'trolleybus' ? 'trolleybus' : 'bus';

    let routeIds = gtfsStore.getRouteIdsByShortName(line);
    if (routeIds.length === 0) routeIds = [line];

    let bestTripId: string | undefined;
    let bestDelay = 0;
    let bestScore = Infinity;
    let bestCurrentStop: string | undefined;
    let bestNextStop: string | undefined;

    for (const [patternId, pattern] of dayIndex.patterns.entries()) {
      if (!routeIds.includes(pattern.routeId)) continue;
      const trips = pattern.trips as any[];
      if (!trips || trips.length === 0) continue;

      let polyline = patternPolylines.get(patternId);
      if (!polyline) {
        polyline = [];
        for (const [schedulePos, stopId] of (pattern.stopSequence as string[]).entries()) {
          const s = gtfsStore.stops.get(stopId);
          if (s && s.stop_lat != null && s.stop_lon != null) {
            polyline.push({
              lat: s.stop_lat,
              lon: s.stop_lon,
              stopId,
              name: s.stop_name || stopId,
              schedulePos,
            });
          }
        }
        patternPolylines.set(patternId, polyline);
      }

      if (polyline.length < 2) continue;

      const proj = projectPointToPolyline(lat, lon, polyline);
      if (proj.distanceMeters > MAX_CORRIDOR_DIST_M) continue;

      const segIdx = Math.max(0, Math.min(polyline.length - 2, proj.segmentIndex));
      const p1 = polyline[segIdx];
      const p2 = polyline[segIdx + 1];
      const d1 = distanceMeters(p1.lat, p1.lon, proj.closestLat, proj.closestLon);
      const dSeg = distanceMeters(p1.lat, p1.lon, p2.lat, p2.lon);
      const t = dSeg > 0 ? Math.min(1, Math.max(0, d1 / dSeg)) : 0;

      for (const trip of trips) {
        const times = gtfsStore.stopTimes.get(trip.trip_id);
        if (!times || times.length <= p2.schedulePos) continue;

        const dep1 = times[p1.schedulePos].departure_sec;
        const arr2 = times[p2.schedulePos].arrival_sec;
        const expectedSec = Math.round(dep1 + t * (arr2 - dep1));
        const delay = sampleSec - expectedSec;
        const score = matchScore(hints, trip.trip_id, trip.trip_headsign ?? '', delay,
          proj.distanceMeters, lat, lon, p2.lat, p2.lon, p2.name, arr2);
        if (score < bestScore) {
          bestScore = score;
          bestTripId = trip.trip_id;
          bestDelay = delay;
          bestCurrentStop = p1.name;
          bestNextStop = p2.name;
        }
      }
    }

    // Fallback: dopasowanie do pojedynczych przystanków (np. pętla końcowa lub ostre zakręty)
    if (!bestTripId) {
      for (const pattern of dayIndex.patterns.values()) {
        if (!routeIds.includes(pattern.routeId)) continue;
        const trips = pattern.trips as any[];
        if (!trips) continue;

        for (const trip of trips) {
          const times = gtfsStore.stopTimes.get(trip.trip_id);
          if (!times) continue;

          for (let i = 0; i < times.length; i++) {
            const stop = gtfsStore.stops.get(times[i].stop_id);
            if (!stop || stop.stop_lat == null || stop.stop_lon == null) continue;

            const d = distanceMeters(lat, lon, stop.stop_lat, stop.stop_lon);
            if (d > 200) continue;

            const expectedSec = times[i].departure_sec ?? times[i].arrival_sec ?? nowSec;
            const delay = sampleSec - expectedSec;
            const next = gtfsStore.stops.get(times[i + 1]?.stop_id);
            const score = matchScore(hints, trip.trip_id, trip.trip_headsign ?? '', delay,
              d, lat, lon, next?.stop_lat ?? stop.stop_lat, next?.stop_lon ?? stop.stop_lon,
              next?.stop_name ?? stop.stop_name, times[i + 1]?.departure_sec ?? expectedSec);
            if (score < bestScore) {
              bestScore = score;
              bestTripId = trip.trip_id;
              bestDelay = delay;
              bestCurrentStop = stop.stop_name;
              bestNextStop = times[i + 1] ? gtfsStore.stops.get(times[i + 1].stop_id)?.stop_name : undefined;
            }
          }
        }
      }
    }

    const delayOutOfRange = bestDelay !== 0 && Math.abs(bestDelay) > DELAY_CAP_SEC;
    if (delayOutOfRange) {
      console.warn(
        `[LiveTracker] ${line} ${vehicleId}: odrzucone opóźnienie ${Math.round(bestDelay / 60)} min (> ${DELAY_CAP_SEC / 60})`,
      );
    }
    // Typ z feedu bywa zgadywany, więc po dopasowaniu bierzemy go z bazy:
    // route_type 0 to tramwaj, 1 to metro, 2 to pociąg (SKA), 11 to trolejbus.
    // Bez meczu zostaje typ z wiersza. Ta sama kolejność co w ścieżce Rusta.
    if (bestTripId) {
      const trip = gtfsStore.trips.get(bestTripId) as { route_id?: string } | undefined;
      const routeType = gtfsStore.routes.get(trip?.route_id ?? '')?.route_type;
      if (routeType === 0) type = 'tram';
      else if (routeType === 1) type = 'subway';
      else if (routeType === 2) type = 'train';
      else if (routeType === 11) type = 'trolleybus';
    }

    return {
      tracked: {
        vehicleId,
        line,
        lat,
        lon,
        type,
        delaySec: bestTripId && !delayOutOfRange ? fusedDelay(row, bestDelay, previous?.matchedTripId === bestTripId ? previous : undefined) : null,
        matchedTripId: bestTripId && !delayOutOfRange ? bestTripId : undefined,
        currentStopName: bestCurrentStop,
        nextStopName: bestNextStop,
        updatedAt: at,
      },
      score: bestTripId ? bestScore : Number.POSITIVE_INFINITY,
    };
  }

  /**
   * Rozwiązanie konfliktów po jednym pollu. Bez tego kilka pojazdów tej samej
   * linii dostawało ten sam `matchedTripId`, a `tripDelays` zapisywał
   * opóźnienie ostatniego z nich - kolejność z odpowiedzi MPK, czyli losowa.
   * Stąd „ Tramwaj pokazuje się w losowym miejscu” i skoki opóźnienia.
   *
   * Zasada: kurs ma dokładnie jeden pojazd (najlepiej dopasowany), a pojazd
   * ma dokładnie jeden kurs. Przy remisie wygrywa ten, którego pozycja
   * pokrywa się z rozkładem najlepiej.
   */
  private resolveConflicts(
    matched: Map<string, { tracked: TrackedVehicle; score: number }>,
  ): { byId: Map<string, TrackedVehicle>; delays: Map<string, number> } {
    // Który pojazd wygrywa każdy kurs.
    const byTrip = new Map<string, { vehicleId: string; score: number }>();
    for (const [vehicleId, entry] of matched) {
      const tripId = entry.tracked.matchedTripId;
      if (!tripId) continue;
      const held = byTrip.get(tripId);
      if (!held || entry.score < held.score) byTrip.set(tripId, { vehicleId, score: entry.score });
    }

    const byId = new Map<string, TrackedVehicle>();
    const delays = new Map<string, number>();
    for (const [vehicleId, entry] of matched) {
      const tripId = entry.tracked.matchedTripId;
      const winner = tripId ? byTrip.get(tripId) : undefined;
      if (winner && winner.vehicleId === vehicleId) {
        byId.set(vehicleId, entry.tracked);
        if (tripId && entry.tracked.delaySec !== null) delays.set(tripId, entry.tracked.delaySec);
      } else {
        // Ten pojazd przegrał spór o kurs (albo w ogóle się nie dopasował)-
        // zostaje w snapshocie, ale bez kursu, żeby nie wmieszać go w cudzą
        // podróż. Dla RAPTOR-a brak opóźnienia jest bezpieczniejszy niż zły.
        // `null`, nie `0`: zero oznaczałoby „na czas”, a tu po prostu nie
        // wiemy - i UI pokazałoby zielony badge dla pojazdu bez pomiaru.
        byId.set(vehicleId, { ...entry.tracked, matchedTripId: undefined, delaySec: null });
      }
    }
    return { byId, delays };
  }

  private liveScheduleKey: DayIndex | null = null;
  private liveTripIds: string[] = [];
  private liveStopNames: string[] = [];

  private ensureLiveSchedule(dayIndex: DayIndex): boolean {
    if (this.liveScheduleKey === dayIndex && this.liveTripIds.length > 0) return true;
    const byLine = new Map<string, { routeId: string; stopSequence: string[]; trips: { trip_id: string; trip_headsign?: string }[] }[]>();
    for (const pattern of dayIndex.patterns.values()) {
      const route = gtfsStore.routes.get(pattern.routeId);
      const line = String(route?.route_short_name ?? pattern.routeId ?? '').trim().toUpperCase();
      if (!line) continue;
      let list = byLine.get(line);
      if (!list) {
        list = [];
        byLine.set(line, list);
      }
      list.push(pattern);
    }
    const tripIds: string[] = [];
    const stopNames: string[] = [];
    const w = new BinaryWriter(256);
    w.u32(byLine.size);
    for (const [line, patterns] of byLine) {
      w.str(line).u32(patterns.length);
      for (const pattern of patterns) {
        const seq: { nameIdx: number; lat: number; lon: number; pos: number }[] = [];
        for (const [pos, stopId] of pattern.stopSequence.entries()) {
          const stop = gtfsStore.stops.get(stopId);
          if (!stop || stop.stop_lat == null || stop.stop_lon == null) continue;
          const nameIdx = stopNames.length;
          stopNames.push(stop.stop_name || stopId);
          seq.push({ nameIdx, lat: stop.stop_lat, lon: stop.stop_lon, pos });
        }
        w.u16(seq.length);
        for (const node of seq) w.u32(node.nameIdx).f64(node.lat).f64(node.lon).str(normalizeName(stopNames[node.nameIdx]));
        const trips = pattern.trips;
        w.u32(trips.length);
        for (const trip of trips) {
          const times = gtfsStore.stopTimes.get(trip.trip_id) as
            | { stop_id: string; departure_sec: number; arrival_sec: number }[]
            | undefined;
          const tripIdx = tripIds.length;
          tripIds.push(trip.trip_id);
          w.u32(tripIdx).str(normalizeName(trip.trip_headsign ?? ''));
          for (let i = 0; i < seq.length; i++) {
            const t = times?.[seq[i].pos];
            w.i32(t ? t.departure_sec | 0 : -2147483648).i32(t ? t.arrival_sec | 0 : -2147483648);
          }
          const fallback: { nameIdx: number; lat: number; lon: number; dep: number }[] = [];
          if (times) {
            for (const t of times) {
              const stop = gtfsStore.stops.get(t.stop_id);
              if (!stop || stop.stop_lat == null || stop.stop_lon == null) continue;
              const dep = t.departure_sec ?? t.arrival_sec;
              if (dep == null) continue;
              const nameIdx = stopNames.length;
              stopNames.push(stop.stop_name || t.stop_id);
              fallback.push({ nameIdx, lat: stop.stop_lat, lon: stop.stop_lon, dep });
            }
          }
          w.u16(fallback.length);
          for (const fb of fallback) w.u32(fb.nameIdx).f64(fb.lat).f64(fb.lon).i32(fb.dep | 0).str(normalizeName(stopNames[fb.nameIdx]));
        }
      }
    }
    const res = invokeRustSync(CMD_LIVE_LOAD_SCHEDULE, w.finish());
    if (!res || res.byteLength < 4) return false;
    this.liveScheduleKey = dayIndex;
    this.liveTripIds = tripIds;
    this.liveStopNames = stopNames;
    return true;
  }

  private matchRowsRust(
    rows: RawVehicleRow[],
    dayIndex: DayIndex,
    nowSec: number,
  ): Map<string, { tracked: TrackedVehicle; score: number }> | null {
    if (!this.ensureLiveSchedule(dayIndex)) return null;
    const usable = rows.filter((row) => row.x && row.y && row.name);
    if (usable.length === 0) return null;
    const w = new BinaryWriter(16 + usable.length * 48);
    w.i32(nowSec).u32(usable.length);
    const now = Date.now();
    for (const row of usable) {
      const hints = matchHints(row, this.previousFor(row));
      const previous = hints.previous;
      const prevIdx = previous?.matchedTripId ? this.liveTripIds.indexOf(previous.matchedTripId) : -1;
      w.str(row.name.trim().toUpperCase()).f64(row.x).f64(row.y)
        .i32(nowSec - Math.round((now - (sampleTime(row, now) ?? now)) / 1000))
        .i32(hints.api ?? -2147483648).str(hints.headsign).i32(prevIdx)
        .f64(previous?.lat ?? row.x).f64(previous?.lon ?? row.y)
        .str(hints.nextStop).i32(hints.nextSec ?? -2147483648);
    }
    const res = invokeRustSync(CMD_LIVE_MATCH_BATCH, w.finish());
    if (!res || res.byteLength < 4) return null;
    const r = new BinaryReader(res);
    const count = r.u32();
    if (count !== usable.length || res.byteLength < 4 + count * 25) return null;
    const matched = new Map<string, { tracked: TrackedVehicle; score: number }>();
    for (let i = 0; i < count; i++) {
      const row = usable[i];
      const line = row.name.trim().toUpperCase();
      const ok = r.u8Val() !== 0;
      const tripIdx = r.u32();
      const delay = r.i32();
      const curIdx = r.u32();
      const nextIdx = r.u32();
      const score = r.f64();
      const tripId = ok ? this.liveTripIds[tripIdx] : undefined;
      const delayOutOfRange = !!tripId && delay !== 0 && Math.abs(delay) > DELAY_CAP_SEC;
      const previous = this.previousFor(row);
      // Ścieżka Rusta nie zna route_type, więc typ bierzemy z bazy po meczu
      // (metro M1/M2 z feedu miasta przychodzi jako „bus", a po meczu
      // dostaje route_type 1 i kropkę metra).
      let vtype: TrackedVehicle['type'] = row.type === 'tram' ? 'tram' : 'bus';
      if (tripId) {
        const trip = gtfsStore.trips.get(tripId) as { route_id?: string } | undefined;
        const routeType = gtfsStore.routes.get(trip?.route_id ?? '')?.route_type;
        if (routeType === 0) vtype = 'tram';
        else if (routeType === 1) vtype = 'subway';
        else if (routeType === 2) vtype = 'train';
        else if (routeType === 11) vtype = 'trolleybus';
      }
      matched.set(line + '-' + row.k, {
        tracked: {
          vehicleId: `${line}-${row.k}`,
          line,
          lat: row.x,
          lon: row.y,
          type: vtype,
          delaySec: tripId && !delayOutOfRange ? fusedDelay(row, delay, previous?.matchedTripId === tripId ? previous : undefined) : null,
          matchedTripId: tripId && !delayOutOfRange ? tripId : undefined,
          currentStopName: tripId ? this.liveStopNames[curIdx] : undefined,
          nextStopName: tripId ? this.liveStopNames[nextIdx] : undefined,
          updatedAt: sampleTime(row, now) ?? now,
        },
        score: tripId && !delayOutOfRange ? score : Number.POSITIVE_INFINITY,
      });
    }
    return matched;
  }

  private async matchAll(rows: RawVehicleRow[]): Promise<void> {
    try {
      if (!gtfsStore.isLoaded) await gtfsStore.load();
    } catch (err) {
      // Rzucamy dalej: poll() ustawi wtedy failed i NIE oznaczy danych jako świeże.
      throw new Error(`gtfs load failed: ${String(err)}`);
    }
    const now = new Date();
    const nowSec = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();

    let dayIndex: DayIndex;
    try {
      dayIndex = await gtfsStore.getDayIndexSlice(
        now.getDay(),
        toDateStr(now),
        nowSec - WINDOW_SEC,
        nowSec + 3600,
      );
    } catch (err) {
      throw new Error(`day index failed: ${String(err)}`);
    }

    const patternPolylines = new Map<string, PatternPolylineNode[]>();
    this.latestDayIndex = dayIndex;
    const seen = new Set<string>();
    rows = rows.filter(row => {
      const id = `${row.name.trim().toUpperCase()}-${row.k}`;
      if (seen.has(id) || sampleTime(row, now.getTime()) == null) return false;
      seen.add(id);
      if (row.timestamp == null) {
        const old = this.sampleHistory.get(id);
        if (!old || old.lat !== row.x || old.lon !== row.y) {
          this.sampleHistory.set(id, { lat: row.x, lon: row.y, since: now.getTime() });
        } else if (now.getTime() - old.since > MAX_SAMPLE_AGE_MS) return false;
      }
      return true;
    });
    for (const id of this.sampleHistory.keys()) if (!seen.has(id)) this.sampleHistory.delete(id);
    const matched =
      this.matchRowsRust(rows, dayIndex, nowSec) ??
      new Map<string, { tracked: TrackedVehicle; score: number }>();

    if (matched.size === 0) {
      for (const row of rows) {
        // MPK potrafi w odpowiedzi umieścić wiersz z zerowymi współrzędnymi
        // (zdarza się np. dla linii 153). Taki wiersz nie ma pozycji, więc
        // dopasowanie do kursu byłoby zmyślone.
        if (!row.x || !row.y || !row.name) continue;
        matched.set(row.name.trim().toUpperCase() + '-' + row.k, this.matchRow(row, dayIndex, nowSec, patternPolylines));
      }
    }

    // Jeden kurs = jeden pojazd (patrz resolveConflicts), inaczej opóźnienia
    // i strzałka na mapie skakałyby między pojazdami w kolejności z API.
    const { byId, delays } = this.resolveConflicts(matched);
    // Przebudowa dotyczy tylko miasta: pociągi regionalne (osobny poll)
    // przeżywają, żeby chwilowa dziura w feedzie kolei nie gasiła opóźnień.
    // Wpisy kolei noszą prefiks z dwukropkiem (`KD:123:veh`, `KŚ:…`, `KM:…`),
    // miejskie to `linia-id` bez dwukropka, więc rozróżnienie nie wymaga
    // listy agencji per-miasto.
    for (const [id, kept] of this.byId) {
      if (!id.includes(':')) continue;
      byId.set(id, kept);
      if (kept.matchedTripId && kept.delaySec !== null) delays.set(kept.matchedTripId, kept.delaySec);
    }
    const newByLine = new Map<string, TrackedVehicle[]>();
    for (const tracked of byId.values()) {
      let list = newByLine.get(tracked.line);
      if (!list) {
        list = [];
        newByLine.set(tracked.line, list);
      }
      list.push(tracked);
    }

    this.byId = byId;
    this.byLine = newByLine;
    this.tripDelays = delays;
  }
}

export const liveTracker = new LiveTracker();
