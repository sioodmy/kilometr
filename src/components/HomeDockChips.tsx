import { useEffect, useRef } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import Animated, {
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { Ticket } from './icons';
import { LineBadge } from './LineBadge';
import { SpringPressable } from './SpringPressable';
import { motion } from '../theme/motion';
import { scheme, shape, type } from '../theme/tokens';
import type { Leg } from '../types/models';

/**
 * Skróty nad search barem docka ekranu głównego: aktywnie przypięta podróż
 * i pociągi z zapisanym biletem odjeżdżające w ciągu 3 h.
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
const ROW_H = CHIP_H + 24;

/** Animowany pasek skrótów nad wyszukiwarką ze sprężystym pojawianiem M3 Expressive. */
export function HomeDockChips({ chips }: { chips: DockChip[] }) {
  const open = useSharedValue(chips.length > 0 ? 1 : 0);
  const lastChipsRef = useRef(chips);
  if (chips.length > 0) {
    lastChipsRef.current = chips;
  }
  const displayChips = chips.length > 0 ? chips : lastChipsRef.current;

  useEffect(() => {
    const target = chips.length > 0 ? 1 : 0;
    open.value = withSpring(
      target,
      target === 1 ? motion.spring.spatialDefault : motion.spring.effectsFast,
    );
  }, [chips.length, open]);

  const wrapStyle = useAnimatedStyle(() => {
    const clamped = Math.max(0, open.value);
    return {
      height: ROW_H * clamped,
      opacity: Math.min(1, clamped),
      transform: [
        { translateY: interpolate(open.value, [0, 1], [6, 0]) },
        { scale: interpolate(open.value, [0, 1], [0.96, 1]) },
      ],
    };
  });

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
    <SpringPressable
      onPress={chip.onPress}
      scaleDelta={fullWidth ? 0.018 : 0.03}
      opacityDelta={0.08}
      haptic="selection"
      accessibilityRole="button"
      accessibilityLabel={chip.a11yLabel}
      style={[
        styles.chip,
        chip.pinned ? styles.chipPinned : styles.chipPlain,
        ticket && styles.chipWithTicket,
        fullWidth && styles.chipFullWidth,
        fullWidth && ticket && styles.chipFullWidthWithTicket,
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
        <SpringPressable
          onPress={(e) => {
            e.stopPropagation();
            ticket.onOpen();
          }}
          hitSlop={6}
          scaleDelta={0.08}
          haptic="light"
          accessibilityRole="button"
          accessibilityLabel={ticket.a11y}
          style={styles.ticketBtn}
        >
          <Ticket size={16} color={scheme.onPrimaryContainer} />
        </SpringPressable>
      )}
    </SpringPressable>
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
    borderRadius: 20,
  },
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
});
