import { StyleSheet, Text, View } from 'react-native';
import { BusFront, Footprints, TramFront } from 'lucide-react-native';
import { scheme, shape, type } from '../theme/tokens';
import type { LegMode } from '../types/models';
import { getLineColors, inferTransitMode } from '../services/lineIdentity';

// Kolor i typ linii żyją w serwisie — korzysta z nich również silnik
// powiadomień, a serwis nie może importować komponentu.
export { getLineColors, inferTransitMode, TRANSIT_PALETTE } from '../services/lineIdentity';

export function LineBadge({ mode, line, compact }: { mode?: LegMode; line?: string; compact?: boolean }) {
  const resolved = inferTransitMode(mode, line);
  if (resolved === 'walk') {
    return (
      <View style={[styles.badge, styles.walk]}>
        <Footprints size={14} color={scheme.onSurfaceVariant} />
      </View>
    );
  }

  const { bg, fg, isTram } = getLineColors(line, mode);
  const Icon = isTram ? TramFront : BusFront;

  return (
    <View style={[styles.badge, compact && styles.compact, { backgroundColor: bg }]}>
      <Icon size={compact ? 12 : 13} color={fg} />
      <Text style={[styles.text, { color: fg }]}>{line}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: shape.small,
    minWidth: 44,
    height: 28,
    justifyContent: 'center',
  },
  walk: { backgroundColor: scheme.surfaceContainerHighest, minWidth: 32 },
  compact: { paddingHorizontal: 6, minWidth: 36, gap: 4 },
  text: { ...type.labelLarge, fontWeight: '700' },
});
