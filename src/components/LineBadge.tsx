import { StyleSheet, Text, View } from 'react-native';
import { BusFront, CableCar, TrainFront, TramFront } from 'lucide-react-native';
import { DirectionsWalk } from './DirectionsWalk';
import { scheme, shape, type } from '../theme/tokens';
import type { LegMode } from '../types/models';
import {
  getLineColors,
  inferTransitMode,
  normalizeLineName,
} from '../services/lineIdentity';
import { getActiveCityIdSync } from '../services/cityStore';

// Kolor i typ linii żyją w serwisie - korzysta z nich również silnik
// powiadomień, a serwis nie może importować komponentu.
export {
  getLineColors,
  inferTransitMode,
  mapLineColor,
  normalizeLineName,
  TRANSIT_PALETTE,
  CABLE_BADGE_BG,
} from '../services/lineIdentity';

export function LineBadge({
  mode,
  line,
  compact,
  active,
  maxWidth,
}: {
  mode?: LegMode;
  line?: string;
  compact?: boolean;
  active?: boolean;
  maxWidth?: number;
}) {
  // Miasto tylko dla heurystyki numerów, gdy brak trybu (np. badge newsów).
  const cityId = getActiveCityIdSync();
  const normalizedLine = normalizeLineName(line, mode, compact);
  const resolved = inferTransitMode(mode, normalizedLine || line, cityId);
  if (resolved === 'walk') {
    return (
      <View
        style={[
          styles.badge,
          styles.walk,
          compact && styles.compactWalk,
          active && styles.walkActive,
        ]}
      >
        <DirectionsWalk
          size={compact ? 13 : 16}
          color={active ? scheme.onPrimaryContainer : scheme.onSurfaceVariant}
        />
      </View>
    );
  }

  const { bg, fg } = getLineColors(normalizedLine || line, mode, cityId);
  // Zestaw ikon nie ma osobnego glifu trolejbusu ani metra, więc trolejbus
  // jedzie ikoną autobusu na własnym zielonym tle, a metro ikoną pociągu
  // na barwie linii ze schematu (M1/M2): kolor niesie tożsamość.
  const Icon =
    resolved === 'cable'
      ? CableCar
      : resolved === 'train' || resolved === 'subway'
        ? TrainFront
        : resolved === 'tram'
          ? TramFront
          : BusFront;

  const charCount = (normalizedLine || '').length;
  const isSmallText = compact && charCount >= 4;
  const isTinyText = compact && charCount >= 6;

  return (
    <View
      style={[
        styles.badge,
        compact && styles.compact,
        maxWidth != null && { maxWidth },
        { backgroundColor: bg },
      ]}
    >
      <Icon size={compact ? 11 : 13} color={fg} />
      <Text
        style={[
          styles.text,
          compact && styles.compactText,
          isSmallText && styles.smallText,
          isTinyText && styles.tinyText,
          { color: fg },
        ]}
        numberOfLines={1}
        ellipsizeMode="tail"
      >
        {normalizedLine}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: shape.small,
    minWidth: 38,
    height: 28,
    justifyContent: 'center',
  },
  walk: { backgroundColor: scheme.surfaceContainerHighest, minWidth: 28 },
  compactWalk: { minWidth: 24, paddingHorizontal: 4, height: 26 },
  walkActive: { backgroundColor: scheme.secondaryContainer },
  compact: { paddingHorizontal: 5, minWidth: 28, height: 26, gap: 3 },
  text: { ...type.labelLarge, fontWeight: '700' },
  compactText: { fontSize: 12, lineHeight: 14, fontWeight: '700' },
  smallText: { fontSize: 11, lineHeight: 13, letterSpacing: -0.3 },
  tinyText: { fontSize: 10, lineHeight: 12, letterSpacing: -0.5 },
});
