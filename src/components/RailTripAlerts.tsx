import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { AlertCircle } from './icons';
import { scheme, shape, type } from '../theme/tokens';
import { useStrings } from '../i18n';
import type { Connection, Leg } from '../types/models';
import { fetchNationalRailLive, fetchZbVehicleAlerts, type ZbVehicleAlert } from '../services/nationalRailLive';

interface TrainAlerts {
  leg: Leg;
  alerts: ZbVehicleAlert[];
}

/**
 * Alerty przypisane do konkretnego pociągu (strumień SSE zbiorkomu):
 * objazdy, odwołane odcinki, ograniczenia prędkości. Komunikaty handlowe
 * operatora (przedsprzedaż, cenniki) są odfiltrowane w serwisie.
 * Odświeżanie co 5 min, tylko na ekranie szczegółów podróży.
 */
export function RailTripAlerts({ connection }: { connection: Connection }) {
  const s = useStrings();
  const [trainAlerts, setTrainAlerts] = useState<TrainAlerts[]>([]);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const legs = connection.legs.filter((l) => l.mode === 'train' && l.tripId?.startsWith('pl:'));
      if (legs.length === 0) return;
      try {
        // Jedno zapytanie o pozycje daje nam id kursu zbiorkomu (zbTripIds).
        const live = await fetchNationalRailLive(legs);
        if (!alive) return;
        const jobs = legs.map(async (leg) => {
          const vehicle = leg.tripId ? live.zbTripIds.get(leg.tripId) : undefined;
          if (!vehicle) return null;
          const alerts = await fetchZbVehicleAlerts(vehicle);
          return alerts.length > 0 ? { leg, alerts } : null;
        });
        const results = (await Promise.all(jobs)).filter((r): r is TrainAlerts => r !== null);
        if (alive) setTrainAlerts(results);
      } catch {
        // brak sieci = brak alertów, rozkład działa offline
      }
    };
    void load();
    const timer = setInterval(load, 5 * 60_000);
    return () => {
      alive = false;
      clearInterval(timer);
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
              <AlertCircle size={18} color={scheme.onErrorContainer} />
              <Text style={styles.line} numberOfLines={1} ellipsizeMode="tail">
                {leg.line ?? s.railAlerts.fallbackLine}
              </Text>
            </View>
            <Text style={styles.title}>{alert.title}</Text>
            {alert.description ? <Text style={styles.body}>{alert.description}</Text> : null}
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
    backgroundColor: scheme.errorContainer,
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
    color: scheme.onErrorContainer,
    flex: 1,
  },
  title: {
    ...type.titleSmall,
    fontWeight: '500',
    color: scheme.onErrorContainer,
  },
  body: {
    ...type.bodyMedium,
    color: scheme.onErrorContainer,
    lineHeight: 19,
  },
});
