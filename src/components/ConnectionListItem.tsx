import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import type { LayoutChangeEvent } from 'react-native';
import Animated, {
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { ConnectionCard } from './ConnectionCard';
import type { ConnectionPeekHandlers } from './ConnectionPeek';
import { useRouteCardTransition } from './RouteCardTransition';
import { normalizeConnectionId } from '../services/routing/connectionIdentity';
import { motion } from '../theme/motion';
import type { Connection } from '../types/models';

export interface ReorderAnimationToken {
  deltaY: number;
  direction: 'up' | 'down';
  seq: number;
}

export type CardEnterMode = 'none' | 'initial' | 'earlier';

const REORDER_SPRING = {
  damping: 26,
  stiffness: 280,
  mass: 0.9,
  reduceMotion: ReduceMotion.System,
};

const ENTER_EASING = Easing.bezier(0.05, 0.7, 0.1, 1);

interface ConnectionListItemProps {
  item: Connection;
  index: number;
  dimmed: boolean;
  tick: number;
  onPress: (item: Connection) => void;
  peek: ConnectionPeekHandlers;
  reduceMotion: boolean;
  enterMode: CardEnterMode;
  reorder?: ReorderAnimationToken;
  onMeasureHeight: (id: string, height: number) => void;
}

/**
 * Komórka listy połączeń z kierunkowym wejściem (początkowe od dołu, wcześniejsze
 * z góry) i płynną animacją FLIP wyłącznie przy realnej zamianie kolejności kart.
 */
export const ConnectionListItem = memo(function ConnectionListItem({
  item,
  index,
  dimmed,
  tick,
  onPress,
  peek,
  reduceMotion,
  enterMode,
  reorder,
  onMeasureHeight,
}: ConnectionListItemProps) {
  const initialModeRef = useRef(enterMode);
  const initialIndexRef = useRef(index);
  const lastReorderSeqRef = useRef(0);

  const startY = reduceMotion
    ? 0
    : initialModeRef.current === 'earlier'
      ? -14
      : initialModeRef.current === 'initial'
        ? 12
        : 0;
  const startOpacity = reduceMotion || initialModeRef.current === 'none' ? 1 : 0;

  const enterOffsetY = useSharedValue(startY);
  const enterOpacity = useSharedValue(startOpacity);
  const reorderOffsetY = useSharedValue(0);
  const swapScale = useSharedValue(1);

  useEffect(() => {
    if (reduceMotion || initialModeRef.current === 'none') return;
    const delay = Math.min(initialIndexRef.current, 5) * 24;
    enterOpacity.value = withDelay(
      delay,
      withTiming(1, {
        duration: 190,
        easing: ENTER_EASING,
        reduceMotion: ReduceMotion.System,
      }),
    );
    enterOffsetY.value = withDelay(delay, withSpring(0, motion.spring.spatialFast));
  }, [enterOffsetY, enterOpacity, reduceMotion]);

  useLayoutEffect(() => {
    if (reduceMotion || !reorder || reorder.seq === lastReorderSeqRef.current) return;
    lastReorderSeqRef.current = reorder.seq;
    // Synchroniczne cofnięcie na poprzednią pozycję przed paintem eliminuje 1-klatkowy skok.
    reorderOffsetY.value = reorder.deltaY;
    swapScale.value = reorder.direction === 'up' ? 1.018 : 0.986;
    reorderOffsetY.value = withSpring(0, REORDER_SPRING);
    swapScale.value = withDelay(170, withSpring(1, motion.spring.effectsFast));
  }, [reduceMotion, reorder, reorderOffsetY, swapScale]);

  const transition = useRouteCardTransition();
  const normalizedId = useMemo(() => normalizeConnectionId(item.id), [item.id]);
  const hiddenCardId = transition?.hiddenCardId;

  const animatedStyle = useAnimatedStyle(() => {
    const isHiddenForMorph = hiddenCardId ? hiddenCardId.value === normalizedId : false;
    return {
      opacity: isHiddenForMorph ? 0 : enterOpacity.value,
      transform: [
        { translateY: enterOffsetY.value + reorderOffsetY.value },
        { scale: swapScale.value },
      ],
    };
  });

  const handleLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const h = event.nativeEvent.layout.height;
      if (h > 0) onMeasureHeight(item.id, h);
    },
    [item.id, onMeasureHeight],
  );

  return (
    <Animated.View style={animatedStyle} onLayout={handleLayout}>
      <ConnectionCard item={item} dimmed={dimmed} onPress={onPress} peek={peek} tick={tick} />
    </Animated.View>
  );
});
