import { useEffect, useState, type ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { SpringPressable } from './SpringPressable';
import { motion } from '../theme/motion';
import { elev, scheme, shape } from '../theme/tokens';
import { useStrings } from '../i18n';

interface M3DialogAction {
  label: string;
  onPress: () => void;
  /** Przycisk tekstowy zamiast wypełnionego. */
  tonal?: boolean;
  destructive?: boolean;
}

interface M3DialogProps {
  visible: boolean;
  icon: ReactNode;
  /** Kolor tonalnego kontenera pod ikoną (np. scheme.errorContainer). */
  iconContainerColor: string;
  title: string;
  message?: string;
  actions: M3DialogAction[];
  onClose: () => void;
}

/**
 * Dialog M3 Expressive: ikona w tonalnym kontenerze, nagłówek, treść
 * pomocnicza i sprężyste wejście kontenera ze skalowaniem.
 */
export function M3Dialog({
  visible,
  icon,
  iconContainerColor,
  title,
  message,
  actions,
  onClose,
}: M3DialogProps) {
  const s = useStrings();
  const reducedMotion = useReducedMotion();
  const [rendered, setRendered] = useState(visible);
  const progress = useSharedValue(visible ? 1 : 0);

  useEffect(() => {
    if (visible) {
      setRendered(true);
      if (reducedMotion) {
        progress.value = 1;
      } else {
        progress.value = 0;
        progress.value = withSpring(1, motion.spring.spatialDefault);
      }
      return;
    }
    if (!rendered) return;
    if (reducedMotion) {
      progress.value = 0;
      setRendered(false);
      return;
    }
    progress.value = withTiming(0, motion.exit, (finished) => {
      if (finished) runOnJS(setRendered)(false);
    });
  }, [visible, rendered, reducedMotion, progress]);

  const scrimStyle = useAnimatedStyle(() => ({
    opacity: Math.max(0, Math.min(1, progress.value)),
  }));

  const cardStyle = useAnimatedStyle(() => ({
    opacity: Math.max(0, Math.min(1, interpolate(progress.value, [0, 0.45, 1], [0, 0.9, 1]))),
    transform: [
      { translateY: interpolate(progress.value, [0, 1], [14, 0]) },
      { scale: interpolate(progress.value, [0, 1], [0.92, 1]) },
    ],
  }));

  if (!rendered) return null;

  return (
    <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={onClose}>
      <Animated.View style={[styles.scrim, scrimStyle]}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityLabel={s.common.close}
        />
        <View style={styles.center} pointerEvents="box-none">
          <Animated.View
            style={[styles.card, cardStyle]}
            accessibilityRole="alert"
            accessibilityLabel={title}
            accessibilityViewIsModal
          >
            <View style={[styles.iconBox, { backgroundColor: iconContainerColor }]}>{icon}</View>

            <Text style={styles.title}>{title}</Text>
            {message ? <Text style={styles.message}>{message}</Text> : null}

            <View style={styles.actions}>
              {actions.map((action, index) => (
                <SpringPressable
                  key={`${action.label}-${index}`}
                  haptic="selection"
                  scaleDelta={0.03}
                  onPress={() => {
                    onClose();
                    action.onPress();
                  }}
                  style={[
                    styles.actionBtn,
                    !action.tonal && styles.actionFilled,
                    !action.tonal && action.destructive && styles.actionDestructive,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={action.label}
                >
                  <Text
                    style={[
                      styles.actionLabel,
                      !action.tonal && styles.actionLabelFilled,
                      !action.tonal && action.destructive && styles.actionLabelDestructive,
                    ]}
                  >
                    {action.label}
                  </Text>
                </SpringPressable>
              ))}
            </View>
          </Animated.View>
        </View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    backgroundColor: scheme.scrim,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: scheme.surfaceContainerHigh,
    borderRadius: shape.extraLarge,
    padding: 24,
    ...elev.level3,
  },
  iconBox: {
    alignSelf: 'flex-start',
    width: 60,
    height: 60,
    borderRadius: shape.large,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  title: {
    fontSize: 22,
    lineHeight: 28,
    fontFamily: 'Manrope_700Bold',
    color: scheme.onSurface,
    letterSpacing: -0.2,
    marginBottom: 8,
  },
  message: {
    fontSize: 14,
    lineHeight: 20,
    fontFamily: 'Manrope_500Medium',
    color: scheme.onSurfaceVariant,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 24,
  },
  actionBtn: {
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: shape.full,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionFilled: {
    backgroundColor: scheme.primary,
  },
  actionDestructive: {
    backgroundColor: scheme.error,
  },
  actionLabel: {
    fontSize: 14,
    fontFamily: 'Manrope_700Bold',
    color: scheme.onSurface,
  },
  actionLabelFilled: {
    color: scheme.onPrimary,
  },
  actionLabelDestructive: {
    color: scheme.onError,
  },
});
