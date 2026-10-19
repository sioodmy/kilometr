import { Easing, ReduceMotion } from 'react-native-reanimated';

// M3 standard do zmian stanu, emphasized decelerate do wejść elementów.
export const motion = {
  state: {
    duration: 200,
    easing: Easing.bezier(0.2, 0, 0, 1),
    reduceMotion: ReduceMotion.System,
  },
  enter: {
    duration: 300,
    easing: Easing.bezier(0.05, 0.7, 0.1, 1),
    reduceMotion: ReduceMotion.System,
  },
} as const;
