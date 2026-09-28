import { useEffect } from 'react';
import { Dimensions, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  FadeInUp,
  FadeOutUp,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { ArrowRight, RotateCcw, Search } from 'lucide-react-native';
import { elev, scheme, shape } from '../theme/tokens';
import type { TripHistoryItem } from '../services/smartRanker';

// Progi pulla (px): lupka od 70, a szybki powrót (reverse) dopiero od ~36%
// wysokości ekranu — celowo głęboko, żeby nie dało się go zahaczyć
// przypadkowym pociągnięciem. MAX zostawia zapas nad progiem.
const SCREEN_H = Dimensions.get('window').height;
const ARM_2_PX = Math.round(SCREEN_H * 0.36);
export const LAST_TRIP_ARM_1 = 70;
export const LAST_TRIP_ARM_2 = ARM_2_PX;
export const LAST_TRIP_DISARM_2 = ARM_2_PX - 20;
export const LAST_TRIP_MAX = ARM_2_PX + 60;

export type LastTripOption = 0 | 1 | 2;

const PILL_PAD = 4;
const THUMB = 34;
const SLOT_GAP = 8;
const PILL_TRAVEL = THUMB + SLOT_GAP;

/**
 * Szybki skrót do ostatniego połączenia, odsłaniany pociągnięciem ekranu
 * w dół (pull-to-refresh bez spinnera): wiersz od→do ze strzałką i pod nim
 * pionowy toggle jak wczorajszy (lupka = szukaj, rotate = powrót).
 * Zero klikalnych elementów — wszystko obsługuje gest rodzica.
 */
export function LastTripPull({
  trip,
  option,
  height,
}: {
  trip: TripHistoryItem;
  option: LastTripOption;
  height: SharedValue<number>;
}) {
  const reversed = option === 2;

  // Strzałka: pełny obrót jak przy swapie na ekranie połączeń.
  const spin = useSharedValue(0);
  useEffect(() => {
    if (reversed) {
      spin.value = withTiming(Math.round(spin.value) + 1, {
        duration: 450,
        easing: Easing.inOut(Easing.ease),
      });
    }
  }, [reversed, spin]);
  const arrowStyle = useAnimatedStyle(() => {
    const p = spin.value % 1;
    return {
      transform: [
        { rotate: `${p * 360}deg` },
        { scale: 1 + 0.28 * Math.sin(Math.PI * p) },
      ],
    };
  });

  // Kciuk pionowego toggla: góra = lupka, dół = powrót.
  const thumbY = useSharedValue(0);
  useEffect(() => {
    thumbY.value = withTiming(reversed ? PILL_TRAVEL : 0, {
      duration: 190,
      easing: Easing.out(Easing.cubic),
    });
  }, [reversed, thumbY]);
  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: thumbY.value }],
  }));

  const containerStyle = useAnimatedStyle(() => ({
    height: height.value,
    opacity: interpolate(height.value, [0, 40], [0, 1]),
  }));

  const from = reversed ? trip.dest_title : trip.origin_title;
  const to = reversed ? trip.origin_title : trip.dest_title;

  return (
    <Animated.View style={[styles.reveal, containerStyle]}>
      <View
        style={styles.content}
        accessibilityRole="text"
        accessibilityLabel={
          reversed
            ? `Szybki powrót: ${from} do ${to}. Puść, aby wyszukać.`
            : `Ostatnie połączenie: ${from} do ${to}. Ciągnij dalej, aby odwrócić.`
        }
      >
        <View style={styles.pill}>
          <Animated.View style={[styles.thumb, thumbStyle]} />
          <View style={styles.slot} pointerEvents="none">
            <Search
              size={17}
              color={!reversed ? scheme.onSecondaryContainer : scheme.onSurfaceVariant}
            />
          </View>
          <View style={styles.slot} pointerEvents="none">
            <RotateCcw
              size={17}
              color={reversed ? scheme.onSecondaryContainer : scheme.onSurfaceVariant}
            />
          </View>
        </View>

        {/* Tekst zamienia się miejscami z rolką jak przy swapie (klucz = treść). */}
        <View style={styles.tripRow}>
          <Animated.View
            key={`from-${from}`}
            entering={new FadeInUp().duration(240)}
            exiting={new FadeOutUp().duration(200)}
            style={styles.tripSide}
          >
            <Text style={styles.fromText} numberOfLines={1}>
              {from}
            </Text>
          </Animated.View>
          <Animated.View style={arrowStyle}>
            <ArrowRight size={20} color={scheme.primary} strokeWidth={2.5} />
          </Animated.View>
          <Animated.View
            key={`to-${to}`}
            entering={new FadeInUp().duration(240)}
            exiting={new FadeOutUp().duration(200)}
            style={styles.tripSide}
          >
            <Text style={styles.toText} numberOfLines={1}>
              {to}
            </Text>
          </Animated.View>
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // Rozciąga listę w dół jak pull-to-refresh; treść doklejona do góry,
  // więc pill (sterowanie) widać od razu, a tekst dojeżdża głębiej.
  reveal: {
    overflow: 'hidden',
    justifyContent: 'flex-start',
    alignItems: 'center',
  },
  content: {
    alignItems: 'center',
    gap: 18,
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
  },
  fromText: {
    fontSize: 17,
    fontWeight: '600',
    color: scheme.onSurfaceVariant,
    textAlign: 'center',
  },
  toText: {
    fontSize: 17,
    fontWeight: '700',
    color: scheme.onSurface,
    textAlign: 'center',
  },
  // Pionowy toggle w vibe docka: pigułka, tor, kciuk jak wczoraj.
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
