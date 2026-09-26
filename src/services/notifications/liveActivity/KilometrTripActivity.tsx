import { HStack, Image, ProgressView, Spacer, Text, VStack } from '@expo/ui/swift-ui';
import {
  activityBackgroundTint,
  background,
  font,
  foregroundStyle,
  lineLimit,
  minimumScaleFactor,
  monospacedDigit,
  padding,
  progressViewStyle,
  shapes,
  tint,
} from '@expo/ui/swift-ui/modifiers';
import { createLiveActivity, type LiveActivityEnvironment } from 'expo-widgets';
import type { TripActivityProps } from '../types';

// Live Activity (Dynamic Island + ekran blokady) dla śledzonej podróży.
//
// UWAGA na regułę z 'widget': ten komponent jest serializowany do osobnego
// bundle'a i działa w izolowanym runtime. Nie wolno tu użyć hooków, importów
// spoza pliku ani referencji do rzeczy z zakresu modułu (stałych i helperów
// na poziomie pliku) — bundler wycina ciało funkcji, więc każda pomocnicza
// funkcja i każdy kolor musi być zadeklarowany WEWNĄTRZ KilometrTripActivity.
//
// Odliczanie i pasek postępu robi system (timerInterval), więc licznik tyka
// co sekundę bez budzenia JS i bez zużycia baterii — tak, jak zegar w Mapach
// Google na ekranie blokady.

export const TRIP_ACTIVITY_NAME = 'KilometrTripActivity';

const KilometrTripActivity = (props: TripActivityProps, environment: LiveActivityEnvironment) => {
  'widget';

  // ─── Paleta (wewnątrz funkcji — zakres modułu nie trafia do bundle'a) ─────
  const ACCENT = '#5CDBBE';
  const MUTED = '#BFC9C5';
  const SURFACE = '#1B2120';
  const WARNING = '#FFB957';
  const SUCCESS = '#7DD895';
  // Always-On: mniej wypełnień i jaśniejsze odcienie, żeby nie biło po oczach.
  const reduced = environment.isLuminanceReduced === true;
  const ink = reduced ? '#FFFFFF' : '#E0E3E1';
  const muted = reduced ? '#C8D0CD' : MUTED;

  const line = props.line || '•';
  const lineColor = props.lineColor || ACCENT;
  const isWalk = props.lineMode === 'walk';
  const arrived = props.phase === 'arrived';
  const waiting = props.phase === 'walking' || props.phase === 'waiting';

  const symbol = arrived
    ? 'checkmark.circle.fill'
    : isWalk
      ? 'figure.walk'
      : props.lineMode === 'tram'
        ? 'tram.fill'
        : 'bus.fill';

  // ─── Zakresy czasowe dla zegara systemowego ──────────────────────────────
  // lower musi być <= upper (ClosedRangeDate), a pozycje końców dobieramy tak,
  // żeby licznik zawsze pokazywał sensowną wartość: przed startem i w trakcie
  // odlicza do celu, po tym liczy w górę od zdarzenia.
  const range = (fromMs: number, toMs: number): { lower: Date; upper: Date } => {
    const a = new Date(fromMs);
    const b = new Date(toMs);
    if (b.getTime() <= a.getTime()) {
      return { lower: a, upper: new Date(a.getTime() + 1000) };
    }
    const now = new Date();
    if (now.getTime() <= a.getTime()) return { lower: now, upper: b };
    if (now.getTime() >= b.getTime()) return { lower: a, upper: new Date(now.getTime() + 1000) };
    return { lower: now, upper: b };
  };

  // Co jest teraz najważniejsze: dojazd na przystanek czy przyjazd na miejsce.
  const targetFromMs = waiting ? Math.min(props.departAtMs, props.boardAtMs) : props.departAtMs;
  const targetMs = waiting ? props.boardAtMs : props.arriveAtMs;
  const targetRange = range(targetFromMs, targetMs);
  const tripRange = range(props.departAtMs, props.arriveAtMs);
  const countUp = arrived || Date.now() > targetMs;

  // ─── Teksty ─────────────────────────────────────────────────────────────
  const statusText = (): string => {
    if (arrived) return 'Jesteś na miejscu';
    if (props.phase === 'walking') return 'Idź na przystanek';
    if (props.phase === 'waiting') return 'Czekaj na pojazd';
    if (props.phase === 'transfer') return 'Przesiadka';
    return props.direction ? `Do ${props.direction}` : 'W trasie';
  };

  const detailText = (): string => {
    if (arrived) return `Cel: ${props.toTitle}`;
    if (props.phase === 'walking' && props.walkMeters > 0) {
      return `${Math.round(props.walkMeters)} m do przystanku`;
    }
    if (props.nextStop) {
      const hops = props.stopsLeft > 0
        ? ` · ${props.stopsLeft} ${props.stopsLeft === 1 ? 'przystanek' : props.stopsLeft < 5 ? 'przystanki' : 'przystanków'}`
        : '';
      return `Następny: ${props.nextStop}${hops}`;
    }
    if (props.phase === 'transfer') return 'Przejście na kolejny pojazd';
    return `Cel: ${props.toTitle}`;
  };

  const etaText = (): string => (arrived ? props.arriveAt : `na miejscu ${props.arriveAt}`);

  const delayText = (): string => {
    if (props.delayMin >= 1) return `opóźnienie +${Math.round(props.delayMin)} min`;
    if (props.delayMin <= -1) return `spieszy ${Math.abs(Math.round(props.delayMin))} min`;
    return 'punktualnie';
  };

  // ─── Elementy wspólne ───────────────────────────────────────────────────
  const lineBadge = (size: number) => (
    <HStack
      spacing={0}
      modifiers={[
        background(isWalk ? muted : lineColor, shapes.roundedRectangle({ cornerRadius: 6 })),
        padding({ horizontal: size >= 40 ? 8 : 5, vertical: size >= 40 ? 3 : 1 }),
      ]}
    >
      <Text
        modifiers={[
          font({ size, weight: 'bold', design: 'rounded' }),
          foregroundStyle(isWalk ? '#111414' : '#FFFFFF'),
          lineLimit(1),
          minimumScaleFactor(0.6),
        ]}
      >
        {line}
      </Text>
    </HStack>
  );

  const modeIcon = (size: number) => (
    <Image
      systemName={symbol}
      size={size}
      color={arrived ? SUCCESS : isWalk ? muted : lineColor}
    />
  );

  // Pasek postępu: system sam go opróżnia między departAt a arriveAt.
  const progressBar = () => (
    <ProgressView
      timerInterval={tripRange}
      countsDown={!arrived}
      modifiers={[
        progressViewStyle('linear'),
        tint(arrived ? SUCCESS : props.progress > 0.02 ? lineColor : muted),
      ]}
    />
  );

  const countdownText = (size: number, color: string) => (
    <Text
      timerInterval={targetRange}
      countsDown={!countUp}
      modifiers={[
        font({ size, weight: 'semibold', design: 'rounded' }),
        monospacedDigit(),
        foregroundStyle(color),
      ]}
    />
  );

  // ─── Ekran blokady ──────────────────────────────────────────────────────
  const banner = (
    <VStack
      spacing={6}
      alignment="leading"
      modifiers={[padding({ all: 14 }), activityBackgroundTint(SURFACE)]}
    >
      <HStack spacing={8}>
        {modeIcon(16)}
        {lineBadge(15)}
        <Text
          modifiers={[font({ size: 13, weight: 'semibold' }), foregroundStyle(ink), lineLimit(1)]}
        >
          {statusText()}
        </Text>
        <Spacer />
        <Text
          modifiers={[
            font({ size: 12, design: 'monospaced' }),
            monospacedDigit(),
            foregroundStyle(muted),
          ]}
        >
          {etaText()}
        </Text>
      </HStack>

      <Text
        modifiers={[
          font({ size: 15, weight: 'medium' }),
          foregroundStyle(ink),
          lineLimit(1),
          minimumScaleFactor(0.75),
        ]}
      >
        {detailText()}
      </Text>

      {progressBar()}

      <HStack spacing={8}>
        {countdownText(17, arrived ? SUCCESS : ACCENT)}
        <Text modifiers={[font({ size: 11 }), foregroundStyle(muted), lineLimit(1)]}>
          {waiting ? 'do odjazdu' : arrived ? '' : 'do celu'}
        </Text>
        <Spacer />
        {props.live ? (
          <Text
            modifiers={[
              font({ size: 11, weight: 'medium' }),
              foregroundStyle(props.delayMin >= 3 ? WARNING : muted),
              lineLimit(1),
            ]}
          >
            {props.vehicleTracked ? 'pojazd śledzony' : delayText()}
          </Text>
        ) : null}
      </HStack>
    </VStack>
  );

  // ─── Dynamic Island: wariant zwinięty ───────────────────────────────────
  const compactLeading = lineBadge(13);

  const compactTrailing = countdownText(15, ink);

  const minimal = modeIcon(16);

  // ─── Dynamic Island: wariant rozwinięty ─────────────────────────────────
  const expandedLeading = (
    <VStack spacing={4} alignment="leading" modifiers={[padding({ leading: 12, top: 10, bottom: 10 })]}>
      {lineBadge(17)}
      <Text
        modifiers={[
          font({ size: 11 }),
          foregroundStyle(muted),
          lineLimit(1),
          minimumScaleFactor(0.7),
        ]}
      >
        {props.transfers > 0
          ? `${props.transfers} ${props.transfers === 1 ? 'przesiadka' : props.transfers < 5 ? 'przesiadki' : 'przesiadek'}`
          : 'bez przesiadki'}
      </Text>
    </VStack>
  );

  const expandedTrailing = (
    <VStack
      spacing={0}
      alignment="trailing"
      modifiers={[padding({ trailing: 12, top: 10, bottom: 10 })]}
    >
      {countdownText(22, arrived ? SUCCESS : ACCENT)}
      <Text modifiers={[font({ size: 10 }), foregroundStyle(muted), lineLimit(1)]}>
        {waiting ? 'do odjazdu' : etaText()}
      </Text>
    </VStack>
  );

  const expandedBottom = (
    <VStack
      spacing={5}
      alignment="leading"
      modifiers={[padding({ leading: 12, trailing: 12, bottom: 10 })]}
    >
      <HStack spacing={6}>
        <Text
          modifiers={[
            font({ size: 12, weight: 'medium' }),
            foregroundStyle(ink),
            lineLimit(1),
            minimumScaleFactor(0.75),
          ]}
        >
          {detailText()}
        </Text>
        <Spacer />
        <Text
          modifiers={[
            font({ size: 11, design: 'monospaced' }),
            monospacedDigit(),
            foregroundStyle(muted),
          ]}
        >
          {etaText()}
        </Text>
      </HStack>
      {progressBar()}
    </VStack>
  );

  return {
    banner,
    bannerSmall: banner,
    compactLeading,
    compactTrailing,
    minimal,
    expandedLeading,
    expandedTrailing,
    expandedBottom,
  };
};

export default createLiveActivity<TripActivityProps>(TRIP_ACTIVITY_NAME, KilometrTripActivity);
