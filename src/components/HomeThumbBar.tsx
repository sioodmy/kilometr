import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Home, Search } from 'lucide-react-native';
import { scheme, type } from '../theme/tokens';
import { ThumbBar, ThumbBarDivider, ThumbBarItem } from './ThumbBar';
import { SAVED_PLACE_ICONS } from './SavedPlacesRow';
import type { SavedPlace } from '../types/models';

interface HomeThumbBarProps {
  onOpenSearch: () => void;
  topSavedPlace?: SavedPlace;
  onSelectPlace?: (place: SavedPlace) => void;
}

/**
 * Dolne menu ekranu głównego — ta sama pigułka co na pozostałych ekranach,
 * więc kciuk trafia w to samo miejsce niezależnie od tego, gdzie jesteśmy:
 * skrót do ulubionego miejsca i wyszukiwarka celu.
 */
export function HomeThumbBar({
  onOpenSearch,
  topSavedPlace,
  onSelectPlace,
}: HomeThumbBarProps) {
  const IconComponent = topSavedPlace ? (SAVED_PLACE_ICONS[topSavedPlace.icon] ?? Home) : Home;
  const showFav = !!topSavedPlace && !!onSelectPlace;

  return (
    <ThumbBar>
      {showFav ? (
        <>
          <ThumbBarItem
            onPress={() => onSelectPlace!(topSavedPlace!)}
            active
            layout="horizontal"
            icon={<IconComponent size={17} color={scheme.onPrimaryContainer} />}
            label={topSavedPlace!.name}
            style={styles.favItem}
            labelStyle={styles.favLabel}
            accessibilityLabel={`Szybka trasa: ${topSavedPlace!.name}`}
          />
          <ThumbBarDivider />
        </>
      ) : null}

      <ThumbBarItem
        onPress={onOpenSearch}
        layout="horizontal"
        icon={<Search size={18} color={scheme.primary} />}
        label="Dokąd jedziesz?"
        style={styles.searchItem}
        labelStyle={styles.searchLabel}
        accessibilityLabel="Szukaj adresu, przystanku lub miejsca"
      />
    </ThumbBar>
  );
}

const styles = StyleSheet.create({
  favItem: {
    flex: 0,
    maxWidth: 160,
    backgroundColor: scheme.primaryContainer,
  },
  favLabel: {
    ...type.labelLarge,
    color: scheme.onPrimaryContainer,
    fontWeight: '700',
  },
  searchItem: {
    flex: 1,
  },
  searchLabel: {
    ...type.bodyMedium,
    color: scheme.onSurfaceVariant,
    fontWeight: '500',
  },
});
