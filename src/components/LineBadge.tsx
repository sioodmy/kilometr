import { StyleSheet, Text, View } from 'react-native';
import { BusFront, Footprints, TramFront } from 'lucide-react-native';
import { scheme, shape, type } from '../theme/tokens';
import type { LegMode } from '../types/models';

export const TRANSIT_PALETTE = [
  '#00897B', // Teal
  '#1976D2', // Blue
  '#D32F2F', // Red
  '#7B1FA2', // Purple
  '#F57C00', // Amber/Orange
  '#303F9F', // Indigo
  '#2E7D32', // Green
  '#C2185B', // Pink
  '#0097A7', // Cyan
  '#E64A19', // Deep Orange
  '#512DA8', // Deep Purple
  '#0288D1', // Light Blue
  '#558B2F', // Olive/Lime
  '#AD1457', // Berry
  '#00838F', // Dark Cyan
  '#455A64', // Blue Grey
  '#5D4037', // Brown
  '#388E3C', // Emerald
  '#0D47A1', // Cobalt
  '#880E4F', // Wine
  '#00695C', // Pine
  '#BF360C', // Rust
  '#311B92', // Violet
  '#1A237E', // Midnight Blue
];

/** Rozpoznaje typ pojazdu (wrocławskie tramwaje to 1–33, reszta to autobusy). */
export function inferTransitMode(mode?: LegMode, line?: string): 'tram' | 'bus' | 'walk' {
  if (mode === 'walk') return 'walk';
  if (mode === 'tram') return 'tram';
  if (mode === 'bus') return 'bus';
  if (!line) return 'bus';
  const clean = line.trim();
  const num = parseInt(clean, 10);
  if (!isNaN(num) && num >= 1 && num <= 33) {
    return 'tram';
  }
  return 'bus';
}

/** Oblicza stabilny, zharmonizowany kolor linii z gwarantowanym kontrastem tekstu. */
export function getLineColors(line?: string, mode?: LegMode): { bg: string; fg: string; isTram: boolean } {
  const resolved = inferTransitMode(mode, line);
  const isTram = resolved === 'tram';
  const clean = (line || '').trim().toUpperCase();

  if (!clean) {
    return { bg: isTram ? '#00897B' : '#1976D2', fg: '#FFFFFF', isTram };
  }

  let hash = 0;
  const key = `${isTram ? 'tram' : 'bus'}:${clean}`;
  for (let i = 0; i < key.length; i++) {
    hash = ((hash << 5) - hash + key.charCodeAt(i)) | 0;
  }
  const idx = Math.abs(hash * 7) % TRANSIT_PALETTE.length;
  const bg = TRANSIT_PALETTE[idx];

  // WCAG AA kontrast: oblicz luminancję tła
  const hex = bg.replace('#', '');
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  const fg = lum > 145 ? '#0A1210' : '#FFFFFF';

  return { bg, fg, isTram };
}

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
