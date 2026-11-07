import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { AlertCircle } from './icons';
import { useStrings } from '../i18n';
import { scheme, shape, type } from '../theme/tokens';
import type { Connection } from '../types/models';
import { alertsForConnection, type TrainAlerts } from '../services/railTripAlerts';

/**
 * Kompaktowy chip alertów per pociąg na liście połączeń: jedna linia
 * (temat utrudnienia) pod wierszem opóźnienia. Cache w serwisie sprawia,
 * że osiem kart nie otwiera ośmiu strumieni - pierwszy odczyt idzie raz,
 * reszta dostaje wynik z pamięci.
 */
export function RailAlertsChip({ connection }: { connection: Connection }) {
  const s = useStrings();
  const [trainAlerts, setTrainAlerts] = useState<TrainAlerts[]>([]);

  const hasTrain = useMemo(
    () =>
      connection.legs?.some(
        (l) => l.mode === 'train' || l.tripId?.startsWith('pl:') || l.trainNumber,
      ),
    [connection.legs],
  );

  useEffect(() => {
    if (!hasTrain) return;
    let alive = true;
    void alertsForConnection(connection).then((alerts) => {
      if (alive) setTrainAlerts(alerts);
    });
    return () => {
      alive = false;
    };
  }, [connection, hasTrain]);

  const flatAlerts = useMemo(
    () =>
      trainAlerts
        .flatMap(({ leg, alerts }) => alerts.map((alert) => ({ leg, alert })))
        .slice(0, 2),
    [trainAlerts],
  );

  if (!hasTrain || flatAlerts.length === 0) return null;

  return (
    <Animated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(180)}>
      {flatAlerts.map(({ leg, alert }, i) => (
        <View
          key={`${leg.id}-${alert.id ?? i}`}
          style={styles.chip}
          accessibilityRole="alert"
          accessibilityLabel={`${leg.line ?? s.railAlerts.fallbackLine}: ${alert.title}`}
        >
          <AlertCircle size={15} color={scheme.onWarningContainer} />
          <Text style={styles.text} numberOfLines={1} ellipsizeMode="tail">
            {alert.title}
          </Text>
        </View>
      ))}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: shape.medium,
    backgroundColor: scheme.warningContainer,
    marginBottom: 6,
  },
  text: {
    ...type.bodySmall,
    color: scheme.onWarningContainer,
    flex: 1,
  },
});
