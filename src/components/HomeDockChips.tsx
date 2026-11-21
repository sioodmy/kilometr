import { useEffect, useRef } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, {
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
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

const CHIP_H = 44;
const ROW_H = CHIP_H + 14;

/** Animowany pasek skrótów nad wyszukiwarką ze sprężystym pojawianiem M3 Expressive. */
export function HomeDockChips({ chips }: { chips: DockChip[] }) {
  const reduceMotion = useReducedMotion();
  const open = useSharedValue(chips.length > 0 ? 1 : 0);
  const lastChipsRef = useRef(chips);
  if (chips.length > 0) {
    lastChipsRef.current = chips;
  }
  const displayChips = chips.length > 0 ? chips : lastChipsRef.current;

  useEffect(() => {
    const target = chips.length > 0 ? 1 : 0;
    if (reduceMotion) {
      open.value = target;
      return;
    }
    open.value = withSpring(
      target,
      target === 1 ? motion.spring.spatialDefault : motion.spring.effectsFast,
    );
  }, [chips.length, open, reduceMotion]);

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
      {chip.pinned && <View style={styles.liveDot} />}
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
        <View style={[styles.timePill, chip.pinned && styles.timePillPinned]}>
          <Text
            style={[styles.time, chip.pinned && styles.timePinned]}
            numberOfLines={1}
          >
            {chip.timeLabel}
          </Text>
        </View>
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
    justifyContent: 'flex-start',
  },
  row: { alignItems: 'center', gap: 10, paddingRight: 16 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: CHIP_H,
    paddingLeft: 14,
    paddingRight: 14,
    borderRadius: shape.full,
    borderWidth: StyleSheet.hairlineWidth,
  },
  chipFullWidth: {
    width: '100%',
    paddingLeft: 14,
    paddingRight: 12,
  },
  chipFullWidthWithTicket: {
    paddingRight: 5,
  },
  chipPinned: {
    backgroundColor: scheme.primaryContainer,
    borderColor: scheme.primary,
  },
  chipPlain: {
    backgroundColor: scheme.surfaceContainerHigh,
    borderColor: scheme.outlineVariant,
  },
  chipWithTicket: { paddingRight: 5 },
  liveDot: {
    width: 7,
    height: 7,
    borderRadius: shape.full,
    backgroundColor: scheme.primary,
    flexShrink: 0,
  },
  title: {
    ...type.labelLarge,
    fontWeight: '700',
    color: scheme.onSurface,
    maxWidth: 160,
  },
  titlePinned: { color: scheme.onPrimaryContainer },
  titleFullWidth: {
    flex: 1,
    maxWidth: undefined,
  },
  timePill: {
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainerLow,
    flexShrink: 0,
  },
  timePillPinned: {
    backgroundColor: scheme.surfaceContainerLow,
  },
  time: {
    ...type.labelSmall,
    fontWeight: '700',
    color: scheme.onSurfaceVariant,
    fontVariant: ['tabular-nums'],
  },
  timePinned: { color: scheme.onSurface },
  ticketBtn: {
    width: 34,
    height: 34,
    borderRadius: shape.full,
    backgroundColor: scheme.primaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
});
