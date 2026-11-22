import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  LinearTransition,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { ChevronRight, Download, LocateFixed, MapPin, MapPinOff, Search, X } from './icons';
import { HomeDockChips, type DockChip } from './HomeDockChips';
import { SpringPressable } from './SpringPressable';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { elev, scheme, shape, type } from '../theme/tokens';
import { useStrings } from '../i18n';

interface HomeThumbBarProps {
  onOpenSearch: () => void;
  startTitle: string;
  isCustomStart: boolean;
  onOpenStart: () => void;
  onResetStart: () => void;
  gpsUnsupported?: boolean;
  /** Skróty nad search barem: przypięta podróż i pociągi z biletem < 3 h. */
  chips?: DockChip[];
  /** Postęp pobierania rozkładu; `null` oznacza zwykły tryb wyszukiwarki. */
  downloadProgress?: number | null;
}

/** Dolny dock ekranu głównego ze sprężystą reakcją M3 Expressive na dotyk. */
export function HomeThumbBar({
  onOpenSearch,
  startTitle,
  isCustomStart,
  onOpenStart,
  onResetStart,
  gpsUnsupported = false,
  chips = [],
  downloadProgress = null,
}: HomeThumbBarProps) {
  const s = useStrings();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const [focused, setFocused] = useState<'search' | 'origin' | 'reset' | null>(null);
  const OriginIcon = isCustomStart ? MapPin : gpsUnsupported ? MapPinOff : LocateFixed;
  const originNeedsPick = gpsUnsupported && !isCustomStart;

  const downloading = downloadProgress !== null;
  const clamped = Math.max(0, Math.min(1, downloadProgress ?? 0));
  const pct = Math.round(clamped * 100);

  // Wypełnienie i połysk animują się na UI thread: postęp z sieci przychodzi
  // skokami, a użytkownik widzi płynny ruch paska.
  const progress = useSharedValue(downloading ? clamped : 0);
  const shine = useSharedValue(0);
  const trackWidth = useSharedValue(0);

  useEffect(() => {
    if (!downloading) {
      progress.value = 0;
      return;
    }
    progress.value = withTiming(clamped, {
      duration: reduceMotion ? 0 : 420,
      easing: Easing.out(Easing.cubic),
    });
  }, [clamped, downloading, progress, reduceMotion]);

  useEffect(() => {
    if (!downloading || reduceMotion) {
      shine.value = 0;
      return;
    }
    shine.value = 0;
    shine.value = withRepeat(
      withTiming(1, { duration: 1600, easing: Easing.inOut(Easing.quad) }),
      -1,
      false,
    );
  }, [downloading, reduceMotion, shine]);

  const fillStyle = useAnimatedStyle(() => ({
    transform: [{ scaleX: progress.value }],
  }));
  const shineStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: -64 + shine.value * (trackWidth.value + 128) }],
  }));

  return (
    <View style={[styles.dock, { paddingBottom: Math.max(insets.bottom, 14) }]}>
      <HomeDockChips chips={chips} />
      <View style={styles.bar}>
        {downloading ? (
          <View
            style={styles.search}
            onLayout={(e) => {
              trackWidth.value = e.nativeEvent.layout.width;
            }}
            accessibilityRole="progressbar"
            accessibilityLabel={s.home.updatingTimetable}
            accessibilityValue={{ min: 0, max: 100, now: pct }}
            accessibilityState={{ busy: true }}
          >
            <Animated.View style={[styles.searchFill, fillStyle]} />
            <Animated.View style={[styles.shine, shineStyle]} pointerEvents="none" />
            <View style={styles.searchContent}>
              <View style={styles.searchIconWell}>
                <Download size={19} color={scheme.onPrimaryContainer} />
              </View>
              <Text style={styles.searchLabel} numberOfLines={1}>
                {s.home.updatingTimetable}
              </Text>
              <View style={styles.progressPill}>
                <Text style={styles.progressPct}>{pct}%</Text>
              </View>
            </View>
          </View>
        ) : (
          <SpringPressable
            onPress={onOpenSearch}
            onFocus={() => setFocused('search')}
            onBlur={() => setFocused(null)}
            scaleDelta={0.02}
            opacityDelta={0.05}
            haptic="selection"
            accessibilityRole="button"
            accessibilityLabel={s.home.searchA11y}
            style={[styles.search, focused === 'search' && styles.focused]}
          >
            <View style={styles.searchIconWell}>
              <Search size={19} color={scheme.onPrimaryContainer} />
            </View>
            <Text style={styles.searchLabel} numberOfLines={1}>
              {s.home.searchLabel}
            </Text>
          </SpringPressable>
        )}

        <Animated.View
          layout={reduceMotion ? undefined : LinearTransition.duration(180)}
          style={styles.originRow}
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
}

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
    paddingRight: 18,
    paddingVertical: 8,
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainerHigh,
    borderWidth: 1.5,
    borderColor: scheme.outlineVariant,
    overflow: 'hidden',
  },
  searchContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
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
  searchFill: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    width: '100%',
    backgroundColor: scheme.primaryContainer,
    transformOrigin: 'left center',
  },
  shine: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    width: 64,
    backgroundColor: 'rgba(255,255,255,0.13)',
  },
  searchLabel: {
    ...type.bodyLarge,
    fontWeight: '700',
    letterSpacing: -0.15,
    color: scheme.onSurface,
    flex: 1,
  },
  progressPill: {
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainerLow,
  },
  progressPct: {
    ...type.labelSmall,
    fontWeight: '800',
    color: scheme.onSurface,
    fontVariant: ['tabular-nums'],
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
  focused: { borderColor: scheme.primary },
});
