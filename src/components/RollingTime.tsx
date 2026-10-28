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
  value,
  direction,
  style,
}: {
  value: string;
  direction: number;
  style: StyleProp<TextStyle>;
}) {
  const [pair, setPair] = useState({ from: value, to: value, direction });
  const [height, setHeight] = useState(0);
  const progress = useSharedValue(1);
  if (pair.to !== value) setPair({ from: pair.to, to: value, direction });

  useLayoutEffect(() => {
    if (pair.from === pair.to) return;
    progress.value = 0;
    progress.value = withSpring(1, spring);
  }, [pair, progress]);

  const outgoing = useAnimatedStyle(() => ({
    transform: [{ translateY: -progress.value * height * pair.direction }],
    opacity: 1 - progress.value,
  }));
  const incoming = useAnimatedStyle(() => ({
    transform: [{ translateY: (1 - progress.value) * height * pair.direction }],
  }));

  return (
    <View style={styles.digit}>
      <Text
        style={[style, styles.measure]}
        onLayout={(event) => setHeight(event.nativeEvent.layout.height)}
      >
        0
      </Text>
      <Animated.Text style={[style, styles.layer, outgoing]}>{pair.from}</Animated.Text>
      <Animated.Text style={[style, styles.layer, incoming]}>{pair.to}</Animated.Text>
    </View>
  );
});

export function RollingTime({ value, style }: { value: string; style: StyleProp<TextStyle> }) {
  const [previous, setPrevious] = useState(value);
  const delta = timeStringToSeconds(value) - timeStringToSeconds(previous);
  const direction =
    (delta > 43200 ? delta - 86400 : delta < -43200 ? delta + 86400 : delta) < 0 ? -1 : 1;
  useLayoutEffect(() => setPrevious(value), [value]);

  return (
    <View accessible accessibilityLabel={value} style={styles.time}>
      <View
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
            <RollingDigit key={index} value={character} direction={direction} style={style} />
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
