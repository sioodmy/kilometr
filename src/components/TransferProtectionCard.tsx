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
import { ChevronRight, ShieldCheck, ShieldAlert, ShieldOff } from 'lucide-react-native';
import { useStrings, type Strings } from '../i18n';
import { scheme } from '../theme/tokens';
import type { TransferProtectionState } from '../services/notifications/transferTypes';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export function TransferAction({
  children,
  label,
  onPress,
  disabled,
  style,
}: {
  children: ReactNode;
  label: string;
  onPress: () => void;
  disabled?: boolean;
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
      accessibilityState={{ disabled: !!disabled }}
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
  const warning = transferNeedsAttention(state);
  const unavailable = state?.status === 'unavailable';
  const Icon = warning ? ShieldAlert : unavailable ? ShieldOff : ShieldCheck;
  const color = warning
    ? scheme.onWarningContainer
    : state?.status === 'changed'
      ? s.transferGuard.changedBody(state.nextLine ?? '', state.transferStop ?? '')
      : unavailable
        ? scheme.onSurfaceVariant
        : scheme.onPrimaryContainer;
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
      label={active ? s.transferGuard.showOptions : s.transferGuard.start}
      onPress={onPress}
      disabled={busy}
      style={[styles.card, warning && styles.warning, unavailable && styles.unavailable]}
    >
      <View style={[styles.symbol, warning && styles.warningSymbol]}>
        {busy ? (
          <ActivityIndicator color={color} />
        ) : (
          <Icon size={28} color={color} strokeWidth={1.8} />
        )}
      </View>
      <View style={styles.copy}>
        {active && <Text style={[styles.eyebrow, { color }]}>{s.transferGuard.title}</Text>}
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
  card: { backgroundColor: scheme.primaryContainer, padding: 18, justifyContent: 'flex-start' },
  warning: { backgroundColor: scheme.warningContainer },
  unavailable: { backgroundColor: scheme.surfaceContainerHigh },
  symbol: {
    width: 52,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderBottomLeftRadius: 22,
    borderBottomRightRadius: 8,
    backgroundColor: scheme.onPrimaryContainer + '14',
  },
  warningSymbol: { backgroundColor: scheme.onWarningContainer + '14' },
  copy: { flex: 1, minWidth: 0, gap: 5 },
  eyebrow: { fontSize: 12, fontWeight: '500', lineHeight: 17 },
  title: { fontSize: 19, lineHeight: 25, fontWeight: '600', letterSpacing: -0.3 },
  body: { fontSize: 13, lineHeight: 19 },
});
