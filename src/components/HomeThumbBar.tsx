import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { ChevronRight, Download, LocateFixed, MapPin, MapPinOff, Search, X } from './icons';
import { HomeDockChips, type DockChip } from './HomeDockChips';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheme, shape, type } from '../theme/tokens';
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
  /** Postęp pobierania rozkładu; `null` = searchbar działa normalnie. */
  downloadProgress?: number | null;
}

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

  const downloading = downloadProgress !== null;
  const clamped = Math.max(0, Math.min(1, downloadProgress ?? 0));
  const pct = Math.round(clamped * 100);

  // Wypełnienie i połysk animują się na UI thread: postęp z sieci przychodzi
  // skokami, a użytkownik ma widzieć, że pobieranie żyje, nie zamarło.
  const progress = useSharedValue(downloading ? clamped : 0);
  const shine = useSharedValue(0);
  const trackWidth = useSharedValue(0);

  useEffect(() => {
    if (!downloading) {
      progress.value = 0;
      return;
    }
    progress.value = withTiming(clamped, {
      duration: reduceMotion ? 0 : 500,
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
    <View style={[styles.dock, { paddingBottom: Math.max(insets.bottom, 12) }]}>
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
              <Download size={20} color={scheme.primary} />
              <Text style={styles.searchLabel}>{s.home.updatingTimetable}</Text>
              <Text style={styles.progressPct}>{pct}%</Text>
            </View>
          </View>
        ) : (
          <Pressable
            onPress={onOpenSearch}
            onFocus={() => setFocused('search')}
            onBlur={() => setFocused(null)}
            accessibilityRole="button"
            accessibilityLabel={s.home.searchA11y}
            style={({ pressed }) => [
              styles.search,
              focused === 'search' && styles.searchFocused,
              pressed && styles.searchPressed,
            ]}
          >
            <Search size={20} color={scheme.onSurfaceVariant} />
            <Text style={styles.searchLabel}>{s.home.searchLabel}</Text>
          </Pressable>
        )}
        <View style={styles.originRow}>
          <Pressable
            onPress={onOpenStart}
            onFocus={() => setFocused('origin')}
            onBlur={() => setFocused(null)}
            accessibilityRole="button"
            accessibilityLabel={
              isCustomStart ? s.home.startCustomA11y(startTitle) : s.home.startGpsA11y(startTitle)
            }
            style={({ pressed }) => [
              styles.origin,
              focused === 'origin' && styles.focused,
              pressed && styles.pressed,
            ]}
          >
            <OriginIcon
              size={18}
              color={gpsUnsupported && !isCustomStart ? scheme.warning : scheme.onSurfaceVariant}
            />
            <Text style={[styles.originPlace, gpsUnsupported && !isCustomStart && styles.warning]}>
              {gpsUnsupported && !isCustomStart ? s.home.pickStart : s.home.startFrom(startTitle)}
            </Text>
            <ChevronRight size={16} color={scheme.onSurfaceVariant} />
          </Pressable>
          {isCustomStart && (
            <Pressable
              onPress={onResetStart}
              onFocus={() => setFocused('reset')}
              onBlur={() => setFocused(null)}
              accessibilityRole="button"
              accessibilityLabel={s.home.resetStartA11y}
              style={({ pressed }) => [
                styles.reset,
                focused === 'reset' && styles.focused,
                pressed && styles.pressed,
              ]}
            >
              <X size={18} color={scheme.onSurfaceVariant} />
            </Pressable>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  dock: {
    marginTop: 8,
    paddingTop: 12,
    paddingHorizontal: 20,
    backgroundColor: scheme.surfaceContainerLow,
    borderTopLeftRadius: shape.extraLarge,
    borderTopRightRadius: shape.extraLarge,
  },
  bar: {
    width: '100%',
    maxWidth: 600,
    alignSelf: 'center',
    gap: 4,
  },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 52,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 20,
    backgroundColor: scheme.surfaceContainerHigh,
    borderWidth: 2,
    borderColor: 'transparent',
    overflow: 'hidden',
  },
  searchContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
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
  searchLabel: { ...type.bodyLarge, fontWeight: '500', color: scheme.onSurface, flex: 1 },
  progressPct: {
    ...type.labelMedium,
    color: scheme.onSurfaceVariant,
    fontVariant: ['tabular-nums'],
  },
  originRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  origin: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 48,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: shape.large,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  originPlace: { ...type.bodyMedium, color: scheme.onSurfaceVariant, flex: 1 },
  warning: { color: scheme.warning },
  reset: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: shape.medium,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  focused: { borderColor: scheme.primary },
  searchFocused: { borderColor: scheme.primary },
  searchPressed: { backgroundColor: scheme.surfaceContainerHighest, borderRadius: shape.large },
  pressed: { backgroundColor: scheme.surfaceContainerHighest },
});
