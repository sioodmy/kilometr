import { Dimensions, StyleSheet, Text, View } from 'react-native';
import Animated, {
  interpolate,
  useAnimatedReaction,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withSpring,
  type SharedValue,
} from 'react-native-reanimated';
import { ArrowRight, RotateCcw, Search } from './icons';
import { motion } from '../theme/motion';
import { elev, scheme, shape, spacing, type } from '../theme/tokens';
import type { TripHistoryItem } from '../services/smartRanker';
import { useStrings } from '../i18n';

// Progi pulla (px): lupka od 70, a szybki powrót dopiero od ~36% wysokości ekranu.
const SCREEN_H = Dimensions.get('window').height;
const ARM_2_PX = Math.round(SCREEN_H * 0.36);
export const LAST_TRIP_ARM_1 = 70;
export const LAST_TRIP_ARM_2 = ARM_2_PX;
export const LAST_TRIP_DISARM_2 = ARM_2_PX - 20;
export const LAST_TRIP_MAX = ARM_2_PX + 60;

export type { LastTripOption } from '../services/lastTripPull';
import type { LastTripOption } from '../services/lastTripPull';

const PILL_PAD = 4;
const THUMB = 34;
const SLOT_GAP = 8;
const PILL_TRAVEL = THUMB + SLOT_GAP;

/**
 * Szybki skrót do ostatniego połączenia odsłaniany pociągnięciem ekranu w dół.
 * Przełącznik trybu i kierunek animują się sprężyście na wątku UI (M3 Expressive).
 */
export function LastTripPull({
  trip,
  option,
  height,
  onActivate,
}: {
  trip: TripHistoryItem;
  option: SharedValue<LastTripOption> | LastTripOption;
  height: SharedValue<number>;
  onActivate: () => void;
}) {
  const s = useStrings();

  const isReversed = useDerivedValue(() => {
    const opt = typeof option === 'number' ? option : option.value;
    return opt === 2 ? 1 : 0;
  });

  // Strzałka wykonuje sprężysty obrót przy przełączeniu kierunku powrotu.
  const spin = useSharedValue(0);
  useAnimatedReaction(
    () => isReversed.value,
    (rev, prev) => {
      if (rev !== prev && rev === 1) {
        spin.value = withSpring(Math.round(spin.value) + 1, motion.spring.spatialDefault);
      }
    },
  );

  const arrowStyle = useAnimatedStyle(() => {
    const p = spin.value % 1;
    return {
      transform: [{ rotate: `${p * 360}deg` }, { scale: 1 + 0.22 * Math.sin(Math.PI * p) }],
    };
  });

  const thumbStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateY: withSpring(isReversed.value ? PILL_TRAVEL : 0, motion.spring.spatialFast),
      },
    ],
  }));

  const searchSlotStyle = useAnimatedStyle(() => ({
    opacity: withSpring(isReversed.value ? 0.45 : 1, motion.spring.effectsFast),
  }));

  const rotateSlotStyle = useAnimatedStyle(() => ({
    opacity: withSpring(isReversed.value ? 1 : 0.45, motion.spring.effectsFast),
  }));

  const containerStyle = useAnimatedStyle(() => ({
    height: height.value,
    opacity: interpolate(height.value, [0, 40], [0, 1]),
    display: height.value <= 0.5 ? ('none' as const) : ('flex' as const),
  }));

  const normalTextStyle = useAnimatedStyle(() => ({
    opacity: withSpring(isReversed.value ? 0 : 1, motion.spring.effectsFast),
    transform: [{ translateY: withSpring(isReversed.value ? -5 : 0, motion.spring.spatialFast) }],
  }));

  const reversedTextStyle = useAnimatedStyle(() => ({
    opacity: withSpring(isReversed.value ? 1 : 0, motion.spring.effectsFast),
    transform: [{ translateY: withSpring(isReversed.value ? 0 : 5, motion.spring.spatialFast) }],
  }));

  return (
    <Animated.View style={[styles.reveal, containerStyle]}>
      <View
        style={styles.content}
        accessible
        accessibilityRole="button"
        accessibilityLabel={s.lastTrip.lastA11y(trip.origin_title, trip.dest_title)}
        accessibilityHint={s.lastTrip.activateHint}
        accessibilityActions={[{ name: 'activate' }]}
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === 'activate') onActivate();
        }}
      >
        <View style={styles.pill}>
          <Animated.View style={[styles.thumb, thumbStyle]} />
          <Animated.View style={[styles.slot, searchSlotStyle]} pointerEvents="none">
            <Search size={17} color={scheme.onSecondaryContainer} />
          </Animated.View>
          <Animated.View style={[styles.slot, rotateSlotStyle]} pointerEvents="none">
            <RotateCcw size={17} color={scheme.onSecondaryContainer} />
          </Animated.View>
        </View>

        <View style={styles.tripRow}>
          <View style={styles.tripSide}>
            <Animated.View style={normalTextStyle}>
              <Text style={styles.fromText} numberOfLines={1}>
                {trip.origin_title}
              </Text>
            </Animated.View>
            <Animated.View style={[StyleSheet.absoluteFill, styles.centerSlot, reversedTextStyle]}>
              <Text style={styles.fromText} numberOfLines={1}>
                {trip.dest_title}
              </Text>
            </Animated.View>
          </View>
          <Animated.View style={arrowStyle}>
            <ArrowRight size={20} color={scheme.primary} />
          </Animated.View>
          <View style={styles.tripSide}>
            <Animated.View style={normalTextStyle}>
              <Text style={styles.toText} numberOfLines={1}>
                {trip.dest_title}
              </Text>
            </Animated.View>
            <Animated.View style={[StyleSheet.absoluteFill, styles.centerSlot, reversedTextStyle]}>
              <Text style={styles.toText} numberOfLines={1}>
                {trip.origin_title}
              </Text>
            </Animated.View>
          </View>
        </View>

        <View style={styles.hintWrap}>
          <Animated.View style={normalTextStyle}>
            <Text style={styles.hint} numberOfLines={2}>
              {s.lastTrip.pullHint}
            </Text>
          </Animated.View>
          <Animated.View style={[StyleSheet.absoluteFill, styles.centerSlot, reversedTextStyle]}>
            <Text style={styles.hint} numberOfLines={2}>
              {s.lastTrip.pullHintBack}
            </Text>
          </Animated.View>
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  reveal: {
    overflow: 'hidden',
    justifyContent: 'flex-start',
    alignItems: 'center',
  },
  content: {
    alignItems: 'center',
    gap: spacing.lg,
    paddingTop: 12,
    paddingBottom: 12,
  },
  tripRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  tripSide: {
    flexShrink: 1,
    maxWidth: '40%',
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  centerSlot: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  fromText: {
    ...type.bodyLarge,
    fontWeight: '600',
    color: scheme.onSurfaceVariant,
    textAlign: 'center',
  },
  toText: {
    ...type.bodyLarge,
    fontWeight: '700',
    color: scheme.onSurface,
    textAlign: 'center',
  },
  hintWrap: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  hint: {
    ...type.labelMedium,
    color: scheme.onSurfaceVariant,
    textAlign: 'center',
  },
  pill: {
    width: THUMB + PILL_PAD * 2,
    padding: PILL_PAD,
    gap: SLOT_GAP,
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainerHigh,
    borderWidth: 1,
    borderColor: scheme.outlineVariant,
    ...elev.level3,
  },
  thumb: {
    position: 'absolute',
    top: PILL_PAD,
    left: PILL_PAD,
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    backgroundColor: scheme.secondaryContainer,
  },
  slot: {
    width: THUMB,
    height: THUMB,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
