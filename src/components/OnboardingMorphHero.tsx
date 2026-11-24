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
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, G, Line, Path, Rect, type PathProps } from 'react-native-svg';
import { motion } from '../theme/motion';
import { scheme } from '../theme/tokens';
import {
  MORPH_ACTIVE_FRACTION,
  SHAPE_COUNT,
  TRANSIT_SHAPES,
  expressiveMorphEase,
  initialTransitPath,
  interpolateTransitPath,
  transitShapeStep,
  type TransitShapeIndex,
} from './morphingShapes';

const AnimatedPath = Animated.createAnimatedComponent(Path);

type Point = readonly [number, number];

const SHIELD_POINTS = 24;
const SHIELD_CENTER = 60;
const SHIELD_RADIUS = 50;

/** Zamienia zamkniętą pętlę punktów na płaską tablicę segmentów Catmull-Rom. */
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

/** Generuje tarczę M3 Expressive w układzie biegunowym z równą liczbą punktów do płynnego morfingu. */
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
 * 0: tablica linii (miękki squircle)
 * 1: znak przystanku D-15 (okrągły węzeł sieci)
 * 2: kompas nawigacyjny (zaokrąglony romb 45°)
 * 3: tarcza kierunkowa (lekko zwężona ku dołowi pod pinezkę)
 */
const SHIELD_SHAPES: readonly (readonly number[])[] = [
  buildShieldContour((t) => superellipseRadius(t, SHIELD_RADIUS, 3.1, 0)),
  buildShieldContour(() => SHIELD_RADIUS),
  buildShieldContour((t) => superellipseRadius(t, SHIELD_RADIUS * 1.02, 2.55, Math.PI / 4)),
  buildShieldContour((t) => {
    const base = superellipseRadius(t, SHIELD_RADIUS * 0.96, 2.8, 0);
    // Dolna część łagodnie schodzi w dół jak tarcza drogowskazu.
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

/** Docelowa sylwetka piktogramu dla każdego kroku: 0 pętla, 1 tramwaj, 2 pociąg, 3 pinezka. */
const STEP_TARGET_SHAPE: readonly TransitShapeIndex[] = [0, 0, 2, 3];

const HERO_MORPH_STEP_MS = 1250;
const ORBIT_PRIMARY_MS = 7200;
const ORBIT_TERTIARY_MS = 11800;

const HERO_MEDAL_SIZE = 128;
const HERO_EXPANDED_HEIGHT = 216;
const HERO_COMPACT_SCALE = 0.485;

function loopAccessoryPresence(rawProgress: number, targetIndex: number): number {
  'worklet';
  const step = transitShapeStep(rawProgress);
  const nextStep = (step + 1) % SHAPE_COUNT;
  const localT = rawProgress - Math.floor(rawProgress);
  const morph = localT >= MORPH_ACTIVE_FRACTION ? 1 : localT / MORPH_ACTIVE_FRACTION;
  if (step === targetIndex) return Math.max(0, 1 - morph * 2.2);
  if (nextStep === targetIndex) return Math.max(0, Math.min(1, (morph - 0.42) * 2.1));
  return 0;
}

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
  /** Aktualny krok onboardingu (0 = Witaj, 1 = Miasto, 2 = Dostęp, 3 = Miejsca). */
  step: 0 | 1 | 2 | 3;
  /** Szerokość sceny w px (używana do płynnego lotu medalionu między środkiem a prawym rogiem). */
  stageWidth: number;
  /** Zwiększ po ważnej akcji (wybór miasta, zgoda GPS, zapisane miejsce), by wywołać impuls. */
  pulseKey: number;
  /** Wysokość kompaktowego nagłówka na krokach 1..3. */
  compactHeight: number;
  /** Zawartość nagłówka kroków 1..3 (tytuł i podtytuł po lewej stronie). */
  headerContent?: React.ReactNode;
}

/**
 * Wspólna scena morphingowa onboardingu M3 Expressive:
 * na kroku powitalnym prezentuje pełną sieć transportową z płynącą pętlą
 * Tramwaj -> Autobus -> Pociąg -> Pinezka, a przy przejściu do kolejnych kroków
 * sprężyście przelatuje do narożnika nagłówka i morfuje tarczę oraz pojazd do kontekstu kroku.
 */
export const OnboardingMorphHero = memo(function OnboardingMorphHero({
  step,
  stageWidth,
  pulseKey,
  compactHeight,
  headerContent,
}: OnboardingMorphHeroProps) {
  const reduceMotion = useReducedMotion();

  // 1 = pełne hero (krok 0), 0 = kompaktowy medalion w nagłówku (kroki 1..3).
  const expand = useSharedValue(step === 0 ? 1 : 0);
  // 1 = tryb ciągłej pętli na kroku 0, 0 = bezpośredni morph docelowy na krokach 1..3.
  const isLoopMode = useSharedValue(step === 0 ? 1 : 0);
  const loopProgress = useSharedValue(0);
  const directFrom = useSharedValue<number>(0);
  const directTo = useSharedValue<number>(STEP_TARGET_SHAPE[step]);
  const directBlend = useSharedValue(1);

  const shieldFrom = useSharedValue<number>(step);
  const shieldTo = useSharedValue<number>(step);
  const shieldBlend = useSharedValue(1);
  const shieldAngle = useSharedValue(0);

  const orbitPrimary = useSharedValue(0);
  const orbitSecondary = useSharedValue(0);
  const trackWave = useSharedValue(0);
  const pulse = useSharedValue(0);

  const prevStepRef = useRef<0 | 1 | 2 | 3>(step);
  const prevPulseRef = useRef(pulseKey);

  // Ciągłe orbity tras i impuls sieci (wyłączone przy reduceMotion).
  useEffect(() => {
    if (reduceMotion) {
      cancelAnimation(orbitPrimary);
      cancelAnimation(orbitSecondary);
      cancelAnimation(trackWave);
      orbitPrimary.value = 0;
      orbitSecondary.value = 0;
      trackWave.value = 0;
      return;
    }
    orbitPrimary.value = 0;
    orbitPrimary.value = withRepeat(
      withTiming(360, { duration: ORBIT_PRIMARY_MS, easing: Easing.linear }),
      -1,
      false,
    );
    orbitSecondary.value = 0;
    orbitSecondary.value = withRepeat(
      withTiming(-360, { duration: ORBIT_TERTIARY_MS, easing: Easing.linear }),
      -1,
      false,
    );
    trackWave.value = 0;
    trackWave.value = withRepeat(
      withTiming(1, { duration: 2800, easing: Easing.inOut(Easing.cubic) }),
      -1,
      false,
    );
    return () => {
      cancelAnimation(orbitPrimary);
      cancelAnimation(orbitSecondary);
      cancelAnimation(trackWave);
    };
  }, [orbitPrimary, orbitSecondary, reduceMotion, trackWave]);

  // Obsługa zmiany kroku: lot medalionu + morph tarczy + morph sylwetki pojazdu.
  useEffect(() => {
    const prev = prevStepRef.current;
    prevStepRef.current = step;
    const targetShape = STEP_TARGET_SHAPE[step];

    if (reduceMotion) {
      cancelAnimation(loopProgress);
      expand.value = step === 0 ? 1 : 0;
      isLoopMode.value = 0;
      directFrom.value = targetShape;
      directTo.value = targetShape;
      directBlend.value = 1;
      shieldFrom.value = step;
      shieldTo.value = step;
      shieldBlend.value = 1;
      shieldAngle.value = 0;
      return;
    }

    expand.value = withSpring(step === 0 ? 1 : 0, motion.spring.spatialDefault);

    // Morph tarczy zewnętrznej między kształtami kroków.
    if (prev !== step) {
      shieldFrom.value = prev;
      shieldTo.value = step;
      shieldBlend.value = 0;
      shieldBlend.value = withSpring(1, motion.spring.spatialDefault);
      shieldAngle.value = withSequence(
        withTiming(step > prev ? 10 : -10, { duration: 150, easing: Easing.out(Easing.quad) }),
        withSpring(0, motion.spring.spatialDefault),
      );
    }

    if (step === 0) {
      // Powrót lub start na kroku powitalnym: ciągły cykl wszystkich pojazdów.
      const startFrom = prev === 0 ? 0 : STEP_TARGET_SHAPE[prev];
      isLoopMode.value = 1;
      cancelAnimation(loopProgress);
      loopProgress.value = startFrom;
      loopProgress.value = withRepeat(
        withTiming(startFrom + SHAPE_COUNT, {
          duration: SHAPE_COUNT * HERO_MORPH_STEP_MS,
          easing: Easing.linear,
        }),
        -1,
        false,
      );
      return;
    }

    // Przejście na krok 1..3: zatrzymujemy pętlę i morfujemy z bieżącej sylwetki do docelowej.
    let currentShape: number;
    if (prev === 0) {
      const raw = loopProgress.value;
      currentShape = Number.isFinite(raw) ? transitShapeStep(Math.round(raw)) : 0;
      cancelAnimation(loopProgress);
    } else {
      currentShape = STEP_TARGET_SHAPE[prev];
    }

    isLoopMode.value = 0;
    directFrom.value = currentShape;
    directTo.value = targetShape;
    if (currentShape === targetShape) {
      directBlend.value = 1;
      pulse.value = withSequence(
        withTiming(1, { duration: 130, easing: Easing.out(Easing.quad) }),
        withSpring(0, motion.spring.spatialFast),
      );
    } else {
      directBlend.value = 0;
      directBlend.value = withTiming(1, {
        duration: 540,
        easing: Easing.out(Easing.cubic),
      });
    }
  }, [
    directBlend,
    directFrom,
    directTo,
    expand,
    isLoopMode,
    loopProgress,
    pulse,
    reduceMotion,
    shieldAngle,
    shieldBlend,
    shieldFrom,
    shieldTo,
    step,
  ]);

  // Sprężysty impuls potwierdzenia po wyborze miasta / przyznaniu zgody / zapisaniu miejsca.
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

  const shieldAnimatedProps = useAnimatedProps<PathProps>(() => {
    const fromIdx = shieldFrom.value;
    const toIdx = shieldTo.value;
    const rawT = shieldBlend.value;
    if (!Number.isFinite(rawT)) return { d: staticShield };
    const from = SHIELD_SHAPES[fromIdx] ?? SHIELD_SHAPES[0];
    const to = SHIELD_SHAPES[toIdx] ?? SHIELD_SHAPES[0];
    return {
      d: interpolateShieldPath(from, to, rawT),
    };
  });

  const vehicleAnimatedProps = useAnimatedProps<PathProps>(() => {
    if (isLoopMode.value > 0.5) {
      const raw = loopProgress.value;
      if (!Number.isFinite(raw)) return { d: staticBody };
      const idx = transitShapeStep(raw);
      const nextIdx = (idx + 1) % SHAPE_COUNT;
      const from = TRANSIT_SHAPES[idx];
      const to = TRANSIT_SHAPES[nextIdx];
      if (!from || !to) return { d: staticBody };
      const localT = raw - Math.floor(raw);
      return {
        d: interpolateTransitPath(from, to, expressiveMorphEase(localT)),
      };
    }

    const rawT = directBlend.value;
    if (!Number.isFinite(rawT)) return { d: staticBody };
    const from = TRANSIT_SHAPES[directFrom.value] ?? TRANSIT_SHAPES[0];
    const to = TRANSIT_SHAPES[directTo.value] ?? TRANSIT_SHAPES[0];
    const eased = expressiveMorphEase(rawT * MORPH_ACTIVE_FRACTION);
    return {
      d: interpolateTransitPath(from, to, eased),
    };
  });

  // Kontener całej strefy hero płynnie kurczy się z 216px na wysokość kompaktowego nagłówka.
  const stageStyle = useAnimatedStyle(() => {
    const h = interpolate(expand.value, [0, 1], [compactHeight, HERO_EXPANDED_HEIGHT]);
    return { height: h };
  });

  // Lot medalionu ze środka sceny (krok 0) do prawego rogu nagłówka (kroki 1..3).
  const medalFlightStyle = useAnimatedStyle(() => {
    const half = HERO_MEDAL_SIZE / 2;
    const compactRadius = (HERO_MEDAL_SIZE * HERO_COMPACT_SCALE) / 2;
    const expandedCx = stageWidth / 2;
    const expandedCy = HERO_EXPANDED_HEIGHT / 2;
    const compactCx = Math.max(compactRadius, stageWidth - compactRadius - 2);
    const compactCy = Math.max(compactRadius + 2, compactHeight / 2);

    const cx = interpolate(expand.value, [0, 1], [compactCx, expandedCx]);
    const cy = interpolate(expand.value, [0, 1], [compactCy, expandedCy]);
    const baseScale = interpolate(expand.value, [0, 1], [HERO_COMPACT_SCALE, 1]);
    const pulseBoost = 1 + pulse.value * 0.11;

    return {
      transform: [
        { translateX: cx - half },
        { translateY: cy - half },
        { scale: baseScale * pulseBoost },
      ],
    };
  });

  const shieldTiltStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${shieldAngle.value}deg` }],
  }));

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: interpolate(expand.value, [0.15, 0.9], [0, 1], 'clamp'),
    transform: [{ scale: interpolate(expand.value, [0, 1], [0.84, 1]) }],
  }));

  const headerTextStyle = useAnimatedStyle(() => ({
    opacity: interpolate(expand.value, [0, 0.55], [1, 0], 'clamp'),
    transform: [{ translateY: interpolate(expand.value, [0, 1], [0, 12]) }],
  }));

  const primaryOrbitStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${Number.isFinite(orbitPrimary.value) ? orbitPrimary.value : 0}deg` }],
  }));

  const secondaryOrbitStyle = useAnimatedStyle(() => ({
    transform: [
      { rotate: `${Number.isFinite(orbitSecondary.value) ? orbitSecondary.value : 0}deg` },
    ],
  }));

  const pulseRingStyle = useAnimatedStyle(() => ({
    opacity: pulse.value * 0.65,
    transform: [{ scale: 1 + pulse.value * 0.24 }],
  }));

  const vehicleBounceStyle = useAnimatedStyle(() => {
    if (isLoopMode.value < 0.5) {
      const b = directBlend.value;
      const wave = b < 1 ? Math.sin(b * Math.PI) : 0;
      return {
        transform: [{ translateY: -wave * 3.5 }, { scale: 1 + wave * 0.04 }],
      };
    }
    const raw = loopProgress.value;
    const localT = Number.isFinite(raw) ? raw - Math.floor(raw) : 0;
    if (localT >= MORPH_ACTIVE_FRACTION) {
      return { transform: [{ translateY: 0 }, { scaleX: 1 }, { scaleY: 1 }] };
    }
    const u = localT / MORPH_ACTIVE_FRACTION;
    const wave = Math.sin(u * Math.PI);
    const stretch = Math.sin(u * Math.PI * 2) * 0.04;
    return {
      transform: [{ translateY: -wave * 4 }, { scaleX: 1 - stretch }, { scaleY: 1 + stretch }],
    };
  });

  const tramAccStyle = useAnimatedStyle(() => {
    const p =
      isLoopMode.value > 0.5
        ? loopAccessoryPresence(loopProgress.value, 0)
        : directAccessoryPresence(directFrom.value, directTo.value, directBlend.value, 0);
    return {
      opacity: p,
      transform: [{ scale: 0.9 + p * 0.1 }],
    };
  });

  const busAccStyle = useAnimatedStyle(() => {
    const p =
      isLoopMode.value > 0.5
        ? loopAccessoryPresence(loopProgress.value, 1)
        : directAccessoryPresence(directFrom.value, directTo.value, directBlend.value, 1);
    return {
      opacity: p,
      transform: [{ scale: 0.9 + p * 0.1 }],
    };
  });

  const trainAccStyle = useAnimatedStyle(() => {
    const p =
      isLoopMode.value > 0.5
        ? loopAccessoryPresence(loopProgress.value, 2)
        : directAccessoryPresence(directFrom.value, directTo.value, directBlend.value, 2);
    return {
      opacity: p,
      transform: [{ scale: 0.9 + p * 0.1 }],
    };
  });

  const pinAccStyle = useAnimatedStyle(() => {
    const p =
      isLoopMode.value > 0.5
        ? loopAccessoryPresence(loopProgress.value, 3)
        : directAccessoryPresence(directFrom.value, directTo.value, directBlend.value, 3);
    return {
      opacity: p * 0.78,
      transform: [{ scale: 0.9 + p * 0.1 }],
    };
  });

  const trackSignalLeftStyle = useAnimatedStyle(() => {
    const w = trackWave.value;
    return {
      opacity: Math.sin(w * Math.PI) * 0.9,
      transform: [{ translateX: interpolate(w, [0, 1], [-18, 22]) }],
    };
  });

  const trackSignalRightStyle = useAnimatedStyle(() => {
    const w = trackWave.value;
    return {
      opacity: Math.sin(w * Math.PI) * 0.9,
      transform: [{ translateX: interpolate(w, [0, 1], [18, -22]) }],
    };
  });

  const glyphSize = 68;
  const innerRingR = HERO_MEDAL_SIZE / 2 - 2;
  const innerCirc = 2 * Math.PI * innerRingR;
  const outerRingSize = 176;
  const outerRingR = outerRingSize / 2 - 6;
  const outerCirc = 2 * Math.PI * outerRingR;

  return (
    <Animated.View style={[styles.stage, stageStyle]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {/* Schematyczna sieć tras i węzłów przesiadkowych (widoczna na kroku powitalnym). */}
      <Animated.View pointerEvents="none" style={[styles.backdrop, backdropStyle]}>
        <Svg
          width={stageWidth}
          height={HERO_EXPANDED_HEIGHT}
          viewBox="0 0 340 216"
          preserveAspectRatio="xMidYMid meet"
        >
          {/* Główna linia tramwajowa pozioma */}
          <Line
            x1={10}
            y1={108}
            x2={330}
            y2={108}
            stroke={scheme.outlineVariant}
            strokeWidth={2}
            strokeLinecap="round"
            strokeOpacity={0.55}
          />
          {/* Górny rozjazd linii kolejowej / autobusowej */}
          <Path
            d="M16 58 H74 Q94 58 106 76 L116 90 M224 90 L234 76 Q246 58 266 58 H324"
            fill="none"
            stroke={scheme.tertiary}
            strokeWidth={2}
            strokeLinecap="round"
            strokeOpacity={0.34}
          />
          {/* Dolna odnoga miejska */}
          <Path
            d="M28 158 H82 Q100 158 112 142 L118 134 M222 134 L228 142 Q240 158 258 158 H312"
            fill="none"
            stroke={scheme.primary}
            strokeWidth={2}
            strokeLinecap="round"
            strokeOpacity={0.28}
          />

          {/* Węzły przystankowe na schemacie */}
          <G>
            <Circle cx={34} cy={108} r={4.5} fill={scheme.surface} stroke={scheme.primary} strokeWidth={2.2} />
            <Circle cx={68} cy={108} r={3.5} fill={scheme.primary} fillOpacity={0.55} />
            <Circle cx={272} cy={108} r={3.5} fill={scheme.primary} fillOpacity={0.55} />
            <Circle cx={306} cy={108} r={4.5} fill={scheme.surface} stroke={scheme.primary} strokeWidth={2.2} />

            <Circle cx={48} cy={58} r={4} fill={scheme.surface} stroke={scheme.tertiary} strokeWidth={2} />
            <Circle cx={292} cy={58} r={4} fill={scheme.surface} stroke={scheme.tertiary} strokeWidth={2} />
            <Circle cx={58} cy={158} r={4} fill={scheme.surface} stroke={scheme.primary} strokeWidth={2} strokeOpacity={0.65} />
            <Circle cx={282} cy={158} r={4} fill={scheme.surface} stroke={scheme.primary} strokeWidth={2} strokeOpacity={0.65} />
          </G>
        </Svg>

        {/* Subtelne impulsy jadące torowiskiem ku węzłowi centralnemu */}
        {!reduceMotion && (
          <>
            <Animated.View style={[styles.railPulseLeft, trackSignalLeftStyle]} />
            <Animated.View style={[styles.railPulseRight, trackSignalRightStyle]} />
          </>
        )}

        {/* Zewnętrzna przesiadkowa orbita z czterema przystankami */}
        <Animated.View style={[styles.outerOrbitWrap, !reduceMotion && secondaryOrbitStyle]}>
          <Svg width={outerRingSize} height={outerRingSize}>
            <Circle
              cx={outerRingSize / 2}
              cy={outerRingSize / 2}
              r={outerRingR}
              fill="none"
              stroke={scheme.outlineVariant}
              strokeWidth={1.5}
              strokeDasharray="4 7"
              strokeOpacity={0.7}
            />
            <Circle
              cx={outerRingSize / 2}
              cy={outerRingSize / 2}
              r={outerRingR}
              fill="none"
              stroke={scheme.tertiary}
              strokeWidth={2.4}
              strokeLinecap="round"
              strokeOpacity={0.65}
              strokeDasharray={`${outerCirc * 0.16} ${outerCirc * 0.84}`}
            />
            <Circle cx={outerRingSize / 2} cy={6} r={3.5} fill={scheme.primary} />
            <Circle cx={outerRingSize - 6} cy={outerRingSize / 2} r={3} fill={scheme.tertiary} />
            <Circle cx={outerRingSize / 2} cy={outerRingSize - 6} r={3.5} fill={scheme.primary} />
            <Circle cx={6} cy={outerRingSize / 2} r={3} fill={scheme.tertiary} />
          </Svg>
        </Animated.View>
      </Animated.View>

      {/* Kompaktowy nagłówek kroków 1..3 (po lewej od medalionu). */}
      {headerContent && (
        <Animated.View
          style={[styles.headerOverlay, headerTextStyle]}
          pointerEvents={step === 0 ? 'none' : 'box-none'}
        >
          {headerContent}
        </Animated.View>
      )}

      {/* Główny medalion: morfująca tarcza + aktywny pierścień + morfujący pojazd. */}
      <Animated.View pointerEvents="none" style={[styles.medalWrap, medalFlightStyle]}>
        {/* Impuls potwierdzenia rozchodzący się na zewnątrz po akcji */}
        {!reduceMotion && <Animated.View style={[styles.pulseHalo, pulseRingStyle]} />}

        {/* Pierścień trasy wokół tarczy */}
        <Animated.View style={[StyleSheet.absoluteFill, !reduceMotion && primaryOrbitStyle]}>
          <Svg width={HERO_MEDAL_SIZE} height={HERO_MEDAL_SIZE}>
            <Circle
              cx={HERO_MEDAL_SIZE / 2}
              cy={HERO_MEDAL_SIZE / 2}
              r={innerRingR}
              fill="none"
              stroke={scheme.primary}
              strokeOpacity={0.22}
              strokeWidth={2}
            />
            <Circle
              cx={HERO_MEDAL_SIZE / 2}
              cy={HERO_MEDAL_SIZE / 2}
              r={innerRingR}
              fill="none"
              stroke={scheme.primary}
              strokeOpacity={0.92}
              strokeWidth={3}
              strokeLinecap="round"
              strokeDasharray={`${innerCirc * 0.24} ${innerCirc * 0.76}`}
            />
          </Svg>
        </Animated.View>

        {/* Organiczna morfująca tarcza tła */}
        <Animated.View style={[styles.shieldLayer, shieldTiltStyle]}>
          <Svg width={HERO_MEDAL_SIZE - 12} height={HERO_MEDAL_SIZE - 12} viewBox="0 0 120 120">
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

        {/* Morfujący piktogram transportowy z akcesoriami */}
        <Animated.View
          style={[
            styles.glyphStage,
            { width: glyphSize, height: glyphSize },
            !reduceMotion && vehicleBounceStyle,
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

          {/* 0: Pantograf i szyny tramwajowe */}
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

          {/* 1: Koła i lusterka autobusu */}
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

          {/* 2: Tory kolejowe i podkład pod pociągiem */}
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

          {/* 3: Łuk przystanku pod grotem pinezki */}
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
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  stage: {
    position: 'relative',
    width: '100%',
    overflow: 'visible',
  },
  backdrop: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  outerOrbitWrap: {
    position: 'absolute',
    width: 176,
    height: 176,
    alignItems: 'center',
    justifyContent: 'center',
  },
  railPulseLeft: {
    position: 'absolute',
    left: 26,
    top: HERO_EXPANDED_HEIGHT / 2 - 1.5,
    width: 30,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: scheme.primary,
  },
  railPulseRight: {
    position: 'absolute',
    right: 26,
    top: HERO_EXPANDED_HEIGHT / 2 - 1.5,
    width: 30,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: scheme.primary,
  },
  headerOverlay: {
    position: 'absolute',
    left: 0,
    right: 76,
    top: 0,
    justifyContent: 'center',
  },
  medalWrap: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: HERO_MEDAL_SIZE,
    height: HERO_MEDAL_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pulseHalo: {
    position: 'absolute',
    width: HERO_MEDAL_SIZE,
    height: HERO_MEDAL_SIZE,
    borderRadius: HERO_MEDAL_SIZE / 2,
    borderWidth: 2.5,
    borderColor: scheme.primary,
  },
  shieldLayer: {
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
