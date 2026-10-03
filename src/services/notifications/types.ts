import type { Connection, Leg } from '../../types/models';

// Model domenowy powiadomień. Wszystko, co leci do natywnego świata
// (Notification i serwis Androida), jest tutaj sprowadzane do jednego
// strukturalnego opisu — dzięki temu plan powiadomienia, tekst alertu
// odjazdu i pasek postępu zawsze opowiadają o tym samym kursie, a
// formatowanie czasu jest w jednym miejscu.

/** Faza podróży — steruje tym, co jest najważniejsze w danym momencie. */
export type TripPhase =
  /** Dojście do przystanku — zanim wsiadłeś. */
  | 'walking'
  /** Stoisz na przystanku, pojazd jeszcze nie odjechał. */
  | 'waiting'
  /** Jedziesz. */
  | 'riding'
  /** Przesiadka: albo dojście, albo oczekiwanie na kolejny pojazd. */
  | 'transfer'
  /** Jesteś na miejscu. */
  | 'arrived';

/** Stan, na którym budujemy treść powiadomienia. Wyliczany z Connection + zegarek + GPS. */
export interface TripProgress {
  phase: TripPhase;
  /**
   * Czas (ms), dla którego policzono ten stan. Wszystko poniżej liczone
   * względem `Date.now()` dałoby wynik zależny od zegara systemowego i psuło
   * powtarzalność — a po drodze okazało się, że `showCountdown` dla stanu
   * policzonego w przeszłości wychodził „nie pokazuj licznika".
   */
  computedAt: number;
  /** Postęp całej podróży 0..1 (0 = start, 1 = cel). Do paska postępu. */
  progress: number;
  /** Postęp wewnątrz bieżącego odcinka 0..1. */
  legProgress: number;
  /**
   * Postęp dojścia do przystanku 0..1 — null gdy nie idziemy pieszo. W fazie
   * „idę" to jedyna liczba, która ma sens: podróż jeszcze się nie zaczęła,
   * więc `progress` byłby zerem przez całe oczekiwanie.
   */
  approachProgress: number | null;

  /** Odjazd pierwszego pojazdu: ile sekund (może być ujemne = po odjeździe). */
  departInSec: number;
  /** 'HH:MM' odjazdu i przyjazdu — do tekstu, nie do animacji. */
  departAt: string;
  arriveAt: string;
  /** Bezwzględne znaczniki w ms — zegar systemowy liczy z nich odliczanie. */
  departAtMs: number;
  arriveAtMs: number;

  /** Ile minut do celu (może być ujemne po przyjeździe). */
  etaMin: number;

  /** Bieżący odcinek, null gdy jeszcze nie wsiadłeś albo już jesteś. */
  leg: Leg | null;
  legIndex: number;
  /** Liczba odcinków łącznie. */
  legCount: number;

  /** Linia pojazdu, którym wsiadasz / jedziesz. */
  line: string;
  lineMode: 'tram' | 'bus' | 'walk';
  /** Kolor linii — akcent powiadomienia i segmentu na pasku postępu. */
  lineColor: string;
  /** Kierunek kursu (np. 'BISKUPIN'). */
  direction: string;

  /** Następny przystanek i ile do niego zostało. Przed odjazdem bywa null. */
  nextStop: string | null;
  /** Przystanek, na którym jesteśmy (albo do którego idziemy). */
  stopName: string;
  nextStopInMin: number | null;
  /** Przystanki do celu (w tym ten, do którego zbliżasz się). */
  stopsLeft: number | null;

  /** Opóźnienie w minutach (+ = spóźniony). */
  delayMin: number;
  /** Czy mamy realne dane o pojeździe (GPS + dopasowanie do rozkładu). */
  live: boolean;
  /** Czy pozycję pojazdu udało się ustalić (nie tylko estymacja czasowa). */
  vehicleTracked: boolean;
  /** Gotowe zdanie o pozycji pojazdu, np. 'Pojazd: Dworcowa → Kazimierza'. */
  vehicleLabel: string | null;

  /** Miejsce przesiadki, jeśli jest. */
  interchange: string | null;
  transfers: number;

  /** Dojście do przystanku: metry i ile sekund zajmie. */
  walkMeters: number | null;
  walkSec: number | null;
  /** Odjazd, na który trzeba wyjść (po dojściu) — przy przesiadce kolejny. */
  boardAtMs: number;
  /** Ile sekund do tego odjazdu. Ujemne = po odjeździe. */
  boardInSec: number;

  fromTitle: string;
  toTitle: string;
}

/**
 * Stan, na którym budujemy natywne powiadomienie śledzące.
 *
 * Plan jest w całości przetłumaczony po stronie JS, a serwis Androida tylko
 * przelicza fazę i postęp z zegara. Dzięki temu powiadomienie przeżywa
 * zamknięcie aplikacji, a tekst wciąż jest po polsku / angielsku /
 * niemiecku / ukraińsku.
 */
export interface LivePlan {
  tripId: string;
  /** Deep link po tapnięciu w powiadomienie. */
  deepLink: string;
  /** Kolor linii — akcent paska postępu i całego powiadomienia. */
  accentColor: string;
  /** Początek podróży razem z dojściem pieszo, ms. */
  startAtMs: number;
  /** Przyjazd na miejsce, ms. */
  endAtMs: number;
  /** Cel licznika systemowego, ms. */
  countdownAtMs: number;
  /** true → licznik w dół do `countdownAtMs`, false → od niego w górę. */
  countdownDown: boolean;
  delayMin: number;
  /** Po tym czasie serwis sam przestanie aktualizować (0 = nie). */
  stopAfterMs: number;
  segments: LivePlanSegment[];
  copy: Record<TripPhase, LivePlanPhaseCopy>;
  actions: { id: 'stop' | 'route'; title: string }[];
}

/** Odcinek na pasku postępu: dojście pieszo albo przejazd pojazdem. */
export interface LivePlanSegment {
  mode: TripProgress['lineMode'];
  line: string;
  color: string;
  startAtMs: number;
  endAtMs: number;
}

/** Treść powiadomienia dla jednej fazy podróży. */
export interface LivePlanPhaseCopy {
  /** Tytuł — warunek konieczny, żeby Android dopuścił Live Update. */
  title: string;
  /** Linia pod tytułem. */
  text: string;
  /** Podpis przy liczniku systemowym. */
  subText: string;
  /** Chip w pasku stanu (Android 16.1+). */
  criticalText: string;
}

/** Ustawienia powiadomień (osobne od ustawień trasowania). */
export interface NotificationPreferences {
  /** Ciche, trwałe powiadomienie w trayu — główna funkcja. */
  trackingEnabled: boolean;
  /** Powiadomienia dźwiękowe „wyjdź za 5 min”. */
  departureAlertsEnabled: boolean;
  /** Powiadomienia o opóźnieniach i zmianach kursu. */
  disruptionAlertsEnabled: boolean;
  /** Ile minut przed odjazdem ostrzec (domyślnie 5). */
  departureAlertLeadMin: number;
  /** Głośne ostrzeżenie w fazie oczekiwania (ostatnie minuty). */
  imminentAlert: boolean;
  /** Pasek postępu i licznik systemowy (natywne Live Update). */
  liveProgressEnabled: boolean;
}

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  trackingEnabled: true,
  departureAlertsEnabled: true,
  disruptionAlertsEnabled: true,
  departureAlertLeadMin: 5,
  imminentAlert: true,
  liveProgressEnabled: true,
};

/** Kontekst powiadomienia: co użytkownik śledzi i skąd ma wrócić po tapnięciu. */
export interface TrackedTrip {
  id: string;
  fromTitle: string;
  fromLat: number;
  fromLon: number;
  toId: string;
  toTitle: string;
  toLat: number;
  toLon: number;
  anchorStopId?: string;
  anchorStopLat?: number;
  anchorStopLon?: number;
  /** Połączenie, na które użytkownik się zgodził (to samo, które widzi na liście). */
  connection: Connection;
  startedAt: number;
}

/** Dane do deep linku z powiadomienia. */
export interface TripLinkParams {
  fromTitle: string;
  fromLat: string;
  fromLon: string;
  toId: string;
  toTitle: string;
  toLat: string;
  toLon: string;
}
