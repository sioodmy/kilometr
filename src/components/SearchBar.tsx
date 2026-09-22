import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Search } from 'lucide-react-native';
import { elev, scheme, shape, type } from '../theme/tokens';

// M3 SearchBar: surfaceContainerHigh, extraLarge shape, leading icon,
// level1 elevation.
export function SearchBar({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.box, pressed && { backgroundColor: scheme.surfaceContainerHighest }]}
      accessibilityRole="search"
    >
      <View style={styles.leading}>
        <Search size={21} color={scheme.onSurfaceVariant} />
      </View>
      <Text style={styles.placeholder} numberOfLines={1}>
        Szukaj adresu lub miejsca…
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: scheme.surfaceContainerHigh,
    borderRadius: shape.full,
    height: 56,
    paddingLeft: 6,
    paddingRight: 8,
    gap: 4,
    ...elev.level1,
  },
  leading: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  placeholder: { flex: 1, ...type.bodyLarge, color: scheme.onSurfaceVariant },
});
