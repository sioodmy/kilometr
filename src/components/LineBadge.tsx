import { StyleSheet, Text, View } from 'react-native';
import { BusFront, Footprints, TramFront } from 'lucide-react-native';
import { scheme, shape, type } from '../theme/tokens';
import type { LegMode } from '../types/models';

export function LineBadge({ mode, line }: { mode: LegMode; line?: string }) {
  if (mode === 'walk') {
    return (
      <View style={[styles.badge, styles.walk]}>
        <Footprints size={14} color={scheme.onSurfaceVariant} />
      </View>
    );
  }
  // M3 baseline blue for buses, seed teal for trams (Maps-style coding)
  const bg = mode === 'bus' ? '#0B57D0' : scheme.primary;
  const Icon = mode === 'bus' ? BusFront : TramFront;
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <Icon size={13} color="#fff" />
      <Text style={styles.text}>{line}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: shape.small,
    minWidth: 46,
    justifyContent: 'center',
  },
  walk: { backgroundColor: scheme.surfaceContainerHighest, minWidth: 34 },
  text: { color: '#fff', ...type.labelLarge },
});
