import { useCallback, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import * as Location from 'expo-location';
import { compassDegrees } from './compassHeading';

export function useDeviceHeading(enabled: boolean, onHeading: (value: number | null) => void) {
  const callback = useRef(onHeading);
  callback.current = onHeading;
  const [state, setState] = useState<'waiting' | 'ok' | 'calibrate' | 'unavailable'>('waiting');

  useFocusEffect(
    useCallback(() => {
      if (!enabled) return;
      let generation = 0;
      let subscription: Location.LocationSubscription | null = null;
      let pendingHeading: number | null = null;
      let lastSentAt = 0;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const flush = () => {
        timer = undefined;
        lastSentAt = Date.now();
        callback.current(pendingHeading);
      };
      const stop = () => {
        generation += 1;
        subscription?.remove();
        subscription = null;
        clearTimeout(timer);
        timer = undefined;
        pendingHeading = null;
        lastSentAt = 0;
        callback.current(null);
      };
      const start = async () => {
        stop();
        if (AppState.currentState !== 'active') return;
        const token = generation;
        try {
          if (!(await Location.getForegroundPermissionsAsync()).granted || token !== generation)
            return;
          setState('waiting');
          const watch = await Location.watchHeadingAsync(
            (sample) => {
              if (token !== generation) return;
              const value = compassDegrees(sample);
              setState(value == null || sample.accuracy === 1 ? 'calibrate' : 'ok');
              pendingHeading = value;
              if (value == null) {
                clearTimeout(timer);
                timer = undefined;
                callback.current(null);
                return;
              }
              const elapsed = Date.now() - lastSentAt;
              if (elapsed >= 80) {
                clearTimeout(timer);
                flush();
              } else if (!timer) timer = setTimeout(flush, 80 - elapsed);
            },
            () => {
              if (token !== generation) return;
              clearTimeout(timer);
              timer = undefined;
              pendingHeading = null;
              setState('unavailable');
              callback.current(null);
            },
          );
          if (token !== generation) watch.remove();
          else subscription = watch;
        } catch {
          if (token === generation) {
            setState('unavailable');
            callback.current(null);
          }
        }
      };
      void start();
      const appState = AppState.addEventListener('change', (next) => {
        if (next === 'active') void start();
        else stop();
      });
      return () => {
        stop();
        appState.remove();
      };
    }, [enabled]),
  );
  return state;
}
