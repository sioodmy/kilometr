import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { AlertCircle } from './icons';
import { scheme, shape, type } from '../theme/tokens';
import { useStrings } from '../i18n';
import type { Connection } from '../types/models';
import { alertsForConnection, type TrainAlerts } from '../services/railTripAlerts';

/**
 * Alerty przypisane do konkretnego pociągu (strumień SSE zbiorkomu):
 * objazdy, odwołane odcinki, ograniczenia prędkości. Komunikaty handlowe
 * operatora (przedsprzedaż, cenniki, prace w kanałach sprzedaży) są
 * odfiltrowane w serwisie. Odświeżanie co 5 min (cache w serwisie).
 *
 * Tonalny amber (warningContainer), nie czerwień: to informacja o
 * utrudnieniach w ruchu, nie błąd.
 */
export function RailTripAlerts({ connection }: { connection: Connection }) {
  const s = useStrings();
  const [trainAlerts, setTrainAlerts] = useState<TrainAlerts[]>([]);

  useEffect(() => {
    let alive = true;
    void alertsForConnection(connection).then((alerts) => {
      if (alive) setTrainAlerts(alerts);
    });
    return () => {
      alive = false;
    };
  }, [connection]);

  if (trainAlerts.length === 0) return null;

  return (
    <Animated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(180)} style={styles.wrap}>
      {trainAlerts.map(({ leg, alerts }) =>
        alerts.map((alert, i) => (
          <View
            key={`${leg.id}-${i}`}
            style={styles.card}
            accessibilityRole="alert"
            accessibilityLabel={`${s.railAlerts.cardA11y(leg.line ?? '')}. ${alert.title}. ${alert.description}`}
          >
            <View style={styles.topRow}>
              <AlertCircle size={18} color={scheme.onWarningContainer} />
              <Text style={styles.line} numberOfLines={1} ellipsizeMode="tail">
                {leg.line ?? s.railAlerts.fallbackLine}
              </Text>
            </View>
            <Text style={styles.title}>{alert.title}</Text>
            {alert.description ? (
              <Text style={styles.body} numberOfLines={4}>
                {alert.description}
              </Text>
            ) : null}
          </View>
        )),
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: 10,
  },
  card: {
    padding: 16,
    gap: 8,
    backgroundColor: scheme.warningContainer,
    borderRadius: shape.large,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  line: {
    ...type.labelLarge,
    fontWeight: '600',
    color: scheme.onWarningContainer,
    flex: 1,
  },
  title: {
    ...type.titleSmall,
    fontWeight: '500',
    color: scheme.onWarningContainer,
  },
  body: {
    ...type.bodyMedium,
    color: scheme.onWarningContainer,
    lineHeight: 19,
    opacity: 0.9,
  },
});
