import { Pressable, StyleSheet, Text, View } from 'react-native';
import { LocateFixed, Mic, Search } from 'lucide-react-native';
import { elev, scheme, shape, type } from '../theme/tokens';

// M3 SearchBar: surfaceContainerHigh, extraLarge shape, leading icon,
// trailing icon buttons, level1 when idle.
export function SearchBar({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.box, pressed && { opacity: 0.9 }]}
      accessibilityRole="search"
    >
      <View style={styles.leading}>
        <Search size={21} color={scheme.onSurfaceVariant} />
      </View>
      <Text style={styles.placeholder} numberOfLines={1}>
        Szukaj adresu lub miejsca…
      </Text>
      <View style={styles.trailing}>
        <Mic size={20} color={scheme.onSurfaceVariant} />
      </View>
      <View style={styles.avatar}>
        <LocateFixed size={19} color={scheme.onPrimaryContainer} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: scheme.surfaceContainerHigh,
    borderRadius: shape.extraLarge,
    height: 60,
    paddingLeft: 6,
    paddingRight: 6,
    gap: 2,
    ...elev.level1,
  },
  leading: { width: 46, alignItems: 'center', justifyContent: 'center' },
  placeholder: { flex: 1, ...type.bodyLarge, color: scheme.onSurfaceVariant },
  trailing: { width: 44, alignItems: 'center', justifyContent: 'center' },
  // M3 tonal avatar action (replaces bordered locate button)
  avatar: {
    width: 40,
    height: 40,
    borderRadius: shape.full,
    backgroundColor: scheme.primaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
