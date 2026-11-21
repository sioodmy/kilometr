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
import { ArrowRight, ChevronRight, ShieldAlert, ShieldCheck, ShieldOff } from './icons';
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
    borderRadius: 24 - press.value * 8,
    transform: [{ scale: 1 - press.value * 0.02 }],
    opacity: 1 - press.value * 0.1,
  }));
  const setPress = (value: number) => {
    press.value = withSpring(value, {
      damping: 24,
      stiffness: 420,
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

export type TransferTone = 'safe' | 'warning' | 'danger' | 'neutral';

export function transferNeedsAttention(state?: TransferProtectionState): boolean {
  return (
    state != null &&
    ['risk', 'rerouting', 'alternative', 'noAlternative', 'conductor'].includes(state.status)
  );
}

export function transferTone(state?: TransferProtectionState): TransferTone {
  if (!state) return 'neutral';
  switch (state.status) {
    case 'safe':
    case 'changed':
    case 'complete':
      return 'safe';
    case 'risk':
    case 'rerouting':
    case 'alternative':
    case 'conductor':
      return 'warning';
    case 'noAlternative':
      return 'danger';
    default:
      return 'neutral';
  }
}

export function transferTitle(state: TransferProtectionState | undefined, s: Strings): string {
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
    case 'conductor':
      return t.conductorTitle;
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

export function formatSlackLabel(
  state: TransferProtectionState | undefined,
  s: Strings,
): string | null {
  if (!state || state.slackSec == null) return null;
  if (state.slackSec < 0) return s.transferGuard.shortBy(Math.max(1, Math.ceil(-state.slackSec / 60)));
  const min = Math.floor(state.slackSec / 60);
  if (min <= 0) return s.transferGuard.tightTransfer;
  return s.transferGuard.spare(min);
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
  const tone = active ? transferTone(state) : 'neutral';
  const warning = tone === 'warning';
  const danger = tone === 'danger';
  const unavailable = active && state?.status === 'unavailable';
  const Icon = !active ? ShieldOff : warning || danger || unavailable ? ShieldAlert : ShieldCheck;
  const color =
    !active || unavailable
      ? scheme.onSurfaceVariant
      : danger
        ? scheme.onErrorContainer
        : warning
          ? scheme.onWarningContainer
          : scheme.onPrimaryContainer;
  const statusLabel = active ? s.transferGuard.enabled : s.transferGuard.disabled;
  const slackText = active ? formatSlackLabel(state, s) : null;
  const altCount = state?.alternatives?.length ?? (state?.alternative ? 1 : 0);
  const body = !active
    ? s.transferGuard.startBody
    : state?.status === 'alternative' && altCount > 0
      ? `${s.transferGuard.alternativesCount(altCount)} · ${s.transferGuard.showOptions}`
      : state?.status === 'conductor'
        ? s.transferGuard.conductorBody
        : warning || danger
          ? s.transferGuard.showOptions
          : slackText && state?.transferStop
            ? `${slackText} · ${state.transferStop}`
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
        active && tone === 'safe' && styles.active,
        active && tone === 'neutral' && !unavailable && styles.active,
        warning && styles.warning,
        danger && styles.danger,
        unavailable && styles.unavailable,
      ]}
    >
      <View
        style={[
          styles.symbol,
          active && !warning && !danger && !unavailable && styles.activeSymbol,
          warning && styles.warningSymbol,
          danger && styles.dangerSymbol,
          unavailable && styles.unavailableSymbol,
        ]}
      >
        {busy ? <ActivityIndicator color={color} /> : <Icon size={26} color={color} />}
      </View>
      <View style={styles.copy}>
        <View style={styles.topRow}>
          <Text style={[styles.eyebrow, { color }]} numberOfLines={1}>
            {s.transferGuard.title} · {statusLabel}
          </Text>
          {active && state?.currentLine && state?.nextLine && (
            <View style={[styles.corridorPill, { borderColor: color + '33' }]}>
              <Text style={[styles.corridorText, { color }]}>{state.currentLine}</Text>
              <ArrowRight size={11} color={color} />
              <Text style={[styles.corridorText, { color }]}>{state.nextLine}</Text>
            </View>
          )}
        </View>
        <Text style={[styles.title, { color }]} numberOfLines={2}>
          {active ? transferTitle(state, s) : s.transferGuard.start}
        </Text>
        <Text style={[styles.body, { color }]} numberOfLines={2}>
          {body}
        </Text>
      </View>
      <ChevronRight size={20} color={color} />
    </TransferAction>
  );
}

const styles = StyleSheet.create({
  action: {
    minHeight: 52,
    minWidth: 48,
    borderWidth: 1.5,
    borderColor: 'transparent',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
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
    padding: 16,
    justifyContent: 'flex-start',
  },
  active: { backgroundColor: scheme.primaryContainer, borderColor: scheme.primary },
  warning: { backgroundColor: scheme.warningContainer, borderColor: scheme.warning },
  danger: { backgroundColor: scheme.errorContainer, borderColor: scheme.error },
  unavailable: { backgroundColor: scheme.surfaceContainerHigh, borderColor: scheme.outline },
  symbol: {
    width: 48,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 8,
    backgroundColor: scheme.onSurfaceVariant + '14',
  },
  activeSymbol: { backgroundColor: scheme.onPrimaryContainer + '16' },
  unavailableSymbol: { backgroundColor: scheme.onSurfaceVariant + '16' },
  warningSymbol: { backgroundColor: scheme.onWarningContainer + '16' },
  dangerSymbol: { backgroundColor: scheme.onErrorContainer + '16' },
  copy: { flex: 1, minWidth: 0, gap: 4 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  eyebrow: { fontSize: 12, fontWeight: '600', lineHeight: 16 },
  corridorPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 1,
  },
  corridorText: { fontSize: 11, fontWeight: '700' },
  title: { fontSize: 18, lineHeight: 23, fontWeight: '700', letterSpacing: -0.25 },
  body: { fontSize: 13, lineHeight: 18 },
});
