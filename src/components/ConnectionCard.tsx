import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ArrowRight, Footprints } from 'lucide-react-native';
import { elev, scheme, shape, type } from '../theme/tokens';
import type { Connection } from '../types/models';
import { LineBadge, inferTransitMode } from './LineBadge';
import { LiveDot } from './LiveDot';
import { formatWalkTime } from '../services/settings';

/** Poprawna polska odmiana: 1 przesiadka, 2–4 przesiadki, 5+ przesiadek. */
export function transfersLabel(n: number): string {
  if (n <= 0) return 'bezpośrednio';
  if (n === 1) return '1 przesiadka';
  const last = n % 10;
  const teen = n % 100;
  if (last >= 2 && last <= 4 && (teen < 12 || teen > 14)) return `${n} przesiadki`;
  return `${n} przesiadek`;
}

/** Minuty od północy dla "teraz". */
function nowSec(): number {
  const d = new Date();
  return d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();
}

export function ConnectionCard({
  item,
  onPress,
  dimmed = false,
}: {
  item: Connection;
  onPress: () => void;
  /** historyczne (przeszłe) połączenie — przygaszony wygląd */
  dimmed?: boolean;
}) {
  const boarding = item.legs.filter((l) => l.mode !== 'walk');
  const walkOnly = boarding.length === 0;

  // Historyczne: odjechało ≥1 min temu — szary badge zamiast czasu odjazdu
  const minsAgo =
    item.departureSec > 0 ? Math.round((nowSec() - item.departureSec) / 60) : -1;
  const historical = minsAgo >= 1;

  // Dokładne reguły:
  // 1. Główny czas (duży, po lewej) = ZA ILE odjazd. Czasy z backendu są już
  //    efektywne (zawierają opóźnienie) — NIE dodawaj delayMin drugi raz.
  // 2. Pill po prawej = czas jazdy. Kolor pill + kropka niosą status live.
  // 3. Brak live: szary pill, brak pulsującej kropki.
  let badgeBg: string = scheme.secondaryContainer;
  let badgeFg: string = scheme.onSecondaryContainer;
  let dotColor: string | null = null;
  const effectiveMin = item.departInMin;

  if (item.live) {
    if (item.delayMin > 0) {
      badgeBg = scheme.errorContainer;
      badgeFg = scheme.onErrorContainer;
      dotColor = scheme.error;
    } else {
      badgeBg = scheme.successContainer;
      badgeFg = scheme.onSuccessContainer;
      dotColor = scheme.success;
    }
  }

  const walkM = walkOnly ? item.legs[0]?.walkM : undefined;
  const walkMin =
    item.durationMin || (walkM != null ? Math.max(1, Math.round(walkM / 80)) : 1);
  const walkDistStr =
    walkM != null ? (walkM >= 1000 ? `${(walkM / 1000).toFixed(1)} km` : `${walkM} m`) : '';

  const departureText = historical
    ? minsAgo <= 1
      ? 'przed chwilą'
      : `${minsAgo} min temu`
    : walkOnly && walkM != null
      ? formatWalkTime(walkMin)
      : effectiveMin <= 1
        ? 'za chwilę'
        : effectiveMin > 59
          ? item.departAt
          : `za ${effectiveMin} min`;
  const departureColor = historical
    ? scheme.onSurfaceVariant
    : item.live && item.delayMin > 0
      ? scheme.error
      : scheme.onSurface;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        dimmed && styles.dimmed,
        pressed && { transform: [{ scale: 0.99 }], opacity: 0.95 },
      ]}
    >
      {/* Góra: ZA ILE odjazd (główne) + pill z czasem jazdy */}
      <View style={styles.top}>
        <Text style={[styles.duration, { color: departureColor }]}>{departureText}</Text>
        <View style={[styles.badge, { backgroundColor: historical ? scheme.surfaceContainerHighest : badgeBg }]}>
          {dotColor != null && !historical && <LiveDot color={dotColor} size={7} />}
          <Text style={[styles.badgeText, { color: historical ? scheme.onSurfaceVariant : badgeFg }]}>
            {item.durationMin} min
          </Text>
        </View>
      </View>

      <View style={styles.hoursRow}>
        <Text style={styles.hours}>{item.departAt}</Text>
        <ArrowRight size={12} color={scheme.onSurfaceVariant} strokeWidth={2} />
        <Text style={styles.hours}>{item.arriveAt}</Text>
        <Text style={styles.hoursDot}>•</Text>
        <Text style={styles.hours}>{walkOnly ? 'pieszo' : transfersLabel(item.transfers)}</Text>
      </View>

      {/* Środek: badge linii. Kierunki tylko dla tramwajów — busowe powodują overflow. */}
      <View style={styles.legs}>
        {walkOnly ? (
          <View style={styles.legChunk}>
            <View style={styles.walkBadge}>
              <Footprints size={13} color={scheme.onSurfaceVariant} />
              <Text style={styles.walkText}>Pieszo</Text>
            </View>
          </View>
        ) : (
          boarding.map((leg, i) => {
            const isBus = inferTransitMode(leg.mode, leg.line) === 'bus';
            return (
              <View key={leg.id} style={styles.legChunk}>
                {i > 0 && <ArrowRight size={14} color={scheme.outline} />}
                <LineBadge mode={leg.mode} line={leg.line} />
                {!isBus && leg.direction ? (
                  <Text style={styles.dir} numberOfLines={1}>{leg.direction}</Text>
                ) : null}
              </View>
            );
          })
        )}
      </View>

      {item.interchange ? <Text style={styles.interchange}>{item.interchange}</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // M3 elevated card: surfaceContainer + level1, shape large
  card: {
    backgroundColor: scheme.surfaceContainer,
    borderRadius: shape.large,
    padding: 14,
    gap: 10,
    ...elev.level1,
  },
  dimmed: {
    opacity: 0.55,
  },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  duration: {
    ...type.titleLarge,
    fontWeight: '700',
    color: scheme.onSurface,
  },
  // Pojedynczy M3 tonal badge w prawym górnym rogu
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: shape.full,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  badgeText: {
    ...type.labelMedium,
    fontWeight: '600',
  },
  hoursRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  hoursDot: {
    ...type.bodySmall,
    color: scheme.onSurfaceVariant,
    marginHorizontal: 1,
  },
  hours: {
    ...type.bodySmall,
    color: scheme.onSurfaceVariant,
  },
  legs: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
    backgroundColor: scheme.surfaceContainerHighest,
    borderRadius: shape.medium,
    padding: 8,
  },
  legChunk: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  dir: {
    ...type.labelMedium,
    color: scheme.onSurface,
    maxWidth: 120,
  },
  walkBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  walkText: {
    ...type.labelLarge,
    fontWeight: '700',
    color: scheme.onSurfaceVariant,
  },
  interchange: {
    ...type.bodySmall,
    color: scheme.primary,
  },
});
