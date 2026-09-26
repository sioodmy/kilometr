import type { Connection, Leg } from '../../types/models';

// Model domenowy powiadomień. Wszystko, co leci do natywnego świata
// (Notification, Live Activity, natywny moduł Androida), jest tutaj
// sprowadzane do jednego strukturalnego opisu — dzięki temu treść
// powiadomienia, Dynamic Island i pasek postępu na Androidzie zawsze
// pokazują to samo, a formatowanie tekstu jest w jednym miejscu.

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
  /** Postęp całej podróży 0..1 (0 = start, 1 = cel). Do paska postępu. */
  progress: number;
  /** Postęp wewnątrz bieżącego odcinka 0..1. */
  legProgress: number;

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
  /** Kolor linii — akcent powiadomienia i plakietka w Dynamic Island. */
  lineColor: string;
  /** Kierunek kursu (np. 'BISKUPIN'). */
  direction: string;

  /** Następny przystanek i ile do niego zostało. */
  nextStop: string | null;
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
  /** Odjazd, na który trzeba wyjść (po dojściu). */
  boardAtMs: number;

  fromTitle: string;
  toTitle: string;
}

/**
 * Stan przekazywany do Live Activity (iOS). Musi być w pełni serializowalny —
 * leci przez mostek do izolowanego bundle'u widgetu. Dlatego same liczby
 * i stringi, nigdy Date/Color/Function.
 */
export interface TripActivityProps {
  phase: TripPhase;
  line: string;
  lineColor: string;
  lineMode: 'tram' | 'bus' | 'walk';
  direction: string;
  nextStop: string;
  nextStopInMin: number;
  stopsLeft: number;
  etaMin: number;
  arriveAt: string;
  departAt: string;
  progress: number;
  delayMin: number;
  live: boolean;
  vehicleTracked: boolean;
  toTitle: string;
  /** Znaczniki ms — widget sam tworzy z nich Date dla timera systemowego. */
  nowMs: number;
  departAtMs: number;
  arriveAtMs: number;
  boardAtMs: number;
  walkMeters: number;
  transfers: number;
}

/** Stan, na który budujemy natywną (Android) powiadomienie śledzące. */
export interface NativeTrackingState {
  phase: TripPhase;
  title: string;
  text: string;
  subText: string;
  lineColor: string;
  /** 0..1000 — tak oczekuje tego Notification.setProgress. */
  progress: number;
  /** 0..1000 — pasek „do przystanku”, osobny od postępu całej podróży. */
  boardProgress: number;
  /** ms — odlicza zegar systemowy (setWhen + chronometr). */
  countdownAtMs: number;
  countdownLabel: string;
  /** true gdy licznik ma odliczać w dół do countdownAtMs. */
  countdownDown: boolean;
  showProgress: boolean;
  showCountdown: boolean;
  live: boolean;
  delayMin: number;
  deepLink: string;
  actions: { id: string; title: string; destructive: boolean }[];
}

/** Ustawienia powiadomień (osobne od ustawień trasowania). */
export interface NotificationPreferences {
  /** Ciche aktualizacje w trayu / Live Activity — główna funkcja. */
  trackingEnabled: boolean;
  /** Powiadomienia dźwiękowe „wyjdź za 5 min”. */
  departureAlertsEnabled: boolean;
  /** Powiadomienia o opóźnieniach i zmianach kursu. */
  disruptionAlertsEnabled: boolean;
  /** Ile minut przed odjazdem ostrzec (domyślnie 5). */
  departureAlertLeadMin: number;
  /** Głośne ostrzeżenie w fazie oczekiwania (ostatnie minuty). */
  imminentAlert: boolean;
  /** Live Activity / pasek postępu — iOS + Android. */
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

/** Dane do deep linku z powiadomienia / Live Activity. */
export interface TripLinkParams {
  fromTitle: string;
  fromLat: string;
  fromLon: string;
  toId: string;
  toTitle: string;
  toLat: string;
  toLon: string;
}
