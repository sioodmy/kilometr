import { memo, useEffect, useRef } from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  interpolate,
  useAnimatedProps,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import Svg, {
  Circle,
  G,
  Path,
  Rect,
  type CircleProps,
  type PathProps,
} from 'react-native-svg';
import { motion } from '../theme/motion';
import { scheme } from '../theme/tokens';
import {
  MORPH_ACTIVE_FRACTION,
  TRANSIT_SHAPES,
  expressiveMorphEase,
  initialTransitPath,
  interpolateTransitPath,
  type TransitShapeIndex,
} from './morphingShapes';

const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

type Point = readonly [number, number];

const SHIELD_POINTS = 28;
const SHIELD_CENTER = 60;
const SHIELD_RADIUS = 52;

/** Dokładne długości ścieżek z assets/logo.svg (viewBox 1024x1024) z zapasem pod round cap. */
const LOGO_TRACK_LEN = 620;
const LOGO_UP_LEN = 408;
const LOGO_DOWN_LEN = 452;

function closedPointsToCubicArray(pts: readonly Point[]): readonly number[] {
  const n = pts.length;
  const out: number[] = [pts[0][0], pts[0][1]];
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const p3 = pts[(i + 2) % n];
    out.push(
      p1[0] + (p2[0] - p0[0]) / 6,
      p1[1] + (p2[1] - p0[1]) / 6,
      p2[0] - (p3[0] - p1[0]) / 6,
      p2[1] - (p3[1] - p1[1]) / 6,
      p2[0],
      p2[1],
    );
  }
  return out;
}

function buildShieldContour(radiusAt: (theta: number) => number): readonly number[] {
  const pts: Point[] = [];
  for (let i = 0; i < SHIELD_POINTS; i++) {
    const theta = -Math.PI / 2 + (Math.PI * 2 * i) / SHIELD_POINTS;
    const r = radiusAt(theta);
    pts.push([SHIELD_CENTER + Math.cos(theta) * r, SHIELD_CENTER + Math.sin(theta) * r]);
  }
  return closedPointsToCubicArray(pts);
}

function superellipseRadius(theta: number, r: number, power: number, rotRad = 0): number {
  const a = theta - rotRad;
  const c = Math.abs(Math.cos(a));
  const s = Math.abs(Math.sin(a));
  return r / Math.pow(Math.pow(c, power) + Math.pow(s, power), 1 / power);
}

/**
 * Cztery tarcze transportowe M3 Expressive (120x120):
 * 0: squircle loga aplikacji (rx ≈ 232/1024)
 * 1: okrągły znak przystanku D-15 (Miasto)
 * 2: zaokrąglony romb kompasu (Dostęp)
 * 3: tarcza kierunkowa pod pinezkę (Miejsca)
 */
const SHIELD_SHAPES: readonly (readonly number[])[] = [
  buildShieldContour((t) => superellipseRadius(t, SHIELD_RADIUS, 4.3, 0)),
  buildShieldContour(() => SHIELD_RADIUS),
  buildShieldContour((t) => superellipseRadius(t, SHIELD_RADIUS * 1.01, 2.55, Math.PI / 4)),
  buildShieldContour((t) => {
    const base = superellipseRadius(t, SHIELD_RADIUS * 0.96, 2.8, 0);
    const bottomPull = Math.max(0, Math.sin(t)) * 5.2;
    const waistNarrow = Math.max(0, Math.sin(t)) * Math.abs(Math.cos(t)) * 5.8;
    return base + bottomPull - waistNarrow;
  }),
];

function interpolateShieldPath(from: readonly number[], to: readonly number[], t: number): string {
  'worklet';
  const x0 = Math.round((from[0] + (to[0] - from[0]) * t) * 10) / 10;
  const y0 = Math.round((from[1] + (to[1] - from[1]) * t) * 10) / 10;
  let d = `M${x0} ${y0}`;
  const len = from.length;
  for (let i = 2; i < len; i += 6) {
    const c1x = Math.round((from[i] + (to[i] - from[i]) * t) * 10) / 10;
    const c1y = Math.round((from[i + 1] + (to[i + 1] - from[i + 1]) * t) * 10) / 10;
    const c2x = Math.round((from[i + 2] + (to[i + 2] - from[i + 2]) * t) * 10) / 10;
    const c2y = Math.round((from[i + 3] + (to[i + 3] - from[i + 3]) * t) * 10) / 10;
    const ex = Math.round((from[i + 4] + (to[i + 4] - from[i + 4]) * t) * 10) / 10;
    const ey = Math.round((from[i + 5] + (to[i + 5] - from[i + 5]) * t) * 10) / 10;
    d += `C${c1x} ${c1y} ${c2x} ${c2y} ${ex} ${ey}`;
  }
  return `${d}Z`;
}

function initialShieldPath(index: number): string {
  const safe = SHIELD_SHAPES[index] ?? SHIELD_SHAPES[0];
  return interpolateShieldPath(safe, safe, 0);
}

/** Docelowa sylwetka piktogramu dla kroków 1..3: 1 tramwaj, 2 pociąg, 3 pinezka. */
const STEP_TARGET_SHAPE: readonly TransitShapeIndex[] = [0, 0, 2, 3];

export const HERO_LOGO_SIZE = 128;
const COMPACT_SCALE = 0.485;
const ORBIT_DURATION_MS = 6400;

function directAccessoryPresence(
  fromIdx: number,
  toIdx: number,
  blend: number,
  targetIndex: number,
): number {
  'worklet';
  if (fromIdx === targetIndex && toIdx === targetIndex) return 1;
  if (fromIdx === targetIndex) return Math.max(0, 1 - blend * 2.1);
  if (toIdx === targetIndex) return Math.max(0, Math.min(1, (blend - 0.4) * 2.0));
  return 0;
}

interface OnboardingMorphHeroProps {
  /** Aktualny krok onboardingu (0 = Logo Witaj, 1 = Miasto, 2 = Dostęp, 3 = Miejsca). */
  step: 0 | 1 | 2 | 3;
  /** Szerokość kontenera roboczego (px). */
  workspaceWidth: number;
  /** Dokładny środek Y slotu na logo na kroku powitalnym (px od góry kontenera roboczego). */
  welcomeCenterY: number;
  /** Wysokość kompaktowego nagłówka na krokach 1..3 (px). */
  compactHeaderHeight: number;
  /** Impuls po akcji (wybór miasta, włączenie zgody, zapisanie miejsca). */
  pulseKey: number;
}

/**
 * Wspólna animacja marki i morfingu onboardingu:
 * na kroku powitalnym rysuje logo Kilometra jak linię na mapie (tory, zwrotnice, węzeł,
 * strzałka i przystanek, dokładnie jak w outro filmu), a po kliknięciu dalej sprężyście
 * przelatuje do nagłówka i morfuje z tarczy loga w Tramwaj, Pociąg i Pinezkę celu.
 */
export const OnboardingMorphHero = memo(function OnboardingMorphHero({
  step,
  workspaceWidth,
  welcomeCenterY,
  compactHeaderHeight,
  pulseKey,
}: OnboardingMorphHeroProps) {
  const reduceMotion = useReducedMotion();

  // 1 = pełne wycentrowane logo (krok 0), 0 = kompaktowy medalion w nagłówku (kroki 1..3).
  const expand = useSharedValue(step === 0 ? 1 : 0);

  // Sekwencja rysowania loga z outro (tor główny -> zwrotnica góra -> zwrotnica dół -> węzeł -> strzałka -> przystanek).
  const bgIntro = useSharedValue(reduceMotion ? 1 : 0);
  const trackDraw = useSharedValue(reduceMotion ? 1 : 0);
  const upDraw = useSharedValue(reduceMotion ? 1 : 0);
  const downDraw = useSharedValue(reduceMotion ? 1 : 0);
  const nodePop = useSharedValue(reduceMotion ? 1 : 0);
  const arrowPop = useSharedValue(reduceMotion ? 1 : 0);
  const stopPop = useSharedValue(reduceMotion ? 1 : 0);

  // Morph tarczy zewnętrznej i sylwetki pojazdu między krokami.
  const shieldFrom = useSharedValue<number>(step);
  const shieldTo = useSharedValue<number>(step);
  const shieldBlend = useSharedValue(1);
  const shieldAngle = useSharedValue(0);

  const directFrom = useSharedValue<number>(STEP_TARGET_SHAPE[step]);
  const directTo = useSharedValue<number>(STEP_TARGET_SHAPE[step]);
  const directBlend = useSharedValue(1);

  const orbitAngle = useSharedValue(0);
  const pulse = useSharedValue(0);

  const prevStepRef = useRef<0 | 1 | 2 | 3>(step);
  const prevPulseRef = useRef(pulseKey);

  // Ciągły subtelny pierścień trasy widoczny na krokach 1..3.
  useEffect(() => {
    if (reduceMotion) {
      cancelAnimation(orbitAngle);
      orbitAngle.value = 0;
      return;
    }
    orbitAngle.value = 0;
    orbitAngle.value = withRepeat(
      withTiming(360, { duration: ORBIT_DURATION_MS, easing: Easing.linear }),
      -1,
      false,
    );
    return () => {
      cancelAnimation(orbitAngle);
    };
  }, [orbitAngle, reduceMotion]);

  // Animacja rysowania loga przy wejściu na krok 0 (jak plansza końcowa w video/src/scenes.ts).
  useEffect(() => {
    if (step !== 0) return;
    if (reduceMotion) {
      bgIntro.value = 1;
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

    bgIntro.value = 0.68;
    trackDraw.value = 0;
    upDraw.value = 0;
    downDraw.value = 0;
    nodePop.value = 0;
    arrowPop.value = 0;
    stopPop.value = 0;

    bgIntro.value = withSpring(1, motion.spring.spatialDefault);
    trackDraw.value = withDelay(140, withTiming(1, { duration: 420, easing: easeInOutCubic }));
    upDraw.value = withDelay(300, withTiming(1, { duration: 380, easing: easeInOutCubic }));
    downDraw.value = withDelay(440, withTiming(1, { duration: 380, easing: easeInOutCubic }));
    nodePop.value = withDelay(260, withSpring(1, motion.spring.spatialFast));
    arrowPop.value = withDelay(560, withTiming(1, { duration: 240, easing: easeOutCubic }));
    stopPop.value = withDelay(680, withSpring(1, motion.spring.spatialFast));
  }, [arrowPop, bgIntro, downDraw, nodePop, reduceMotion, step, stopPop, trackDraw, upDraw]);

  // Przejście między krokami: lot medalionu + morph tarczy + morph pojazdu.
  useEffect(() => {
    const prev = prevStepRef.current;
    prevStepRef.current = step;
    const targetShape = STEP_TARGET_SHAPE[step];

    if (reduceMotion) {
      expand.value = step === 0 ? 1 : 0;
      shieldFrom.value = step;
      shieldTo.value = step;
      shieldBlend.value = 1;
      shieldAngle.value = 0;
      directFrom.value = targetShape;
      directTo.value = targetShape;
      directBlend.value = 1;
      return;
    }

    expand.value = withSpring(step === 0 ? 1 : 0, motion.spring.spatialDefault);

    if (prev !== step) {
      shieldFrom.value = prev;
      shieldTo.value = step;
      shieldBlend.value = 0;
      shieldBlend.value = withSpring(1, motion.spring.spatialDefault);
      shieldAngle.value = withSequence(
        withTiming(step > prev ? 12 : -12, { duration: 150, easing: Easing.out(Easing.quad) }),
        withSpring(0, motion.spring.spatialDefault),
      );
    }

    if (step === 0) return;

    const fromShape = prev === 0 ? targetShape : STEP_TARGET_SHAPE[prev];
    directFrom.value = fromShape;
    directTo.value = targetShape;
    if (fromShape === targetShape) {
      directBlend.value = 1;
    } else {
      directBlend.value = 0;
      directBlend.value = withTiming(1, { duration: 520, easing: Easing.out(Easing.cubic) });
    }
  }, [
    directBlend,
    directFrom,
    directTo,
    expand,
    reduceMotion,
    shieldAngle,
    shieldBlend,
    shieldFrom,
    shieldTo,
    step,
  ]);

  useEffect(() => {
    if (pulseKey === prevPulseRef.current) return;
    prevPulseRef.current = pulseKey;
    if (reduceMotion) return;
    pulse.value = withSequence(
      withTiming(1, { duration: 120, easing: Easing.out(Easing.quad) }),
      withSpring(0, motion.spring.spatialFast),
    );
  }, [pulse, pulseKey, reduceMotion]);

  const staticShield = initialShieldPath(step);
  const staticBody = initialTransitPath(STEP_TARGET_SHAPE[step]);

  // Lot ze środka kroku powitalnego do prawego narożnika nagłówka kroków 1..3.
  const medalFlightStyle = useAnimatedStyle(() => {
    const half = HERO_LOGO_SIZE / 2;
    const compactRadius = (HERO_LOGO_SIZE * COMPACT_SCALE) / 2;
    const expandedCx = workspaceWidth / 2;
    const expandedCy = welcomeCenterY;
    const compactCx = Math.max(compactRadius + 24, workspaceWidth - 24 - compactRadius);
    const compactCy = Math.max(compactRadius + 4, compactHeaderHeight / 2);

    const cx = interpolate(expand.value, [0, 1], [compactCx, expandedCx]);
    const cy = interpolate(expand.value, [0, 1], [compactCy, expandedCy]);
    const baseScale = interpolate(expand.value, [0, 1], [COMPACT_SCALE, 1]);
    const introScale = interpolate(expand.value, [0, 1], [1, bgIntro.value]);
    const pulseBoost = 1 + pulse.value * 0.11;

    return {
      transform: [
        { translateX: cx - half },
        { translateY: cy - half },
        { scale: baseScale * introScale * pulseBoost },
      ],
    };
  });

  const shieldTiltStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${shieldAngle.value}deg` }],
  }));

  const shieldAnimatedProps = useAnimatedProps<PathProps>(() => {
    const rawT = shieldBlend.value;
    const from = SHIELD_SHAPES[shieldFrom.value] ?? SHIELD_SHAPES[0];
    const to = SHIELD_SHAPES[shieldTo.value] ?? SHIELD_SHAPES[0];
    const d = Number.isFinite(rawT) ? interpolateShieldPath(from, to, rawT) : staticShield;
    return { d };
  });

  // Osobna warstwa z opacity zamiast interpolateColor w SVG fill, bo na Webie
  // animowany atrybut fill nie zawsze aktualizuje DOM po przejściu z kroku 0.
  const shieldPrimaryOverlayStyle = useAnimatedStyle(() => ({
    opacity: interpolate(expand.value, [0.15, 0.85], [0, 1], 'clamp'),
  }));

  const shieldContainerStrokeStyle = useAnimatedStyle(() => ({
    opacity: interpolate(expand.value, [0, 0.75], [1, 0], 'clamp'),
  }));

  // Warstwa loga (widoczna na kroku 0, płynnie zwija się podczas morfingu w krok 1).
  const logoLayerStyle = useAnimatedStyle(() => {
    const k = interpolate(expand.value, [0.35, 0.92], [0, 1], 'clamp');
    return {
      opacity: k,
      transform: [{ scale: 0.72 + k * 0.28 }, { rotate: `${(1 - k) * -18}deg` }],
    };
  });

  const trackProps = useAnimatedProps<PathProps>(() => {
    const k = trackDraw.value;
    return {
      strokeDashoffset: LOGO_TRACK_LEN * (1 - k),
      strokeOpacity: k > 0.01 ? 1 : 0,
    };
  });

  const upProps = useAnimatedProps<PathProps>(() => {
    const k = upDraw.value;
    return {
      strokeDashoffset: LOGO_UP_LEN * (1 - k),
      strokeOpacity: k > 0.01 ? 1 : 0,
    };
  });

  const downProps = useAnimatedProps<PathProps>(() => {
    const k = downDraw.value;
    return {
      strokeDashoffset: LOGO_DOWN_LEN * (1 - k),
      strokeOpacity: k > 0.01 ? 1 : 0,
    };
  });

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

  // Warstwa morfującego pojazdu (wyłania się płynnie z loga po przejściu do kroku 1..3).
  const vehicleLayerStyle = useAnimatedStyle(() => {
    const k = interpolate(expand.value, [0.05, 0.62], [1, 0], 'clamp');
    const b = directBlend.value;
    const hop = b < 1 ? Math.sin(b * Math.PI) * 3.5 : 0;
    return {
      opacity: k,
      transform: [
        { scale: 0.74 + k * 0.26 },
        { translateY: -hop },
      ],
    };
  });

  const vehicleAnimatedProps = useAnimatedProps<PathProps>(() => {
    const rawT = directBlend.value;
    if (!Number.isFinite(rawT)) return { d: staticBody };
    const from = TRANSIT_SHAPES[directFrom.value] ?? TRANSIT_SHAPES[0];
    const to = TRANSIT_SHAPES[directTo.value] ?? TRANSIT_SHAPES[0];
    const eased = expressiveMorphEase(rawT * MORPH_ACTIVE_FRACTION);
    return {
      d: interpolateTransitPath(from, to, eased),
    };
  });

  const tramAccStyle = useAnimatedStyle(() => {
    const p = directAccessoryPresence(directFrom.value, directTo.value, directBlend.value, 0);
    return { opacity: p, transform: [{ scale: 0.9 + p * 0.1 }] };
  });

  const busAccStyle = useAnimatedStyle(() => {
    const p = directAccessoryPresence(directFrom.value, directTo.value, directBlend.value, 1);
    return { opacity: p, transform: [{ scale: 0.9 + p * 0.1 }] };
  });

  const trainAccStyle = useAnimatedStyle(() => {
    const p = directAccessoryPresence(directFrom.value, directTo.value, directBlend.value, 2);
    return { opacity: p, transform: [{ scale: 0.9 + p * 0.1 }] };
  });

  const pinAccStyle = useAnimatedStyle(() => {
    const p = directAccessoryPresence(directFrom.value, directTo.value, directBlend.value, 3);
    return { opacity: p * 0.78, transform: [{ scale: 0.9 + p * 0.1 }] };
  });

  // Zewnętrzny pierścień trasy widoczny tylko w trybie kompaktowym (kroki 1..3),
  // żeby logo na kroku powitalnym było czyste jak w outro filmu.
  const compactOrbitStyle = useAnimatedStyle(() => {
    const vis = interpolate(expand.value, [0, 0.5], [1, 0], 'clamp');
    const angle = Number.isFinite(orbitAngle.value) ? orbitAngle.value : 0;
    return {
      opacity: vis,
      transform: [{ rotate: `${angle}deg` }],
    };
  });

  const pulseRingStyle = useAnimatedStyle(() => ({
    opacity: pulse.value * 0.65,
    transform: [{ scale: 1 + pulse.value * 0.24 }],
  }));

  const glyphSize = 70;
  const ringR = HERO_LOGO_SIZE / 2 - 2;
  const ringCirc = 2 * Math.PI * ringR;

  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.medalWrap, medalFlightStyle]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {!reduceMotion && <Animated.View style={[styles.pulseHalo, pulseRingStyle]} />}

      {/* Subtelny pierścień trasy na krokach 1..3 */}
      <Animated.View style={[StyleSheet.absoluteFill, compactOrbitStyle]}>
        <Svg width={HERO_LOGO_SIZE} height={HERO_LOGO_SIZE}>
          <Circle
            cx={HERO_LOGO_SIZE / 2}
            cy={HERO_LOGO_SIZE / 2}
            r={ringR}
            fill="none"
            stroke={scheme.primary}
            strokeOpacity={0.22}
            strokeWidth={2}
          />
          <Circle
            cx={HERO_LOGO_SIZE / 2}
            cy={HERO_LOGO_SIZE / 2}
            r={ringR}
            fill="none"
            stroke={scheme.primary}
            strokeOpacity={0.92}
            strokeWidth={3}
            strokeLinecap="round"
            strokeDasharray={`${ringCirc * 0.24} ${ringCirc * 0.76}`}
          />
        </Svg>
      </Animated.View>

      {/* Morfująca tarcza tła: ciemny kontener pod piktogramy (kroki 1..3) + nakładka loga (krok 0) */}
      <Animated.View style={[styles.shieldLayer, shieldTiltStyle]}>
        <Animated.View style={shieldContainerStrokeStyle}>
          <Svg width={HERO_LOGO_SIZE - 8} height={HERO_LOGO_SIZE - 8} viewBox="0 0 120 120">
            <AnimatedPath
              d={staticShield}
              animatedProps={reduceMotion ? undefined : shieldAnimatedProps}
              fill={scheme.primaryContainer}
              stroke={scheme.primary}
              strokeOpacity={0.34}
              strokeWidth={1.6}
            />
          </Svg>
        </Animated.View>
        <Animated.View style={[StyleSheet.absoluteFill, shieldPrimaryOverlayStyle]}>
          <Svg width={HERO_LOGO_SIZE - 8} height={HERO_LOGO_SIZE - 8} viewBox="0 0 120 120">
            <AnimatedPath
              d={staticShield}
              animatedProps={reduceMotion ? undefined : shieldAnimatedProps}
              fill={scheme.primary}
            />
          </Svg>
        </Animated.View>
      </Animated.View>

      {/* Logo aplikacji Kilometr (szyny, zwrotnica, węzeł, strzałka, przystanek) */}
      <Animated.View style={[styles.logoLayer, logoLayerStyle]}>
        <Svg width={HERO_LOGO_SIZE - 16} height={HERO_LOGO_SIZE - 16} viewBox="0 0 1024 1024">
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

      {/* Morfujący piktogram transportowy kroków 1..3 (Tramwaj -> Pociąg -> Pinezka) */}
      <Animated.View
        style={[
          styles.glyphStage,
          { width: glyphSize, height: glyphSize },
          vehicleLayerStyle,
        ]}
      >
        <Svg width={glyphSize} height={glyphSize} viewBox="0 0 100 100">
          <AnimatedPath
            d={staticBody}
            animatedProps={reduceMotion ? undefined : vehicleAnimatedProps}
            fill={scheme.onPrimaryContainer}
            fillRule="evenodd"
          />
        </Svg>

        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            reduceMotion ? { opacity: STEP_TARGET_SHAPE[step] === 0 ? 1 : 0 } : tramAccStyle,
          ]}
        >
          <Svg width={glyphSize} height={glyphSize} viewBox="0 0 100 100">
            <Path
              d="M36 11H64M42 21L50 11.5L58 21M38 80L33 89M62 80L67 89"
              fill="none"
              stroke={scheme.onPrimaryContainer}
              strokeWidth={5.2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </Svg>
        </Animated.View>

        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            reduceMotion ? { opacity: STEP_TARGET_SHAPE[step] === 1 ? 1 : 0 } : busAccStyle,
          ]}
        >
          <Svg width={glyphSize} height={glyphSize} viewBox="0 0 100 100">
            <Rect x={23} y={74} width={11} height={12} rx={4.5} fill={scheme.onPrimaryContainer} />
            <Rect x={66} y={74} width={11} height={12} rx={4.5} fill={scheme.onPrimaryContainer} />
            <Path
              d="M13 35V46M87 35V46"
              fill="none"
              stroke={scheme.onPrimaryContainer}
              strokeWidth={5.2}
              strokeLinecap="round"
            />
          </Svg>
        </Animated.View>

        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            reduceMotion ? { opacity: STEP_TARGET_SHAPE[step] === 2 ? 1 : 0 } : trainAccStyle,
          ]}
        >
          <Svg width={glyphSize} height={glyphSize} viewBox="0 0 100 100">
            <Path
              d="M37 79L29 90M63 79L71 90M31 85.5H69"
              fill="none"
              stroke={scheme.onPrimaryContainer}
              strokeWidth={5.2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </Svg>
        </Animated.View>

        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            reduceMotion ? { opacity: STEP_TARGET_SHAPE[step] === 3 ? 0.78 : 0 } : pinAccStyle,
          ]}
        >
          <Svg width={glyphSize} height={glyphSize} viewBox="0 0 100 100">
            <Path
              d="M34 91.5Q50 96 66 91.5"
              fill="none"
              stroke={scheme.onPrimaryContainer}
              strokeWidth={4.6}
              strokeLinecap="round"
            />
          </Svg>
        </Animated.View>
      </Animated.View>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  medalWrap: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: HERO_LOGO_SIZE,
    height: HERO_LOGO_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pulseHalo: {
    position: 'absolute',
    width: HERO_LOGO_SIZE,
    height: HERO_LOGO_SIZE,
    borderRadius: HERO_LOGO_SIZE / 2,
    borderWidth: 2.5,
    borderColor: scheme.primary,
  },
  shieldLayer: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoLayer: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  glyphStage: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
