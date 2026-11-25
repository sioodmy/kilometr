import { memo, useLayoutEffect, useState } from 'react';
import { StyleSheet, Text, View, type StyleProp, type TextStyle } from 'react-native';
import Animated, {
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { timeStringToSeconds } from '../gtfs/geo';

const spring = {
  damping: 24,
  stiffness: 300,
  mass: 0.8,
  overshootClamping: true,
  reduceMotion: ReduceMotion.System,
};

const RollingDigit = memo(function RollingDigit({
  initialFrom,
  value,
  direction,
  style,
}: {
  initialFrom: string;
  value: string;
  direction: number;
  style: StyleProp<TextStyle>;
}) {
  const [pair, setPair] = useState(() => ({ from: initialFrom, to: value, direction }));
  const flatStyle = StyleSheet.flatten(style);
  const initialHeight = flatStyle?.lineHeight ?? flatStyle?.fontSize ?? 0;
  const digitHeight = useSharedValue(initialHeight);
  const progress = useSharedValue(initialFrom === value ? 1 : 0);

  useLayoutEffect(() => {
    setPair((prev) => {
      if (prev.to === value) return prev;
      return { from: prev.to, to: value, direction };
    });
  }, [value, direction]);

  useLayoutEffect(() => {
    if (pair.from === pair.to) return;
    progress.value = 0;
    progress.value = withSpring(1, spring);
  }, [pair, progress]);

  const outgoing = useAnimatedStyle(() => {
    const h = digitHeight.value;
    return {
      transform: [{ translateY: -progress.value * h * pair.direction }],
      opacity: 1 - progress.value,
    };
  });

  const incoming = useAnimatedStyle(() => {
    const h = digitHeight.value;
    return {
      transform: [{ translateY: (1 - progress.value) * h * pair.direction }],
      opacity: Math.min(1, progress.value * 1.5),
    };
  });

  return (
    <View style={styles.digit}>
      <Text
        style={[style, styles.measure]}
        selectable={false}
        onLayout={(event) => {
          digitHeight.value = event.nativeEvent.layout.height;
        }}
      >
        0
      </Text>
      <Animated.Text style={[style, styles.layer, outgoing]} selectable={false}>
        {pair.from}
      </Animated.Text>
      <Animated.Text style={[style, styles.layer, incoming]} selectable={false}>
        {pair.to}
      </Animated.Text>
    </View>
  );
});

export function RollingTime({ value, style }: { value: string; style: StyleProp<TextStyle> }) {
  const [previous, setPrevious] = useState(value);
  const [animated, setAnimated] = useState(false);

  if (value !== previous && !animated) {
    setAnimated(true);
  }

  useLayoutEffect(() => {
    if (previous !== value) setPrevious(value);
  }, [previous, value]);

  // Na pierwszym renderze unikamy tworzenia kilkunastu workletów i warstw Animated.Text
  // dla niezmienionej godziny; animacja włącza się dopiero przy faktycznej zmianie wartości.
  if (!animated && value === previous) {
    return (
      <View accessible accessibilityLabel={value} style={styles.time}>
        <Text style={style} selectable={false}>
          {value}
        </Text>
      </View>
    );
  }

  const delta = timeStringToSeconds(value) - timeStringToSeconds(previous);
  const direction =
    (delta > 43200 ? delta - 86400 : delta < -43200 ? delta + 86400 : delta) < 0 ? -1 : 1;

  return (
    <View accessible accessibilityLabel={value} style={styles.time}>
      <View
        aria-hidden
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={styles.time}
      >
        {Array.from(value, (character, index) =>
          character === ':' ? (
            <Text key={index} style={style}>
              {character}
            </Text>
          ) : (
            <RollingDigit
              key={index}
              initialFrom={previous[index] ?? character}
              value={character}
              direction={direction}
              style={style}
            />
          ),
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  time: { flexDirection: 'row', alignItems: 'center' },
  digit: { overflow: 'hidden' },
  measure: { opacity: 0 },
  layer: { position: 'absolute', top: 0, left: 0 },
});
