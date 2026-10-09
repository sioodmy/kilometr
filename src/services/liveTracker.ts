// Lokalny tracker pojazdów MPK: poll pozycji + dopasowanie kursów do
// rozkładu (opóźnienia). Zasilanie RAPTOR-a (tripDelays) i flag live w UI.
// Działa w całości na telefonie, bez serwera pośredniczącego. Uzasadnienie
// przy fetchAll.
//
// Matcher rzutuje pozycję GPS na geometrię trasy kursu (odcinki między
// kolejnymi przystankami) oraz sprawdza oczekiwany czas w rozkładzie.
// Eliminuje to błędy pojazdów w ruchu między przystankami i fałszywe dopasowania.

import { MPK, WROCLAW_BUS_LINES, WROCLAW_TRAM_LINES } from './gtfsConfig';
import { DayIndex, gtfsStore } from './routing/store';
import { distanceMeters, projectPointToPolyline } from '../gtfs/geo';
import { kvGet, kvSet } from './storage';
import type { VehiclePosition } from '../types/models';

/** Jak często pytamy o pozycje. MPK odświeża je co ~5 s, więc 20 s to zapas. */
const POLL_MS = 20000;
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
const WINDOW_SEC = 1800;
const MAX_CORRIDOR_DIST_M = 350;
const DELAY_CAP_SEC = 1800;
/** Ostatni udany snapshot na dysku, żeby restart apki nie startował od zera. */
const SNAPSHOT_KEY = 'live.snapshot.v1';
/** Ile wytrzymujemy snapshot z dysku bez odświeżenia. */
const SNAPSHOT_MAX_AGE_MS = 15 * 60 * 1000;

export interface RawVehicleRow {
  name: string;
  type: string;
  x: number;
  y: number;
  k: number;
}

export interface TrackedVehicle extends VehiclePosition {
  type: 'bus' | 'tram';
}

interface PatternPolylineNode {
  lat: number;
  lon: number;
  stopId: string;
  name: string;
}

function toDateStr(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

/** Snapshot przeżywa restart aplikacji, więc format weryfikujemy przy odczycie. */
interface StoredSnapshot {
  at: number;
  rows: RawVehicleRow[];
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

  /** Czyści stan trackera (np. po resecie bazy lub nowym imporcie). */
  reset(): void {
    this.byId.clear();
    this.byLine.clear();
    this.tripDelays.clear();
    this.lastOk = 0;
    void kvSet(SNAPSHOT_KEY, JSON.stringify({ at: 0, rows: [] } satisfies StoredSnapshot));
  }

  /** Idempotentny start tickera (pierwsze ensureFresh też go stawia). */
  start(): void {
    if (this.timer) return;
    void this.poll();
    this.timer = setInterval(() => {
      void this.poll();
    }, POLL_MS);
  }

  /**
   * Szybka ścieżka przed planowaniem: gdy snapshot świeży — nic nie robi,
   * w przeciwnym razie odpala poll W TLE i wraca od razu (planowanie nigdy
   * nie czeka na sieć; najwyżej użyje opóźnień sprzed ≤20 s).
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
    return new Map(this.tripDelays);
  }

  /** Ostatni snapshot (np. do spinania pozycji z kartą przejazdu). */
  lookup(vehicleId: string): TrackedVehicle | undefined {
    return this.byId.get(vehicleId);
  }

  snapshot(line?: string): TrackedVehicle[] {
    if (line) return this.byLine.get(line.trim().toUpperCase()) ?? [];
    return Array.from(this.byId.values());
  }

  async poll(): Promise<void> {
    if (this.inFlight) return;
    this.inFlight = true;
    try {
      const rows = await this.fetchAll();
      if (rows && rows.length > 0) {
        await this.matchAll(rows);
        this.lastOk = Date.now();
        void this.persistSnapshot(rows);
      } else {
        // Pusta odpowiedź to nie awaria: po północy Wrocław milknie. Ostatni
        // dobry snapshot zostaje w pamięci, a stan przejdzie na „stale” dopiero
        // po GIVE_UP_MS, więc noc nie miga komunikatem o braku danych.
      }
    } catch (err) {
      console.warn('[LiveTracker] poll failed:', err);
    } finally {
      this.inFlight = false;
    }
  }

  /** Dopasowanie pojedynczego pojazdu na żądanie (np. przy wejściu w kartę przejazdu). */
  async matchSingle(row: RawVehicleRow): Promise<TrackedVehicle | null> {
    if (!row.x || !row.y || !row.name) return null;
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
   * Pozycje pojazdów wprost z MPK, z jednym ponowieniem.
   *
   * Świadomie bez pośrednika: cache brzegowy na Cloudflare kosztowałby 100k
   * requestów na dobę (limit Workers Free), a pomiary pokazują, że MPK i tak
   * odpowiada w 291 ms medianowo i nie zawodzi. Jedno ponowienie po krótkiej
   * przerwie wystarczy na przejściowy timeout.
   */
  private async fetchAll(): Promise<RawVehicleRow[] | null> {
    const first = await this.fetchDirect();
    if (first) return first;
    await new Promise((r) => setTimeout(r, 1200));
    return this.fetchDirect();
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
      if (!res.ok) return null;
      return this.parseRows(await res.text());
    } catch {
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
    return parsed as RawVehicleRow[];
  }

  private persistSnapshot(rows: RawVehicleRow[]): void {
    void kvSet(SNAPSHOT_KEY, JSON.stringify({ at: Date.now(), rows } satisfies StoredSnapshot));
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
      const raw = await kvGet(SNAPSHOT_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as StoredSnapshot;
      if (!parsed || !Array.isArray(parsed.rows) || parsed.rows.length === 0) return;
      if (Date.now() - parsed.at > SNAPSHOT_MAX_AGE_MS) return;
      await this.matchAll(parsed.rows);
      this.lastOk = Date.now();
    } catch (err) {
      console.warn('[LiveTracker] snapshot restore failed:', err);
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
    const type: 'bus' | 'tram' = row.type === 'tram' ? 'tram' : 'bus';

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
        for (const stopId of pattern.stopSequence as string[]) {
          const s = gtfsStore.stops.get(stopId);
          if (s && s.stop_lat != null && s.stop_lon != null) {
            polyline.push({
              lat: s.stop_lat,
              lon: s.stop_lon,
              stopId,
              name: s.stop_name || stopId,
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
        if (!times || times.length <= segIdx + 1) continue;

        const dep1 = times[segIdx].departure_sec;
        const arr2 = times[segIdx + 1].arrival_sec;
        const expectedSec = Math.round(dep1 + t * (arr2 - dep1));
        const delay = nowSec - expectedSec;

        // Odfiltruj kursy spoza realistycznego okna opóźnienia (-5 min do +35 min)
        if (delay < -300 || delay > 2100) continue;

        const score = Math.abs(delay) + proj.distanceMeters * 2;
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
      for (const [patternId, pattern] of dayIndex.patterns.entries()) {
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
            const delay = nowSec - expectedSec;
            if (delay < -300 || delay > 2100) continue;

            const score = Math.abs(delay) + d * 2;
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

    // Poza DELAY_CAP_SEC opóźnienie nie znaczy „pojazd 40 minut spóźniony”
    // tylko „dopasowanie do kursu jest podejrzane”. Wcześniej taki wynik
    // zerowano, a pojazd zostawał `live: true` — użytkownik dostawał zielony
    // „Na czas” przy tramwaju, który wyraźnie nie jest na czas. Teraz zamiast
    // kłamstwa jest brak informacji: delaySec = null, a UI pada z powrotem na
    // „Rozkład”, bo `live` jest wyprowadzane z `delaySec`.
    const delayOutOfRange = bestDelay !== 0 && Math.abs(bestDelay) > DELAY_CAP_SEC;
    if (delayOutOfRange) {
      console.warn(
        `[LiveTracker] ${line} ${vehicleId}: odrzucone opóźnienie ${Math.round(bestDelay / 60)} min (> ${DELAY_CAP_SEC / 60})`,
      );
    }

    return {
      tracked: {
        vehicleId,
        line,
        lat,
        lon,
        type,
        // `null` = brak wiarygodnego pomiaru (a nie „na czas”). Dzięki temu
        // `matchSingle` nie ustawia `matchedTripId`, więc RAPTOR nie dostaje
        // fałszywego opóźnienia, a UI pokazuje rozkład zamiast zielonego badge.
        delaySec: bestTripId && !delayOutOfRange ? bestDelay : null,
        matchedTripId: bestTripId && !delayOutOfRange ? bestTripId : undefined,
        currentStopName: bestCurrentStop,
        nextStopName: bestNextStop,
        updatedAt: Date.now(),
      },
      score: bestTripId ? bestScore : Number.POSITIVE_INFINITY,
    };
  }

  /**
   * Rozwiązanie konfliktów po jednym pollu. Bez tego kilka pojazdów tej samej
   * linii dostawało ten sam `matchedTripId`, a `tripDelays` zapisywał
   * opóźnienie ostatniego z nich — kolejność z odpowiedzi MPK, czyli losowa.
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
        // Ten pojazd przegrał spór o kurs (albo w ogóle się nie dopasował) —
        // zostaje w snapshocie, ale bez kursu, żeby nie wmieszać go w cudzą
        // podróż. Dla RAPTOR-a brak opóźnienia jest bezpieczniejszy niż zły.
        // `null`, nie `0`: zero oznaczałoby „na czas”, a tu po prostu nie
        // wiemy — i UI pokazałoby zielony badge dla pojazdu bez pomiaru.
        byId.set(vehicleId, { ...entry.tracked, matchedTripId: undefined, delaySec: null });
      }
    }
    return { byId, delays };
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
    const matched = new Map<string, { tracked: TrackedVehicle; score: number }>();

    for (const row of rows) {
      // MPK potrafi w odpowiedzi umieścić wiersz z zerowymi współrzędnymi
      // (zdarza się np. dla linii 153). Taki wiersz nie ma pozycji, więc
      // dopasowanie do kursu byłoby zmyślone.
      if (!row.x || !row.y || !row.name) continue;
      matched.set(row.name.trim().toUpperCase() + '-' + row.k, this.matchRow(row, dayIndex, nowSec, patternPolylines));
    }

    // Jeden kurs = jeden pojazd (patrz resolveConflicts), inaczej opóźnienia
    // i strzałka na mapie skakałyby między pojazdami w kolejności z API.
    const { byId, delays } = this.resolveConflicts(matched);
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
