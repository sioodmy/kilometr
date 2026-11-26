import { memo, useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedProps,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, G, Path, type CircleProps, type PathProps } from 'react-native-svg';
import { motion } from '../theme/motion';
import { scheme } from '../theme/tokens';

const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

/** Dokładne długości ścieżek z assets/logo.svg (viewBox 1024x1024) z zapasem pod round cap. */
const LOGO_TRACK_LEN = 620;
const LOGO_UP_LEN = 408;
const LOGO_DOWN_LEN = 452;

const HERO_LOGO_SIZE = 104;

/** Animowane logo Kilometra rysowane na ekranie powitalnym (tor, zwrotnice, węzeł i przystanek). */
export const OnboardingMorphHero = memo(function OnboardingMorphHero() {
  const reduceMotion = useReducedMotion();

  const cardScale = useSharedValue(reduceMotion ? 1 : 0.84);
  const trackDraw = useSharedValue(reduceMotion ? 1 : 0);
  const upDraw = useSharedValue(reduceMotion ? 1 : 0);
  const downDraw = useSharedValue(reduceMotion ? 1 : 0);
  const nodePop = useSharedValue(reduceMotion ? 1 : 0);
  const arrowPop = useSharedValue(reduceMotion ? 1 : 0);
  const stopPop = useSharedValue(reduceMotion ? 1 : 0);

  useEffect(() => {
    if (reduceMotion) {
      cardScale.value = 1;
      trackDraw.value = 1;
      upDraw.value = 1;
      downDraw.value = 1;
      nodePop.value = 1;
      arrowPop.value = 1;
      stopPop.value = 1;
      return;
    }

    const easeInOutCubic = Easing.inOut(Easing.cubic);
    const easeOutCubic = Easing.out(Easing.cubic);

    cardScale.value = withSpring(1, motion.spring.spatialDefault);
    trackDraw.value = withDelay(100, withTiming(1, { duration: 380, easing: easeInOutCubic }));
    upDraw.value = withDelay(240, withTiming(1, { duration: 340, easing: easeInOutCubic }));
    downDraw.value = withDelay(360, withTiming(1, { duration: 340, easing: easeInOutCubic }));
    nodePop.value = withDelay(220, withSpring(1, motion.spring.spatialFast));
    arrowPop.value = withDelay(480, withTiming(1, { duration: 220, easing: easeOutCubic }));
    stopPop.value = withDelay(580, withSpring(1, motion.spring.spatialFast));
  }, [arrowPop, cardScale, downDraw, nodePop, reduceMotion, stopPop, trackDraw, upDraw]);

  const cardAnimStyle = useAnimatedStyle(() => ({
    transform: [{ scale: cardScale.value }],
  }));

  const trackProps = useAnimatedProps<PathProps>(() => ({
    strokeDashoffset: LOGO_TRACK_LEN * (1 - trackDraw.value),
    strokeOpacity: trackDraw.value > 0.01 ? 1 : 0,
  }));

  const upProps = useAnimatedProps<PathProps>(() => ({
    strokeDashoffset: LOGO_UP_LEN * (1 - upDraw.value),
    strokeOpacity: upDraw.value > 0.01 ? 1 : 0,
  }));

  const downProps = useAnimatedProps<PathProps>(() => ({
    strokeDashoffset: LOGO_DOWN_LEN * (1 - downDraw.value),
    strokeOpacity: downDraw.value > 0.01 ? 1 : 0,
  }));

  const nodeOuterProps = useAnimatedProps<CircleProps>(() => ({
    r: 102 * Math.max(0, nodePop.value),
  }));

  const nodeInnerProps = useAnimatedProps<CircleProps>(() => ({
    r: 50 * Math.max(0, nodePop.value),
  }));

  const stopProps = useAnimatedProps<CircleProps>(() => ({
    r: 32 * Math.max(0, stopPop.value),
  }));

  const arrowProps = useAnimatedProps<PathProps>(() => ({
    fillOpacity: arrowPop.value,
    strokeOpacity: arrowPop.value,
  }));

  return (
    <View
      style={styles.halo}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Animated.View style={[styles.badge, cardAnimStyle]}>
        <Svg width={HERO_LOGO_SIZE - 14} height={HERO_LOGO_SIZE - 14} viewBox="0 0 1024 1024">
          <G transform="translate(512, 512) scale(0.84) translate(-512, -512)">
            <AnimatedPath
              d="M352 180 L352 794"
              fill="none"
              stroke={scheme.onPrimary}
              strokeWidth={80}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray={`${LOGO_TRACK_LEN} ${LOGO_TRACK_LEN}`}
              animatedProps={reduceMotion ? undefined : trackProps}
            />
            <AnimatedPath
              d="M352 512 C390 380 480 300 600 220"
              fill="none"
              stroke={scheme.onPrimary}
              strokeWidth={80}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray={`${LOGO_UP_LEN} ${LOGO_UP_LEN}`}
              animatedProps={reduceMotion ? undefined : upProps}
            />
            <AnimatedPath
              d="M352 512 C400 664 510 754 672 754"
              fill="none"
              stroke={scheme.onPrimary}
              strokeWidth={80}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray={`${LOGO_DOWN_LEN} ${LOGO_DOWN_LEN}`}
              animatedProps={reduceMotion ? undefined : downProps}
            />
            <G transform="translate(605, 215) rotate(-35)">
              <AnimatedPath
                d="M-18 -68 L96 0 L-18 68 L8 0 Z"
                fill={scheme.onPrimary}
                stroke={scheme.onPrimary}
                strokeWidth={40}
                strokeLinejoin="round"
                strokeLinecap="round"
                animatedProps={reduceMotion ? undefined : arrowProps}
              />
            </G>
            <AnimatedCircle
              cx={352}
              cy={512}
              r={102}
              fill={scheme.onPrimary}
              animatedProps={reduceMotion ? undefined : nodeOuterProps}
            />
            <AnimatedCircle
              cx={352}
              cy={512}
              r={50}
              fill={scheme.primary}
              animatedProps={reduceMotion ? undefined : nodeInnerProps}
            />
            <AnimatedCircle
              cx={672}
              cy={754}
              r={32}
              fill={scheme.onPrimary}
              animatedProps={reduceMotion ? undefined : stopProps}
            />
          </G>
        </Svg>
      </Animated.View>
    </View>
  );
});

const styles = StyleSheet.create({
  halo: {
    width: HERO_LOGO_SIZE + 28,
    height: HERO_LOGO_SIZE + 28,
    borderRadius: 36,
    backgroundColor: scheme.surfaceContainerLow,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: scheme.outlineVariant,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    width: HERO_LOGO_SIZE,
    height: HERO_LOGO_SIZE,
    borderRadius: 28,
    backgroundColor: scheme.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
