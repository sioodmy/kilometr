import { getLineColors, inferTransitMode } from '../../components/LineBadge';
import type { Connection } from '../../types/models';
import {
  countdownText,
  delayText,
  formatClock,
  formatDistance,
  minutesText,
  toPermille,
  untilText,
} from './format';
import type {
  NativeTrackingState,
  TripActivityProps,
  TripProgress,
  TrackedTrip,
} from './types';

// Tekst powiadomienia. Jedna funkcja → trzy miejsca docelowe (natywna
// powiadomienie Androida, awaryjne expo-notifications, karta w aplikacji),
// dzięki czemu nigdy nie zdarzy się, że tray mówi jedno, a ekran drugie.
//
// Hierarchia jest świadoma: tytuł = „co się dzieje teraz”, podtytuł = „gdzie
// jedziemy / jaki jest następny krok”, treść = liczby, których użytkownik
// naprawdę potrzebuje (dystans, ETA, opóźnienie). Nic więcej — powiadomienie
// ma być czytelne jednym wzrokiem na ekranie blokady.

export interface TripCopy {
  title: string;
  subtitle: string;
  body: string;
  /** Tekst przy liczniku, np. 'do odjazdu'. */
  countdownCaption: string;
  countdownAtMs: number;
  countdownDown: boolean;
  /** Pasek postępu: 0..1000. */
  progressPermille: number;
  showProgress: boolean;
  accentColor: string;
}

function lineLabel(p: TripProgress): string {
  const kind = inferTransitMode(p.lineMode === 'walk' ? 'walk' : undefined, p.line);
  if (kind === 'walk') return 'Pieszo';
  return kind === 'tram' ? 'Tramwaj' : 'Autobus';
}

function chainLabel(conn: Connection): string {
  const lines = conn.legs
    .filter((l) => l.mode !== 'walk')
    .map((l) => l.line)
    .filter(Boolean);
  return lines.join(' → ');
}

function stopsLabel(n: number | null): string {
  if (n == null) return '';
  if (n === 0) return 'ostatni przystanek';
  if (n === 1) return '1 przystanek';
  if (n < 5) return `${n} przystanki`;
  return `${n} przystanków`;
}

/** Opóźnienie dopisane tylko wtedy, gdy faktycznie coś zmienia decyzję. */
function delaySuffix(p: TripProgress): string {
  if (p.delayMin >= 2) return ` • opóźnienie +${Math.round(p.delayMin)} min`;
  if (p.delayMin <= -2) return ` • spieszy ${Math.abs(Math.round(p.delayMin))} min`;
  return '';
}

export function buildTripCopy(p: TripProgress, conn: Connection): TripCopy {
  const accent = p.lineColor || getLineColors(p.line || undefined, p.line?.length ? undefined : 'walk').bg;

  switch (p.phase) {
    case 'arrived':
      return {
        title: 'Jesteś na miejscu',
        subtitle: `${p.toTitle} • ${p.arriveAt}`,
        body: `Podróż trwała ${minutesText(conn.durationMin)}`,
        countdownCaption: '',
        countdownAtMs: p.arriveAtMs,
        countdownDown: false,
        progressPermille: 1000,
        showProgress: false,
        accentColor: accent,
      };

    case 'walking': {
      const walk = p.walkMeters != null ? formatDistance(p.walkMeters) : '';
      const walkMin = p.walkSec != null ? minutesText(p.walkSec / 60) : '';
      const departIn = Math.max(0, p.departInSec);
      return {
        title: walk ? `Idź na przystanek • ${walk}` : 'Idź na przystanek',
        subtitle: `${lineLabel(p)} ${p.line} o ${p.departAt}`,
        body: [
          walkMin ? `dojście ${walkMin}` : '',
          `wyjście ${countdownText(departIn)}`,
          chainLabel(conn),
        ]
          .filter(Boolean)
          .join(' • '),
        countdownCaption: 'do odjazdu',
        countdownAtMs: p.boardAtMs,
        countdownDown: true,
        progressPermille: toPermille(p.walkSec ? 1 - p.walkSec / Math.max(1, p.departInSec) : 0),
        showProgress: p.walkSec != null && departIn > 0,
        accentColor: accent,
      };
    }

    case 'waiting': {
      const platform = p.leg?.platformCode ? ` • słup ${p.leg.platformCode}` : '';
      return {
        title: `${lineLabel(p)} ${p.line} • ${untilText(p.departInSec)}`,
        subtitle: p.direction ? `Do ${p.direction}` : chainLabel(conn) || p.toTitle,
        body: [
          `odjazd ${p.departAt}`,
          p.leg ? `przystanek ${p.leg.fromStop}` : '',
          `${p.transfers} ${p.transfers === 1 ? 'przesiadka' : 'przesiadki'}`,
          delaySuffix(p),
          platform,
        ]
          .filter(Boolean)
          .join(' • '),
        countdownCaption: 'do odjazdu',
        countdownAtMs: p.boardAtMs,
        countdownDown: true,
        progressPermille: 0,
        showProgress: false,
        accentColor: accent,
      };
    }

    case 'transfer': {
      const walk = p.walkMeters != null ? formatDistance(p.walkMeters) : '';
      const next = p.leg ? `${lineLabel(p)} ${p.line}` : 'kolejny pojazd';
      return {
        title: `Przesiadka • ${next}`,
        subtitle: p.interchange ?? (p.leg ? p.leg.fromStop : p.toTitle),
        body: [
          walk ? `dojście ${walk}` : '',
          `${next} ${untilText(p.departInSec)}`,
          stopsLabel(p.stopsLeft),
        ]
          .filter(Boolean)
          .join(' • '),
        countdownCaption: 'do odjazdu',
        countdownAtMs: p.boardAtMs,
        countdownDown: true,
        progressPermille: toPermille(p.progress),
        showProgress: p.progress > 0.02,
        accentColor: accent,
      };
    }

    case 'riding':
    default: {
      const eta = Math.max(0, p.etaMin);
      const next = p.nextStop ? `następny ${p.nextStop}` : p.toTitle;
      const hops = stopsLabel(p.stopsLeft);
      const body = [
        next,
        hops,
        `na miejscu ${p.arriveAt}`,
        p.vehicleLabel ?? delaySuffix(p),
      ]
        .filter(Boolean)
        .join(' • ');
      return {
        title: `${lineLabel(p)} ${p.line} • ${minutesText(eta)} do celu`,
        subtitle: p.nextStop
          ? `Za ${hops || 'chwilę'} • ${p.nextStop}`
          : p.direction
            ? `Do ${p.direction}`
            : p.toTitle,
        body,
        countdownCaption: 'do celu',
        countdownAtMs: p.arriveAtMs,
        countdownDown: p.etaMin > 0,
        progressPermille: toPermille(p.progress),
        showProgress: true,
        accentColor: accent,
      };
    }
  }
}

/** Props do Live Activity — ta sama informacja, tylko dla widgetu. */
export function buildActivityProps(p: TripProgress): TripActivityProps {
  return {
    phase: p.phase,
    line: p.line || '•',
    lineColor: p.lineColor,
    lineMode: p.lineMode,
    direction: p.direction || '',
    nextStop: p.nextStop ?? p.toTitle,
    nextStopInMin: p.nextStopInMin ?? 0,
    stopsLeft: p.stopsLeft ?? 0,
    etaMin: Math.max(0, p.etaMin),
    arriveAt: p.arriveAt,
    departAt: p.departAt,
    progress: p.progress,
    delayMin: p.delayMin,
    live: p.live,
    vehicleTracked: p.vehicleTracked,
    toTitle: p.toTitle,
    nowMs: Date.now(),
    departAtMs: p.departAtMs,
    arriveAtMs: p.arriveAtMs,
    boardAtMs: p.boardAtMs,
    walkMeters: p.walkMeters ?? 0,
    transfers: p.transfers,
  };
}

/** Stan dla natywnej powiadomienia śledzącej na Androidzie. */
export function buildNativeState(
  p: TripProgress,
  conn: Connection,
  deepLink: string,
  withActions: boolean,
): NativeTrackingState {
  const copy = buildTripCopy(p, conn);
  return {
    phase: p.phase,
    title: copy.title,
    text: copy.subtitle,
    subText: copy.body,
    lineColor: copy.accentColor,
    progress: copy.progressPermille,
    boardProgress: p.walkSec
      ? toPermille(1 - p.walkSec / Math.max(1, p.departInSec))
      : 0,
    countdownAtMs: copy.countdownAtMs,
    countdownLabel: copy.countdownCaption,
    countdownDown: copy.countdownDown,
    showProgress: copy.showProgress,
    showCountdown: copy.countdownAtMs > Date.now(),
    live: p.live,
    delayMin: p.delayMin,
    deepLink,
    actions: withActions
      ? [
          { id: 'stop', title: 'Zakończ', destructive: true },
          { id: 'routes', title: 'Trasa', destructive: false },
        ]
      : [],
  };
}

/** Deep link do ekranu połączeń — te same parametry co w buildRoutesLink. */
export function buildTripLink(trip: TrackedTrip): string {
  const q: Record<string, string> = {
    fromTitle: trip.fromTitle,
    fromLat: String(trip.fromLat),
    fromLon: String(trip.fromLon),
    toId: trip.toId ?? '',
    toTitle: trip.toTitle,
    toLat: String(trip.toLat),
    toLon: String(trip.toLon),
  };
  const qs = Object.entries(q)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');
  return `kilometr://routes?${qs}`;
}

/** Godzina odjazdu w formacie zegara — używana w tytule monitu „wyjdź”. */
export function boardClock(p: TripProgress): string {
  return p.departAt || formatClock(0);
}

/** Ile sekund do odjazdu pierwszego pojazdu, licząc od teraz. */
export function departInSec(p: TripProgress): number {
  return p.departInSec;
}

export { delayText };
