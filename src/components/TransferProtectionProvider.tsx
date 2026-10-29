import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronRight, ShieldAlert } from './icons';
import * as Haptics from 'expo-haptics';
import { useStrings } from '../i18n';
import { scheme } from '../theme/tokens';
import { useCurrentLocation } from '../services/currentLocation';
import { acceptTransferAlternative, stopTracking, useTrackedTrip } from '../services/notifications';
import { usesNativeTransferProtection } from '../services/notifications/module';
import { hasTransfer } from '../services/notifications/transferTypes';
import { TransferAction, transferNeedsAttention, transferTitle } from './TransferProtectionCard';
import { TransferProtectionSheet } from './TransferProtectionSheet';

const OpenTransfer = createContext<() => void>(() => {});
export const useTransferProtection = () => useContext(OpenTransfer);

function ForegroundLocation() {
  useCurrentLocation();
  return null;
}

export function TransferProtectionProvider({ children }: { children: ReactNode }) {
  const { trip } = useTrackedTrip();
  const s = useStrings();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(Date.now());
  const shown = useRef(new Set<string>());
  const active = trip?.protectionEnabled === true && hasTransfer(trip.connection);
  const transfer = active ? trip.transfer : undefined;
  const state =
    transfer && now - transfer.updatedAt > 30_000 && transfer.status !== 'preparing'
      ? { ...transfer, status: 'unavailable' as const, alternative: undefined }
      : transfer;
  const urgent = transferNeedsAttention(state);

  useEffect(() => {
    setOpen(false);
    shown.current.clear();
  }, [trip?.id, trip?.startedAt]);

  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(timer);
  }, [active]);

  useEffect(() => {
    if (!trip || !urgent || !state || AppState.currentState !== 'active') return;
    const incident = `${trip.id}:${trip.startedAt}:${state.activeLegIndex}`;
    const key = `${incident}:${state.alternative?.id ?? 'risk'}`;
    if (shown.current.has(key)) return;
    if (![...shown.current].some((value) => value.startsWith(incident))) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
    }
    shown.current.add(key);
    setOpen(true);
  }, [trip, state, urgent]);

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
      {urgent && !open && (
        <View style={[styles.banner, { paddingBottom: Math.max(12, insets.bottom) }]}>
          <TransferAction
            label={s.transferGuard.showOptions}
            onPress={() => setOpen(true)}
            style={styles.bannerAction}
          >
            <ShieldAlert size={26} color={scheme.onWarningContainer} />
            <View style={styles.bannerCopy}>
              <Text style={styles.bannerTitle}>{transferTitle(state, s)}</Text>
              <Text style={styles.bannerText}>{s.transferGuard.showOptions}</Text>
            </View>
            <ChevronRight size={20} color={scheme.onWarningContainer} />
          </TransferAction>
        </View>
      )}
      {open && state && trip && (
        <TransferProtectionSheet
          connection={trip.connection}
          state={state}
          onClose={() => setOpen(false)}
          onAccept={acceptTransferAlternative}
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
  banner: {
    paddingHorizontal: 12,
    paddingTop: 12,
    backgroundColor: scheme.surface,
    alignItems: 'center',
  },
  bannerAction: { width: '100%', maxWidth: 560, backgroundColor: scheme.warningContainer },
  bannerCopy: { flex: 1, minWidth: 0, gap: 4 },
  bannerTitle: {
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '600',
    color: scheme.onWarningContainer,
  },
  bannerText: { fontSize: 12, lineHeight: 18, color: scheme.onWarningContainer },
});
