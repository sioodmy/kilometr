import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { ArrowRight } from 'lucide-react-native';
import { useStrings, getLocaleSync } from '../i18n';
import { scheme, shape, type } from '../theme/tokens';
import { formatShareTime, transferCount, type SharedConnection } from '../sharing/connection';
import { LineBadge } from './LineBadge';

export function JourneyShareCard({ journey }: { journey: SharedConnection }) {
  const { share: s, city } = useStrings();
  const { width, fontScale } = useWindowDimensions();
  const stacked = width / fontScale < 340;
  const date = new Intl.DateTimeFormat(getLocaleSync(), {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${journey.date}T12:00:00Z`));
  const arrivalDay = Math.floor(journey.arrival / 1440);

  return (
    <View style={styles.card}>
      <View style={styles.hero}>
        <View style={styles.meta}>
          <Text style={styles.brand}>{s.brand}</Text>
          <Text style={styles.date}>
            {city.name(journey.city)} · {date}
          </Text>
        </View>
        <Text style={styles.arrivalLabel}>{s.arrival}</Text>
        <View style={styles.arrivalRow}>
          <Text style={styles.arrival}>{formatShareTime(journey.arrival)}</Text>
          {arrivalDay > 0 && <Text style={styles.day}>{s.dayLater(arrivalDay)}</Text>}
        </View>
        <Text style={styles.destination}>{journey.to}</Text>
      </View>
      <View style={styles.body}>
        <View style={[styles.departureRow, stacked && styles.stacked]}>
          <View style={styles.origin}>
            <Text style={styles.label}>
              {s.departure} · {formatShareTime(journey.departure)}
            </Text>
            <Text style={styles.originName}>{journey.from}</Text>
          </View>
          <Text style={styles.duration}>{s.duration(journey.arrival - journey.departure)}</Text>
        </View>
        <View style={styles.lines}>
          {journey.legs.map((leg, index) => (
            <View key={index} style={styles.lineStep}>
              {index > 0 && <ArrowRight size={14} color={scheme.onSurfaceVariant} />}
              <LineBadge mode={leg.mode} line={leg.line} compact />
            </View>
          ))}
        </View>
        <Text style={styles.label}>
          {journey.legs.every((leg) => leg.mode === 'walk')
            ? s.walk
            : s.transfers(transferCount(journey))}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: shape.extraLarge,
    overflow: 'hidden',
    backgroundColor: scheme.surfaceContainerHighest,
  },
  hero: { backgroundColor: scheme.primaryContainer, padding: 24, gap: 4 },
  meta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 22,
  },
  brand: { ...type.titleMedium, fontWeight: '700', color: scheme.onPrimaryContainer },
  date: { ...type.bodySmall, color: scheme.onPrimaryContainer, flexShrink: 1 },
  arrivalLabel: { ...type.bodyLarge, color: scheme.onPrimaryContainer },
  arrivalRow: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', columnGap: 10 },
  arrival: {
    fontSize: 58,
    fontWeight: '700',
    letterSpacing: -2,
    fontVariant: ['tabular-nums'],
    color: scheme.onPrimaryContainer,
    includeFontPadding: false,
  },
  day: { ...type.titleMedium, color: scheme.onPrimaryContainer },
  destination: { ...type.titleLarge, fontWeight: '600', color: scheme.onPrimaryContainer },
  body: { padding: 22, gap: 16 },
  departureRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  stacked: { flexDirection: 'column' },
  origin: { flex: 1, gap: 5 },
  label: { ...type.bodyMedium, color: scheme.onSurfaceVariant },
  originName: { ...type.titleMedium, color: scheme.onSurface },
  duration: { ...type.titleMedium, fontWeight: '600', color: scheme.onSurface },
  lines: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  lineStep: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
