import { memo, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  LinearTransition,
  ReduceMotion,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useStrings } from '../i18n';
import { elev, scheme, shape, type } from '../theme/tokens';
import { MorphingLoader } from './MorphingLoader';

const SHIMMER_DURATION_MS = 1350;
const PHASE_TRANSFERS_MS = 1800;
const PHASE_LONG_MS = 4500;

const SkeletonConnectionCard = memo(function SkeletonConnectionCard({
  dimmed,
  delay = 0,
}: {
  dimmed?: boolean;
  delay?: number;
}) {
  const reduceMotion = useReducedMotion();
  const [cardWidth, setCardWidth] = useState(320);
  const sweep = useSharedValue(0);

  useEffect(() => {
    if (reduceMotion) {
      cancelAnimation(sweep);
      sweep.value = 0;
      return;
    }
    sweep.value = 0;
    sweep.value = withDelay(
      delay,
      withRepeat(
        withSequence(
          withTiming(1, {
            duration: SHIMMER_DURATION_MS,
            easing: Easing.inOut(Easing.cubic),
          }),
          withDelay(260, withTiming(0, { duration: 0 })),
        ),
        -1,
        false,
      ),
    );
    return () => {
      cancelAnimation(sweep);
    };
  }, [delay, reduceMotion, sweep]);

  const sheenStyle = useAnimatedStyle(() => {
    const band = Math.max(96, cardWidth * 0.42);
    const travel = cardWidth + band * 2;
    return {
      width: band,
      transform: [{ translateX: -band + sweep.value * travel }, { skewX: '-16deg' }],
    };
  });

  return (
    <View
      onLayout={(e) => {
        const w = Math.round(e.nativeEvent.layout.width);
        if (w > 0 && w !== cardWidth) setCardWidth(w);
      }}
      style={[styles.skelCard, dimmed && styles.skelCardDimmed]}
    >
      <View style={styles.skelRow}>
        <View style={[styles.skel, { width: 112, height: 26, borderRadius: 10 }]} />
        <View style={[styles.skel, { width: 66, height: 28, borderRadius: shape.full }]} />
      </View>
      <View style={styles.skelMetaRow}>
        <View style={[styles.skel, { width: 132, height: 14, borderRadius: 7 }]} />
        <View style={[styles.skel, { width: 88, height: 14, borderRadius: 7 }]} />
      </View>
      <View style={styles.skelStrip}>
        <View style={[styles.skel, { width: '100%', height: 5, borderRadius: 3 }]} />
        <View style={styles.skelBadges}>
          <View style={[styles.skel, { width: 44, height: 24, borderRadius: shape.full }]} />
          <View style={[styles.skel, { width: 58, height: 24, borderRadius: shape.full }]} />
          <View style={[styles.skel, { width: 38, height: 24, borderRadius: shape.full }]} />
        </View>
      </View>
      {!reduceMotion && (
        <Animated.View pointerEvents="none" style={[styles.sheen, sheenStyle]} />
      )}
    </View>
  );
});

export interface RouteLoadingViewProps {
  /** Trasa między miastami korzysta z dodatkowego komunikatu kolejowego. */
  intercity?: boolean;
}

/**
 * Widok ładowania listy połączeń: morfujący wskaźnik M3 Expressive, progresywne
 * komunikaty przy dłuższym liczeniu oraz szkielet kart z kierunkowym połyskiem.
 */
export function RouteLoadingView({ intercity = false }: RouteLoadingViewProps) {
  const s = useStrings();
  const reduceMotion = useReducedMotion();
  const [phase, setPhase] = useState<0 | 1 | 2>(0);

  useEffect(() => {
    setPhase(0);
    const t1 = setTimeout(() => setPhase(1), PHASE_TRANSFERS_MS);
    const t2 = setTimeout(() => setPhase(2), PHASE_LONG_MS);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [intercity]);

  const statusLabel =
    phase === 0
      ? intercity
        ? s.routes.searchingIntercity
        : s.routes.searching
      : phase === 1
        ? s.routes.searchingTransfers
        : s.routes.searchingLong;

  return (
    <Animated.View
      entering={
        reduceMotion
          ? undefined
          : FadeIn.duration(180).reduceMotion(ReduceMotion.System)
      }
      exiting={
        reduceMotion
          ? undefined
          : FadeOut.duration(140).reduceMotion(ReduceMotion.System)
      }
      layout={
        reduceMotion
          ? undefined
          : LinearTransition.springify().damping(26).stiffness(320)
      }
      style={styles.root}
      accessibilityLiveRegion="polite"
    >
      <View style={styles.heroBanner}>
        <MorphingLoader variant="contained" size={38} />
        <View style={styles.heroCopy}>
          <Animated.Text
            key={phase}
            entering={
              reduceMotion
                ? undefined
                : FadeIn.duration(220).reduceMotion(ReduceMotion.System)
            }
            exiting={
              reduceMotion
                ? undefined
                : FadeOut.duration(120).reduceMotion(ReduceMotion.System)
            }
            style={styles.heroTitle}
            numberOfLines={2}
          >
            {statusLabel}
          </Animated.Text>
          {phase >= 1 && (
            <Animated.Text
              entering={
                reduceMotion
                  ? undefined
                  : FadeIn.duration(240).reduceMotion(ReduceMotion.System)
              }
              style={styles.heroHint}
              numberOfLines={2}
            >
              {s.routes.searchingOfflineHint}
            </Animated.Text>
          )}
        </View>
      </View>

      <SkeletonConnectionCard delay={0} />
      <SkeletonConnectionCard delay={140} />
      <SkeletonConnectionCard delay={280} dimmed />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    gap: 12,
  },
  heroBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: shape.extraLarge,
    backgroundColor: scheme.surfaceContainerLow,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: scheme.outlineVariant,
  },
  heroCopy: {
    flex: 1,
    gap: 3,
  },
  heroTitle: {
    ...type.titleSmall,
    fontWeight: '700',
    color: scheme.onSurface,
    lineHeight: 20,
  },
  heroHint: {
    ...type.bodySmall,
    color: scheme.onSurfaceVariant,
    lineHeight: 17,
  },
  skelCard: {
    backgroundColor: scheme.surfaceContainer,
    borderRadius: shape.extraLarge,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: scheme.outlineVariant,
    paddingHorizontal: 16,
    paddingVertical: 15,
    overflow: 'hidden',
    ...elev.level1,
  },
  skelCardDimmed: {
    opacity: 0.62,
  },
  skelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  skelMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 12,
  },
  skelStrip: {
    marginTop: 14,
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderRadius: 18,
    backgroundColor: scheme.surfaceContainerLow,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: scheme.outlineVariant,
    gap: 10,
  },
  skelBadges: {
    flexDirection: 'row',
    gap: 8,
  },
  skel: {
    backgroundColor: scheme.surfaceContainerHighest,
    borderRadius: shape.small,
  },
  sheen: {
    position: 'absolute',
    top: -12,
    bottom: -12,
    left: 0,
    backgroundColor: scheme.onSurface,
    opacity: 0.05,
  },
});
