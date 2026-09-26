import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Home, Search } from 'lucide-react-native';
import { elev, scheme, shape, type } from '../theme/tokens';
import { SAVED_PLACE_ICONS } from './SavedPlacesRow';
import type { SavedPlace } from '../types/models';

interface HomeThumbBarProps {
  onOpenSearch: () => void;
  topSavedPlace?: SavedPlace;
  onSelectPlace?: (place: SavedPlace) => void;
}

/**
 * Dolny pasek szybkiej akcji dla ekranu głównego (Home Screen).
 * Umieszczony bezpośrednio w strefie kciuka:
 * - 1-tap powrót do domu / ulubionego miejsca bez sięgania do góry ekranu
 * - Wygodna wyszukiwarka uruchamiana kciukiem bez zmiany chwytu w jadącym tramwaju
 */
export function HomeThumbBar({
  onOpenSearch,
  topSavedPlace,
  onSelectPlace,
}: HomeThumbBarProps) {
  const insets = useSafeAreaInsets();
  const IconComponent = topSavedPlace ? (SAVED_PLACE_ICONS[topSavedPlace.icon] ?? Home) : Home;

  return (
    <View
      pointerEvents="box-none"
      style={[styles.wrapper, { bottom: Math.max(insets.bottom, 10) + 10 }]}
    >
      <View style={styles.bar}>
        {/* Skrót do ulubionego / domowego miejsca (1 tap) */}
        {topSavedPlace && onSelectPlace ? (
          <>
            <Pressable
              onPress={() => onSelectPlace(topSavedPlace)}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel={`Szybka trasa: ${topSavedPlace.name}`}
              style={({ pressed }) => [
                styles.quickFavBtn,
                pressed && styles.btnPressed,
              ]}
            >
              <View style={styles.favIconBadge}>
                <IconComponent size={16} color={scheme.onSecondaryContainer} />
              </View>
              <Text style={styles.favLabel} numberOfLines={1}>
                {topSavedPlace.name}
              </Text>
            </Pressable>
            <View style={styles.divider} />
          </>
        ) : null}

        {/* Wyszukiwanie celu w strefie kciuka */}
        <Pressable
          onPress={onOpenSearch}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel="Szukaj adresu, przystanku lub miejsca"
          style={({ pressed }) => [
            styles.searchBtn,
            pressed && styles.btnPressed,
          ]}
        >
          <Search size={18} color={scheme.primary} />
          <Text style={styles.searchPlaceholder} numberOfLines={1}>
            Dokąd jedziesz?
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'absolute',
    left: 16,
    right: 16,
    alignItems: 'center',
    zIndex: 99,
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: scheme.surfaceContainerHigh,
    borderRadius: shape.full,
    paddingHorizontal: 8,
    paddingVertical: 5,
    minHeight: 52,
    borderWidth: 1,
    borderColor: scheme.outlineVariant,
    maxWidth: 440,
    width: '100%',
    ...elev.level3,
  },
  quickFavBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: shape.full,
    backgroundColor: scheme.secondaryContainer,
    maxWidth: 150,
  },
  favIconBadge: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  favLabel: {
    ...type.labelLarge,
    color: scheme.onSecondaryContainer,
    fontWeight: '700',
  },
  searchBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: shape.full,
    minHeight: 42,
  },
  searchPlaceholder: {
    ...type.bodyMedium,
    color: scheme.onSurfaceVariant,
    flex: 1,
  },
  divider: {
    width: 1,
    height: 24,
    backgroundColor: scheme.outlineVariant,
    marginHorizontal: 4,
    opacity: 0.6,
  },
  btnPressed: {
    opacity: 0.75,
    transform: [{ scale: 0.97 }],
  },
});
