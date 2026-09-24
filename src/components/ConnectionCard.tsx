import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ArrowRight, Footprints } from 'lucide-react-native';
import { elev, scheme, shape, type } from '../theme/tokens';
import type { Connection, Leg } from '../types/models';
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

type SegmentItem =
  | { type: 'walk'; key: string; minutes: number }
  | { type: 'transit'; key: string; leg: Leg }
  | { type: 'arrow'; key: string };

function parseHMtoSec(hm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(hm || '');
  if (!m) return null;
  return Number(m[1]) * 3600 + Number(m[2]) * 60;
}

function getLegWalkMin(leg?: Leg): number {
  if (!leg) return 1;
  if (leg.walkM != null && leg.walkM > 0) {
    return Math.max(1, Math.round(leg.walkM / 80));
  }
  const dep = parseHMtoSec(leg.departAt);
  const arr = parseHMtoSec(leg.arriveAt);
  if (dep != null && arr != null && arr > dep) {
    return Math.max(1, Math.round((arr - dep) / 60));
  }
  return 1;
}

function buildLegSegments(legs: Leg[]): SegmentItem[] {
  const transitLegs = legs.filter((l) => l.mode !== 'walk');
  if (transitLegs.length === 0) {
    return [];
  }

  const items: SegmentItem[] = [];

  // 1. Initial walk (pieszo na pierwszy przystanek)
  const firstTransitIdx = legs.findIndex((l) => l.mode !== 'walk');
  if (firstTransitIdx > 0) {
    const initialWalks = legs.slice(0, firstTransitIdx);
    const walkM = initialWalks.reduce((acc, l) => acc + (l.walkM ?? 0), 0);
    const min = walkM > 0 ? Math.max(1, Math.round(walkM / 80)) : getLegWalkMin(initialWalks[0]);
    if (min > 0) {
      items.push({ type: 'walk', key: 'walk-initial', minutes: min });
    }
  }

  // 2. Kolejne pojazdy oraz przesiadki piesze między nimi
  for (let i = 0; i < transitLegs.length; i++) {
    const tLeg = transitLegs[i];
    items.push({ type: 'transit', key: `transit-${tLeg.id || i}`, leg: tLeg });

    if (i < transitLegs.length - 1) {
      const nextTLeg = transitLegs[i + 1];
      const curIdx = legs.indexOf(tLeg);
      const nextIdx = legs.indexOf(nextTLeg);

      let transferWalkMin = 0;
      if (curIdx >= 0 && nextIdx > curIdx + 1) {
        const intermediateWalks = legs.slice(curIdx + 1, nextIdx).filter((l) => l.mode === 'walk');
        const transferM = intermediateWalks.reduce((acc, l) => acc + (l.walkM ?? 0), 0);
        if (transferM > 0) {
          transferWalkMin = Math.max(1, Math.round(transferM / 80));
        } else if (intermediateWalks.length > 0) {
          transferWalkMin = getLegWalkMin(intermediateWalks[0]);
        }
      }

      // Jeśli przesiadka wymagała przejścia pieszego, dodaj walk pill przed strzałką
      if (transferWalkMin > 0) {
        items.push({ type: 'walk', key: `walk-transfer-${tLeg.id || i}`, minutes: transferWalkMin });
      }

      items.push({ type: 'arrow', key: `arrow-${tLeg.id || i}` });
    }
  }

  // 3. Final walk (pieszo z ostatniego przystanku do celu)
  const lastTransitIdx = legs.reduce((last, l, idx) => (l.mode !== 'walk' ? idx : last), -1);
  if (lastTransitIdx >= 0 && lastTransitIdx < legs.length - 1) {
    const finalWalks = legs.slice(lastTransitIdx + 1);
    const walkM = finalWalks.reduce((acc, l) => acc + (l.walkM ?? 0), 0);
    const min = walkM > 0 ? Math.max(1, Math.round(walkM / 80)) : getLegWalkMin(finalWalks[0]);
    if (min > 0) {
      items.push({ type: 'walk', key: 'walk-final', minutes: min });
    }
  }

  return items;
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
  const boarding = useMemo(() => item.legs.filter((l) => l.mode !== 'walk'), [item.legs]);
  const walkOnly = boarding.length === 0;
  const segments = useMemo(() => buildLegSegments(item.legs), [item.legs]);

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

      {/* Środek: badge linii oraz piesze części trasy (zgodnie ze stylem Jakdojade) */}
      <View style={styles.legs}>
        {walkOnly ? (
          <View style={styles.walkOnlyWrap}>
            <View style={styles.walkPill}>
              <Footprints size={12} color={scheme.onSurfaceVariant} strokeWidth={2.2} />
              <Text style={styles.walkPillText}>{walkMin}m</Text>
            </View>
            <Text style={styles.walkOnlyText}>Pieszo do celu</Text>
          </View>
        ) : (
          segments.map((seg) => {
            if (seg.type === 'walk') {
              return (
                <View
                  key={seg.key}
                  style={styles.walkPill}
                  accessibilityLabel={`${seg.minutes} minut pieszo`}
                >
                  <Footprints size={12} color={scheme.onSurfaceVariant} strokeWidth={2.2} />
                  <Text style={styles.walkPillText}>{seg.minutes}m</Text>
                </View>
              );
            }
            if (seg.type === 'arrow') {
              return (
                <ArrowRight
                  key={seg.key}
                  size={13}
                  color={scheme.outline}
                  strokeWidth={2}
                  style={styles.arrowIcon}
                />
              );
            }
            const isBus = inferTransitMode(seg.leg.mode, seg.leg.line) === 'bus';
            const showDirection = Boolean(seg.leg.direction) && (!isBus || boarding.length === 1);
            return (
              <View key={seg.key} style={styles.transitGroup}>
                <LineBadge mode={seg.leg.mode} line={seg.leg.line} />
                {showDirection ? (
                  <Text
                    style={[styles.dir, boarding.length > 1 && styles.dirCompact]}
                    numberOfLines={1}
                    ellipsizeMode="tail"
                  >
                    {seg.leg.direction}
                  </Text>
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
  transitGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    flexShrink: 1,
  },
  dir: {
    ...type.labelMedium,
    color: scheme.onSurface,
    maxWidth: 120,
    flexShrink: 1,
  },
  dirCompact: {
    maxWidth: 80,
  },
  walkPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3.5,
    backgroundColor: scheme.surfaceContainer,
    borderRadius: shape.full,
    paddingHorizontal: 7,
    height: 26,
  },
  walkPillText: {
    ...type.labelSmall,
    fontSize: 12,
    lineHeight: 15,
    fontWeight: '700',
    color: scheme.onSurfaceVariant,
    includeFontPadding: false,
  },
  arrowIcon: {
    marginHorizontal: 1,
  },
  walkOnlyWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 2,
  },
  walkOnlyText: {
    ...type.labelMedium,
    fontWeight: '600',
    color: scheme.onSurfaceVariant,
  },
  interchange: {
    ...type.bodySmall,
    color: scheme.primary,
  },
});
