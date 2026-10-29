import { useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, {
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { ChevronRight, ShieldCheck, ShieldAlert, ShieldOff } from './icons';
import { useStrings, type Strings } from '../i18n';
import { scheme } from '../theme/tokens';
import type { TransferProtectionState } from '../services/notifications/transferTypes';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export function TransferAction({
  children,
  label,
  onPress,
  disabled,
  selected,
  style,
}: {
  children: ReactNode;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  selected?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const [focused, setFocused] = useState(false);
  const press = useSharedValue(0);
  const animated = useAnimatedStyle(() => ({
    borderRadius: 28 - press.value * 12,
    transform: [{ scale: 1 - press.value * 0.025 }],
    opacity: 1 - press.value * 0.12,
  }));
  const setPress = (value: number) => {
    press.value = withSpring(value, {
      damping: 22,
      stiffness: 400,
      reduceMotion: ReduceMotion.System,
    });
  };
  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled, selected }}
      disabled={disabled}
      onPress={onPress}
      onPressIn={() => setPress(1)}
      onPressOut={() => setPress(0)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={[
        styles.action,
        style,
        animated,
        focused && styles.focused,
        disabled && styles.disabled,
      ]}
    >
      {children}
    </AnimatedPressable>
  );
}

export function transferNeedsAttention(state?: TransferProtectionState) {
  return (
    state != null && ['risk', 'rerouting', 'alternative', 'noAlternative'].includes(state.status)
  );
}

export function transferTitle(state: TransferProtectionState | undefined, s: Strings) {
  const t = s.transferGuard;
  switch (state?.status) {
    case 'preparing':
      return t.preparing;
    case 'safe':
      return t.safe;
    case 'risk':
    case 'rerouting':
    case 'noAlternative':
      return state.nextLine ? t.riskTitle(state.nextLine) : t.attention;
    case 'alternative':
      return t.alternativeTitle;
    case 'unavailable':
      return t.unavailable;
    case 'complete':
      return t.complete;
    case 'changed':
      return t.active;
    default:
      return t.active;
  }
}

export function TransferProtectionCard({
  state,
  active,
  busy,
  onPress,
}: {
  state?: TransferProtectionState;
  active: boolean;
  busy?: boolean;
  onPress: () => void;
}) {
  const s = useStrings();
  const warning = active && transferNeedsAttention(state);
  const unavailable = active && state?.status === 'unavailable';
  const Icon = !active ? ShieldOff : warning || unavailable ? ShieldAlert : ShieldCheck;
  const color =
    !active || unavailable
      ? scheme.onSurfaceVariant
      : warning
        ? scheme.onWarningContainer
        : scheme.onPrimaryContainer;
  const statusLabel = active ? s.transferGuard.enabled : s.transferGuard.disabled;
  const body = !active
    ? s.transferGuard.startBody
    : warning
      ? s.transferGuard.showOptions
      : state?.status === 'safe' && state.nextLine
        ? s.transferGuard.next(state.nextLine, state.transferStop ?? '')
        : unavailable
          ? s.transferGuard.unavailableBody
          : s.transferGuard.waiting;
  return (
    <TransferAction
      label={`${active ? s.transferGuard.showOptions : s.transferGuard.start}. ${statusLabel}`}
      onPress={onPress}
      disabled={busy}
      selected={active}
      style={[
        styles.card,
        active && styles.active,
        warning && styles.warning,
        unavailable && styles.unavailable,
      ]}
    >
      <View
        style={[
          styles.symbol,
          active && styles.activeSymbol,
          warning && styles.warningSymbol,
          unavailable && styles.unavailableSymbol,
        ]}
      >
        {busy ? (
          <ActivityIndicator color={color} />
        ) : (
          <Icon size={28} color={color} />
        )}
      </View>
      <View style={styles.copy}>
        <Text style={[styles.eyebrow, { color }]}>
          {s.transferGuard.title} · {statusLabel}
        </Text>
        <Text style={[styles.title, { color }]}>
          {active ? transferTitle(state, s) : s.transferGuard.start}
        </Text>
        <Text style={[styles.body, { color }]}>{body}</Text>
      </View>
      <ChevronRight size={20} color={color} />
    </TransferAction>
  );
}

const styles = StyleSheet.create({
  action: {
    minHeight: 52,
    minWidth: 48,
    borderWidth: 2,
    borderColor: 'transparent',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
    paddingVertical: 14,
    gap: 12,
  },
  focused: {
    outlineColor: scheme.primary,
    outlineWidth: 2,
    outlineOffset: 3,
    outlineStyle: 'solid',
  },
  disabled: { opacity: 0.5 },
  card: {
    backgroundColor: scheme.surfaceContainer,
    borderColor: scheme.outlineVariant,
    padding: 18,
    justifyContent: 'flex-start',
  },
  active: { backgroundColor: scheme.primaryContainer, borderColor: scheme.primary },
  warning: { backgroundColor: scheme.warningContainer, borderColor: scheme.warning },
  unavailable: { backgroundColor: scheme.surfaceContainerHigh, borderColor: scheme.outline },
  symbol: {
    width: 52,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderBottomLeftRadius: 22,
    borderBottomRightRadius: 8,
    backgroundColor: scheme.onSurfaceVariant + '14',
  },
  activeSymbol: { backgroundColor: scheme.onPrimaryContainer + '14' },
  unavailableSymbol: { backgroundColor: scheme.onSurfaceVariant + '14' },
  warningSymbol: { backgroundColor: scheme.onWarningContainer + '14' },
  copy: { flex: 1, minWidth: 0, gap: 5 },
  eyebrow: { fontSize: 12, fontWeight: '500', lineHeight: 17 },
  title: { fontSize: 19, lineHeight: 25, fontWeight: '600', letterSpacing: -0.3 },
  body: { fontSize: 13, lineHeight: 19 },
});
