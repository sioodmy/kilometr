import type { Strings } from '../../i18n/pl';
import { getLineColors, inferTransitMode } from '../lineIdentity';
import type { Connection } from '../../types/models';
import { clockFromMs, formatDistance, parseClock } from './format';
import { computeLegTimeline } from './tripProgress';
import type { LivePlan, LivePlanPhaseCopy, LivePlanSegment, TripPhase, TripProgress, TrackedTrip } from './types';

// Tekst powiadomienia — warstwa czysta.
//
// Zasada, która za tym stoi: liczbę, która zmienia się co sekundę, rysuje
// system (chronometr `setWhen` + `setUsesChronometer`), a my dostarczamy
// tekst, który z definicji nie zestarzeje — bezwzględne godziny („odjazd
// 14:32”), kierunki, nazwy przystanków, liczby przystanków. Dzięki temu plan
// można wysłać raz na fazę, a serwis Androida sam przelicza fazę i postęp co
// sekundę, także wtedy, gdy proces aplikacji leży.
//
// Słownik dostajemy argumentem, nie przez `tr()`, i to celowo: moduł ma nie
// ciągnąć `react-native` za sobą, bo `check:notifications` liczy te same
// rzeczy w czystym node. Wywołujący (`presenter.ts`, `alerts.ts`) używają `tr()`.

/** Neutralny kolor dojść i przesiadek — wspólny dla wszystkich linii. */
export const WALK_SEGMENT_COLOR = '#8A8F98';

export interface TripCopy {
  title: string;
  subtitle: string;
  body: string;
}

/**
 * Treść powiadomienia dla każdej fazy naraz. Serwis nie zna polskiej odmiany
 * ani słownika, więc wybiera gotowy wariant na podstawie zegara — dzięki
 * temu po zamknięciu aplikacji faza zmienia się dalej, a tekst wciąż jest
 * przetłumaczony i poprawnie odmieniony.
 *
 * Układ jest jednolity i odpowiada na jedno pytanie: „co teraz robię?”.
 * Tytuł zawsze niesie kurs i GODZINĘ BEZWZGLĘDNĄ (razem z etykietą „odjazd”
 * w jednej linii — zegar systemowy tyka obok, ale sam nie wie, do czego
 * liczy), a pod spodem stoją odpowiedzi na pytania właściwe dla fazy:
 * przy dojściu — który przystanek i w jakim kierunku, przy przesiadce — to
 * samo plus ile dojścia, w trakcie jazdy — gdzie wysiadam i ile przystanków
 * zostało. Nigdzie nie ma czasu względnego („za 4 min”), bo zamarzałby po
 * zamknięciu aplikacji.
 */
export function buildPhaseCopy(
  p: TripProgress,
  conn: Connection,
  s: Strings,
): Record<TripPhase, LivePlanPhaseCopy> {
  const n = s.notification;
  const mode = modeLabel(p.lineMode, s);
  const service = p.line ? `${mode} ${p.line}` : mode;
  // Godzina z tego samego znacznika, na który celuje licznik systemowy —
  // inaczej tytuł obiecywałby jeden odjazd, a odliczanie szło do drugiego.
  const boardAt = clockFromMs(p.boardAtMs);
  const arriveAt = p.arriveAt;
  // Przystanek, na którym wsiadamy (albo do którego idziemy) i kierunek.
  const boardStop = p.leg?.fromStop ?? '';
  const boarding = join(
    boardStop ? n.stopHere(boardStop) : '',
    p.direction ? n.directionTo(p.direction) : '',
    p.leg?.platformCode ? n.platform(p.leg.platformCode) : '',
  );

  const walkMeters = upcomingWalkMeters(p, conn);
  const walkText = walkMeters != null && walkMeters > 0 ? formatDistance(walkMeters) : '';
  const walkMin = p.walkSec != null ? Math.round(p.walkSec / 60) : null;
  const walk = join(
    walkText,
    walkMin != null && walkMin > 0 ? n.walkApproach(walkMin) : '',
  );
  const stops = p.stopsLeft != null && p.stopsLeft > 0 ? n.stops(p.stopsLeft) : '';
  const transfers = p.transfers > 0 ? n.transfers(p.transfers) : '';
  const delay =
    p.delayMin >= 2
      ? n.delayLate(p.delayMin)
      : p.delayMin <= -2
        ? n.delayEarly(p.delayMin)
        : '';
  const vehicle = p.vehicleLabel ? n.vehicleAt(p.vehicleLabel) : '';
  // Ile trwa przejazd kursem, na którym czekamy. Liczba z rozkładu, więc nie
  // zestarzeje się przy zamkniętej aplikacji.
  const ride = rideLengthMin(p, s);

  return {
    walking: {
      title: n.departTitle(service, boardAt),
      text: boarding,
      subText: join(walk, transfers),
      criticalText: n.chipDepart(boardAt),
    },

    waiting: {
      title: n.departTitle(service, boardAt),
      text: boarding,
      // Przy oczekiwaniu liczy się jeszcze, ile potrwa sam przejazd i czy
      // trzeba będzie gdzieś przesiadać.
      subText: join(stops, ride, transfers, delay),
      criticalText: n.chipDepart(boardAt),
    },

    transfer: {
      title: n.transferTitle(service, boardAt),
      // Nazwa przesiadki już mówi, na którym przystanku przesiadam — nie
      // powtarzamy jej w „przystanek X".
      text: interchangeName(p.interchange) ?? boarding,
      subText: join(walk, stops, delay),
      criticalText: n.chipDepart(boardAt),
    },

    riding: {
      title: n.rideTitle(service, arriveAt),
      // Godziny przyjazdu nie powtarzamy — jest już w tytule. Tu liczy się
      // tylko to, czego tytuł nie mówi: gdzie dojeżdżamy i ile to potrwa.
      text: join(
        p.leg?.toStop ? n.alightAt(p.leg.toStop) : '',
        p.direction ? n.directionTo(p.direction) : '',
      ),
      subText: join(p.nextStop ? n.nextStop(p.nextStop) : '', stops, delay || vehicle),
      criticalText: n.chipArrive(arriveAt),
    },

    arrived: {
      title: n.arrivedTitle,
      text: n.arrivedBody(arriveAt, s.common.durMin(conn.durationMin)),
      subText: '',
      criticalText: n.chipArrive(arriveAt),
    },
  };
}

/**
 * Nazwa przesiadki bez etykiety. Planer często zwraca „Przesiadka: Rondo”,
 * a tytuł i tak zaczyna się od słowa „Przesiadka” — zdejmujemy wyłącznie
 * powtórzony wyraz, a jak nazwa jest nietypowa, zostawiamy ją w całości.
 */
function interchangeName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const match = /^(przesiadka|przeładunek|zmiana|transfer|umstieg|пересадка)\s*[:\-]\s*(.+)$/i.exec(
    raw.trim(),
  );
  return match ? match[2] : raw;
}

/**
 * Ile minut trwa przejazd pojazdem, na którym użytkownik czeka. Bierzemy
 * różnicę godzin odcinka, a nie `durationMin` całej podróży — przy
 * przesiadce to dwie różne liczby, a myślimy o tym, co zaraz się ruszy.
 */
function rideLengthMin(p: TripProgress, s: Strings): string {
  if (!p.leg) return '';
  const depart = parseClock(p.leg.departAt);
  const arrive = parseClock(p.leg.arriveAt);
  if (depart == null || arrive == null) return '';
  const span = ((arrive - depart + 86400) % 86400) / 60;
  const min = Math.round(span);
  return min > 0 && min < 12 * 60 ? s.notification.rideLength(min) : '';
}

/**
 * Trzy pola zamiast całego planu — tyle potrzebują alerty odjazdu („wyjdź za
 * 5 minut", opóźnienie, „jesteś na miejscu"). Zdanie budujemy z bieżącej
 * fazy, żeby banner i powiadomienie nie opowiadały o różnych rzeczach.
 */
export function buildTripCopy(p: TripProgress, conn: Connection, s: Strings): TripCopy {
  const n = s.notification;
  const current = buildPhaseCopy(p, conn, s)[p.phase];
  return {
    title: current.title,
    subtitle: current.text,
    // Tylko fakty, których nie ma ani w tytule, ani w podtitle — powtórzenie
    // „na miejscu 14:25" w trzech miejscach wygląda jak błąd.
    body: join(
      p.leg?.platformCode ? n.platform(p.leg.platformCode) : '',
      p.delayMin >= 2 ? n.delayLate(p.delayMin) : '',
      p.vehicleLabel ? n.vehicleAt(p.vehicleLabel) : '',
    ),
  };
}

/**
 * Odcinki na pasku postępu. Dojścia pieszo dostają kolor neutralny, żeby nie
 * udawały linii, a przejazdy — kolor linii. Czasy przycinamy do okna
 * podróży, bo ostatni odcinek bywa wyliczony z `durationMin`, nie z rozkładu.
 */
export function buildSegments(
  timeline: ReturnType<typeof computeLegTimeline>,
  startAtMs: number,
  endAtMs: number,
): LivePlanSegment[] {
  const out: LivePlanSegment[] = [];
  for (const entry of timeline) {
    const from = Math.max(startAtMs, entry.departMs);
    const to = Math.min(endAtMs, entry.arriveMs);
    if (to <= from) continue;
    const mode = inferTransitMode(entry.leg.mode, entry.leg.line);
    out.push({
      mode,
      line: entry.leg.line ?? '',
      color:
        mode === 'walk'
          ? WALK_SEGMENT_COLOR
          : getLineColors(entry.leg.line || undefined, entry.leg.mode).bg,
      startAtMs: from,
      endAtMs: to,
    });
  }
  return out;
}

export interface BuildPlanOptions {
  /** Po tym czasie serwis ma przestać aktualizować powiadomienie (ms). */
  stopAfterMs?: number;
}

/**
 * Plan w całości — to leci do `LiveTripService` jako jeden JSON. Poza
 * godzinami i listą odcinków serwis sam liczy fazę i postęp z zegara, więc
 * tekst musi być bezwzględny: „odjazd 14:32" nie starzeje się, „za 4 min"
 * starzeje się przy pierwszym odświeżeniu.
 */
export function buildLivePlan(
  p: TripProgress,
  conn: Connection,
  trip: TrackedTrip,
  s: Strings,
  options: BuildPlanOptions = {},
): LivePlan {
  const timeline = computeLegTimeline(conn, new Date(p.computedAt));
  // Pasek obejmuje CAŁĄ podróż razem z dojściem pieszo. Liczony od odjazdu
  // pierwszego pojazdu dawałby pusty pasek przez całe oczekiwanie i skok
  // w trakcie dojścia.
  const startAtMs = timeline.length > 0 ? timeline[0].departMs : p.departAtMs;
  const endAtMs = p.arriveAtMs;
  // Do czego liczy zegar systemowy. Przed odjazdem (i przy przesiadce)
  // użytkownik myśli o ODJEŹDZIE, w trakcie jazdy — o PRZYJEŹDZIE.
  // `boardAtMs` w fazie „jadę" celuje w odjazd, który już był, więc licznik
  // zamarzałby na tej samej wartości przez całą trasę.
  const waiting =
    p.phase === 'walking' || p.phase === 'waiting' || p.phase === 'transfer';
  const countdownAtMs = waiting ? p.boardAtMs : p.arriveAtMs;
  // Po przekroczeniu celu licznik liczy w górę („14:51 • 3 min") zamiast
  // pokazywać ujemne minuty.
  const countdownDown = countdownAtMs > p.computedAt;

  return {
    tripId: trip.id,
    deepLink: buildTripLink(trip),
    accentColor:
      p.lineColor || getLineColors(p.line || undefined, p.lineMode === 'walk' ? 'walk' : undefined).bg,
    startAtMs,
    endAtMs,
    countdownAtMs,
    countdownDown,
    delayMin: Math.round(p.delayMin),
    stopAfterMs: options.stopAfterMs ?? 0,
    segments: buildSegments(timeline, startAtMs, endAtMs),
    copy: withDelayedChip(buildPhaseCopy(p, conn, s), p.delayMin, s),
    // Po przyjeździe „Zakończ" nie ma już czego kończyć — przycisk zmienia się
    // na potwierdzenie. Plan i tak przychodzi na każdą zmianę fazy, więc etykieta
    // dojeżdża razem z resztą treści.
    actions: [
      {
        id: 'stop',
        title: p.phase === 'arrived' ? s.notification.actionOk : s.notification.actionStop,
      },
      { id: 'route', title: s.notification.actionRoute },
    ],
  };
}

/** Serializuje plan do JSON-u, który leci jako jeden intent do serwisu. */
export function buildLivePlanJson(
  p: TripProgress,
  conn: Connection,
  trip: TrackedTrip,
  s: Strings,
  options: BuildPlanOptions = {},
): string {
  return JSON.stringify(buildLivePlan(p, conn, trip, s, options));
}

/**
 * Opóźnienie w kolorze i w chipie. Chip w pasku stanu ma jedno miejsce,
 * a opóźnienie zmienia decyzję użytkownika bardziej niż godzina przyjazdu.
 */
function withDelayedChip(
  copy: Record<TripPhase, LivePlanPhaseCopy>,
  delayMin: number,
  s: Strings,
): Record<TripPhase, LivePlanPhaseCopy> {
  if (delayMin < 2) return copy;
  const chip = s.notification.chipDelay(delayMin);
  return Object.fromEntries(
    Object.entries(copy).map(([phase, value]) => [phase, { ...value, criticalText: chip }]),
  ) as Record<TripPhase, LivePlanPhaseCopy>;
}

function modeLabel(mode: TripProgress['lineMode'], s: Strings): string {
  return mode === 'walk'
    ? s.notification.modeWalk
    : mode === 'tram'
      ? s.notification.modeTram
      : s.notification.modeBus;
}

/**
 * Ile trzeba dojść do pojazdu.
 *
 * `TripProgress.walkMeters` bywa zerem przed startem dojścia, bo `tripProgress`
 * szuka tylko ODCINKA, który już trwa. Tymczasem to jest właśnie chwila, w
 * której dystans jest najważniejszy — użytkownik stoi w domu i musi zdecydować,
 * czy zdąży. Dlatego przy pierwszym wsiadaniu sięgamy po dojście stojące
 * przed pierwszym pojazdem, nawet jeśli jeszcze nie ruszyliśmy.
 */
function upcomingWalkMeters(p: TripProgress, conn: Connection): number | null {
  if (p.walkMeters != null) return p.walkMeters;
  if (p.phase !== 'walking') return null;
  const boardIndex = conn.legs.findIndex((l) => l.mode !== 'walk');
  if (boardIndex <= 0) return null;
  const prev = conn.legs[boardIndex - 1];
  return prev.mode === 'walk' ? (prev.walkM ?? null) : null;
}

function join(...parts: (string | null | undefined)[]): string {
  return parts.filter(Boolean).join(' • ');
}

// ─── Deep linki ────────────────────────────────────────────────────────────

/** Deep link do ekranu połączeń — te same parametry co w buildRoutesLink. */
export function buildTripLink(trip: TrackedTrip): string {
  return `kilometr://routes?${queryString(tripParams(trip))}`;
}

function tripParams(trip: TrackedTrip): Record<string, string> {
  return {
    fromTitle: trip.fromTitle,
    fromLat: String(trip.fromLat),
    fromLon: String(trip.fromLon),
    toId: trip.toId ?? '',
    toTitle: trip.toTitle,
    toLat: String(trip.toLat),
    toLon: String(trip.toLon),
  };
}

function queryString(q: Record<string, string>): string {
  return Object.entries(q)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');
}

/**
 * `data` powiadomienia. Płaskie pola, bo po tapnięciu `expo-notifications`
 * oddaje je niezmienione i `app/_layout` przekłada je 1:1 na parametry
 * trasy. Znacznik czasu jest potrzebny, bo `getLastNotificationResponseAsync`
 * zwraca ostatnią odpowiedź **w całej historii** — bez niego apka otwarta
 * godzinę po tapnięciu znowu skoczyłaby na ekran połączeń.
 */
export function tripNotificationData(trip: TrackedTrip, alert?: string): Record<string, unknown> {
  return {
    kind: 'trip',
    at: Date.now(),
    ...(alert ? { alert } : {}),
    ...tripParams(trip),
  };
}