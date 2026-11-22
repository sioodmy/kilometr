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
import Svg, { Path, type PathProps } from 'react-native-svg';
import { scheme, shape } from '../theme/tokens';
import {
  INITIAL_SHAPE_PATH,
  MORPH_SHAPES,
  MORPH_STEP_MS,
  SHAPE_COUNT,
  expressiveMorphEase,
  interpolateShapePath,
} from './morphingShapes';

const AnimatedPath = Animated.createAnimatedComponent(Path);

export interface MorphingLoaderProps {
  /** Rozmiar samego kształtu w px (kontener dla wariantu contained jest odpowiednio większy). */
  size?: number;
  /** Kolor wypełnienia kształtu; domyślnie primary albo onPrimaryContainer dla wariantu contained. */
  color?: string;
  /** Wariant bare ('default') do przycisków/chipów lub tonalna kapsuła ('contained') do sekcji. */
  variant?: 'default' | 'contained';
  /** Kolor tła okrągłego kontenera w wariancie contained. */
  containerColor?: string;
  /** Opcjonalna etykieta dostępności dla czytników ekranu. */
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * Wskaźnik ładowania w stylu Material 3 Expressive: kształt płynnie morfuje
 * między sześcioma figurami i obraca się z impulsem sprężyny w całości na wątku UI,
 * więc nie zacina się nawet podczas ciężkiego liczenia trasy na wątku JS.
 */
export const MorphingLoader = memo(function MorphingLoader({
  size = 32,
  color,
  variant = 'default',
  containerColor,
  accessibilityLabel,
  style,
}: MorphingLoaderProps) {
  const reduceMotion = useReducedMotion();
  const progress = useSharedValue(0);

  useEffect(() => {
    if (reduceMotion) {
      cancelAnimation(progress);
      progress.value = 0;
      return;
    }
    progress.value = 0;
    progress.value = withRepeat(
      withTiming(SHAPE_COUNT, {
        duration: SHAPE_COUNT * MORPH_STEP_MS,
        easing: Easing.linear,
      }),
      -1,
      false,
    );
    return () => {
      cancelAnimation(progress);
    };
  }, [progress, reduceMotion]);

  const animatedProps = useAnimatedProps<PathProps>(() => {
    const raw = progress.value;
    const step = Math.floor(raw) % SHAPE_COUNT;
    const nextStep = (step + 1) % SHAPE_COUNT;
    const localT = raw - Math.floor(raw);
    const eased = expressiveMorphEase(localT);
    return {
      d: interpolateShapePath(MORPH_SHAPES[step], MORPH_SHAPES[nextStep], eased),
    };
  });

  // 6 kroków * (90° impulsu + 30° dryfu) = 720°, więc pętla zamyka się bez skoku kąta.
  const rotateStyle = useAnimatedStyle(() => {
    const raw = progress.value;
    const step = Math.floor(raw) % SHAPE_COUNT;
    const localT = raw - Math.floor(raw);
    const eased = expressiveMorphEase(localT);
    const deg = step * 90 + eased * 90 + raw * 30;
    return {
      transform: [{ rotate: `${deg}deg` }],
    };
  });

  const fillColor =
    color ?? (variant === 'contained' ? scheme.onPrimaryContainer : scheme.primary);

  const shapeEl = (
    <Animated.View style={[{ width: size, height: size }, !reduceMotion && rotateStyle]}>
      <Svg width={size} height={size} viewBox="0 0 100 100">
        <AnimatedPath
          d={INITIAL_SHAPE_PATH}
          animatedProps={reduceMotion ? undefined : animatedProps}
          fill={fillColor}
        />
      </Svg>
    </Animated.View>
  );

  if (variant === 'contained') {
    const containerSize = Math.round(size * 1.48);
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
        {shapeEl}
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
      {shapeEl}
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
  },
});
