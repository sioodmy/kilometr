import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Redirect, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
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
    setFixture(transferFixture(targetStatus, params.expired === '1', params.direct === '1', railMode));
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
        <Text style={styles.demo}>{s.transferGuard.demo}</Text>

        {/* Przełącznik typu trasy: miejska vs kolejowa */}
        <View style={styles.segmented}>
          <TransferAction
            label="Trasa miejska (tramwaj)"
            selected={!isRail}
            onPress={() => {
              setIsRail(false);
              const nextStatus = fixture.state.status === 'conductor' ? 'alternative' : fixture.state.status;
              setFixture(
                transferFixture(
                  nextStatus,
                  params.expired === '1',
                  params.direct === '1',
                  false,
                ),
              );
            }}
            style={[styles.segment, !isRail && styles.segmentActive]}
          >
            <Text style={[styles.segmentText, !isRail && styles.segmentTextActive]}>
              🚋 Tramwaj (4 → 10)
            </Text>
          </TransferAction>

          <TransferAction
            label="Trasa kolejowa (Intercity)"
            selected={isRail}
            onPress={() => {
              setIsRail(true);
              const nextStatus =
                fixture.state.status === 'alternative' ? 'conductor' : fixture.state.status;
              setFixture(
                transferFixture(
                  nextStatus,
                  params.expired === '1',
                  params.direct === '1',
                  true,
                ),
              );
            }}
            style={[styles.segment, isRail && styles.segmentActive]}
          >
            <Text style={[styles.segmentText, isRail && styles.segmentTextActive]}>
              🚆 Kolej (KD → IC)
            </Text>
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
          <View style={styles.deckSection}>
            <Text style={styles.sectionHeader}>Dolny pasek podróży (RouteTravelDeck):</Text>
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
          </View>
        )}

        <LegTimeline legs={fixture.connection.legs} />

        {hasTransfer(fixture.connection) && (
          <View style={styles.modes}>
            <Text style={styles.sectionHeader}>Stany ochrony przesiadek:</Text>
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
  content: { padding: 16, gap: 18 },
  demo: { fontSize: 14, color: scheme.onSurfaceVariant },
  segmented: {
    flexDirection: 'row',
    gap: 8,
    backgroundColor: scheme.surfaceContainer,
    padding: 4,
    borderRadius: shape.cornerMedium,
  },
  segment: {
    flex: 1,
    minHeight: 44,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: shape.cornerSmall,
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentActive: {
    backgroundColor: scheme.primaryContainer,
  },
  segmentText: {
    fontSize: 13,
    fontWeight: '500',
    color: scheme.onSurfaceVariant,
    textAlign: 'center',
  },
  segmentTextActive: {
    fontWeight: '600',
    color: scheme.onPrimaryContainer,
  },
  deckSection: {
    gap: 6,
    padding: 8,
    borderRadius: shape.cornerMedium,
    backgroundColor: scheme.surfaceContainerLow,
  },
  sectionHeader: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: scheme.onSurfaceVariant,
    paddingHorizontal: 4,
  },
  modes: { gap: 8 },
  mode: { backgroundColor: scheme.surfaceContainerHigh },
  modeActive: {
    backgroundColor: scheme.primaryContainer,
    borderWidth: 1.5,
    borderColor: scheme.primary,
  },
  modeText: {
    fontSize: 14,
    lineHeight: 20,
    color: scheme.onSurface,
    textAlign: 'center',
    flexShrink: 1,
  },
  modeTextActive: {
    fontWeight: '600',
    color: scheme.onPrimaryContainer,
  },
});
