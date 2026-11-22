import { memo, useEffect } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedProps,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Path, Rect, type PathProps } from 'react-native-svg';
import { scheme, shape } from '../theme/tokens';
import {
  MORPH_ACTIVE_FRACTION,
  MORPH_STEP_MS,
  SHAPE_COUNT,
  TRANSIT_SHAPES,
  expressiveMorphEase,
  initialTransitPath,
  interpolateTransitPath,
  type TransitShapeIndex,
} from './morphingShapes';

const AnimatedPath = Animated.createAnimatedComponent(Path);

const ORBIT_DURATION_MS = 1900;

/** Zwraca wagę widoczności [0..1] danej ikony akcesoriów dla bieżącej fazy morfingu. */
function shapePresence(rawProgress: number, targetIndex: number): number {
  'worklet';
  const step = Math.floor(rawProgress) % SHAPE_COUNT;
  const nextStep = (step + 1) % SHAPE_COUNT;
  const localT = rawProgress - Math.floor(rawProgress);
  const morph = localT >= MORPH_ACTIVE_FRACTION ? 1 : localT / MORPH_ACTIVE_FRACTION;
  if (step === targetIndex) {
    // Szybko wygasza stare akcesoria w pierwszej połowie przejścia.
    return Math.max(0, 1 - morph * 2.2);
  }
  if (nextStep === targetIndex) {
    // Wyłania nowe akcesoria w drugiej połowie przejścia, zanim sylwetka osiądzie.
    return Math.max(0, Math.min(1, (morph - 0.42) * 2.1));
  }
  return 0;
}

export interface MorphingLoaderProps {
  /** Rozmiar piktogramu w px (kontener dla wariantu contained jest odpowiednio większy). */
  size?: number;
  /** Kolor wypełnienia piktogramu; domyślnie primary albo onPrimaryContainer dla contained. */
  color?: string;
  /** Wariant bare ('default') do przycisków/chipów lub tonalna kapsuła ('contained') z pierścieniem trasy. */
  variant?: 'default' | 'contained';
  /** Kolor tła okrągłego kontenera w wariancie contained. */
  containerColor?: string;
  /** Początkowy kształt sekwencji (0 = tramwaj, 1 = autobus, 2 = pociąg, 3 = pinezka). */
  startIndex?: TransitShapeIndex;
  /** Opcjonalna etykieta dostępności dla czytników ekranu. */
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * Transportowy wskaźnik ładowania M3 Expressive: płynnie morfuje między
 * tramwajem, autobusem, pociągiem i pinezką celu na wątku UI (Reanimated 4),
 * dzięki czemu pozostaje płynny nawet podczas ciężkiego liczenia trasy RAPTOR.
 */
export const MorphingLoader = memo(function MorphingLoader({
  size = 32,
  color,
  variant = 'default',
  containerColor,
  startIndex = 0,
  accessibilityLabel,
  style,
}: MorphingLoaderProps) {
  const reduceMotion = useReducedMotion();
  const progress = useSharedValue<number>(startIndex);
  const orbit = useSharedValue(0);

  useEffect(() => {
    if (reduceMotion) {
      cancelAnimation(progress);
      cancelAnimation(orbit);
      progress.value = startIndex;
      orbit.value = 0;
      return;
    }
    progress.value = startIndex;
    progress.value = withRepeat(
      withTiming(startIndex + SHAPE_COUNT, {
        duration: SHAPE_COUNT * MORPH_STEP_MS,
        easing: Easing.linear,
      }),
      -1,
      false,
    );
    if (variant === 'contained') {
      orbit.value = 0;
      orbit.value = withRepeat(
        withTiming(360, {
          duration: ORBIT_DURATION_MS,
          easing: Easing.linear,
        }),
        -1,
        false,
      );
    }
    return () => {
      cancelAnimation(progress);
      cancelAnimation(orbit);
    };
  }, [orbit, progress, reduceMotion, startIndex, variant]);

  const bodyAnimatedProps = useAnimatedProps<PathProps>(() => {
    const raw = progress.value;
    const step = Math.floor(raw) % SHAPE_COUNT;
    const nextStep = (step + 1) % SHAPE_COUNT;
    const localT = raw - Math.floor(raw);
    const eased = expressiveMorphEase(localT);
    return {
      d: interpolateTransitPath(TRANSIT_SHAPES[step], TRANSIT_SHAPES[nextStep], eased),
    };
  });

  // Delikatny, sprężysty ruch squash-and-stretch i podskok przy każdej zamianie pojazdu.
  const bounceStyle = useAnimatedStyle(() => {
    const localT = progress.value - Math.floor(progress.value);
    if (localT >= MORPH_ACTIVE_FRACTION) {
      return {
        transform: [{ translateY: 0 }, { scaleX: 1 }, { scaleY: 1 }],
      };
    }
    const u = localT / MORPH_ACTIVE_FRACTION;
    const wave = Math.sin(u * Math.PI);
    const hop = -wave * (size * 0.055);
    const stretch = Math.sin(u * Math.PI * 2) * 0.045;
    return {
      transform: [
        { translateY: hop },
        { scaleX: 1 - stretch },
        { scaleY: 1 + stretch },
      ],
    };
  });

  const tramAccStyle = useAnimatedStyle(() => {
    const p = shapePresence(progress.value, 0);
    return {
      opacity: p,
      transform: [{ translateY: (1 - p) * (size * 0.06) }],
    };
  });

  const busAccStyle = useAnimatedStyle(() => {
    const p = shapePresence(progress.value, 1);
    return {
      opacity: p,
      transform: [{ scale: 0.88 + p * 0.12 }],
    };
  });

  const trainAccStyle = useAnimatedStyle(() => {
    const p = shapePresence(progress.value, 2);
    return {
      opacity: p,
      transform: [{ translateY: (1 - p) * -(size * 0.05) }],
    };
  });

  const pinAccStyle = useAnimatedStyle(() => {
    const p = shapePresence(progress.value, 3);
    return {
      opacity: p * 0.72,
      transform: [{ scaleX: 0.45 + p * 0.55 }],
    };
  });

  const orbitStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${orbit.value}deg` }],
  }));

  const fillColor =
    color ?? (variant === 'contained' ? scheme.onPrimaryContainer : scheme.primary);
  const staticPath = initialTransitPath(startIndex);

  const pictogram = (
    <Animated.View style={[styles.stage, { width: size, height: size }, !reduceMotion && bounceStyle]}>
      <Svg width={size} height={size} viewBox="0 0 100 100">
        <AnimatedPath
          d={staticPath}
          animatedProps={reduceMotion ? undefined : bodyAnimatedProps}
          fill={fillColor}
          fillRule="evenodd"
        />
      </Svg>

      {/* 0: Pantograf i szyny tramwajowe */}
      <Animated.View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          reduceMotion ? { opacity: startIndex === 0 ? 1 : 0 } : tramAccStyle,
        ]}
      >
        <Svg width={size} height={size} viewBox="0 0 100 100">
          <Path
            d="M36 11H64M42 21L50 11.5L58 21M38 80L33 89M62 80L67 89"
            fill="none"
            stroke={fillColor}
            strokeWidth={5.2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </Svg>
      </Animated.View>

      {/* 1: Koła i lusterka autobusu */}
      <Animated.View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          reduceMotion ? { opacity: startIndex === 1 ? 1 : 0 } : busAccStyle,
        ]}
      >
        <Svg width={size} height={size} viewBox="0 0 100 100">
          <Rect x={23} y={74} width={11} height={12} rx={4.5} fill={fillColor} />
          <Rect x={66} y={74} width={11} height={12} rx={4.5} fill={fillColor} />
          <Path
            d="M13 35V46M87 35V46"
            fill="none"
            stroke={fillColor}
            strokeWidth={5.2}
            strokeLinecap="round"
          />
        </Svg>
      </Animated.View>

      {/* 2: Tory kolejowe i podkład pod pociągiem */}
      <Animated.View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          reduceMotion ? { opacity: startIndex === 2 ? 1 : 0 } : trainAccStyle,
        ]}
      >
        <Svg width={size} height={size} viewBox="0 0 100 100">
          <Path
            d="M37 79L29 90M63 79L71 90M31 85.5H69"
            fill="none"
            stroke={fillColor}
            strokeWidth={5.2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </Svg>
      </Animated.View>

      {/* 3: Łuk przystanku pod grotem pinezki */}
      <Animated.View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          reduceMotion ? { opacity: startIndex === 3 ? 0.72 : 0 } : pinAccStyle,
        ]}
      >
        <Svg width={size} height={size} viewBox="0 0 100 100">
          <Path
            d="M34 91.5Q50 96 66 91.5"
            fill="none"
            stroke={fillColor}
            strokeWidth={4.6}
            strokeLinecap="round"
          />
        </Svg>
      </Animated.View>
    </Animated.View>
  );

  if (variant === 'contained') {
    const containerSize = Math.round(size * 1.52);
    const radius = containerSize / 2 - 2.5;
    const circumference = 2 * Math.PI * radius;
    const arcLength = circumference * 0.28;
    return (
      <View
        accessible={Boolean(accessibilityLabel)}
        accessibilityRole={accessibilityLabel ? 'progressbar' : undefined}
        accessibilityLabel={accessibilityLabel}
        style={[
          styles.contained,
          {
            width: containerSize,
            height: containerSize,
            borderRadius: shape.full,
            backgroundColor: containerColor ?? scheme.primaryContainer,
          },
          style,
        ]}
      >
        {!reduceMotion && (
          <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, orbitStyle]}>
            <Svg width={containerSize} height={containerSize}>
              <Circle
                cx={containerSize / 2}
                cy={containerSize / 2}
                r={radius}
                fill="none"
                stroke={scheme.primary}
                strokeOpacity={0.78}
                strokeWidth={2.5}
                strokeLinecap="round"
                strokeDasharray={`${arcLength} ${circumference - arcLength}`}
              />
            </Svg>
          </Animated.View>
        )}
        {pictogram}
      </View>
    );
  }

  return (
    <View
      accessible={Boolean(accessibilityLabel)}
      accessibilityRole={accessibilityLabel ? 'progressbar' : undefined}
      accessibilityLabel={accessibilityLabel}
      style={[styles.wrap, { width: size, height: size }, style]}
    >
      {pictogram}
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  contained: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  stage: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
