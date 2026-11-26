import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { useNavigation } from 'expo-router';
import { useReducedMotion } from 'react-native-reanimated';

const DEFAULT_FALLBACK_MS = 240;

type TransitionEndEvent = {
  data?: {
    closing?: boolean;
  };
};

type TransitionCapableNavigation = {
  addListener?: (
    event: string,
    callback: (event: TransitionEndEvent) => void,
  ) => () => void;
  getState?: () => { index?: number } | undefined;
  getParent?: () => TransitionCapableNavigation | undefined;
};

/**
 * Zwraca `true` dopiero po zakończeniu natywnej animacji wejścia ekranu
 * w `@react-navigation/native-stack` (lub po pierwszej klatce na Web / reduced motion).
 * `InteractionManager.runAfterInteractions` nie czeka na przejścia `react-native-screens`,
 * więc ciężkie sekcje poniżej zgięcia i zapytania w tle muszą korzystać z tego sygnału.
 */
export function useScreenTransitionSettled(fallbackMs = DEFAULT_FALLBACK_MS): boolean {
  const navigation = useNavigation() as unknown as TransitionCapableNavigation;
  const reduceMotion = useReducedMotion();
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let frame: number | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let unsubscribe: (() => void) | undefined;
    let unsubscribeParent: (() => void) | undefined;

    const markSettled = () => {
      if (cancelled) return;
      cancelled = true;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      unsubscribe?.();
      unsubscribe = undefined;
      unsubscribeParent?.();
      unsubscribeParent = undefined;
      setSettled(true);
    };

    const scheduleAfterFrame = () => {
      if (cancelled || frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        if (Platform.OS === 'web') {
          // Dwie klatki dają przeglądarce szansę wyrenderować i namalować skeleton przed ciężką pracą.
          frame = requestAnimationFrame(() => {
            frame = null;
            markSettled();
          });
          return;
        }
        markSettled();
      });
    };

    if (Platform.OS === 'web' || reduceMotion) {
      scheduleAfterFrame();
    } else {
      try {
        unsubscribe = navigation.addListener?.('transitionEnd', (event) => {
          if (event?.data?.closing) return;
          scheduleAfterFrame();
        });
        if (navigation.getState?.()?.index === 0) {
          unsubscribeParent = navigation.getParent?.()?.addListener?.('transitionEnd', (event) => {
            if (event?.data?.closing) return;
            scheduleAfterFrame();
          });
        }
      } catch {
        // Fallback poniżej domknie stan, gdyby nawigator nie emitował transitionEnd.
      }
      timer = setTimeout(scheduleAfterFrame, fallbackMs);
    }

    return () => {
      cancelled = true;
      if (frame !== null) cancelAnimationFrame(frame);
      if (timer !== null) clearTimeout(timer);
      unsubscribe?.();
      unsubscribeParent?.();
    };
  }, [navigation, reduceMotion, fallbackMs]);

  return settled;
}
