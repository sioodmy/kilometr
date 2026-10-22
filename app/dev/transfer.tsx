import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Redirect, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useStrings } from '../../src/i18n';
import { scheme } from '../../src/theme/tokens';
import { transferFixture } from '../../src/dev/transferFixture';
import {
  TransferAction,
  TransferProtectionCard,
} from '../../src/components/TransferProtectionCard';
import { TransferProtectionSheet } from '../../src/components/TransferProtectionSheet';
import { ConnectionSummary } from '../../src/components/ConnectionSummary';
import { LegTimeline } from '../../src/components/LegTimeline';
import type { TransferProtectionState } from '../../src/services/notifications/transferTypes';
import { hasTransfer } from '../../src/services/notifications/transferTypes';

export default function TransferPreview() {
  const s = useStrings();
  const params = useLocalSearchParams<{ state?: string; expired?: string; direct?: string }>();
  const modes: TransferProtectionState['status'][] = [
    'waiting',
    'safe',
    'risk',
    'alternative',
    'noAlternative',
    'unavailable',
  ];
  const initial = modes.find((mode) => mode === params.state) ?? 'alternative';
  const [fixture, setFixture] = useState(() =>
    transferFixture(initial, params.expired === '1', params.direct === '1'),
  );
  const [active, setActive] = useState(false);
  const [open, setOpen] = useState(!!params.state);
  useEffect(() => {
    setFixture(transferFixture(initial, params.expired === '1', params.direct === '1'));
    setActive(!!params.state);
    setOpen(!!params.state);
  }, [initial, params.expired, params.state, params.direct]);
  if (!__DEV__) return <Redirect href="/" />;
  const labels = [
    s.transferGuard.active,
    s.transferGuard.safe,
    s.transferGuard.attention,
    s.transferGuard.alternativeTitle,
    s.transferGuard.noAlternative,
    s.transferGuard.unavailable,
  ];
  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.demo}>{s.transferGuard.demo}</Text>
        <ConnectionSummary item={fixture.connection} />
        <LegTimeline legs={fixture.connection.legs} />
        {hasTransfer(fixture.connection) && (
          <TransferProtectionCard
            state={active ? fixture.state : undefined}
            active={active}
            onPress={() => {
              setActive(true);
              setOpen(true);
            }}
          />
        )}
        {hasTransfer(fixture.connection) && (
          <View style={styles.modes}>
            {modes.map((mode, index) => (
              <TransferAction
                key={mode}
                label={labels[index]}
                onPress={() => {
                  setFixture(transferFixture(mode));
                  setActive(true);
                  setOpen(true);
                }}
                style={styles.mode}
              >
                <Text style={styles.modeText}>{labels[index]}</Text>
              </TransferAction>
            ))}
          </View>
        )}
      </ScrollView>
      {open && hasTransfer(fixture.connection) && (
        <TransferProtectionSheet
          {...fixture}
          onClose={() => setOpen(false)}
          onStop={() => {
            setActive(false);
            setOpen(false);
          }}
          onAccept={async () => {
            const alternative = fixture.state.alternative;
            if (!alternative || alternative.validUntil <= Date.now()) return false;
            setFixture({
              connection: alternative.connection,
              state: {
                ...fixture.state,
                status: 'changed',
                alternative: undefined,
                nextLine: alternative.nextLine,
                transferStop: alternative.transferStop,
              },
            });
            return true;
          }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: scheme.surface },
  content: { padding: 16, gap: 20 },
  demo: { fontSize: 14, color: scheme.onSurfaceVariant },
  modes: { gap: 8 },
  mode: { backgroundColor: scheme.surfaceContainerHigh },
  modeText: {
    fontSize: 14,
    lineHeight: 20,
    color: scheme.onSurface,
    textAlign: 'center',
    flexShrink: 1,
  },
});
