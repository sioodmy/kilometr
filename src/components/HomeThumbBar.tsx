import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ChevronRight, LocateFixed, MapPin, MapPinOff, Search, X } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheme, shape, type } from '../theme/tokens';
import { useStrings } from '../i18n';

interface HomeThumbBarProps {
  onOpenSearch: () => void;
  startTitle: string;
  isCustomStart: boolean;
  onOpenStart: () => void;
  onResetStart: () => void;
  gpsUnsupported?: boolean;
}

export function HomeThumbBar({
  onOpenSearch,
  startTitle,
  isCustomStart,
  onOpenStart,
  onResetStart,
  gpsUnsupported = false,
}: HomeThumbBarProps) {
  const s = useStrings();
  const insets = useSafeAreaInsets();
  const [focused, setFocused] = useState<'search' | 'origin' | 'reset' | null>(null);
  const OriginIcon = isCustomStart ? MapPin : gpsUnsupported ? MapPinOff : LocateFixed;
  return (
    <View style={[styles.dock, { paddingBottom: Math.max(insets.bottom, 12) }]}>
      <View style={styles.bar}>
        <Pressable
          onPress={onOpenSearch}
          onFocus={() => setFocused('search')}
          onBlur={() => setFocused(null)}
          accessibilityRole="button"
          accessibilityLabel={s.home.searchA11y}
          style={({ pressed }) => [
            styles.search,
            focused === 'search' && styles.searchFocused,
            pressed && styles.searchPressed,
          ]}
        >
          <Search size={20} color={scheme.onSurfaceVariant} />
          <Text style={styles.searchLabel}>{s.home.searchLabel}</Text>
        </Pressable>
        <View style={styles.originRow}>
          <Pressable
            onPress={onOpenStart}
            onFocus={() => setFocused('origin')}
            onBlur={() => setFocused(null)}
            accessibilityRole="button"
            accessibilityLabel={
              isCustomStart ? s.home.startCustomA11y(startTitle) : s.home.startGpsA11y(startTitle)
            }
            style={({ pressed }) => [
              styles.origin,
              focused === 'origin' && styles.focused,
              pressed && styles.pressed,
            ]}
          >
            <OriginIcon
              size={18}
              color={gpsUnsupported && !isCustomStart ? scheme.warning : scheme.onSurfaceVariant}
            />
            <Text style={[styles.originPlace, gpsUnsupported && !isCustomStart && styles.warning]}>
              {gpsUnsupported && !isCustomStart ? s.home.pickStart : s.home.startFrom(startTitle)}
            </Text>
            <ChevronRight size={16} color={scheme.onSurfaceVariant} />
          </Pressable>
          {isCustomStart && (
            <Pressable
              onPress={onResetStart}
              onFocus={() => setFocused('reset')}
              onBlur={() => setFocused(null)}
              accessibilityRole="button"
              accessibilityLabel={s.home.resetStartA11y}
              style={({ pressed }) => [
                styles.reset,
                focused === 'reset' && styles.focused,
                pressed && styles.pressed,
              ]}
            >
              <X size={18} color={scheme.onSurfaceVariant} />
            </Pressable>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  dock: {
    marginTop: 8,
    paddingTop: 12,
    paddingHorizontal: 20,
    backgroundColor: scheme.surfaceContainerLow,
    borderTopLeftRadius: shape.extraLarge,
    borderTopRightRadius: shape.extraLarge,
  },
  bar: {
    width: '100%',
    maxWidth: 600,
    alignSelf: 'center',
    gap: 4,
  },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 52,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 20,
    backgroundColor: scheme.surfaceContainerHigh,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  searchLabel: { ...type.bodyLarge, fontWeight: '500', color: scheme.onSurface, flex: 1 },
  originRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  origin: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 48,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: shape.large,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  originPlace: { ...type.bodyMedium, color: scheme.onSurfaceVariant, flex: 1 },
  warning: { color: scheme.warning },
  reset: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: shape.medium,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  focused: { borderColor: scheme.primary },
  searchFocused: { borderColor: scheme.primary },
  searchPressed: { backgroundColor: scheme.surfaceContainerHighest, borderRadius: shape.large },
  pressed: { backgroundColor: scheme.surfaceContainerHighest },
});
