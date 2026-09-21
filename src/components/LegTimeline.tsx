import { StyleSheet, Text, View } from 'react-native';
import { Footprints } from 'lucide-react-native';
import { elev, scheme, shape, type } from '../theme/tokens';
import type { Leg } from '../types/models';
import { LineBadge } from './LineBadge';
import { LiveDot } from './LiveDot';

/** Jakdojade-style vertical timeline for one connection. Pure presentational. */
export function LegTimeline({ legs }: { legs: Leg[] }) {
  return (
    <View style={styles.list}>
      {legs.map((leg, i) => {
        const last = i === legs.length - 1;
        if (leg.mode === 'walk') {
          return (
            <View key={leg.id} style={styles.row}>
              <View style={styles.rail}>
                <View style={styles.walkLine} />
                <View style={[styles.node, styles.walkNode]}>
                  <Footprints size={13} color={scheme.onSurfaceVariant} />
                </View>
                {!last && <View style={styles.walkLine} />}
              </View>
              <View style={styles.body}>
                <Text style={styles.walkText}>
                  Przejdź pieszo {leg.walkM ?? 200} m ({leg.departAt}–{leg.arriveAt})
                </Text>
                <Text style={styles.walkSub}>{leg.fromStop} → {leg.toStop}</Text>
              </View>
            </View>
          );
        }
        const accent = leg.mode === 'bus' ? '#0B57D0' : scheme.primary;
        return (
          <View key={leg.id} style={styles.row}>
            <View style={styles.rail}>
              {!last && <View style={[styles.spine, { backgroundColor: accent }]} />}
              <View style={[styles.node, { borderColor: accent }]}>
                <View style={[styles.innerDot, { backgroundColor: accent }]} />
              </View>
            </View>
            <View style={[styles.card, { borderLeftColor: accent }]}>
              <View style={styles.cardTop}>
                <LineBadge mode={leg.mode} line={leg.line} />
                <Text style={styles.dir} numberOfLines={1}>kier. {leg.direction}</Text>
                {/* live = pulsing dot only, no text */}
                {leg.live ? <LiveDot color={scheme.success} size={8} /> : null}
              </View>
              <Text style={styles.stopBig}>{leg.fromStop} <Text style={styles.hour}>{leg.departAt}</Text></Text>
              <Text style={styles.meta}>{leg.stopsCount} przystanki • ~{leg.stopsCount * 2} min</Text>
              <Text style={styles.stopBig}>{leg.toStop} <Text style={styles.hour}>{leg.arriveAt}</Text></Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: 2 },
  row: { flexDirection: 'row', gap: 12 },
  rail: { width: 34, alignItems: 'center', position: 'relative', paddingVertical: 4 },
  spine: { position: 'absolute', top: 0, bottom: -6, width: 4, borderRadius: 99, opacity: 0.85 },
  walkLine: { width: 2, height: 18, backgroundColor: scheme.outlineVariant },
  node: { width: 26, height: 26, borderRadius: 99, backgroundColor: scheme.surfaceContainerLowest, borderWidth: 3, alignItems: 'center', justifyContent: 'center', zIndex: 1 },
  walkNode: { borderWidth: 1, borderColor: scheme.outlineVariant },
  innerDot: { width: 8, height: 8, borderRadius: 99 },
  body: { flex: 1, paddingVertical: 8, gap: 2 },
  // M3 filled card: tonal surface, no border, shape large
  card: { flex: 1, backgroundColor: scheme.surfaceContainer, borderRadius: shape.large, borderLeftWidth: 4, padding: 12, gap: 6, marginBottom: 10, ...elev.level1 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dir: { flex: 1, ...type.labelLarge, color: scheme.onSurface },
  stopBig: { ...type.titleSmall, color: scheme.onSurface },
  hour: { color: scheme.onSurfaceVariant, fontWeight: '400' },
  meta: { ...type.bodySmall, color: scheme.onSurfaceVariant },
  walkText: { ...type.titleSmall, color: scheme.onSurface },
  walkSub: { ...type.bodySmall, color: scheme.onSurfaceVariant },
});
