// Czysty ranking „Ostatnich miejsc" — bez magazynu i bez natywnych modułów,
// żeby tę samą logikę dało się policzyć w `npm run check:smart-rank`
// (tak jak logikę powiadomień w `check:notifications`).
//
// Sedno: to NIE jest historia wyszukiwania tylko ranking nawyków (#2, #11).
// Wejście to historia przejazdów, gdzie jeden wpis = jedna para
// „stąd → tam" z licznikiem `uses` (ile razy użytkownik ją sprawdzał),
// plus miejsca przypięte. Kolejność liczy przede wszystkim częstotliwość;
// świeżość tylko gasi stary nawyk, a nie odwraca kolejność.

import { distanceMeters } from '../gtfs/geo';
import type { SavedPlace, SmartDestination } from '../types/models';

/** Wpis historii: jedna sprawdzona para miejsc wraz z liczbą powtórzeń. */
export interface TripHistoryItem {
  id: string;
  origin_title: string;
  origin_lat: number;
  origin_lon: number;
  dest_id: string;
  dest_title: string;
  dest_address: string;
  dest_lat: number;
  dest_lon: number;
  duration_min: number;
  timestamp: number;
  /**
   * Ile razy sprawdzano tę parę. Wpisów zapisanych przed tą wersją nie ma —
   * `tripUses` traktuje brak jako jedno sprawdzenie.
   */
  uses?: number;
}

/** Cel w formie, w jakiej przychodzi z wyszukiwarki albo z przypiętego miejsca. */
export interface TripDestinationInput {
  id: string;
  title: string;
  address?: string;
  lat: number;
  lon: number;
}

/** Starty w tym promieniu to to samo miejsce (dom → praca vs rynk → praca). */
export const CLUSTER_RADIUS_M = 1600;
/** Nie proponujemy celu, w którym użytkownik stoi. */
export const EXCLUSION_RADIUS_M = 250;
/** Dwa różne id tego samego budynku (wyszukiwarka vs przypięte miejsce). */
export const SAME_PLACE_RADIUS_M = 150;
/** Promień, w którym przypięte miejsce uznajemy za „to, gdzie jestem". */
export const CONTEXT_PLACE_RADIUS_M = 350;
/** Dwa zapisy tej samej pary w tym oknie to jedno sprawdzenie, nie dwa. */
export const REPEAT_GAP_MS = 5 * 60 * 1000;
/** Czas dojazdu, gdy nikt go nie zmierzył (np. przypięte miejsce). */
export const FALLBACK_TRIP_MIN = 18;

// Wagi rankingu. `uses` ma dominować: pięć sprawdzeń tej samej trasy znaczy
// więcej niż jedno sprawdzenie czegoś innego dzisiaj (#2), a przypięte miejsce
// bez historii wciąż musi się przebić (użytkownik sam je wskazał).
const HABIT_WEIGHT = 10;
const SAVED_BONUS = 14;
const FRESHNESS_MAX = 6;
const FRESHNESS_DECAY_DAYS = 10;

const DAY_MS = 24 * 3600 * 1000;

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/** Ile razy sprawdzano parę (stare wpisy bez pola = raz). */
export function tripUses(trip: TripHistoryItem): number {
  const uses = Math.round(trip.uses ?? 1);
  return uses > 0 ? uses : 1;
}

function isSameDestination(trip: TripHistoryItem, dest: TripDestinationInput): boolean {
  if (dest.id && trip.dest_id && dest.id === trip.dest_id) return true;
  if (dest.title && trip.dest_title && dest.title === trip.dest_title) return true;
  if (finite(trip.dest_lat) && finite(trip.dest_lon)) {
    return distanceMeters(trip.dest_lat, trip.dest_lon, dest.lat, dest.lon) <= SAME_PLACE_RADIUS_M;
  }
  return false;
}

/**
 * Wpis opisujący tę samą parę co teraz sprawdzana: ten sam cel (po id, nazwie
 * albo współrzędnych) w promieniu tego samego startu. Dzięki temu „z Polbudu
 * do domu" i „z Rynku do domu" to dwa osobne nawyki, a nie jeden.
 *
 * W klastrze może być więcej niż jeden wpis o tym samym celu (dwa starty po
 * 1,6 km od siebie, albo dane sprzed zmiany formatu). Wybieramy wtedy
 * **najmocniejszy** nawyk — nowe sprawdzenie musi dodać się do niego, inaczej
 * licznik rozjeżdżałby się między wpisami i suma przestałaby znaczyć
 * „tyle razy sprawdzałem stąd".
 */
export function findTripPair(
  history: TripHistoryItem[],
  originLat: number,
  originLon: number,
  dest: TripDestinationInput,
): TripHistoryItem | undefined {
  let best: TripHistoryItem | undefined;
  for (const trip of history) {
    if (!isSameDestination(trip, dest)) continue;
    if (distanceMeters(originLat, originLon, trip.origin_lat, trip.origin_lon) > CLUSTER_RADIUS_M) continue;
    if (
      !best ||
      tripUses(trip) > tripUses(best) ||
      (tripUses(trip) === tripUses(best) && trip.timestamp > best.timestamp)
    ) {
      best = trip;
    }
  }
  return best;
}

/**
 * Typowy czas dojazdu po tej trasie — mediana z pierwszego okna kursów.
 * Średnia ciągnęłaby do jednego długiego kursu, a „najszybszy z listy" kłamałby
 * przy zmianie sortowania. Parzysta liczba kursów to średnia z dwóch środkowych,
 * bo dla dwóch kursów „mediana" to po prostu ten dłuższy.
 */
export function typicalDurationMin(list: { durationMin: number }[]): number | undefined {
  if (list.length === 0) return undefined;
  const durations = list.map((c) => c.durationMin).sort((a, b) => a - b);
  const mid = Math.floor(durations.length / 2);
  return durations.length % 2 === 1
    ? durations[mid]
    : Math.round((durations[mid - 1] + durations[mid]) / 2);
}

/**
 * Nowa historia po jednym sprawdzeniu trasy.
 *
 * - ta sama para krótko po sobie → odświeżamy czas, ale NIE liczymy drugi raz.
 *   Otwarcie ekranu połączeń odpala to samo zapytanie jeszcze raz (i po
 *   zamianie, i po zmianie godziny), a bez tego nawyk rósłby od odpytań,
 *   a nie od intencji użytkownika;
 * - ta sama para po dłuższej chwili → `uses + 1`, bo to faktyczny nawyk;
 * - nowa para → nowy wpis, a pozostałych nie kasujemy. Wcześniejszy kod
 *   usuwał wszystkie wpisy o tym samym celu, przez co wystarczyło jedno
 *   sprawdzenie „do domu" z innego miejsca, żeby zniknęło „do domu" stąd.
 */
export function mergeTripSearch(
  history: TripHistoryItem[],
  originLat: number,
  originLon: number,
  originTitle: string,
  dest: TripDestinationInput,
  measuredMinutes: number | undefined,
  now: number,
): TripHistoryItem[] {
  // Wpis bez poprawnych współrzędnych jest bezużyteczny: ranking odsiewa go
  // po `distanceMeters` (NaN nie mieści się w żadnym promieniu), więc trafiłby
  // do magazynu i zniknął bez śladu. Deep link z `toLat=abc` właśnie tak kończy.
  if (!finite(originLat) || !finite(originLon) || !finite(dest.lat) || !finite(dest.lon)) {
    return history;
  }

  const measured = finite(measuredMinutes) && measuredMinutes > 0 ? measuredMinutes : undefined;
  const match = findTripPair(history, originLat, originLon, dest);

  if (match) {
    const uses = tripUses(match);
    const isRepeat = now - match.timestamp < REPEAT_GAP_MS;
    const previous = match.duration_min || FALLBACK_TRIP_MIN;
    const merged: TripHistoryItem = {
      ...match,
      // Świeższy start i cel mają świeższe współrzędne (np. kotwica
      // przystanku zamiast surowego GPS), więc to one są kanoniczne.
      origin_title: originTitle || match.origin_title,
      origin_lat: originLat,
      origin_lon: originLon,
      dest_id: dest.id || match.dest_id,
      dest_title: dest.title || match.dest_title,
      dest_address: dest.address || match.dest_address,
      dest_lat: dest.lat,
      dest_lon: dest.lon,
      // Powtórka tej samej podróży: nowy pomiar jest lepszy niż poprzedni.
      // Nowe sprawdzenie po dłuższej chwili: uśredniamy, żeby jeden wyjazd
      // po drodze (korek) nie przesunął szacunku na stałe.
      duration_min: Math.round(
        measured === undefined ? previous : isRepeat ? measured : (previous * uses + measured) / (uses + 1),
      ),
      timestamp: now,
      uses: isRepeat ? uses : uses + 1,
    };
    return [merged, ...history.filter((trip) => trip !== match)];
  }

  const item: TripHistoryItem = {
    // Losowy sufiks zawsze niepusty (`slice` potrafi oddać „i”, a w skrajnym
    // razie pusty string — dokładnie ten sam problem co w `newId()`).
    id: `trip-${now}-${Math.random().toString(36).slice(2, 6).padEnd(4, '0')}`,
    origin_title: originTitle || 'Wrocław',
    origin_lat: originLat,
    origin_lon: originLon,
    dest_id: dest.id || dest.title,
    dest_title: dest.title,
    dest_address: dest.address || 'Wrocław',
    dest_lat: dest.lat,
    dest_lon: dest.lon,
    duration_min: measured ?? FALLBACK_TRIP_MIN,
    timestamp: now,
    uses: 1,
  };
  return [item, ...history];
}

interface CandidateStats {
  id: string;
  title: string;
  address: string;
  lat: number;
  lon: number;
  /** Nawyk: ile razy sprawdzano ten cel z tej okolicy. */
  uses: number;
  /** Suma `uses * duration_min` — średnia ważona wychodzi z niej przy renderze. */
  durationSum: number;
  lastTimestamp: number;
  isSavedPlace: boolean;
}

/** Punktacja jednego kandydata: nawyk + przypięcie + zgaszony wiek nawyku. */
export function scoreCandidate(uses: number, lastTimestamp: number, isSavedPlace: boolean, now: number): number {
  const daysSince = Math.max(0, (now - lastTimestamp) / DAY_MS);
  const freshness = FRESHNESS_MAX * Math.exp(-daysSince / FRESHNESS_DECAY_DAYS);
  return uses * HABIT_WEIGHT + (isSavedPlace ? SAVED_BONUS : 0) + freshness;
}

/**
 * „Ostatnie miejsca" dla bieżącej pozycji: nawyki z okolicy + przypięte
 * miejsca, posortowane częstotliwością (a nie chronologicznie — #2).
 *
 * Świeżość wchodzi do wyniku jako zgaszony bonus, więc codzienna
 * jednorazowa podpowiedź nie wypycha celu, po który użytkownik chodzi
 * pięć razy w tygodniu.
 */
export function rankSmartDestinations(
  history: TripHistoryItem[],
  savedPlaces: SavedPlace[],
  userLat: number,
  userLon: number,
  now: number,
  limit = 4,
): SmartDestination[] {
  const oneMonthAgo = now - 30 * DAY_MS;

  // 1. Czy stoiemy w pobliżu przypiętego miejsca? To zmienia start, a zatem
  //    i to, które nawyki są „nasze" — nie chcemy proponować powrotu do domu,
  //    kiedy użytkownik właśnie w domu jest.
  const currentContextPlace =
    savedPlaces.find(
      (place) =>
        finite(place.lat) && finite(place.lon) &&
        distanceMeters(userLat, userLon, place.lat, place.lon) <= CONTEXT_PLACE_RADIUS_M,
    ) ?? null;
  const originId = currentContextPlace
    ? currentContextPlace.placeId || currentContextPlace.id
    : 'current-gps';

  // 2. Historia. Bez przejazdów z okolicy bierzemy globalne, żeby sekcja
  //    „Ostatnie miejsca" nigdy nie była pusta dla kogoś, kto dopiero
  //    zaczął z aplikacji korzystać.
  const recentMonthTrips = history.filter((trip) => trip.timestamp >= oneMonthAgo);
  let nearbyTrips = recentMonthTrips.filter(
    (trip) => distanceMeters(userLat, userLon, trip.origin_lat, trip.origin_lon) <= CLUSTER_RADIUS_M,
  );
  if (nearbyTrips.length === 0) {
    nearbyTrips = recentMonthTrips.length > 0 ? recentMonthTrips : history;
  }

  // 3. Agregacja kandydatów: jeden cel = jeden wpis niezależnie od tego,
  //    skąd był sprawdzany.
  const candidateMap = new Map<string, CandidateStats>();

  for (const trip of nearbyTrips) {
    const distToDest = distanceMeters(userLat, userLon, trip.dest_lat, trip.dest_lon);
    if (distToDest <= EXCLUSION_RADIUS_M) continue;
    if (
      currentContextPlace &&
      (trip.dest_id === currentContextPlace.id || trip.dest_id === currentContextPlace.placeId)
    ) {
      continue;
    }

    const key = trip.dest_id || trip.dest_title;
    const uses = tripUses(trip);
    const duration = trip.duration_min || FALLBACK_TRIP_MIN;
    let cand = candidateMap.get(key);
    if (!cand) {
      // Ten sam budynek pod dwiema nazwami (albo dwoma id) w danych sprzed
      // zmiany: `recordTripSearch` porównywał tytuły, nie współrzędne, więc
      // „Magnolia Park" i „Siłownia" mogły zostać w historii obok siebie.
      // Jeden wiersz, inaczej limit 4 wyrzuci prawdziwą destynację — dokładnie
      // powód, dla którego #45 scalało przypięte miejsce z historią.
      for (const existing of candidateMap.values()) {
        if (
          distanceMeters(existing.lat, existing.lon, trip.dest_lat, trip.dest_lon) <= SAME_PLACE_RADIUS_M
        ) {
          cand = existing;
          break;
        }
      }
    }
    if (!cand) {
      candidateMap.set(key, {
        id: trip.dest_id,
        title: trip.dest_title,
        address: trip.dest_address,
        lat: trip.dest_lat,
        lon: trip.dest_lon,
        uses,
        durationSum: duration * uses,
        lastTimestamp: trip.timestamp,
        isSavedPlace: false,
      });
      continue;
    }
    // Kilka wpisów tego samego celu z okolicy to Z PUNKTU WIDZENIA RANKINGU jeden
    // nawyk (promień 1,6 km to jedno miejsce), więc sumujemy sprawdzenia.
    // `max` gubiłoby to, co wiemy: dwa wpisy po 2 to cztery sprawdzenia stąd,
    // a nie dwa. Tytuł i współrzędne zostają z pierwszego (najświeższego) wpisu,
    // bo `nearbyTrips` jest już posortowane od nowego do starego.
    cand.uses += uses;
    cand.durationSum += duration * uses;
    if (trip.timestamp > cand.lastTimestamp) cand.lastTimestamp = trip.timestamp;
  }

  // 4. Przypięte miejsca wchodzą do tego samego rankingu (bonusy, nie osobna
  //    lista), a ten sam budynek z innego źródła jest scalany z istniejącym
  //    wpisem — inaczej „Szybkie cele" pokazują dwa identyczne wiersze, każdy
  //    z osobnym planowaniem trasy, a limit wyrzuca prawdziwą destynację.
  for (const place of savedPlaces) {
    if (currentContextPlace && place.id === currentContextPlace.id) continue;
    const distToDest = distanceMeters(userLat, userLon, place.lat, place.lon);
    if (distToDest <= EXCLUSION_RADIUS_M) continue;

    const key = place.placeId || place.id;
    let cand = candidateMap.get(key);
    let mergedByDistance = false;
    if (!cand && finite(place.lat) && finite(place.lon)) {
      for (const existing of candidateMap.values()) {
        if (existing.isSavedPlace) continue;
        if (
          finite(existing.lat) &&
          finite(existing.lon) &&
          distanceMeters(existing.lat, existing.lon, place.lat, place.lon) <= SAME_PLACE_RADIUS_M
        ) {
          cand = existing;
          mergedByDistance = true;
          break;
        }
      }
    }
    if (!cand) {
      candidateMap.set(key, {
        id: place.placeId || place.id,
        title: place.name,
        address: place.address,
        lat: place.lat,
        lon: place.lon,
        uses: 0,
        durationSum: 0,
        lastTimestamp: now - 12 * 3600 * 1000,
        isSavedPlace: true,
      });
      continue;
    }
    cand.isSavedPlace = true;
    if (mergedByDistance) {
      // Nazwa i współrzędne przypiętego miejsca są kanoniczne — użytkownik
      // sam je wpisał i tak wyglądają w „Zapisane miejsca".
      cand.title = place.name;
      cand.address = place.address;
      cand.lat = place.lat;
      cand.lon = place.lon;
      cand.id = key;
    }
  }

  // 5. Ranking: częstotliwość pierwsza, świeżość tylko jako gaszenie.
  const scored = Array.from(candidateMap.values())
    .map((cand) => ({
      cand,
      score: scoreCandidate(cand.uses, cand.lastTimestamp, cand.isSavedPlace, now),
    }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.cand.uses - a.cand.uses ||
        b.cand.lastTimestamp - a.cand.lastTimestamp ||
        a.cand.title.localeCompare(b.cand.title),
    );

  return scored.slice(0, limit).map(({ cand }) => ({
    id: cand.id,
    title: cand.title,
    address: cand.address,
    frequency: Math.max(1, cand.uses),
    // Przypięte miejsce bez historii nie ma pomiaru — dostaje wartość domyślną.
    avgDurationMin: cand.uses > 0 ? Math.max(1, Math.round(cand.durationSum / cand.uses)) : FALLBACK_TRIP_MIN,
    lat: cand.lat,
    lon: cand.lon,
    originId,
  }));
}
