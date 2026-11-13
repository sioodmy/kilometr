import { useEffect, useRef } from 'react';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { Ticket } from './icons';
import { LineBadge } from './LineBadge';
import { motion } from '../theme/motion';
import { scheme, shape, type } from '../theme/tokens';
import type { Leg } from '../types/models';

/**
 * Skróty nad search barem docka ekranu głównego: aktywnie przypięta podróż
 * i pociągi z zapisanym biletem odjeżdżające w ciągu 3 h. Kurs kolejowy
 * i jego bilet mieszkają w jednym pillu: tap w pill otwiera połączenie,
 * tap w segment biletu otwiera podgląd do kontroli. Listę buduje ekran
 * główny (app/index.tsx), tu tylko render i animacja rozwinięcia.
 */
export interface DockChip {
  id: string;
  /** Odcinki pojazdowe do kompaktowych LineBadge'ów (pierwsze dwa). */
  badgeLegs: Leg[];
  title: string;
  /** „za 12 min” albo „14:02”; brak = sam cel podróży. */
  timeLabel?: string;
  /** Aktywnie śledzona podróż: chip z akcentowym kontenerem. */
  pinned?: boolean;
  /** Segment biletu w pillu; brak = połączenie bez zapisanego biletu. */
  ticket?: { a11y: string; onOpen: () => void };
  a11yLabel: string;
  onPress: () => void;
}

const CHIP_H = 40;
// Dolny odstęp do search bara jest częścią animowanej wysokości, żeby po
// zwinięciu nie zostawał pusty prześwit. Chip jest centrowany w pasku,
// więc po 12 dp oddycha z każdej strony.
const ROW_H = CHIP_H + 24;

export function HomeDockChips({ chips }: { chips: DockChip[] }) {
  // 1 = rozwinięte. Wartość startowa dopasowana do pierwszego renderu, żeby
  // dock nie „wyrastał” po każdym powrocie z arkusza (komponent montuje
  // się od nowa razem z całym paskiem).
  const open = useSharedValue(chips.length > 0 ? 1 : 0);
  const lastChipsRef = useRef(chips);
  if (chips.length > 0) {
    lastChipsRef.current = chips;
  }
  const displayChips = chips.length > 0 ? chips : lastChipsRef.current;

  useEffect(() => {
    const target = chips.length > 0 ? 1 : 0;
    // Rozwinięcie emphasized (wejście M3), zwinięcie krótsze, jak zmiana stanu.
    open.value = withTiming(target, target === 1 ? motion.enter : motion.state);
  }, [chips.length, open]);

  const wrapStyle = useAnimatedStyle(() => ({
    height: ROW_H * open.value,
    opacity: open.value,
  }));

  const isSingle = displayChips.length === 1;

  return (
    <Animated.View
      style={[styles.wrap, wrapStyle]}
      accessibilityElementsHidden={chips.length === 0}
      importantForAccessibility={chips.length === 0 ? 'no-hide-descendants' : 'auto'}
    >
      {isSingle ? (
        <ChipView chip={displayChips[0]} fullWidth />
      ) : displayChips.length > 1 ? (
        <ScrollView
          horizontal
          contentContainerStyle={styles.row}
          showsHorizontalScrollIndicator={false}
          overScrollMode="never"
        >
          {displayChips.map((chip) => (
            <ChipView key={chip.id} chip={chip} />
          ))}
        </ScrollView>
      ) : null}
    </Animated.View>
  );
}

function ChipView({ chip, fullWidth }: { chip: DockChip; fullWidth?: boolean }) {
  const ticket = chip.ticket;
  return (
    <Pressable
      onPress={chip.onPress}
      accessibilityRole="button"
      accessibilityLabel={chip.a11yLabel}
      style={({ pressed }) => [
        styles.chip,
        chip.pinned ? styles.chipPinned : styles.chipPlain,
        ticket && styles.chipWithTicket,
        fullWidth && styles.chipFullWidth,
        fullWidth && ticket && styles.chipFullWidthWithTicket,
        pressed && (fullWidth ? styles.chipFullWidthPressed : styles.chipPressed),
      ]}
    >
      {chip.badgeLegs.map((leg, index) => (
        <LineBadge key={`${leg.id}-${index}`} leg={leg} compact />
      ))}
      <Text
        style={[
          styles.title,
          chip.pinned && styles.titlePinned,
          fullWidth && styles.titleFullWidth,
        ]}
        numberOfLines={1}
      >
        {chip.title}
      </Text>
      {chip.timeLabel ? (
        <Text
          style={[
            styles.time,
            chip.pinned && styles.timePinned,
            fullWidth && styles.timeFullWidth,
          ]}
          numberOfLines={1}
        >
          {chip.timeLabel}
        </Text>
      ) : null}
      {ticket && (
        <Pressable
          onPress={(e) => {
            e.stopPropagation();
            ticket.onOpen();
          }}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel={ticket.a11y}
          style={({ pressed }) => [styles.ticketBtn, pressed && styles.ticketPressed]}
        >
          <Ticket size={16} color={scheme.onPrimaryContainer} />
        </Pressable>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: '100%',
    maxWidth: 600,
    alignSelf: 'center',
    overflow: 'hidden',
    justifyContent: 'center',
  },
  row: { alignItems: 'center', gap: 12, paddingRight: 18 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: CHIP_H,
    paddingLeft: 14,
    paddingRight: 18,
    // 20 = promień search bara, żeby chipy i bar miały wspólny język kształtu.
    borderRadius: 20,
  },
  // Pojedynczy pill rozciąga się na pełną szerokość i matchuje search bar poniżej.
  chipFullWidth: {
    width: '100%',
    paddingLeft: 16,
    paddingRight: 16,
  },
  chipFullWidthWithTicket: {
    paddingRight: 6,
  },
  chipPinned: { backgroundColor: scheme.secondaryContainer },
  chipPlain: { backgroundColor: scheme.surfaceContainerHighest },
  chipWithTicket: { paddingRight: 4 },
  chipPressed: { transform: [{ scale: 0.96 }], opacity: 0.85 },
  chipFullWidthPressed: { opacity: 0.85 },
  title: {
    ...type.labelMedium,
    fontWeight: '600',
    color: scheme.onSurface,
    maxWidth: 150,
  },
  titlePinned: { color: scheme.onSecondaryContainer },
  titleFullWidth: {
    flex: 1,
    maxWidth: undefined,
  },
  time: { ...type.labelMedium, fontWeight: '500', color: scheme.onSurfaceVariant },
  timePinned: { color: scheme.onSecondaryContainer, opacity: 0.8 },
  timeFullWidth: {
    flexShrink: 0,
  },
  ticketBtn: {
    width: 32,
    height: 32,
    borderRadius: shape.full,
    backgroundColor: scheme.primaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ticketPressed: { opacity: 0.6 },
});
