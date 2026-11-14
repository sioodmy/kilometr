// react-native-reanimated dla zrzutów: każda animacja od razu kończy się w stanie
// docelowym, więc ekran wygląda jak w aplikacji po wejściu na niego.
import { useReducer, useRef, type Ref } from 'react';
import { FlatList, Image, ScrollView, Text, View, type FlatListProps } from 'react-native';

export interface SharedValue<T> {
  value: T;
}

type Fn = (x: number) => number;
const identity: Fn = (x) => x;
const chain: object = new Proxy({}, { get: () => () => chain });

export const Easing = {
  linear: identity,
  ease: identity,
  quad: identity,
  cubic: identity,
  sin: identity,
  exp: identity,
  circle: identity,
  bezier: () => identity,
  bezierFn: () => identity,
  in: (f: Fn) => f,
  out: (f: Fn) => f,
  inOut: (f: Fn) => f,
};
export const ReduceMotion = { System: 'system', Always: 'always', Never: 'never' };
export const FadeIn = chain;
export const FadeInDown = chain;
export const FadeOut = chain;
export const FadeOutUp = chain;
export const LinearTransition = chain;

/** Zmiana wartości (np. `opacity.value = withTiming(1)` w efekcie) przerysowuje komponent. */
export function useSharedValue<T>(initial: T): SharedValue<T> {
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const ref = useRef<SharedValue<T> | null>(null);
  if (!ref.current) {
    let current = initial;
    ref.current = {
      get value() {
        return current;
      },
      set value(next: T) {
        if (Object.is(next, current)) return;
        current = next;
        rerender();
      },
    };
  }
  return ref.current;
}
export const useAnimatedStyle = <T,>(fn: () => T) => fn();
export const useDerivedValue = <T,>(fn: () => T): SharedValue<T> => ({ value: fn() });
export const useAnimatedReaction = () => {};
export const useReducedMotion = () => true;
export const withTiming = <T,>(to: T) => to;
export const withSpring = <T,>(to: T) => to;
export const withDelay = <T,>(_ms: number, to: T) => to;
export const withRepeat = <T,>(to: T) => to;
export const withSequence = <T,>(...steps: T[]) => steps[steps.length - 1];
export const cancelAnimation = () => {};
export const runOnJS =
  <A extends unknown[], R>(fn: (...args: A) => R) =>
  (...args: A) =>
    fn(...args);

export function interpolate(x: number, input: number[], output: number[]): number {
  if (x <= input[0]) return output[0];
  for (let i = 1; i < input.length; i++) {
    if (x <= input[i]) return output[i - 1] + ((x - input[i - 1]) / (input[i] - input[i - 1])) * (output[i] - output[i - 1]);
  }
  return output[output.length - 1];
}
export function interpolateColor(x: number, input: number[], output: string[]): string {
  let best = 0;
  input.forEach((v, i) => {
    if (Math.abs(v - x) < Math.abs(input[best] - x)) best = i;
  });
  return output[best];
}

/**
 * Na webie `maintainVisibleContentPosition` czeka na scroll, którego nikt nie
 * wyśle, więc lista zostawała bez komórek. Zrzut nie przewija, kotwica zbędna.
 */
function AnimatedFlatList<T>(props: FlatListProps<T> & { ref?: Ref<FlatList<T>> }) {
  return <FlatList {...props} maintainVisibleContentPosition={undefined} />;
}

const Animated = {
  View,
  Text,
  ScrollView,
  Image,
  FlatList: AnimatedFlatList,
  createAnimatedComponent: <C,>(c: C) => c,
};
export default Animated;
