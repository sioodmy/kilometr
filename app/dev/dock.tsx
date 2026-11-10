import { useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { Redirect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { HomeThumbBar } from '../../src/components/HomeThumbBar';
import type { DockChip } from '../../src/components/HomeDockChips';
import { clockFromMs } from '../../src/services/notifications/format';
import { scheme, shape, type } from '../../src/theme/tokens';
import { useStrings } from '../../src/i18n';
import type { Leg } from '../../src/types/models';

/**
 * Podgląd deweloperski chipów w docku (Expo Go). Śledzenie kursu i bilety
 * kolejowe nie działają w Expo Go, więc dane są fikcyjne, ale komponent
 * i animacja rozwinięcia są dokładnie te same co na ekranie głównym.
 */

// Fikcyjne odcinki: po jednym na tryb przewozu, żeby zobaczyć LineBadge'y.
const TRAM_LEG: Leg = {
  id: 'dev-tram-4',
  mode: 'tram',
  line: '4',
  direction: 'ZWIERYNOWICE',
  fromStop: 'Plac Grunwaldzki',
  toStop: 'Zwierzyniecka',
  departAt: '12:00',
  arriveAt: '12:09',
  stopsCount: 4,
  live: false,
};
const KD_LEG: Leg = {
  id: 'dev-kd-d1',
  mode: 'train',
  line: 'KD D1',
  railAgency: 'KD',
  trainNumber: '69123',
  fromStop: 'Legnica',
  toStop: 'Wrocław Główny',
  departAt: '12:40',
  arriveAt: '13:27',
  stopsCount: 5,
  live: false,
};
const IC_LEG: Leg = {
  id: 'dev-ic-6124',
  mode: 'train',
  line: 'IC 6124',
  railAgency: 'IC',
  trainNumber: '6124',
  trainName: 'HETMAN',
  fromStop: 'Wrocław Główny',
  toStop: 'Warszawa Centralna',
  departAt: '13:40',
  arriveAt: '17:10',
  stopsCount: 6,
  live: false,
};

export default function DockPreview() {
  const s = useStrings();
  const [pinned, setPinned] = useState(true);
  const [ticketSoon, setTicketSoon] = useState(true);
  const [ticketLater, setTicketLater] = useState(true);

  const chips = useMemo<DockChip[]>(() => {
    const now = Date.now();
    const list: DockChip[] = [];
    if (pinned) {
      list.push({
        id: 'dev-pinned',
        badgeLegs: [TRAM_LEG],
        title: 'Zwierzyniecka',
        timeLabel: s.common.departIn(9),
        pinned: true,
        a11yLabel: s.home.dockPinnedA11y('Zwierzyniecka', s.common.departIn(9)),
        onPress: () => Alert.alert('Dev', 'Otwarto szczegóły przypiętej podróży.'),
      });
    }
    if (ticketSoon) {
      const dep = now + 40 * 60_000;
      list.push({
        id: 'dev-ticket-soon',
        badgeLegs: [KD_LEG, IC_LEG],
        title: 'Warszawa Centralna',
        timeLabel: s.common.departIn(40),
        ticket: {
          a11y: s.railTickets.showTicket,
          onOpen: () => Alert.alert('Dev', 'Otwarto bilet na pełnym ekranie.'),
        },
        a11yLabel: s.home.dockTicketA11y('Warszawa Centralna', clockFromMs(dep)),
        onPress: () => Alert.alert('Dev', 'Otwarto szczegóły połączenia.'),
      });
    }
    if (ticketLater) {
      const dep = now + 130 * 60_000;
      list.push({
        id: 'dev-ticket-later',
        badgeLegs: [IC_LEG],
        title: 'Wrocław Główny',
        timeLabel: clockFromMs(dep),
        ticket: {
          a11y: s.railTickets.showTicket,
          onOpen: () => Alert.alert('Dev', 'Otwarto bilet na pełnym ekranie.'),
        },
        a11yLabel: s.home.dockTicketA11y('Wrocław Główny', clockFromMs(dep)),
        onPress: () => Alert.alert('Dev', 'Otwarto szczegóły połączenia.'),
      });
    }
    return list;
  }, [pinned, ticketSoon, ticketLater, s]);

  if (!__DEV__) return <Redirect href="/" />;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.content}>
        <Text style={styles.demo}>
          Podgląd chipów w docku: przypięta podróż i pociągi z biletem w oknie 3 h.
          Przełączniki testują animację rozwijania i zwijania.
        </Text>
        <Toggle label="Przypięta podróż" on={pinned} onPress={() => setPinned((v) => !v)} />
        <Toggle label="Bilet za 40 min" on={ticketSoon} onPress={() => setTicketSoon((v) => !v)} />
        <Toggle
          label="Bilet za 2 h 10 min"
          on={ticketLater}
          onPress={() => setTicketLater((v) => !v)}
        />
      </View>
      <View style={{ flex: 1 }} />
      <HomeThumbBar
        chips={chips}
        startTitle="Plac Grunwaldzki"
        isCustomStart={false}
        onOpenSearch={() => Alert.alert('Dev', 'Otwarto wyszukiwanie celu.')}
        onOpenStart={() => Alert.alert('Dev', 'Otwarto wybór punktu startowego.')}
        onResetStart={() => {}}
      />
    </SafeAreaView>
  );
}

function Toggle({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="switch"
      accessibilityState={{ checked: on }}
      style={({ pressed }) => [styles.toggle, on && styles.toggleOn, pressed && { opacity: 0.8 }]}
    >
      <Text style={[styles.toggleText, on && styles.toggleTextOn]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: scheme.surface },
  content: { padding: 20, gap: 10 },
  demo: { ...type.bodyMedium, color: scheme.onSurfaceVariant, lineHeight: 20 },
  toggle: {
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: 16,
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainerHigh,
  },
  toggleOn: { backgroundColor: scheme.secondaryContainer },
  toggleText: { ...type.labelLarge, color: scheme.onSurfaceVariant },
  toggleTextOn: { color: scheme.onSecondaryContainer, fontWeight: '600' },
});
