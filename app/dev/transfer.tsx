import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Redirect, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { TrainFront, TramFront } from '../../src/components/icons';
import { useStrings } from '../../src/i18n';
import { scheme, shape } from '../../src/theme/tokens';
import { transferFixture } from '../../src/dev/transferFixture';
import {
  TransferAction,
  TransferProtectionCard,
} from '../../src/components/TransferProtectionCard';
import { TransferProtectionSheet } from '../../src/components/TransferProtectionSheet';
import { ConnectionSummary } from '../../src/components/ConnectionSummary';
import { LegTimeline } from '../../src/components/LegTimeline';
import { RouteTravelDeck } from '../../src/components/RouteTravelDeck';
import type { TransferProtectionState } from '../../src/services/notifications/transferTypes';
import { hasTransfer } from '../../src/services/notifications/transferTypes';

export default function TransferPreview() {
  const s = useStrings();
  const params = useLocalSearchParams<{
    state?: string;
    expired?: string;
    direct?: string;
    rail?: string;
  }>();

  const [isRail, setIsRail] = useState(() => params.rail === '1');

  const modes: TransferProtectionState['status'][] = [
    'conductor',
    'waiting',
    'safe',
    'risk',
    'alternative',
    'noAlternative',
    'unavailable',
  ];

  const initial =
    modes.find((mode) => mode === params.state) ?? (isRail ? 'conductor' : 'alternative');

  const [fixture, setFixture] = useState(() =>
    transferFixture(initial, params.expired === '1', params.direct === '1', isRail),
  );
  const [active, setActive] = useState(true);
  const [open, setOpen] = useState(!!params.state || isRail);

  useEffect(() => {
    const railMode = params.rail === '1';
    setIsRail(railMode);
    const targetStatus =
      modes.find((mode) => mode === params.state) ?? (railMode ? 'conductor' : 'alternative');
    setFixture(
      transferFixture(targetStatus, params.expired === '1', params.direct === '1', railMode),
    );
    setActive(true);
    setOpen(!!params.state || railMode);
  }, [params.expired, params.state, params.direct, params.rail]);

  if (!__DEV__) return <Redirect href="/" />;

  const getLabel = (mode: TransferProtectionState['status']) => {
    switch (mode) {
      case 'conductor':
        return s.transferGuard.conductorTitle;
      case 'waiting':
        return s.transferGuard.active;
      case 'safe':
        return s.transferGuard.safe;
      case 'risk':
        return s.transferGuard.attention;
      case 'alternative':
        return s.transferGuard.alternativeTitle;
      case 'noAlternative':
        return s.transferGuard.noAlternative;
      case 'unavailable':
        return s.transferGuard.unavailable;
      default:
        return mode;
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.demo}>{s.transferGuard.devTitle}</Text>

        {/* Przełącznik typu trasy: miejska vs kolejowa */}
        <View style={styles.segmented}>
          <TransferAction
            label="4 → 10"
            selected={!isRail}
            onPress={() => {
              setIsRail(false);
              const nextStatus =
                fixture.state.status === 'conductor' ? 'alternative' : fixture.state.status;
              setFixture(
                transferFixture(nextStatus, params.expired === '1', params.direct === '1', false),
              );
            }}
            style={[styles.segment, !isRail && styles.segmentActive]}
          >
            <TramFront
              size={18}
              color={!isRail ? scheme.onPrimaryContainer : scheme.onSurfaceVariant}
            />
            <Text style={[styles.segmentText, !isRail && styles.segmentTextActive]}>4 → 10</Text>
          </TransferAction>

          <TransferAction
            label="KD → IC"
            selected={isRail}
            onPress={() => {
              setIsRail(true);
              const nextStatus =
                fixture.state.status === 'alternative' ? 'conductor' : fixture.state.status;
              setFixture(
                transferFixture(nextStatus, params.expired === '1', params.direct === '1', true),
              );
            }}
            style={[styles.segment, isRail && styles.segmentActive]}
          >
            <TrainFront
              size={18}
              color={isRail ? scheme.onPrimaryContainer : scheme.onSurfaceVariant}
            />
            <Text style={[styles.segmentText, isRail && styles.segmentTextActive]}>KD → IC</Text>
          </TransferAction>
        </View>

        <ConnectionSummary item={fixture.connection} />

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
          <RouteTravelDeck
            connection={fixture.connection}
            hasTransfers={hasTransfer(fixture.connection)}
            transferState={active ? fixture.state : undefined}
            transferActive={active}
            onTransferPress={() => {
              setActive(true);
              setOpen(true);
            }}
          />
        )}

        <LegTimeline
          legs={fixture.connection.legs}
          transferState={active ? fixture.state : undefined}
          onOpenTransferProtection={() => setOpen(true)}
        />

        {hasTransfer(fixture.connection) && (
          <View style={styles.modes}>
            <Text style={styles.sectionHeader}>{s.transferGuard.demo}</Text>
            {modes.map((mode) => {
              const isSelected = fixture.state.status === mode;
              return (
                <TransferAction
                  key={mode}
                  label={getLabel(mode)}
                  selected={isSelected}
                  onPress={() => {
                    setFixture(
                      transferFixture(
                        mode,
                        params.expired === '1',
                        params.direct === '1',
                        isRail,
                      ),
                    );
                    setActive(true);
                    setOpen(true);
                  }}
                  style={[styles.mode, isSelected && styles.modeActive]}
                >
                  <Text style={[styles.modeText, isSelected && styles.modeTextActive]}>
                    {getLabel(mode)}
                  </Text>
                </TransferAction>
              );
            })}
          </View>
        )}
      </ScrollView>

      {open && hasTransfer(fixture.connection) && (
        <TransferProtectionSheet
          {...fixture}
          onClose={() => setOpen(false)}
          onPauseProtection={() => {
            setActive(false);
            setOpen(false);
          }}
          onStop={() => {
            setActive(false);
            setOpen(false);
          }}
          onAccept={async (alternativeId) => {
            const list = fixture.state.alternatives ?? (fixture.state.alternative ? [fixture.state.alternative] : []);
            const alternative = list.find((a) => a.id === alternativeId) ?? fixture.state.alternative;
            if (!alternative || alternative.validUntil <= Date.now()) return false;
            setFixture({
              connection: alternative.connection,
              state: {
                ...fixture.state,
                status: 'safe',
                alternative: undefined,
                alternatives: undefined,
                nextLine: alternative.nextLine,
                nextMode: alternative.nextMode,
                transferStop: alternative.transferStop,
                slackSec: alternative.slackSec ?? 240,
                swappedByUser: true,
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
  content: { padding: 16, gap: 16 },
  demo: { fontSize: 13, fontWeight: '700', color: scheme.primary, textTransform: 'uppercase' },
  segmented: { flexDirection: 'row', gap: 10 },
  segment: {
    flex: 1,
    backgroundColor: scheme.surfaceContainer,
    borderColor: scheme.outlineVariant,
    borderRadius: shape.large,
  },
  segmentActive: {
    backgroundColor: scheme.primaryContainer,
    borderColor: scheme.primary,
  },
  segmentText: { fontSize: 14, fontWeight: '700', color: scheme.onSurfaceVariant },
  segmentTextActive: { color: scheme.onPrimaryContainer },
  sectionHeader: { fontSize: 12, fontWeight: '700', color: scheme.onSurfaceVariant, textTransform: 'uppercase' },
  modes: { gap: 10 },
  mode: {
    backgroundColor: scheme.surfaceContainer,
    borderColor: scheme.outlineVariant,
    justifyContent: 'flex-start',
  },
  modeActive: {
    backgroundColor: scheme.primaryContainer,
    borderColor: scheme.primary,
  },
  modeText: { fontSize: 14, fontWeight: '600', color: scheme.onSurface },
  modeTextActive: { color: scheme.onPrimaryContainer },
});
