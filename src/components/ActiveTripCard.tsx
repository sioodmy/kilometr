import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { BusFront, CheckCircle2, Footprints, Navigation, TramFront, X } from 'lucide-react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { elev, scheme, shape, type } from '../theme/tokens';
import { getLineColors } from './LineBadge';
import { LiveDot } from './LiveDot';
import { countdownText, formatDistance, minutesText, plural, untilText } from '../services/notifications';
import type { TripProgress, TrackedTrip } from '../services/notifications';

// Karta aktywnej podróży. Pokazuje dokładnie to samo co powiadomienie i Live
// Activity — ta sama funkcja `buildTripCopy` stoi za tekstami, więc użytkownik
// nie musi zgadywać, czy to, co widzi na ekranie blokady, dotyczy tego samego
// kursu. Licznik tyka lokalnie (1 Hz) — tu nie ma powodu oszczędzać baterii,
// bo aplikacja i tak jest na pierwszym planie.

const TICK_MS = 1000;

const PHASE_LABEL: Record<TripProgress['phase'], string> = {
  walking: 'Idź na przystanek',
  waiting: 'Czekaj na pojazd',
  riding: 'W trasie',
  transfer: 'Przesiadka',
  arrived: 'Jesteś na miejscu',
};

function ModeIcon({ mode, color, size = 14 }: { mode: TripProgress['lineMode']; color: string; size?: number }) {
  if (mode === 'walk') return <Footprints size={size} color={color} strokeWidth={2.2} />;
  return mode === 'tram' ? (
    <TramFront size={size} color={color} strokeWidth={2.2} />
  ) : (
    <BusFront size={size} color={color} strokeWidth={2.2} />
  );
}

function useCountdown(targetMs: number, down: boolean): string {
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), TICK_MS);
    return () => clearInterval(t);
  }, []);
  const diffSec = (targetMs - Date.now()) / 1000;
  if (down) return countdownText(diffSec);
  return `+${untilText(Math.abs(diffSec))}`;
}

/** Pasek postępu: szerokość animowana na UI thread, więc nie migocze. */
function ProgressBar({ value, color, height = 5 }: { value: number; color: string; height?: number }) {
  const width = useSharedValue(0);

  useEffect(() => {
    width.value = withTiming(Math.max(0.015, value), {
      duration: 700,
      easing: Easing.out(Easing.cubic),
    });
  }, [value, width]);

  const animated = useAnimatedStyle(() => ({ width: `${width.value * 100}%` }));

  return (
    <View style={[styles.track, { height, borderRadius: height / 2 }]}>
      <Animated.View style={[styles.fill, { backgroundColor: color, borderRadius: height / 2 }, animated]} />
    </View>
  );
}

export function ActiveTripCard({
  trip,
  progress,
  onStop,
  onOpen,
}: {
  trip: TrackedTrip;
  progress: TripProgress;
  onStop: () => void;
  onOpen?: () => void;
}) {
  const arrived = progress.phase === 'arrived';
  const waiting = progress.phase === 'waiting' || progress.phase === 'walking';
  const targetMs = waiting ? progress.boardAtMs : progress.arriveAtMs;
  const countdown = useCountdown(targetMs, !arrived);
  const countdownCaption = arrived ? '' : waiting ? 'do odjazdu' : 'do celu';
  const { bg, fg } = getLineColors(progress.line || undefined, progress.lineMode === 'walk' ? 'walk' : undefined);
  const accent = arrived ? scheme.success : progress.lineColor || bg;
  const pulses = progress.live && !arrived;

  const walk = progress.walkMeters != null && progress.walkMeters > 0 ? formatDistance(progress.walkMeters) : null;
  const hops =
    progress.stopsLeft == null || progress.stopsLeft <= 0
      ? null
      : `${progress.stopsLeft} ${plural(progress.stopsLeft, 'przystanek', 'przystanki', 'przystanków')}`;

  return (
    <View style={[styles.card, { borderColor: accent }]}>
      {/* Pasek postępu podróży — sygnał „jesteś w trakcie”, nie liczba. */}
      <ProgressBar value={arrived ? 1 : progress.progress} color={accent} />

      <View style={styles.head}>
        <View style={[styles.lineChip, { backgroundColor: progress.lineMode === 'walk' ? scheme.surfaceContainerHighest : bg }]}>
          <ModeIcon mode={progress.lineMode} color={progress.lineMode === 'walk' ? scheme.onSurfaceVariant : fg} />
          <Text style={[styles.lineText, { color: progress.lineMode === 'walk' ? scheme.onSurfaceVariant : fg }]}>
            {progress.line || '—'}
          </Text>
        </View>

        <View style={styles.headText}>
          <Text style={styles.phase} numberOfLines={1}>
            {PHASE_LABEL[progress.phase]}
          </Text>
          <Text style={styles.dest} numberOfLines={1}>
            {progress.nextStop ? `Następny: ${progress.nextStop}` : `Cel: ${progress.toTitle}`}
          </Text>
        </View>

        <View style={styles.countdownBox}>
          <Text style={[styles.countdown, { color: accent }]}>{countdown}</Text>
          {countdownCaption ? <Text style={styles.countdownCaption}>{countdownCaption}</Text> : null}
        </View>
      </View>

      <View style={styles.metaRow}>
        {pulses ? <LiveDot color={progress.delayMin >= 2 ? scheme.error : scheme.success} size={7} /> : null}
        <Text style={styles.meta} numberOfLines={1}>
          {trip.fromTitle && trip.toTitle ? `${trip.fromTitle} → ${trip.toTitle}` : trip.toTitle}
        </Text>
      </View>

      <View style={styles.metaRow}>
        {pulses ? <View style={styles.liveSlot} /> : null}
        <Text style={styles.meta} numberOfLines={1}>
          {[
            `odjazd ${progress.departAt}`,
            `na miejscu ${progress.arriveAt}`,
            hops,
            walk ? `${walk} do przystanku` : null,
            progress.delayMin >= 2
              ? `opóźnienie +${Math.round(progress.delayMin)} min`
              : progress.delayMin <= -2
                ? `spieszy ${Math.abs(Math.round(progress.delayMin))} min`
                : null,
          ]
            .filter(Boolean)
            .join(' • ')}
        </Text>
      </View>

      {!arrived && progress.etaMin > 0 ? (
        <Text style={styles.etaHint}>{minutesText(progress.etaMin)} podróży do celu</Text>
      ) : null}

      <View style={styles.actions}>
        {onOpen ? (
          <Pressable
            onPress={onOpen}
            accessibilityRole="button"
            accessibilityLabel="Pokaż szczegóły podróży"
            style={({ pressed }) => [styles.action, pressed && { opacity: 0.7 }]}
            hitSlop={6}
          >
            <Navigation size={15} color={scheme.onSecondaryContainer} />
            <Text style={styles.actionText}>Szczegóły</Text>
          </Pressable>
        ) : null}

        <Pressable
          onPress={onStop}
          accessibilityRole="button"
          accessibilityLabel="Zakończ śledzenie podróży"
          style={({ pressed }) => [styles.action, styles.actionStop, pressed && { opacity: 0.7 }]}
          hitSlop={6}
        >
          {arrived ? (
            <CheckCircle2 size={15} color={scheme.onSecondaryContainer} />
          ) : (
            <X size={15} color={scheme.onSecondaryContainer} />
          )}
          <Text style={styles.actionText}>{arrived ? 'OK' : 'Zakończ'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: scheme.surfaceContainer,
    borderRadius: shape.large,
    padding: 14,
    gap: 10,
    borderWidth: 1,
    ...elev.level2,
  },
  track: {
    backgroundColor: scheme.surfaceContainerHighest,
    overflow: 'hidden',
    width: '100%',
  },
  fill: {
    height: '100%',
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  lineChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: shape.small,
    paddingHorizontal: 9,
    paddingVertical: 5,
    minWidth: 48,
    justifyContent: 'center',
  },
  lineText: {
    ...type.labelLarge,
    fontWeight: '700',
  },
  headText: {
    flex: 1,
    gap: 1,
  },
  phase: {
    ...type.titleMedium,
    fontWeight: '700',
    color: scheme.onSurface,
  },
  dest: {
    ...type.bodySmall,
    color: scheme.onSurfaceVariant,
  },
  countdownBox: {
    alignItems: 'flex-end',
  },
  countdown: {
    ...type.titleMedium,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    includeFontPadding: false,
  },
  countdownCaption: {
    ...type.labelSmall,
    color: scheme.onSurfaceVariant,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  // Wyrównanie wiersza, gdy po lewej nie ma pulsującej kropki — inaczej
  // tekst skakałby o kilka pikseli przy zmianie statusu live.
  liveSlot: {
    width: 21,
  },
  meta: {
    ...type.bodySmall,
    color: scheme.onSurfaceVariant,
    flexShrink: 1,
  },
  etaHint: {
    ...type.labelMedium,
    color: scheme.onSurfaceVariant,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
  },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: scheme.secondaryContainer,
    borderRadius: shape.full,
    paddingHorizontal: 14,
    height: 34,
  },
  actionStop: {
    backgroundColor: scheme.surfaceContainerHighest,
  },
  actionText: {
    ...type.labelLarge,
    color: scheme.onSecondaryContainer,
    fontWeight: '600',
  },
});
