import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ArrowRight, Footprints, History } from 'lucide-react-native';
import { elev, scheme, shape, type } from '../theme/tokens';
import type { Connection } from '../types/models';
import { LineBadge } from './LineBadge';
import { LiveDot } from './LiveDot';

/** Poprawna polska odmiana: 1 przesiadka, 2–4 przesiadki, 5+ przesiadek. */
export function transfersLabel(n: number): string {
  if (n <= 0) return 'bezpośrednio';
  if (n === 1) return '1 przesiadka';
  const last = n % 10;
  const teen = n % 100;
  if (last >= 2 && last <= 4 && (teen < 12 || teen > 14)) return `${n} przesiadki`;
  return `${n} przesiadek`;
}

// M3 assist-chip status: pulsing dot = tracked live, clock = schedule.
// No "GPS" text — state is shown, not told.
function StatusChip({ delayMin, live }: { delayMin: number; live: boolean }) {
  if (!live) {
    return (
      <View style={[styles.chip, styles.chipSchedule]}>
        <History size={13} color={scheme.onSurfaceVariant} />
        <Text style={[styles.chipText, { color: scheme.onSurfaceVariant }]}>rozkład</Text>
      </View>
    );
  }
  if (delayMin === 0) {
    return (
      <View style={[styles.chip, styles.chipOk]}>
        <LiveDot color={scheme.success} size={7} />
        <Text style={[styles.chipText, { color: scheme.onSuccessContainer }]}>na czas</Text>
      </View>
    );
  }
  const late = delayMin > 0;
  const tone = late ? scheme.errorContainer : scheme.warningContainer;
  const ink = late ? scheme.onErrorContainer : scheme.onWarningContainer;
  return (
    <View style={[styles.chip, { backgroundColor: tone }]}>
      <LiveDot color={late ? scheme.error : scheme.warning} size={7} />
      <Text style={[styles.chipText, { color: ink }]}>
        {late ? `+${delayMin} min` : `${delayMin} min`}
      </Text>
    </View>
  );
}

export function ConnectionCard({ item, onPress }: { item: Connection; onPress: () => void }) {
  const boarding = item.legs.filter((l) => l.mode !== 'walk');
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.card, pressed && { transform: [{ scale: 0.99 }], opacity: 0.95 }]}>
      {/* top line: time + countdown */}
      <View style={styles.top}>
        <Text style={styles.duration}>{item.durationMin} min</Text>
        <View style={styles.countdown}>
          <Text style={styles.countdownText}>
            {item.departInMin <= 1 ? 'odjazd teraz' : `za ${item.departInMin} min`}
          </Text>
        </View>
      </View>
      <Text style={styles.hours}>{item.departAt} → {item.arriveAt} • {transfersLabel(item.transfers)}</Text>

      {/* middle: line badges like (*) 4 BISKUPIN -> 2 Krzyki */}
      <View style={styles.legs}>
        {boarding.map((leg, i) => (
          <View key={leg.id} style={styles.legChunk}>
            {i > 0 && <ArrowRight size={14} color={scheme.outline} />}
            <LineBadge mode={leg.mode} line={leg.line} />
            <Text style={styles.dir} numberOfLines={1}>{leg.direction}</Text>
          </View>
        ))}
      </View>

      {/* bottom: stops + live status */}
      <View style={styles.bottom}>
        <View style={styles.stops}>
          <Text style={styles.stop} numberOfLines={1}>{item.legs[0]?.fromStop}</Text>
          <Footprints size={12} color={scheme.outline} />
          <Text style={styles.stop} numberOfLines={1}>{item.legs[item.legs.length - 1]?.toStop}</Text>
        </View>
        <StatusChip delayMin={item.delayMin} live={item.live} />
      </View>
      {item.interchange ? <Text style={styles.interchange}>{item.interchange}</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // M3 elevated card: tonal surface + level1, shape large
  card: { backgroundColor: scheme.surfaceContainerLow, borderRadius: shape.large, padding: 16, gap: 10, ...elev.level1 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  duration: { ...type.titleLarge, fontWeight: '500', color: scheme.onSurface },
  // M3 filled tonal countdown: secondary container
  countdown: { backgroundColor: scheme.secondaryContainer, borderRadius: shape.full, paddingHorizontal: 12, paddingVertical: 6 },
  countdownText: { ...type.labelLarge, color: scheme.onSecondaryContainer },
  hours: { ...type.bodySmall, color: scheme.onSurfaceVariant },
  legs: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap', backgroundColor: scheme.surfaceContainerHighest, borderRadius: shape.medium, padding: 10 },
  legChunk: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dir: { ...type.labelMedium, color: scheme.onSurface, maxWidth: 90 },
  bottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  stops: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
  stop: { ...type.bodySmall, color: scheme.onSurfaceVariant, flexShrink: 1 },
  // M3 assist-chip: tonal container, small height, icon + label
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 8, paddingRight: 12, paddingVertical: 6, borderRadius: shape.small, borderWidth: 1, borderColor: scheme.outlineVariant },
  chipOk: { backgroundColor: scheme.successContainer, borderColor: 'transparent' },
  chipSchedule: { backgroundColor: 'transparent' },
  chipText: { ...type.labelMedium },
  interchange: { ...type.bodySmall, color: scheme.primary },
});
