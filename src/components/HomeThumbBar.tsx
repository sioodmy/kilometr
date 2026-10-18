import { Pressable, StyleSheet, Text, View } from 'react-native';
import { LocateFixed, MapPinOff, Search, X } from 'lucide-react-native';
import { scheme, shape, type } from '../theme/tokens';
import { ThumbBar } from './ThumbBar';
import { useStrings } from '../i18n';

interface HomeThumbBarProps {
  onOpenSearch: () => void;
  startTitle: string;
  isCustomStart: boolean;
  onOpenStart: () => void;
  onResetStart: () => void;
  gpsUnsupported?: boolean;
}

const BAR_PADDING = 8;
const INNER_RADIUS = shape.extraLarge - BAR_PADDING - 1;

export function HomeThumbBar({
  onOpenSearch,
  startTitle,
  isCustomStart,
  onOpenStart,
  onResetStart,
  gpsUnsupported = false,
}: HomeThumbBarProps) {
  const s = useStrings();
  const OriginIcon = gpsUnsupported && !isCustomStart ? MapPinOff : LocateFixed;
  return (
    <ThumbBar contentStyle={styles.bar} measurementKey="home">
      <Pressable
        onPress={onOpenSearch}
        accessibilityRole="button"
        accessibilityLabel={s.home.searchA11y}
        style={({ pressed }) => [styles.search, pressed && { opacity: 0.8 }]}
      >
        <Search size={22} color={scheme.onPrimaryContainer} />
        <Text style={styles.searchLabel}>{s.home.searchLabel}</Text>
      </Pressable>
      <View style={styles.originRow}>
        <Pressable
          onPress={onOpenStart}
          accessibilityRole="button"
          accessibilityLabel={
            isCustomStart ? s.home.startCustomA11y(startTitle) : s.home.startGpsA11y(startTitle)
          }
          style={({ pressed }) => [styles.origin, pressed && styles.pressed]}
        >
          <OriginIcon
            size={18}
            color={gpsUnsupported && !isCustomStart ? scheme.warning : scheme.onSurfaceVariant}
          />
          <View style={styles.originText}>
            <Text style={styles.originLabel}>{s.routeDetails.origin}</Text>
            <Text style={[styles.originPlace, gpsUnsupported && !isCustomStart && styles.warning]}>
              {gpsUnsupported && !isCustomStart ? s.home.pickStart : startTitle}
            </Text>
          </View>
        </Pressable>
        {isCustomStart && (
          <Pressable
            onPress={onResetStart}
            accessibilityRole="button"
            accessibilityLabel={s.home.resetStartA11y}
            style={({ pressed }) => [styles.reset, pressed && styles.pressed]}
          >
            <X size={18} color={scheme.onSurfaceVariant} />
          </Pressable>
        )}
      </View>
    </ThumbBar>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'column',
    borderRadius: shape.extraLarge,
    paddingHorizontal: BAR_PADDING,
    paddingVertical: BAR_PADDING,
    gap: 4,
  },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 54,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: INNER_RADIUS,
    backgroundColor: scheme.primaryContainer,
  },
  searchLabel: { ...type.bodyLarge, fontWeight: '500', color: scheme.onPrimaryContainer, flex: 1 },
  originRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  origin: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 52,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: INNER_RADIUS,
  },
  originText: { flex: 1, gap: 2 },
  originLabel: { ...type.bodySmall, color: scheme.onSurfaceVariant },
  originPlace: { ...type.bodyMedium, color: scheme.onSurface },
  warning: { color: scheme.warning },
  reset: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: shape.medium,
  },
  pressed: { backgroundColor: scheme.surfaceContainerHighest },
});
