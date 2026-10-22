import { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  findNodeHandle,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useReducedMotion } from 'react-native-reanimated';
import { Clock3, MapPin, ShieldAlert, ShieldCheck, X } from 'lucide-react-native';
import { useStrings } from '../i18n';
import { scheme } from '../theme/tokens';
import type { Connection } from '../types/models';
import type { TransferProtectionState } from '../services/notifications/transferTypes';
import { clockFromMs } from '../services/notifications/format';
import { LineBadge } from './LineBadge';
import { DirectionsWalk } from './DirectionsWalk';
import { getSettingsSync, profileWalkSpeedMps } from '../services/settings';
import { TransferAction, transferNeedsAttention, transferTitle } from './TransferProtectionCard';

export function TransferProtectionSheet({
  connection,
  state,
  onClose,
  onAccept,
  onStop,
}: {
  connection: Connection;
  state: TransferProtectionState;
  onClose: () => void;
  onAccept: (id: string) => Promise<boolean>;
  onStop: () => void;
}) {
  const s = useStrings();
  const t = s.transferGuard;
  const insets = useSafeAreaInsets();
  const { height, width, fontScale } = useWindowDimensions();
  const reduceMotion = useReducedMotion();
  const titleRef = useRef<Text>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const alternative = state.alternative;
  const expired =
    !!alternative && (now >= alternative.validUntil || now - state.updatedAt > 30_000);
  const warning = transferNeedsAttention(state);
  const compact = width / fontScale < 350;
  const Icon = warning ? ShieldAlert : ShieldCheck;
  const description =
    state.status === 'preparing'
      ? t.preparing
      : state.status === 'unavailable'
        ? t.unavailableBody
        : state.status === 'noAlternative'
          ? t.noAlternative
          : state.status === 'risk' || state.status === 'rerouting'
            ? t.riskBody
            : state.status === 'safe'
              ? t.buffer(state.nextLine ?? '', Math.max(0, Math.floor((state.slackSec ?? 0) / 60)))
              : state.status === 'complete'
                ? t.complete
                : state.status === 'changed'
                  ? t.changedBody(state.nextLine ?? '', state.transferStop ?? '')
                  : alternative
                    ? t.unchanged
                    : t.waiting;
  const remaining = alternative?.connection.legs
    .slice(alternative.activeLegIndex)
    .filter((_, index) => alternative.kind === 'fromHere' || index > 0);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    setError(null);
  }, [alternative?.id]);

  const accept = async () => {
    if (busy || !alternative || expired) return;
    setBusy(true);
    setError(null);
    try {
      if (await onAccept(alternative.id)) onClose();
      else setError(t.expired);
    } catch {
      setError(t.acceptError);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      transparent
      statusBarTranslucent
      navigationBarTranslucent
      animationType={reduceMotion ? 'none' : 'slide'}
      onRequestClose={() => {
        if (!busy) onClose();
      }}
      onShow={() => {
        const tag = findNodeHandle(titleRef.current);
        if (tag) AccessibilityInfo.setAccessibilityFocus(tag);
      }}
    >
      <View style={[styles.overlay, { paddingTop: insets.top + 12 }]}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={() => {
            if (!busy) onClose();
          }}
          accessible={false}
          focusable={false}
          importantForAccessibility="no-hide-descendants"
        />
        <View
          accessibilityViewIsModal
          importantForAccessibility="yes"
          style={[
            styles.sheet,
            { maxHeight: height - insets.top - 12, paddingBottom: Math.max(insets.bottom, 16) },
          ]}
        >
          <View style={styles.header}>
            <Text style={styles.label}>{t.title}</Text>
            <TransferAction label={t.later} onPress={onClose} disabled={busy} style={styles.close}>
              <X size={22} color={scheme.onSurfaceVariant} />
            </TransferAction>
          </View>
          <ScrollView
            bounces={false}
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}
          >
            <View style={[styles.symbol, warning && styles.warningSymbol]}>
              <Icon
                size={32}
                strokeWidth={1.8}
                color={warning ? scheme.onWarningContainer : scheme.onPrimaryContainer}
              />
            </View>
            <Text ref={titleRef} style={styles.headline} accessibilityRole="header">
              {transferTitle(state, s)}
            </Text>
            <Text style={styles.description} accessibilityLiveRegion="polite">
              {description}
            </Text>
            {(state.delaySec != null || state.slackSec != null) && (
              <View style={styles.facts}>
                {state.delaySec != null && state.delaySec > 0 && (
                  <Text style={styles.fact}>{t.delay(Math.ceil(state.delaySec / 60))}</Text>
                )}
                {state.slackSec != null && (
                  <Text style={[styles.fact, warning && styles.warningFact]}>
                    {state.slackSec < 0
                      ? t.shortBy(Math.ceil(-state.slackSec / 60))
                      : t.spare(Math.floor(state.slackSec / 60))}
                  </Text>
                )}
              </View>
            )}
            {state.nextLine && (
              <View style={styles.original}>
                <View style={styles.flex}>
                  <Text style={styles.label}>{t.originalPlan}</Text>
                  <View style={styles.originalLine}>
                    <LineBadge line={state.nextLine} />
                    <Text style={styles.stopName}>{state.transferStop}</Text>
                  </View>
                </View>
                {state.departureAtMs != null && (
                  <View style={styles.originalTime}>
                    <Text style={styles.label}>{t.departure}</Text>
                    <Text style={styles.timeSmall}>{clockFromMs(state.departureAtMs)}</Text>
                    <Text style={styles.source}>
                      {state.departureSource === 'live' ? t.live : t.schedule}
                    </Text>
                  </View>
                )}
              </View>
            )}
            {alternative && (
              <View style={styles.proposal}>
                <View style={[styles.arrivalRow, compact && styles.stacked]}>
                  <View style={styles.flex}>
                    <Text style={styles.proposalLabel}>{t.suggestedPlan}</Text>
                    <Text style={styles.destination}>{connection.toTitle}</Text>
                  </View>
                  <View style={styles.arrival}>
                    <Text style={styles.proposalLabel}>{t.arrival}</Text>
                    <Text style={styles.time}>{clockFromMs(alternative.arrivalAtMs)}</Text>
                  </View>
                </View>
                <View style={styles.instruction}>
                  <MapPin size={20} color={scheme.onSecondaryContainer} />
                  <Text style={styles.instructionText}>
                    {alternative.kind === 'stayOn'
                      ? t.stayUntil(state.currentLine ?? '', alternative.transferStop)
                      : alternative.kind === 'fromHere'
                        ? t.fromHere
                        : t.sameStop}
                  </Text>
                </View>
                {remaining?.map((leg, index) => (
                  <View key={`${leg.id}:${index}`} style={styles.leg}>
                    {leg.mode === 'walk' ? (
                      <DirectionsWalk size={22} color={scheme.onSurfaceVariant} />
                    ) : (
                      <LineBadge line={leg.line} mode={leg.mode} size="large" />
                    )}
                    <View style={styles.flex}>
                      <Text style={styles.legStop}>{leg.fromStop}</Text>
                      <Text style={styles.legDirection}>{leg.toStop}</Text>
                    </View>
                    <Text style={styles.legTime}>
                      {leg.mode === 'walk'
                        ? s.compass.walkMins(
                            Math.max(
                              1,
                              Math.ceil(
                                (leg.walkM ?? 0) /
                                  profileWalkSpeedMps(getSettingsSync().walkPace) /
                                  60,
                              ),
                            ),
                          )
                        : leg.departAt}
                    </Text>
                  </View>
                ))}
                <View style={styles.sourceRow}>
                  <Clock3 size={15} color={scheme.onSurfaceVariant} />
                  <Text style={styles.source}>{t.schedule}</Text>
                </View>
              </View>
            )}
            {(state.status === 'rerouting' || state.status === 'preparing') && (
              <ActivityIndicator color={scheme.primary} />
            )}
          </ScrollView>
          <View style={styles.footer}>
            {(error || expired) && (
              <Text accessibilityRole="alert" style={styles.error}>
                {error ?? t.expired}
              </Text>
            )}
            <Text style={styles.scope}>
              {state.scope === 'background' ? t.background : t.foreground}
            </Text>
            {alternative && (
              <TransferAction
                label={t.choose}
                onPress={() => void accept()}
                disabled={busy || expired}
                style={styles.confirm}
              >
                {busy && <ActivityIndicator color={scheme.onPrimary} />}
                <Text style={styles.confirmText}>{t.choose}</Text>
              </TransferAction>
            )}
            <TransferAction
              label={warning ? t.keepPlan : s.common.close}
              onPress={onClose}
              disabled={busy}
            >
              <Text style={styles.keepText}>{warning ? t.keepPlan : s.common.close}</Text>
            </TransferAction>
            {!warning && (
              <TransferAction label={t.stop} onPress={onStop} disabled={busy}>
                <Text style={styles.stopText}>{t.stop}</Text>
              </TransferAction>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    alignItems: 'center',
    backgroundColor: '#00000099',
  },
  sheet: {
    width: '100%',
    maxWidth: 560,
    backgroundColor: scheme.surfaceContainerLow,
    borderTopLeftRadius: 36,
    borderTopRightRadius: 36,
    flexShrink: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 24,
    paddingRight: 12,
    paddingTop: 8,
  },
  label: { fontSize: 12, lineHeight: 18, color: scheme.onSurfaceVariant },
  close: { width: 48, height: 48, padding: 0, marginLeft: 'auto' },
  content: { paddingHorizontal: 24, paddingBottom: 12, gap: 16 },
  symbol: {
    width: 52,
    height: 52,
    borderRadius: 20,
    borderBottomRightRadius: 8,
    backgroundColor: scheme.primaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  warningSymbol: { backgroundColor: scheme.warningContainer },
  headline: {
    fontSize: 30,
    lineHeight: 36,
    fontWeight: '600',
    letterSpacing: -0.7,
    color: scheme.onSurface,
  },
  description: { fontSize: 15, lineHeight: 22, color: scheme.onSurfaceVariant, marginTop: -6 },
  facts: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  fact: { fontSize: 13, lineHeight: 20, color: scheme.onSurfaceVariant },
  warningFact: { color: scheme.warning },
  original: { flexDirection: 'row', flexWrap: 'wrap', gap: 16, paddingVertical: 6 },
  originalLine: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8 },
  flex: { flex: 1, minWidth: 0, gap: 4 },
  stopName: { fontSize: 14, lineHeight: 20, color: scheme.onSurface, flexShrink: 1 },
  originalTime: { gap: 4 },
  timeSmall: {
    fontSize: 21,
    fontWeight: '500',
    color: scheme.onSurface,
    fontVariant: ['tabular-nums'],
  },
  source: { fontSize: 12, lineHeight: 18, color: scheme.onSurfaceVariant, flexShrink: 1 },
  proposal: {
    borderRadius: 28,
    backgroundColor: scheme.surfaceContainerHigh,
    padding: 20,
    gap: 18,
  },
  arrivalRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  stacked: { flexDirection: 'column', alignItems: 'stretch' },
  proposalLabel: { fontSize: 12, lineHeight: 18, color: scheme.onSurfaceVariant },
  destination: { fontSize: 18, lineHeight: 24, fontWeight: '600', color: scheme.onSurface },
  arrival: { gap: 2 },
  time: {
    fontSize: 40,
    lineHeight: 46,
    letterSpacing: -1.5,
    fontWeight: '500',
    color: scheme.primary,
    fontVariant: ['tabular-nums'],
    includeFontPadding: false,
  },
  instruction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 16,
    backgroundColor: scheme.secondaryContainer,
  },
  instructionText: {
    fontSize: 14,
    lineHeight: 21,
    fontWeight: '500',
    color: scheme.onSecondaryContainer,
    flex: 1,
  },
  leg: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 12 },
  legStop: { fontSize: 14, lineHeight: 20, fontWeight: '500', color: scheme.onSurface },
  legDirection: { fontSize: 13, lineHeight: 19, color: scheme.onSurfaceVariant },
  legTime: { fontSize: 16, lineHeight: 22, color: scheme.onSurface, fontVariant: ['tabular-nums'] },
  sourceRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  scope: {
    fontSize: 12,
    lineHeight: 18,
    color: scheme.onSurfaceVariant,
    textAlign: 'center',
    marginBottom: 6,
  },
  error: { fontSize: 14, lineHeight: 21, color: scheme.error },
  footer: { paddingHorizontal: 24, paddingTop: 8, gap: 4 },
  confirm: { backgroundColor: scheme.primary, minHeight: 60 },
  confirmText: {
    fontSize: 17,
    lineHeight: 23,
    fontWeight: '600',
    color: scheme.onPrimary,
    textAlign: 'center',
    flexShrink: 1,
  },
  keepText: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
    color: scheme.primary,
    textAlign: 'center',
    flexShrink: 1,
  },
  stopText: {
    fontSize: 14,
    lineHeight: 20,
    color: scheme.error,
    textAlign: 'center',
    flexShrink: 1,
  },
});
