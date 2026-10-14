import { StyleSheet, Text, View } from 'react-native';
import { BusFront, CableCar, TrainFront, TramFront } from 'lucide-react-native';
import { DirectionsWalk } from './DirectionsWalk';
import { scheme, shape, type } from '../theme/tokens';
import type { LegMode } from '../types/models';
import { getLineColors, inferTransitMode } from '../services/lineIdentity';

// Kolor i typ linii żyją w serwisie — korzysta z nich również silnik
// powiadomień, a serwis nie może importować komponentu.
export {
  getLineColors,
  inferTransitMode,
  TRANSIT_PALETTE,
  CABLE_BADGE_BG,
} from '../services/lineIdentity';

export function LineBadge({
  mode,
  line,
  compact,
  active,
}: {
  mode?: LegMode;
  line?: string;
  compact?: boolean;
  active?: boolean;
}) {
  const resolved = inferTransitMode(mode, line);
  if (resolved === 'walk') {
    return (
      <View style={[styles.badge, styles.walk, active && styles.walkActive]}>
        <DirectionsWalk
          size={compact ? 14 : 16}
          color={active ? scheme.onPrimaryContainer : scheme.onSurfaceVariant}
        />
      </View>
    );
  }

  const { bg, fg } = getLineColors(line, mode);
  // Zestaw ikon nie ma osobnego glifu trolejbusu, więc trolejbus jedzie
  // ikoną autobusu na własnym zielonym tle: kolor niesie tożsamość.
  const Icon =
    resolved === 'cable' ? CableCar : resolved === 'train' ? TrainFront : resolved === 'tram' ? TramFront : BusFront;

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
  walkActive: { backgroundColor: scheme.secondaryContainer },
  compact: { paddingHorizontal: 6, minWidth: 36, gap: 4 },
  text: { ...type.labelLarge, fontWeight: '700' },
});
