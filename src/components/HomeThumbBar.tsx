import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { LocateFixed, MapPinOff, Search, X } from 'lucide-react-native';
import { scheme, type } from '../theme/tokens';
import { ThumbBar, ThumbBarDivider, ThumbBarItem } from './ThumbBar';
import { useStrings } from '../i18n';

interface HomeThumbBarProps {
  onOpenSearch: () => void;
  /** Miejsce odjazdu — w miejscu dawnego skrótu do ulubionego. */
  startTitle: string;
  isCustomStart: boolean;
  onOpenStart: () => void;
  onResetStart: () => void;
  /** GPS poza Wrocławiem: start wymaga ręcznego wyboru. */
  gpsUnsupported?: boolean;
}

/**
 * Dolne menu ekranu głównego — jeden wiersz, dwa wejścia:
 * z lewej wyszukiwarka celu, z prawej wybór startu („z: …” z ikonką
 * po prawej). Ten sam font, te same ikony (18) i wyśrodkowane labele.
 */
export function HomeThumbBar({
  onOpenSearch,
  startTitle,
  isCustomStart,
  onOpenStart,
  onResetStart,
  gpsUnsupported = false,
}: HomeThumbBarProps) {
  const s = useStrings();
  return (
    <ThumbBar>
      <ThumbBarItem
        onPress={onOpenSearch}
        layout="horizontal"
        icon={<Search size={18} color={scheme.primary} />}
        label={s.home.searchLabel}
        style={styles.searchItem}
        labelStyle={styles.searchLabel}
        accessibilityLabel={s.home.searchA11y}
      />

      <ThumbBarDivider />

      <Pressable
        onPress={onOpenStart}
        style={({ pressed }) => [styles.startItem, pressed && { opacity: 0.7 }]}
        accessibilityRole="button"
        accessibilityLabel={
          isCustomStart
            ? s.home.startCustomA11y(startTitle)
            : s.home.startGpsA11y(startTitle)
        }
      >
        <Text
          style={[styles.startText, isCustomStart && styles.startTextCustom, gpsUnsupported && styles.startTextWarn]}
          numberOfLines={1}
          ellipsizeMode="tail"
        >
          {gpsUnsupported && !isCustomStart ? s.home.pickStart : s.home.startFrom(startTitle)}
        </Text>
        {isCustomStart ? (
          <Pressable
            hitSlop={8}
            onPress={(e) => {
              e.stopPropagation();
              onResetStart();
            }}
            accessibilityRole="button"
            accessibilityLabel={s.home.resetStartA11y}
            style={styles.startResetBtn}
          >
            <X size={14} color={scheme.onSurfaceVariant} />
          </Pressable>
        ) : gpsUnsupported ? (
          <MapPinOff size={18} color={scheme.warning} />
        ) : (
          <LocateFixed size={18} color={scheme.onSurfaceVariant} />
        )}
      </Pressable>
    </ThumbBar>
  );
}

const styles = StyleSheet.create({
  // Szukanie bierze wolne miejsce, start ma maks. 45% i ucina się z elipsą —
  // label „Dokąd jedziesz?” nigdy nie ginie. Oba wiersze: bodyMedium,
  // ikony 18, min. 50 px, wyśrodkowane w pionie (bar rozciąga, items centrują).
  searchItem: {
    flex: 1,
    minWidth: 0,
    // Bazowy ThumbBarItem centruje treść — tu ma hugować lewą (symetria
    // do startu hugującego prawą: 12 + 4 z obu stron pigułki).
    justifyContent: 'flex-start',
  },
  searchLabel: {
    ...type.bodyMedium,
    lineHeight: 20,
    color: scheme.onSurfaceVariant,
    fontWeight: '500',
  },
  startItem: {
    flex: 1,
    minWidth: 0,
    maxWidth: '45%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
    paddingHorizontal: 12,
    minHeight: 50,
  },
  startText: {
    ...type.bodyMedium,
    lineHeight: 20,
    color: scheme.onSurfaceVariant,
    fontWeight: '500',
    flexShrink: 1,
    minWidth: 0,
  },
  startTextCustom: {
    color: scheme.onSurface,
    fontWeight: '600',
  },
  startTextWarn: {
    color: scheme.warning,
    fontWeight: '700',
  },
  startResetBtn: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 4,
    backgroundColor: scheme.surfaceContainerHighest,
  },
});
