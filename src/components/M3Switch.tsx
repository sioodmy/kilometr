import { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, View } from 'react-native';
import { Check } from 'lucide-react-native';
import { scheme } from '../theme/tokens';

// ─── Material 3 Switch ───────────────────────────────────────────────────────
// Spec M3 (dark): tor 52×32 full-rounded.
// OFF: surfaceContainerHighest + 2px outline, kciuk 16px w kolorze outline.
// ON:  primary bez ramki, kciuk 24px onPrimary z ikoną check w onPrimaryContainer.
// Całość animowana (pozycja + rozmiar kciuka), rola "switch" dla dostępności.

const TRACK_W = 52;
const TRACK_H = 32;
const THUMB_OFF = 16;
const THUMB_ON = 24;
const OFF_LEFT = 7;
const ON_LEFT = TRACK_W - THUMB_ON - 6; // 22

export function M3Switch({
  value,
  onChange,
  disabled = false,
  label,
}: {
  value: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label?: string;
}) {
  const anim = useRef(new Animated.Value(value ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(anim, {
      toValue: value ? 1 : 0,
      duration: 180,
      useNativeDriver: false,
    }).start();
  }, [value, anim]);

  const translateX = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, ON_LEFT - OFF_LEFT],
  });
  const thumbSize = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [THUMB_OFF, THUMB_ON],
  });

  return (
    <Pressable
      onPress={() => !disabled && onChange(!value)}
      disabled={disabled}
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled }}
      accessibilityLabel={label ?? 'Przełącznik'}
      hitSlop={8}
      style={({ pressed }) => [
        styles.track,
        {
          backgroundColor: value ? scheme.primary : scheme.surfaceContainerHighest,
          borderColor: value ? scheme.primary : scheme.outline,
          borderWidth: value ? 0 : 2,
          opacity: disabled ? 0.5 : 1,
        },
        pressed && !disabled && { opacity: disabled ? 0.5 : 0.85 },
      ]}
    >
      <Animated.View
        style={[
          styles.thumb,
          {
            width: thumbSize,
            height: thumbSize,
            borderRadius: THUMB_ON,
            backgroundColor: value ? scheme.onPrimary : scheme.outline,
            transform: [{ translateX }],
          },
        ]}
      >
        {value && (
          <View style={styles.iconWrap} pointerEvents="none">
            <Check size={16} color={scheme.primaryContainer} strokeWidth={3} />
          </View>
        )}
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  track: {
    width: TRACK_W,
    height: TRACK_H,
    borderRadius: TRACK_H / 2,
    justifyContent: 'center',
    paddingLeft: OFF_LEFT,
  },
  thumb: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
