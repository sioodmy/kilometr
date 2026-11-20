import { Easing, ReduceMotion } from 'react-native-reanimated';

/** Tokeny ruchu M3 Expressive: krzywe timingowe oraz fizyka sprężyn przestrzennych i efektowych. */
export const motion = {
  state: {
    duration: 200,
    easing: Easing.bezier(0.2, 0, 0, 1),
    reduceMotion: ReduceMotion.System,
  },
  enter: {
    duration: 280,
    easing: Easing.bezier(0.05, 0.7, 0.1, 1),
    reduceMotion: ReduceMotion.System,
  },
  exit: {
    duration: 170,
    easing: Easing.bezier(0.3, 0, 0.8, 0.15),
    reduceMotion: ReduceMotion.System,
  },
  spring: {
    /** Szybkie elementy przestrzenne: wskaźniki zakładek, chipy, przełączniki, obrót ikon. */
    spatialFast: {
      damping: 20,
      stiffness: 520,
      mass: 0.8,
      reduceMotion: ReduceMotion.System,
    },
    /** Standardowe kontenery: arkusze, dialogi, rozwijane panele. */
    spatialDefault: {
      damping: 22,
      stiffness: 320,
      mass: 0.9,
      reduceMotion: ReduceMotion.System,
    },
    /** Większe przesunięcia i powroty gestów z miękkim wygaszeniem. */
    spatialSlow: {
      damping: 26,
      stiffness: 220,
      mass: 1,
      reduceMotion: ReduceMotion.System,
    },
    /** Szybkie efekty bez odbicia: przezroczystość, kolory, drobne stany. */
    effectsFast: {
      damping: 26,
      stiffness: 460,
      mass: 0.8,
      overshootClamping: true,
      reduceMotion: ReduceMotion.System,
    },
    /** Spokojne efekty bez odbicia: tła i scrimy. */
    effectsDefault: {
      damping: 28,
      stiffness: 320,
      mass: 0.9,
      overshootClamping: true,
      reduceMotion: ReduceMotion.System,
    },
    /** Sprężysty nacisk przycisków i kart. */
    press: {
      damping: 22,
      stiffness: 460,
      mass: 0.75,
      reduceMotion: ReduceMotion.System,
    },
  },
  /** Konfiguracja sprężyny dla arkuszy @gorhom/bottom-sheet. */
  sheet: {
    damping: 26,
    stiffness: 340,
    mass: 0.85,
    overshootClamping: false,
    restDisplacementThreshold: 0.5,
    restSpeedThreshold: 0.5,
  },
} as const;
