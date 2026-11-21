import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { ArrowRight, ShieldAlert, X } from './icons';
import { useStrings } from '../i18n';
import { scheme } from '../theme/tokens';
import { useCurrentLocation } from '../services/currentLocation';
import {
  acceptTransferAlternative,
  refreshTransferAlternatives,
  setTransferProtectionEnabled,
  stopTracking,
  useTrackedTrip,
} from '../services/notifications';
import { usesNativeTransferProtection } from '../services/notifications/module';
import {
  hasTransfer,
  type TransferProtectionState,
} from '../services/notifications/transferTypes';
import {
  formatSlackLabel,
  transferNeedsAttention,
  transferTitle,
  transferTone,
} from './TransferProtectionCard';
import { TransferProtectionSheet } from './TransferProtectionSheet';

const OpenTransfer = createContext<() => void>(() => {});
export const useTransferProtection = () => useContext(OpenTransfer);

const STALE_ALERT_MS = 90_000;
const STABLE_STATUSES = new Set([
  'preparing',
  'waiting',
  'safe',
  'changed',
  'conductor',
  'complete',
]);

function ForegroundLocation() {
  // Przesiadka wymaga dokładnego GPS, bo liczy się dojście do słupka.
  useCurrentLocation(true, true);
  return null;
}

function sanitizeFreshness(
  transfer: TransferProtectionState | undefined,
  now: number,
): TransferProtectionState | undefined {
  if (!transfer) return undefined;
  const ageMs = now - transfer.updatedAt;
  if (ageMs > STALE_ALERT_MS && !STABLE_STATUSES.has(transfer.status)) {
    return {
      ...transfer,
      status: 'unavailable',
      alternative: undefined,
      alternatives: undefined,
    };
  }
  const freshAlts = (
    transfer.alternatives && transfer.alternatives.length > 0
      ? transfer.alternatives
      : transfer.alternative
        ? [transfer.alternative]
        : []
  ).filter((alt) => alt.validUntil > now);
  if (transfer.status === 'alternative' && freshAlts.length === 0) {
    return {
      ...transfer,
      alternative: undefined,
      alternatives: undefined,
    };
  }
  if (freshAlts.length > 0) {
    return {
      ...transfer,
      alternative: freshAlts[0],
      alternatives: freshAlts,
    };
  }
  return transfer;
}

export function TransferProtectionProvider({ children }: { children: ReactNode }) {
  const { trip } = useTrackedTrip();
  const s = useStrings();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  const buzzed = useRef(new Set<string>());

  const active = trip?.protectionEnabled === true && hasTransfer(trip.connection);
  const state = useMemo(
    () => (active ? sanitizeFreshness(trip.transfer, now) : undefined),
    [active, trip?.transfer, now],
  );
  const urgent = transferNeedsAttention(state);

  const incidentKey =
    trip && urgent && state
      ? `${trip.id}:${trip.startedAt}:${state.activeLegIndex ?? 0}:${state.status}:${state.alternative?.id ?? 'none'}`
      : null;

  useEffect(() => {
    setOpen(false);
    setDismissedKey(null);
    buzzed.current.clear();
  }, [trip?.id, trip?.startedAt]);

  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(timer);
  }, [active]);

  useEffect(() => {
    if (!incidentKey || AppState.currentState !== 'active') return;
    if (buzzed.current.has(incidentKey)) return;
    buzzed.current.add(incidentKey);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
  }, [incidentKey]);

  const showDock = urgent && !open && incidentKey != null && dismissedKey !== incidentKey;
  const tone = transferTone(state);
  const dockDanger = tone === 'danger';
  const dockBg = dockDanger ? scheme.errorContainer : scheme.warningContainer;
  const dockFg = dockDanger ? scheme.onErrorContainer : scheme.onWarningContainer;
  const dockBorder = dockDanger ? scheme.error : scheme.warning;
  const altCount = state?.alternatives?.length ?? (state?.alternative ? 1 : 0);
  const dockSub =
    state?.status === 'alternative' && altCount > 0
      ? s.transferGuard.alternativesCount(altCount)
      : formatSlackLabel(state, s) ?? s.transferGuard.showOptions;

  return (
    <OpenTransfer.Provider value={() => setOpen(true)}>
      {active && !usesNativeTransferProtection() && <ForegroundLocation />}
      <View
        style={styles.content}
        accessibilityElementsHidden={open && !!state}
        importantForAccessibility={open && state ? 'no-hide-descendants' : 'auto'}
      >
        {children}
      </View>

      {showDock && state && (
        <View
          pointerEvents="box-none"
          style={[styles.dockWrap, { paddingBottom: Math.max(12, insets.bottom + 8) }]}
        >
          <View style={[styles.dock, { backgroundColor: dockBg, borderColor: dockBorder }]}>
            <Pressable
              onPress={() => setOpen(true)}
              accessibilityRole="button"
              accessibilityLabel={`${transferTitle(state, s)}. ${s.transferGuard.dockOpenAction}`}
              style={styles.dockMain}
            >
              <View style={[styles.dockIconWrap, { backgroundColor: dockFg + '18' }]}>
                <ShieldAlert size={22} color={dockFg} />
              </View>
              <View style={styles.dockCopy}>
                <View style={styles.dockTopRow}>
                  <Text style={[styles.dockTitle, { color: dockFg }]} numberOfLines={1}>
                    {transferTitle(state, s)}
                  </Text>
                </View>
                <View style={styles.dockMetaRow}>
                  {state.currentLine && state.nextLine && (
                    <View style={[styles.dockCorridor, { borderColor: dockFg + '33' }]}>
                      <Text style={[styles.dockCorridorText, { color: dockFg }]}>
                        {state.currentLine}
                      </Text>
                      <ArrowRight size={10} color={dockFg} />
                      <Text style={[styles.dockCorridorText, { color: dockFg }]}>
                        {state.nextLine}
                      </Text>
                    </View>
                  )}
                  <Text style={[styles.dockSub, { color: dockFg }]} numberOfLines={1}>
                    {dockSub}
                  </Text>
                </View>
              </View>
              <View style={[styles.dockCta, { backgroundColor: dockFg }]}>
                <Text style={[styles.dockCtaText, { color: dockBg }]}>
                  {s.transferGuard.dockOpenAction}
                </Text>
              </View>
            </Pressable>

            <Pressable
              onPress={() => setDismissedKey(incidentKey)}
              accessibilityRole="button"
              accessibilityLabel={s.common.close}
              style={styles.dockClose}
            >
              <X size={18} color={dockFg} />
            </Pressable>
          </View>
        </View>
      )}

      {open && state && trip && (
        <TransferProtectionSheet
          connection={trip.connection}
          state={state}
          onClose={() => setOpen(false)}
          onAccept={acceptTransferAlternative}
          onRefresh={refreshTransferAlternatives}
          onPauseProtection={() => {
            setOpen(false);
            void setTransferProtectionEnabled(false);
          }}
          onStop={() => {
            setOpen(false);
            void stopTracking();
          }}
        />
      )}
    </OpenTransfer.Provider>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1 },
  dockWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 14,
    alignItems: 'center',
  },
  dock: {
    width: '100%',
    maxWidth: 560,
    borderRadius: 24,
    borderWidth: 1.5,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 12,
    paddingRight: 6,
    paddingVertical: 10,
    gap: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.32,
    shadowRadius: 16,
    elevation: 8,
  },
  dockMain: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 44,
  },
  dockIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dockCopy: { flex: 1, minWidth: 0, gap: 3 },
  dockTopRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dockTitle: { fontSize: 14, lineHeight: 19, fontWeight: '700', flex: 1 },
  dockMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dockCorridor: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  dockCorridorText: { fontSize: 11, fontWeight: '800' },
  dockSub: { fontSize: 12, lineHeight: 16, fontWeight: '600', flex: 1 },
  dockCta: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    minHeight: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dockCtaText: { fontSize: 12, fontWeight: '800' },
  dockClose: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
