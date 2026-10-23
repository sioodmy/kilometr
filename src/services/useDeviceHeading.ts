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
      let filteredHeading: number | null = null;
      let publishedHeading: number | null = null;
      let lastSentAt = 0;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const flush = () => {
        timer = undefined;
        const now = Date.now();
        const elapsed = now - lastSentAt;
        lastSentAt = now;
        if (pendingHeading == null) return;
        const delta =
          filteredHeading == null ? 0 : ((pendingHeading - filteredHeading + 540) % 360) - 180;
        filteredHeading =
          filteredHeading == null
            ? pendingHeading
            : (filteredHeading + delta * (1 - Math.exp(-elapsed / 350)) + 360) % 360;
        if (
          publishedHeading != null &&
          Math.abs(((filteredHeading - publishedHeading + 540) % 360) - 180) < 3
        )
          return;
        publishedHeading = filteredHeading;
        callback.current(filteredHeading);
      };
      const stop = () => {
        generation += 1;
        subscription?.remove();
        subscription = null;
        clearTimeout(timer);
        timer = undefined;
        pendingHeading = null;
        filteredHeading = null;
        publishedHeading = null;
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
              const value = sample.accuracy === 1 ? null : compassDegrees(sample);
              setState(value == null || sample.accuracy === 1 ? 'calibrate' : 'ok');
              pendingHeading = value;
              if (value == null) {
                clearTimeout(timer);
                timer = undefined;
                filteredHeading = null;
                publishedHeading = null;
                callback.current(null);
                return;
              }
              const elapsed = Date.now() - lastSentAt;
              if (elapsed >= 200) {
                clearTimeout(timer);
                flush();
              } else if (!timer) timer = setTimeout(flush, 200 - elapsed);
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
