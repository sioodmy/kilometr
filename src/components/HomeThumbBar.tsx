import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  LinearTransition,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
import { ChevronRight, Download, LocateFixed, MapPin, MapPinOff, Search, X } from './icons';
import { HomeDockChips, type DockChip } from './HomeDockChips';
import { SpringPressable } from './SpringPressable';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { motion } from '../theme/motion';
import { useWebLayout } from '../theme/layout';
import { elev, scheme, shape, type } from '../theme/tokens';
import { useStrings } from '../i18n';

/** Parametry fali M3 Expressive Wavy Linear Progress Indicator. */
const WAVE_LENGTH = 22;
const WAVE_AMPLITUDE = 2.2;
const WAVE_STROKE = 3;
const WAVE_HEIGHT = 10;
const WAVE_CENTER_Y = WAVE_HEIGHT / 2;
const TRACK_GAP = 5;
const STOP_DOT_SIZE = 4;

/** Buduje ciągłą ścieżkę sinusoidalną (C1) na szerokość toru + 2 okresy do płynnego przesuwu fazy. */
function buildWavePath(width: number): string {
  const cycles = Math.max(4, Math.ceil(width / WAVE_LENGTH) + 2);
  const half = WAVE_LENGTH / 2;
  const quarter = WAVE_LENGTH / 4;
  const ctrlUp = WAVE_CENTER_Y - WAVE_AMPLITUDE * 2;
  const ctrlDown = WAVE_CENTER_Y + WAVE_AMPLITUDE * 2;
  let d = `M 0 ${WAVE_CENTER_Y}`;
  for (let i = 0; i < cycles; i++) {
    const x0 = i * WAVE_LENGTH;
    d += ` Q ${x0 + quarter} ${ctrlUp} ${x0 + half} ${WAVE_CENTER_Y}`;
    d += ` Q ${x0 + half + quarter} ${ctrlDown} ${x0 + WAVE_LENGTH} ${WAVE_CENTER_Y}`;
  }
  return d;
}

interface HomeThumbBarProps {
  onOpenSearch: () => void;
  startTitle: string;
  isCustomStart: boolean;
  onOpenStart: () => void;
  onResetStart: () => void;
  gpsUnsupported?: boolean;
  /** Skróty nad search barem: przypięta podróż i pociągi z biletem < 3 h. */
  chips?: DockChip[];
  /** Postęp pobierania rozkładu (0..1); `null` oznacza zwykły tryb wyszukiwarki. */
  downloadProgress?: number | null;
  /** Opcjonalny bieżący krok importu (np. weryfikacja bazy). */
  downloadStep?: string | null;
  /** Tryb renderowania: przyklejony dolny dock mobilny albo karta planera w treści desktopu. */
  variant?: 'dock' | 'planner';
}

/** Dolny dock ekranu głównego ze sprężystą reakcją M3 Expressive i falującym paskiem postępu. */
export const HomeThumbBar = memo(function HomeThumbBar({
  onOpenSearch,
  startTitle,
  isCustomStart,
  onOpenStart,
  onResetStart,
  gpsUnsupported = false,
  chips = [],
  downloadProgress = null,
  downloadStep = null,
  variant = 'dock',
}: HomeThumbBarProps) {
  const s = useStrings();
  const insets = useSafeAreaInsets();
  const layout = useWebLayout();
  const reduceMotion = useReducedMotion();
  const isPlanner = variant === 'planner';
  const plannerRow = isPlanner && layout.isDesktop;
  const [focused, setFocused] = useState<'search' | 'origin' | 'reset' | null>(null);
  const [trackLayoutWidth, setTrackLayoutWidth] = useState(0);
  const OriginIcon = isCustomStart ? MapPin : gpsUnsupported ? MapPinOff : LocateFixed;
  const originNeedsPick = gpsUnsupported && !isCustomStart;

  const downloading = downloadProgress !== null;
  const clamped = Math.max(0, Math.min(1, downloadProgress ?? 0));
  const pct = Math.round(clamped * 100);
  const indeterminate = downloading && clamped <= 0.01;
  const updatingLabel = downloadStep || s.home.updatingTimetable;

  const mode = useSharedValue(downloading ? 1 : 0);
  const progress = useSharedValue(downloading ? clamped : 0);
  const isIndeterminate = useSharedValue(indeterminate ? 1 : 0);
  const trackWidth = useSharedValue(0);
  const wavePhase = useSharedValue(0);
  const indetPos = useSharedValue(0);
  const iconNudge = useSharedValue(0);
  const lastMilestoneRef = useRef(-1);

  useEffect(() => {
    isIndeterminate.value = indeterminate ? 1 : 0;
  }, [indeterminate, isIndeterminate]);

  // Przejście stanu searchbar <-> aktualizowanie: kształt i tło reagują sprężyną M3 Expressive.
  useEffect(() => {
    const target = downloading ? 1 : 0;
    mode.value = reduceMotion ? target : withSpring(target, motion.spring.spatialFast);
  }, [downloading, mode, reduceMotion]);

  // Postęp pobierania wygładzony sprężyną efektową (bez odbicia).
  useEffect(() => {
    if (!downloading) {
      cancelAnimation(progress);
      progress.value = 0;
      lastMilestoneRef.current = -1;
      return;
    }
    progress.value = reduceMotion
      ? clamped
      : withSpring(clamped, motion.spring.effectsDefault);
  }, [clamped, downloading, progress, reduceMotion]);

  // Subtelny impuls ikony pobierania przy realnych skokach postępu (co 10%), nigdy pusta pętla.
  useEffect(() => {
    if (!downloading || reduceMotion) {
      cancelAnimation(iconNudge);
      iconNudge.value = 0;
      return;
    }
    const bucket = Math.floor(pct / 10);
    if (bucket > 0 && bucket !== lastMilestoneRef.current) {
      lastMilestoneRef.current = bucket;
      iconNudge.value = withSequence(
        withSpring(2.5, motion.spring.spatialFast),
        withSpring(0, motion.spring.spatialDefault),
      );
    }
  }, [downloading, iconNudge, pct, reduceMotion]);

  // Faza fali M3 Expressive działa na wątku UI wyłącznie podczas aktywnego pobierania.
  useEffect(() => {
    if (!downloading || reduceMotion) {
      cancelAnimation(wavePhase);
      wavePhase.value = 0;
      return;
    }
    wavePhase.value = 0;
    wavePhase.value = withRepeat(
      withTiming(1, { duration: 920, easing: Easing.linear }),
      -1,
      false,
    );
    return () => {
      cancelAnimation(wavePhase);
    };
  }, [downloading, reduceMotion, wavePhase]);

  // Tryb wstępny (0%, łączenie z serwerem): fala przesuwa się płynnie po torze z krzywą M3 emphasized.
  useEffect(() => {
    if (!indeterminate || reduceMotion) {
      cancelAnimation(indetPos);
      indetPos.value = 0;
      return;
    }
    indetPos.value = 0;
    indetPos.value = withRepeat(
      withTiming(1, {
        duration: 1350,
        easing: Easing.bezier(0.4, 0, 0.2, 1),
      }),
      -1,
      false,
    );
    return () => {
      cancelAnimation(indetPos);
    };
  }, [indeterminate, indetPos, reduceMotion]);

  const waveSvgWidth = Math.max(trackLayoutWidth, 180) + WAVE_LENGTH * 2;
  const wavePath = useMemo(() => buildWavePath(waveSvgWidth), [waveSvgWidth]);

  const washStyle = useAnimatedStyle(() => ({
    opacity: mode.value * 0.28,
  }));

  // Kółko wyszukiwania (19) płynnie przechodzi w zaokrąglony kwadrat M3 Expressive (12).
  const iconWellStyle = useAnimatedStyle(() => ({
    borderRadius: 19 - mode.value * 7,
    transform: [{ scale: 1 + mode.value * 0.02 }],
  }));

  const downloadGlyphStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: iconNudge.value }],
  }));

  const activeRightMaskStyle = useAnimatedStyle(() => {
    const w = trackWidth.value;
    if (w <= 0) return { opacity: 0, transform: [{ translateX: -9999 }] };
    if (isIndeterminate.value > 0.5) {
      const seg = Math.max(44, w * 0.34);
      const left = -seg + indetPos.value * (w + seg);
      const rightEdge = left + seg;
      return { opacity: 1, transform: [{ translateX: rightEdge - w }] };
    }
    const filled = Math.max(14, Math.min(w, progress.value * w));
    return { opacity: 1, transform: [{ translateX: filled - w }] };
  });

  const activeLeftMaskStyle = useAnimatedStyle(() => {
    const w = trackWidth.value;
    if (w <= 0) return { transform: [{ translateX: 0 }] };
    if (isIndeterminate.value > 0.5) {
      const seg = Math.max(44, w * 0.34);
      return { transform: [{ translateX: w - seg }] };
    }
    const filled = Math.max(14, Math.min(w, progress.value * w));
    return { transform: [{ translateX: w - filled }] };
  });

  const waveShiftStyle = useAnimatedStyle(() => {
    const w = trackWidth.value;
    let left = 0;
    if (w > 0 && isIndeterminate.value > 0.5) {
      const seg = Math.max(44, w * 0.34);
      left = -seg + indetPos.value * (w + seg);
    }
    return {
      transform: [{ translateX: -left - WAVE_LENGTH + wavePhase.value * WAVE_LENGTH }],
    };
  });

  const inactiveTrackStyle = useAnimatedStyle(() => {
    const w = trackWidth.value;
    if (w <= 0) return { opacity: 0, transform: [{ translateX: 0 }, { scaleX: 0.001 }] };
    if (isIndeterminate.value > 0.5) {
      return { opacity: 1, transform: [{ translateX: 0 }, { scaleX: 1 }] };
    }
    const filled = Math.max(14, Math.min(w, progress.value * w));
    const start = filled + TRACK_GAP;
    const rem = Math.max(0, w - start);
    const scaleX = Math.max(0.001, rem / w);
    const tx = start + rem * 0.5 - w * 0.5;
    return {
      opacity: rem > 4 ? 1 : 0,
      transform: [{ translateX: tx }, { scaleX }],
    };
  });

  const stopDotStyle = useAnimatedStyle(() => ({
    opacity: isIndeterminate.value > 0.5 || progress.value < 0.96 ? 1 : 0,
  }));

  const searchPillContent = (
    <>
      <Animated.View
        style={[StyleSheet.absoluteFill, styles.tonalWash, washStyle]}
        pointerEvents="none"
      />
      <Animated.View
        style={[
          styles.searchIconWell,
          downloading && styles.searchIconWellActive,
          iconWellStyle,
        ]}
      >
        {downloading ? (
          <Animated.View
            entering={reduceMotion ? undefined : FadeIn.duration(180)}
            exiting={reduceMotion ? undefined : FadeOut.duration(120)}
            style={downloadGlyphStyle}
          >
            <Download size={18} color={scheme.onPrimary} />
          </Animated.View>
        ) : (
          <Animated.View
            entering={reduceMotion ? undefined : FadeIn.duration(180)}
            exiting={reduceMotion ? undefined : FadeOut.duration(120)}
          >
            <Search size={19} color={scheme.onPrimaryContainer} />
          </Animated.View>
        )}
      </Animated.View>

      {downloading ? (
        <Animated.View
          entering={reduceMotion ? undefined : FadeIn.duration(motion.enter.duration)}
          exiting={reduceMotion ? undefined : FadeOut.duration(motion.exit.duration)}
          style={styles.updateColumn}
        >
          <View style={styles.updateTopRow}>
            <Text style={styles.updateLabel} numberOfLines={1}>
              {updatingLabel}
            </Text>
            <View style={styles.progressPill}>
              <Text style={styles.progressPct}>{pct}%</Text>
            </View>
          </View>

          <View
            style={styles.waveTrackRow}
            onLayout={(e) => {
              const nextW = Math.round(e.nativeEvent.layout.width);
              if (nextW > 0 && nextW !== trackLayoutWidth) {
                setTrackLayoutWidth(nextW);
                trackWidth.value = nextW;
              }
            }}
          >
            <Animated.View style={[styles.inactiveTrack, inactiveTrackStyle]} />
            {reduceMotion ? (
              <View
                style={[
                  styles.staticFill,
                  { width: `${Math.max(4, pct)}%` },
                ]}
              />
            ) : (
              <Animated.View style={[styles.activeWaveClip, activeRightMaskStyle]}>
                <Animated.View style={[styles.activeWaveClip, activeLeftMaskStyle]}>
                  <Animated.View style={[styles.waveSvgWrap, waveShiftStyle]}>
                    <Svg width={waveSvgWidth} height={WAVE_HEIGHT}>
                      <Path
                        d={wavePath}
                        fill="none"
                        stroke={scheme.primary}
                        strokeWidth={WAVE_STROKE}
                        strokeLinecap="round"
                      />
                    </Svg>
                  </Animated.View>
                </Animated.View>
              </Animated.View>
            )}
            <Animated.View style={[styles.stopDot, stopDotStyle]} />
          </View>
        </Animated.View>
      ) : (
        <Animated.View
          entering={reduceMotion ? undefined : FadeIn.duration(180)}
          exiting={reduceMotion ? undefined : FadeOut.duration(120)}
          style={styles.searchLabelWrap}
        >
          <Text style={styles.searchLabel} numberOfLines={1}>
            {s.home.searchLabel}
          </Text>
        </Animated.View>
      )}
    </>
  );

  return (
    <View
      style={[
        isPlanner ? styles.plannerCard : styles.dock,
        !isPlanner && { paddingBottom: Math.max(insets.bottom, 14) },
      ]}
    >
      <HomeDockChips chips={chips} fullWidth={isPlanner} />
      <View
        style={[
          styles.bar,
          isPlanner && styles.barPlanner,
          plannerRow && styles.barPlannerRow,
        ]}
      >
        <SpringPressable
          onPress={downloading ? undefined : onOpenSearch}
          disabled={downloading}
          onFocus={() => setFocused('search')}
          onBlur={() => setFocused(null)}
          scaleDelta={0.02}
          opacityDelta={0.05}
          haptic={downloading ? false : 'selection'}
          accessibilityRole={downloading ? 'progressbar' : 'button'}
          accessibilityLabel={downloading ? updatingLabel : s.home.searchA11y}
          accessibilityValue={downloading ? { min: 0, max: 100, now: pct } : undefined}
          accessibilityState={downloading ? { busy: true } : undefined}
          style={[
            styles.search,
            plannerRow && styles.searchPlannerRow,
            downloading && styles.searchUpdating,
            !downloading && focused === 'search' && styles.focused,
          ]}
        >
          {searchPillContent}
        </SpringPressable>

        <Animated.View
          layout={reduceMotion ? undefined : LinearTransition.duration(180)}
          style={[styles.originRow, plannerRow && styles.originRowPlanner]}
        >
          <SpringPressable
            onPress={onOpenStart}
            onFocus={() => setFocused('origin')}
            onBlur={() => setFocused(null)}
            scaleDelta={0.018}
            opacityDelta={0.05}
            haptic="selection"
            accessibilityRole="button"
            accessibilityLabel={
              isCustomStart ? s.home.startCustomA11y(startTitle) : s.home.startGpsA11y(startTitle)
            }
            style={[
              styles.origin,
              plannerRow && styles.originPlanner,
              originNeedsPick && styles.originWarning,
              focused === 'origin' && styles.focused,
            ]}
          >
            <View
              style={[
                styles.originIconWell,
                originNeedsPick && styles.originIconWellWarning,
                isCustomStart && styles.originIconWellCustom,
              ]}
            >
              <OriginIcon
                size={15}
                color={
                  originNeedsPick
                    ? scheme.onWarningContainer
                    : isCustomStart
                      ? scheme.onPrimaryContainer
                      : scheme.primary
                }
              />
            </View>
            <Text
              style={[styles.originPlace, originNeedsPick && styles.originPlaceWarning]}
              numberOfLines={1}
            >
              {originNeedsPick ? s.home.pickStart : s.home.startFrom(startTitle)}
            </Text>
            <ChevronRight
              size={16}
              color={originNeedsPick ? scheme.onWarningContainer : scheme.onSurfaceVariant}
            />
          </SpringPressable>
          {isCustomStart && (
            <Animated.View
              entering={reduceMotion ? undefined : FadeIn.duration(140)}
              exiting={reduceMotion ? undefined : FadeOut.duration(100)}
            >
              <SpringPressable
                onPress={onResetStart}
                onFocus={() => setFocused('reset')}
                onBlur={() => setFocused(null)}
                scaleDelta={0.06}
                haptic="selection"
                accessibilityRole="button"
                accessibilityLabel={s.home.resetStartA11y}
                style={[styles.reset, focused === 'reset' && styles.focused]}
              >
                <X size={18} color={scheme.onSurfaceVariant} />
              </SpringPressable>
            </Animated.View>
          )}
        </Animated.View>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  dock: {
    paddingTop: 14,
    paddingHorizontal: 16,
    backgroundColor: scheme.surfaceContainer,
    borderTopLeftRadius: shape.extraLarge,
    borderTopRightRadius: shape.extraLarge,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: scheme.outlineVariant,
    ...elev.level2,
  },
  bar: {
    width: '100%',
    maxWidth: 600,
    alignSelf: 'center',
    gap: 10,
  },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 56,
    paddingLeft: 9,
    paddingRight: 16,
    paddingVertical: 8,
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainerHigh,
    borderWidth: 1.5,
    borderColor: scheme.outlineVariant,
    overflow: 'hidden',
  },
  searchUpdating: {
    borderColor: scheme.primary,
  },
  tonalWash: {
    backgroundColor: scheme.primaryContainer,
  },
  searchIconWell: {
    width: 38,
    height: 38,
    borderRadius: shape.full,
    backgroundColor: scheme.primaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  searchIconWellActive: {
    backgroundColor: scheme.primary,
  },
  searchLabelWrap: {
    flex: 1,
    justifyContent: 'center',
  },
  searchLabel: {
    ...type.bodyLarge,
    fontWeight: '700',
    letterSpacing: -0.15,
    color: scheme.onSurface,
  },
  updateColumn: {
    flex: 1,
    justifyContent: 'center',
    gap: 5,
    minWidth: 0,
  },
  updateTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  updateLabel: {
    ...type.labelLarge,
    fontWeight: '700',
    letterSpacing: -0.1,
    color: scheme.onSurface,
    flex: 1,
  },
  progressPill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: shape.full,
    backgroundColor: scheme.primary,
    flexShrink: 0,
  },
  progressPct: {
    ...type.labelSmall,
    fontWeight: '800',
    color: scheme.onPrimary,
    fontVariant: ['tabular-nums'],
  },
  waveTrackRow: {
    height: WAVE_HEIGHT,
    width: '100%',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  inactiveTrack: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: WAVE_STROKE,
    borderRadius: WAVE_STROKE / 2,
    backgroundColor: scheme.outlineVariant,
  },
  staticFill: {
    height: WAVE_STROKE,
    borderRadius: WAVE_STROKE / 2,
    backgroundColor: scheme.primary,
  },
  activeWaveClip: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    overflow: 'hidden',
  },
  waveSvgWrap: {
    height: WAVE_HEIGHT,
  },
  stopDot: {
    position: 'absolute',
    right: 0,
    width: STOP_DOT_SIZE,
    height: STOP_DOT_SIZE,
    borderRadius: STOP_DOT_SIZE / 2,
    backgroundColor: scheme.primary,
  },
  originRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  origin: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 46,
    paddingLeft: 8,
    paddingRight: 14,
    paddingVertical: 6,
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainerLow,
    borderWidth: 1.5,
    borderColor: scheme.outlineVariant,
  },
  originWarning: {
    backgroundColor: scheme.warningContainer,
    borderColor: scheme.warning,
  },
  originIconWell: {
    width: 28,
    height: 28,
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  originIconWellCustom: {
    backgroundColor: scheme.primaryContainer,
  },
  originIconWellWarning: {
    backgroundColor: scheme.warningContainer,
  },
  originPlace: {
    ...type.bodyMedium,
    fontWeight: '600',
    color: scheme.onSurfaceVariant,
    flex: 1,
  },
  originPlaceWarning: {
    color: scheme.onWarningContainer,
    fontWeight: '700',
  },
  reset: {
    width: 46,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainerHigh,
    borderWidth: 1.5,
    borderColor: scheme.outlineVariant,
  },
  plannerCard: {
    marginTop: 14,
    padding: 16,
    borderRadius: shape.extraLarge,
    backgroundColor: scheme.surfaceContainer,
    borderWidth: 1,
    borderColor: scheme.outlineVariant,
    ...elev.level2,
  },
  barPlanner: {
    maxWidth: '100%',
  },
  barPlannerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  searchPlannerRow: {
    flex: 1.35,
    minWidth: 0,
  },
  originRowPlanner: {
    flex: 1,
    minWidth: 0,
  },
  originPlanner: {
    minHeight: 56,
  },
  focused: { borderColor: scheme.primary },
});
