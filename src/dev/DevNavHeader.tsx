import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { scheme, shape, type } from '../theme/tokens';

export function DevNavHeader({
  current,
}: {
  current: 'home' | 'search' | 'transfer' | 'index';
}) {
  const links: Array<{
    id: 'home' | 'search' | 'transfer';
    path: '/dev/home' | '/dev/search' | '/dev/transfer';
    label: string;
  }> = [
    { id: 'home', path: '/dev/home', label: '🏠 Główny' },
    { id: 'search', path: '/dev/search', label: '🔍 Szukaj' },
    { id: 'transfer', path: '/dev/transfer', label: '🔄 Przesiadki' },
  ];

  return (
    <View style={styles.container}>
      <View style={styles.topRow}>
        <Text style={styles.tag}>DEV MOCK EXPO</Text>
        <Pressable
          hitSlop={8}
          onPress={() => router.replace('/dev' as any)}
          style={({ pressed }) => [styles.hubBtn, pressed && styles.hubBtnPressed]}
        >
          <Text style={styles.hubBtnText}>Hub</Text>
        </Pressable>
      </View>
      <View style={styles.tabsRow}>
        {links.map((link) => {
          const active = current === link.id;
          return (
            <Pressable
              key={link.id}
              hitSlop={6}
              onPress={() => {
                if (!active) router.replace(link.path);
              }}
              style={({ pressed }) => [
                styles.tab,
                active && styles.tabActive,
                pressed && !active && styles.tabPressed,
              ]}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
            >
              <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>
                {link.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: scheme.outlineVariant,
    backgroundColor: scheme.surfaceContainerLowest,
    gap: 8,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  tag: {
    ...type.labelSmall,
    letterSpacing: 1,
    color: scheme.primary,
    textTransform: 'uppercase',
  },
  hubBtn: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainerHigh,
  },
  hubBtnPressed: {
    opacity: 0.7,
  },
  hubBtnText: {
    ...type.labelSmall,
    color: scheme.onSurfaceVariant,
  },
  tabsRow: {
    flexDirection: 'row',
    gap: 6,
  },
  tab: {
    flex: 1,
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: shape.small,
    backgroundColor: scheme.surfaceContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabActive: {
    backgroundColor: scheme.primary,
  },
  tabPressed: {
    backgroundColor: scheme.surfaceContainerHigh,
  },
  tabLabel: {
    ...type.labelMedium,
    color: scheme.onSurfaceVariant,
  },
  tabLabelActive: {
    color: scheme.onPrimary,
    fontWeight: '700',
  },
});
