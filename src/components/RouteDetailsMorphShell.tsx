import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
} from 'react';
import {
  BackHandler,
  Platform,
  StyleSheet,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  Extrapolation,
  ReduceMotion,
  cancelAnimation,
  interpolate,
  interpolateColor,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  type AnimatedStyle,
} from 'react-native-reanimated';
import { motion } from '../theme/motion';
import { scheme, shape } from '../theme/tokens';
import type { Connection } from '../types/models';
import { useTransferThresholds, useWalkSpeedMps } from '../services/settings';
import { analyzeConnection } from './connectionInsights';
import { ConnectionCardMorphPreview, JourneyStrip } from './ConnectionCard';
import { useRouteCardTransition, type CardTransitionSource } from './RouteCardTransition';
import { normalizeConnectionId } from '../services/routing/connectionIdentity';
import { acquirePredictiveBack, isNativePredictiveBackSupported } from '../services/predictiveBack';
import {
  EDGE_BACK_ZONE_PX,
  MAX_SHARED_STRIP_RETURN_SCROLL_Y,
  computeCloseDurationMs,
  computeDragShellFrame,
  computeGpuShellTransform,
  computePredictiveBackShellFrame,
  computeScaledStripRect,
  shouldDismissFromGesture,
  topLeftScaleTranslation,
  type CardSurfaceVariant,
  type TransitionRect,
} from './routeCardTransitionMath';

export interface MorphShellRenderProps {
  /** Zgłasza dokładny prostokąt docelowego JourneyStrip względem pełnego ekranu szczegółów (scrollY = 0). */
  onTargetStripRect: (rect: TransitionRect) => void;
  /** Styl sterujący widocznością docelowego JourneyStrip na wątku UI bez re-renderu. */
  targetStripAnimatedStyle: StyleProp<AnimatedStyle<ViewStyle>>;
  /** Styl dla nagłówka ekranu szczegółów (delikatne wejście i wyjście). */
  headerAnimatedStyle: StyleProp<AnimatedStyle<ViewStyle>>;
  /** Styl dla sekcji poniżej podsumowania (płynny fade bez ciągnięcia WebView mapy przy powrocie). */
  belowSummaryAnimatedStyle: StyleProp<AnimatedStyle<ViewStyle>>;
  /** Zamyka ekran szczegółów płynnym powrotem do karty na liście. */
  requestClose: () => void;
}

interface RouteDetailsMorphShellProps {
  source: CardTransitionSource;
  connection: Connection;
  topInset: number;
  scrollYRef: MutableRefObject<number>;
  /** False, gdy nad ekranem otwarty jest arkusz (np. udostępnianie lub alarm). */
  canInterceptBack: boolean;
  onSettled: () => void;
  onDismissComplete: () => void;
  children: (props: MorphShellRenderProps) => ReactNode;
}

const OPEN_SPRING = {
  damping: 30,
  stiffness: 420,
  mass: 0.78,
  overshootClamping: true,
  energyThreshold: 0.002,
  reduceMotion: ReduceMotion.System,
};

const CLOSE_EASING = Easing.bezier(0.2, 0, 0, 1);
const OPEN_SETTLE_FALLBACK_MS = 700;
const CLOSE_COMPLETE_FALLBACK_MS = 340;
const STRIP_MEASURE_FALLBACK_MS = 32;

function resolveCardColors(variant: CardSurfaceVariant): {
  bg: string;
  border: string;
  borderWidth: number;
} {
  if (variant === 'past') {
    return {
      bg: scheme.surfaceContainerLow,
      border: scheme.outlineVariant + '55',
      borderWidth: StyleSheet.hairlineWidth,
    };
  }
  if (variant === 'boarded') {
    return {
      bg: scheme.surfaceContainer,
      border: scheme.primary + '85',
      borderWidth: 1.5,
    };
  }
  if (variant === 'longWalk') {
    return {
      bg: scheme.surfaceContainer,
      border: scheme.warning + '75',
      borderWidth: 1.5,
    };
  }
  return {
    bg: scheme.surfaceContainer,
    border: scheme.outlineVariant,
    borderWidth: StyleSheet.hairlineWidth,
  };
}

/**
 * Kontener Material 3 Container Transform rozwijający klikniętą kartę z listy połączeń
 * do pełnego ekranu szczegółów ze wspólnym lotem paska JourneyStrip i interaktywnym gestem wstecz.
 */
export function RouteDetailsMorphShell({
  source,
  connection,
  topInset,
  scrollYRef,
  canInterceptBack,
  onSettled,
  onDismissComplete,
  children,
}: RouteDetailsMorphShellProps) {
  const transition = useRouteCardTransition();
  const windowDims = useWindowDimensions();
  const initialContainerSize = transition?.getContainerSize();
  const [viewport, setViewport] = useState(() => ({
    width:
      initialContainerSize && initialContainerSize.width > 0
        ? initialContainerSize.width
        : windowDims.width,
    height:
      initialContainerSize && initialContainerSize.height > 0
        ? initialContainerSize.height
        : windowDims.height,
  }));

  const screenW = viewport.width > 0 ? viewport.width : windowDims.width;
  const screenH = viewport.height > 0 ? viewport.height : windowDims.height;

  const listCardId = source.cardConnectionId ?? source.connectionId;
  const listCardNormalizedId = source.cardNormalizedId ?? source.normalizedId;
  const stripMatchesSource =
    normalizeConnectionId(connection.id) === normalizeConnectionId(source.connection.id);
  const walkMps = useWalkSpeedMps();
  const thresholds = useTransferThresholds();
  const stripInsights = useMemo(
    () => analyzeConnection(connection, walkMps, thresholds),
    [connection, walkMps, thresholds],
  );
  const hasTransitStrip =
    stripMatchesSource && stripInsights.transitLegs.length > 0 && source.stripRect != null;

  const cardColors = resolveCardColors(source.variant);
  const surfaceBg = scheme.surface;
  const cardBg = cardColors.bg;
  const cardBorder = cardColors.border;
  const cardBorderWidth = cardColors.borderWidth;

  const openStartedRef = useRef(false);
  const openSettledRef = useRef(false);
  const openSettleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openSettleFrameRef = useRef<number | null>(null);
  const closingRef = useRef(false);
  const dismissFinishedRef = useRef(false);
  const closeFallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const canInterceptBackRef = useRef(canInterceptBack);
  canInterceptBackRef.current = canInterceptBack;
  const onSettledRef = useRef(onSettled);
  onSettledRef.current = onSettled;
  const onDismissCompleteRef = useRef(onDismissComplete);
  onDismissCompleteRef.current = onDismissComplete;

  // Wartości animacji działające wyłącznie na wątku UI (zero re-renderów podczas ruchu).
  const progress = useSharedValue(0);
  const screenWVal = useSharedValue(screenW);
  const screenHVal = useSharedValue(screenH);
  screenWVal.value = screenW;
  screenHVal.value = screenH;

  const srcX = useSharedValue(source.cardRect.x);
  const srcY = useSharedValue(source.cardRect.y);
  const srcW = useSharedValue(source.cardRect.width);
  const srcH = useSharedValue(source.cardRect.height);

  // Przybliżony punkt docelowy paska przed pierwszym pomiarem (korygowany w 1. klatce przed ruchem).
  const estimatedTargetStripY = topInset + 60 + 4 + 16 + 150;
  const srcStripX = useSharedValue(source.stripRect?.x ?? source.cardRect.x + 16);
  const srcStripY = useSharedValue(source.stripRect?.y ?? source.cardRect.y + 84);
  const srcStripW = useSharedValue(
    source.stripRect?.width ?? Math.max(40, source.cardRect.width - 32),
  );
  const srcStripH = useSharedValue(source.stripRect?.height ?? 56);

  const dstStripX = useSharedValue(source.stripRect?.x ?? 30);
  const dstStripY = useSharedValue(estimatedTargetStripY);
  const dstStripW = useSharedValue(source.stripRect?.width ?? Math.max(40, screenW - 60));
  const dstStripH = useSharedValue(source.stripRect?.height ?? 56);
  const baseTargetStripRef = useRef({
    x: source.stripRect?.x ?? 30,
    y: estimatedTargetStripY,
    width: source.stripRect?.width ?? Math.max(40, screenW - 60),
    height: source.stripRect?.height ?? 56,
    measured: false,
  });

  // Startowy prostokąt paska przy powrocie z interaktywnego przeciągania.
  const dragStripX = useSharedValue(dstStripX.value);
  const dragStripY = useSharedValue(dstStripY.value);
  const dragStripW = useSharedValue(dstStripW.value);
  const dragStripH = useSharedValue(dstStripH.value);

  // 1 podczas lotu wspólnego paska JourneyStrip (ukrywa duplikaty w karcie i podsumowaniu).
  const useSharedStrip = useSharedValue(hasTransitStrip ? 1 : 0);
  const isClosingVal = useSharedValue(0);

  const nativePredictiveSupported = useMemo(() => isNativePredictiveBackSupported(), []);
  const [isScreenFocused, setIsScreenFocused] = useState(true);
  useFocusEffect(
    useCallback(() => {
      setIsScreenFocused(true);
      return () => setIsScreenFocused(false);
    }, []),
  );

  // Stan interaktywnego gestu wstecz (lewa krawędź na iOS i Androidzie < 14).
  const edgeEligible = useSharedValue(false);
  const isDragging = useSharedValue(0);
  const touchStartX = useSharedValue(0);
  const touchStartY = useSharedValue(0);
  const dragX = useSharedValue(0);
  const dragY = useSharedValue(0);
  const dragProgress = useSharedValue(0);

  // Stan natywnego Android Predictive Back (API 34+, lewa i prawa krawędź).
  const predictiveActive = useSharedValue(0);
  const predictiveProgress = useSharedValue(0);
  const predictiveDeltaY = useSharedValue(0);
  const predictiveEdge = useSharedValue(0);
  const predictiveStartYRef = useRef(0);
  const predictiveGesturingRef = useRef(false);

  // Startowa ramka przy domykaniu z pozycji palca (ciągły lot bez przeskoku).
  const dismissingFromDrag = useSharedValue(0);
  const dismissStartX = useSharedValue(0);
  const dismissStartY = useSharedValue(0);
  const dismissStartW = useSharedValue(screenW);
  const dismissStartH = useSharedValue(screenH);
  const dismissStartR = useSharedValue(0);

  const canGestureBackVal = useSharedValue(canInterceptBack);
  canGestureBackVal.value = canInterceptBack;

  const hiddenCardId = transition?.hiddenCardId;

  const handleRootLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    if (width > 0 && height > 0) {
      setViewport((prev) =>
        Math.abs(prev.width - width) < 0.5 && Math.abs(prev.height - height) < 0.5
          ? prev
          : { width, height },
      );
    }
  }, []);

  const revealSourceCard = useCallback(() => {
    if (hiddenCardId && hiddenCardId.value === listCardNormalizedId) {
      hiddenCardId.value = '';
    }
  }, [hiddenCardId, listCardNormalizedId]);

  // Ukrywamy oryginalną kartę na liście w tej samej klatce, w której montuje się morphShell.
  useLayoutEffect(() => {
    if (hiddenCardId) {
      hiddenCardId.value = listCardNormalizedId;
    }
    return () => {
      if (hiddenCardId && hiddenCardId.value === listCardNormalizedId) {
        hiddenCardId.value = '';
      }
    };
  }, [hiddenCardId, listCardNormalizedId]);

  const clearOpenSettleTimers = useCallback(() => {
    if (openSettleTimerRef.current !== null) {
      clearTimeout(openSettleTimerRef.current);
      openSettleTimerRef.current = null;
    }
    if (openSettleFrameRef.current !== null) {
      cancelAnimationFrame(openSettleFrameRef.current);
      openSettleFrameRef.current = null;
    }
  }, []);

  const markOpenSettled = useCallback(() => {
    if (openSettledRef.current || closingRef.current) return;
    openSettledRef.current = true;
    clearOpenSettleTimers();
    useSharedStrip.value = 0;
    // Oddajemy 1 klatkę na domknięcie ostatniego kadru morphingu przed ciężkim montażem sekcji.
    openSettleFrameRef.current = requestAnimationFrame(() => {
      openSettleFrameRef.current = null;
      if (!closingRef.current) {
        onSettledRef.current();
      }
    });
  }, [clearOpenSettleTimers, useSharedStrip]);

  const beginOpenAnimation = useCallback(() => {
    if (openStartedRef.current || closingRef.current) return;
    openStartedRef.current = true;
    clearOpenSettleTimers();
    openSettleTimerRef.current = setTimeout(() => {
      markOpenSettled();
    }, OPEN_SETTLE_FALLBACK_MS);
    progress.value = withSpring(1, OPEN_SPRING, (finished) => {
      'worklet';
      if (finished) {
        useSharedStrip.value = 0;
        runOnJS(markOpenSettled)();
      }
    });
  }, [clearOpenSettleTimers, markOpenSettled, progress, useSharedStrip]);

  const handleTargetStripRect = useCallback(
    (rect: TransitionRect) => {
      if (hasTransitStrip && rect.width > 20 && rect.height > 16) {
        baseTargetStripRef.current = {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
          measured: true,
        };
        if (!closingRef.current) {
          dstStripX.value = rect.x;
          dstStripY.value = rect.y;
          dstStripW.value = rect.width;
          dstStripH.value = rect.height;
        }
      }
      beginOpenAnimation();
    },
    [beginOpenAnimation, dstStripH, dstStripW, dstStripX, dstStripY, hasTransitStrip],
  );

  // Bezpieczny start otwierania, gdyby pasek nie istniał lub callback layoutu się opóźnił.
  useEffect(() => {
    const startTimer = setTimeout(
      () => {
        beginOpenAnimation();
      },
      hasTransitStrip ? STRIP_MEASURE_FALLBACK_MS : 0,
    );

    return () => {
      clearTimeout(startTimer);
      clearOpenSettleTimers();
    };
  }, [beginOpenAnimation, clearOpenSettleTimers, hasTransitStrip]);

  const finalizeClose = useCallback(() => {
    if (dismissFinishedRef.current) return;
    dismissFinishedRef.current = true;
    if (closeFallbackTimerRef.current !== null) {
      clearTimeout(closeFallbackTimerRef.current);
      closeFallbackTimerRef.current = null;
    }
    revealSourceCard();
    onDismissCompleteRef.current();
  }, [revealSourceCard]);

  useEffect(() => {
    return () => {
      if (closeFallbackTimerRef.current !== null) {
        clearTimeout(closeFallbackTimerRef.current);
        closeFallbackTimerRef.current = null;
      }
    };
  }, []);

  /** Odświeża docelową pozycję karty na liście w locie (np. po zmianie kolejności live). */
  const refreshSourceCardGeometryInFlight = useCallback(() => {
    if (!transition) return;
    void transition.measureCard(listCardId).then((measured) => {
      if (!measured || dismissFinishedRef.current) return;
      srcX.value = measured.cardRect.x;
      srcY.value = measured.cardRect.y;
      srcW.value = measured.cardRect.width;
      srcH.value = measured.cardRect.height;
      if (measured.stripRect) {
        srcStripX.value = measured.stripRect.x;
        srcStripY.value = measured.stripRect.y;
        srcStripW.value = measured.stripRect.width;
        srcStripH.value = measured.stripRect.height;
      }
    });
  }, [
    listCardId,
    srcH,
    srcStripH,
    srcStripW,
    srcStripX,
    srcStripY,
    srcW,
    srcX,
    srcY,
    transition,
  ]);

  const requestClose = useCallback(() => {
    // Drugie cofnięcie w trakcie zamykania domyka ekran natychmiast bez blokowania użytkownika.
    if (closingRef.current) {
      cancelAnimation(progress);
      finalizeClose();
      return;
    }
    closingRef.current = true;
    clearOpenSettleTimers();
    isClosingVal.value = 1;
    dismissingFromDrag.value = 0;
    isDragging.value = 0;
    dragX.value = 0;
    dragY.value = 0;
    dragProgress.value = 0;
    predictiveGesturingRef.current = false;
    predictiveActive.value = 0;
    predictiveProgress.value = 0;
    predictiveDeltaY.value = 0;

    refreshSourceCardGeometryInFlight();

    const scrollY = scrollYRef.current;
    const canReturnSharedStrip =
      hasTransitStrip &&
      baseTargetStripRef.current.measured &&
      scrollY <= MAX_SHARED_STRIP_RETURN_SCROLL_Y;

    if (canReturnSharedStrip) {
      dstStripX.value = baseTargetStripRef.current.x;
      dstStripY.value = baseTargetStripRef.current.y - scrollY;
      dstStripW.value = baseTargetStripRef.current.width;
      dstStripH.value = baseTargetStripRef.current.height;
      useSharedStrip.value = 1;
    } else {
      useSharedStrip.value = 0;
    }

    const duration = computeCloseDurationMs(progress.value);
    cancelAnimation(progress);
    progress.value = withTiming(
      0,
      {
        duration,
        easing: CLOSE_EASING,
        reduceMotion: ReduceMotion.System,
      },
      (finished) => {
        'worklet';
        if (finished) {
          if (hiddenCardId && hiddenCardId.value === listCardNormalizedId) {
            hiddenCardId.value = '';
          }
          runOnJS(finalizeClose)();
        }
      },
    );

    closeFallbackTimerRef.current = setTimeout(
      finalizeClose,
      duration + CLOSE_COMPLETE_FALLBACK_MS,
    );
  }, [
    clearOpenSettleTimers,
    dismissingFromDrag,
    dragProgress,
    dragX,
    dragY,
    dstStripH,
    dstStripW,
    dstStripX,
    dstStripY,
    finalizeClose,
    hasTransitStrip,
    hiddenCardId,
    isClosingVal,
    isDragging,
    listCardNormalizedId,
    progress,
    refreshSourceCardGeometryInFlight,
    scrollYRef,
    useSharedStrip,
  ]);

  const startDismissFromDragOnJS = useCallback(
    (
      shellX: number,
      shellY: number,
      shellW: number,
      shellH: number,
      shellR: number,
      shellScale: number,
    ) => {
      if (closingRef.current) return;
      closingRef.current = true;
      clearOpenSettleTimers();
      isClosingVal.value = 1;
      refreshSourceCardGeometryInFlight();

      const scrollY = scrollYRef.current;
      const canReturnSharedStrip =
        hasTransitStrip &&
        baseTargetStripRef.current.measured &&
        scrollY <= MAX_SHARED_STRIP_RETURN_SCROLL_Y;

      if (canReturnSharedStrip) {
        const startStrip = computeScaledStripRect(
          { x: shellX, y: shellY, scale: shellScale },
          baseTargetStripRef.current,
          scrollY,
        );
        dragStripX.value = startStrip.x;
        dragStripY.value = startStrip.y;
        dragStripW.value = startStrip.width;
        dragStripH.value = startStrip.height;
        useSharedStrip.value = 1;
      } else {
        useSharedStrip.value = 0;
      }

      dismissStartX.value = shellX;
      dismissStartY.value = shellY;
      dismissStartW.value = shellW;
      dismissStartH.value = shellH;
      dismissStartR.value = shellR;
      dismissingFromDrag.value = 1;
      isDragging.value = 0;
      dragX.value = 0;
      dragY.value = 0;
      dragProgress.value = 0;
      progress.value = 1;

      const duration = 205;
      progress.value = withTiming(
        0,
        {
          duration,
          easing: CLOSE_EASING,
          reduceMotion: ReduceMotion.System,
        },
        (finished) => {
          'worklet';
          if (finished) {
            if (hiddenCardId && hiddenCardId.value === listCardNormalizedId) {
              hiddenCardId.value = '';
            }
            runOnJS(finalizeClose)();
          }
        },
      );

      closeFallbackTimerRef.current = setTimeout(
        finalizeClose,
        duration + CLOSE_COMPLETE_FALLBACK_MS,
      );
    },
    [
      clearOpenSettleTimers,
      dismissStartH,
      dismissStartR,
      dismissStartW,
      dismissStartX,
      dismissStartY,
      dismissingFromDrag,
      dragProgress,
      dragStripH,
      dragStripW,
      dragStripX,
      dragStripY,
      dragX,
      dragY,
      finalizeClose,
      hasTransitStrip,
      hiddenCardId,
      isClosingVal,
      isDragging,
      listCardNormalizedId,
      progress,
      refreshSourceCardGeometryInFlight,
      scrollYRef,
      useSharedStrip,
    ],
  );

  // Android 14+ (API 34+): natywny Predictive Back z lewej i prawej krawędzi ekranu.
  // Gdy nad ekranem otwarty jest arkusz lub ekran traci fokus (/map, /line), callback
  // jest odpinany, by zdarzenia wróciły do standardowego BackHandlera.
  const shouldUseNativePredictive =
    nativePredictiveSupported && isScreenFocused && canInterceptBack;
  useEffect(() => {
    if (!shouldUseNativePredictive) return undefined;
    const release = acquirePredictiveBack({
      onStart: (event) => {
        if (closingRef.current || progress.value < 0.7) return;
        cancelAnimation(predictiveProgress);
        cancelAnimation(predictiveDeltaY);
        predictiveGesturingRef.current = true;
        predictiveStartYRef.current = event.touchY;
        predictiveEdge.value = event.swipeEdge;
        predictiveDeltaY.value = 0;
        predictiveProgress.value = event.progress;
        predictiveActive.value = 1;
        useSharedStrip.value = 0;
      },
      onProgress: (event) => {
        if (closingRef.current || progress.value < 0.7) return;
        if (!predictiveGesturingRef.current) {
          predictiveGesturingRef.current = true;
          predictiveStartYRef.current = event.touchY;
          predictiveActive.value = 1;
          useSharedStrip.value = 0;
        }
        predictiveEdge.value = event.swipeEdge;
        predictiveDeltaY.value = event.touchY - predictiveStartYRef.current;
        predictiveProgress.value = event.progress;
      },
      onInvoke: () => {
        if (closingRef.current) {
          cancelAnimation(progress);
          finalizeClose();
          return;
        }
        const wasGesturing = predictiveGesturingRef.current && predictiveProgress.value > 0.01;
        predictiveGesturingRef.current = false;
        if (wasGesturing) {
          const frame = computePredictiveBackShellFrame(
            predictiveProgress.value,
            predictiveDeltaY.value,
            predictiveEdge.value,
            screenWVal.value,
            screenHVal.value,
          );
          predictiveActive.value = 0;
          predictiveProgress.value = 0;
          predictiveDeltaY.value = 0;
          startDismissFromDragOnJS(
            frame.x,
            frame.y,
            frame.width,
            frame.height,
            frame.radius,
            frame.scale,
          );
        } else {
          predictiveActive.value = 0;
          predictiveProgress.value = 0;
          predictiveDeltaY.value = 0;
          requestClose();
        }
      },
      onCancel: () => {
        predictiveGesturingRef.current = false;
        predictiveActive.value = 0;
        predictiveProgress.value = withSpring(0, motion.spring.spatialFast);
        predictiveDeltaY.value = withSpring(0, motion.spring.spatialFast);
      },
    });
    return () => {
      release();
      if (!closingRef.current && predictiveGesturingRef.current) {
        predictiveGesturingRef.current = false;
        predictiveActive.value = 0;
        predictiveProgress.value = withSpring(0, motion.spring.spatialFast);
        predictiveDeltaY.value = withSpring(0, motion.spring.spatialFast);
      }
    };
  }, [
    finalizeClose,
    predictiveActive,
    predictiveDeltaY,
    predictiveEdge,
    predictiveProgress,
    progress,
    requestClose,
    screenHVal,
    screenWVal,
    shouldUseNativePredictive,
    startDismissFromDragOnJS,
    useSharedStrip,
  ]);

  // Fallback dla Androida < 14 i Expo Go bez natywnego modułu Predictive Back.
  useFocusEffect(
    useCallback(() => {
      if (Platform.OS === 'web' || nativePredictiveSupported) return undefined;
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        if (!canInterceptBackRef.current) return false;
        requestClose();
        return true;
      });
      return () => sub.remove();
    }, [nativePredictiveSupported, requestClose]),
  );

  // Interaktywny gest wstecz z lewej krawędzi (iOS i Android < 14): ręczna aktywacja na wątku UI
  // nie blokuje pionowego scrollowania ani gestów SwipeableLegCard w głębi ekranu.
  const backPanGesture = useMemo(
    () =>
      Gesture.Pan()
        .enabled(Platform.OS !== 'web' && !nativePredictiveSupported)
        .manualActivation(true)
        .onTouchesDown((e, stateManager) => {
          'worklet';
          if (
            e.numberOfTouches !== 1 ||
            !canGestureBackVal.value ||
            isClosingVal.value === 1 ||
            progress.value < 0.85
          ) {
            edgeEligible.value = false;
            stateManager.fail();
            return;
          }
          const touch = e.allTouches[0];
          if (!touch || touch.absoluteX > EDGE_BACK_ZONE_PX) {
            edgeEligible.value = false;
            stateManager.fail();
            return;
          }
          touchStartX.value = touch.absoluteX;
          touchStartY.value = touch.absoluteY;
          edgeEligible.value = true;
        })
        .onTouchesMove((e, stateManager) => {
          'worklet';
          if (!edgeEligible.value || isDragging.value === 1) return;
          if (e.numberOfTouches !== 1) {
            edgeEligible.value = false;
            stateManager.fail();
            return;
          }
          const touch = e.allTouches[0];
          const dx = touch.absoluteX - touchStartX.value;
          const dy = touch.absoluteY - touchStartY.value;
          if (dx < -6 || (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx))) {
            edgeEligible.value = false;
            stateManager.fail();
            return;
          }
          if (dx > 8 && dx > Math.abs(dy) * 1.25) {
            isDragging.value = 1;
            useSharedStrip.value = 0;
            stateManager.activate();
          }
        })
        .onTouchesUp((_e, stateManager) => {
          'worklet';
          if (isDragging.value === 0) {
            edgeEligible.value = false;
            stateManager.fail();
          }
        })
        .onTouchesCancelled((_e, stateManager) => {
          'worklet';
          if (isDragging.value === 0) {
            edgeEligible.value = false;
            stateManager.fail();
          }
        })
        .onUpdate((e) => {
          'worklet';
          if (isDragging.value === 0) return;
          const dx = Math.max(0, e.translationX);
          dragX.value = dx;
          dragY.value = e.translationY;
          const denom = Math.max(180, screenWVal.value * 0.72);
          dragProgress.value = Math.max(0, Math.min(1, dx / denom));
        })
        .onEnd((e) => {
          'worklet';
          if (isDragging.value === 0) return;
          edgeEligible.value = false;
          const dx = Math.max(0, e.translationX);
          const denom = Math.max(180, screenWVal.value * 0.72);
          const dp = Math.max(0, Math.min(1, dx / denom));
          if (shouldDismissFromGesture(dp, e.velocityX)) {
            const frame = computeDragShellFrame(
              dx,
              e.translationY,
              dp,
              screenWVal.value,
              screenHVal.value,
            );
            runOnJS(startDismissFromDragOnJS)(
              frame.x,
              frame.y,
              frame.width,
              frame.height,
              frame.radius,
              frame.scale,
            );
          } else {
            isDragging.value = 0;
            dragProgress.value = withSpring(0, motion.spring.spatialFast);
            dragX.value = withSpring(0, motion.spring.spatialFast);
            dragY.value = withSpring(0, motion.spring.spatialFast);
          }
        })
        .onFinalize(() => {
          'worklet';
          edgeEligible.value = false;
          if (isDragging.value === 1 && isClosingVal.value === 0) {
            isDragging.value = 0;
            dragProgress.value = withSpring(0, motion.spring.spatialFast);
            dragX.value = withSpring(0, motion.spring.spatialFast);
            dragY.value = withSpring(0, motion.spring.spatialFast);
          }
        }),
    [
      canGestureBackVal,
      dragProgress,
      dragX,
      dragY,
      edgeEligible,
      isClosingVal,
      isDragging,
      nativePredictiveSupported,
      progress,
      screenHVal,
      screenWVal,
      startDismissFromDragOnJS,
      touchStartX,
      touchStartY,
      useSharedStrip,
    ],
  );

  const scrimStyle = useAnimatedStyle(() => {
    const pp = predictiveProgress.value;
    if (predictiveActive.value === 1 || pp > 0.001) {
      return {
        opacity: interpolate(pp, [0, 1], [0.56, 0.14], Extrapolation.CLAMP),
      };
    }
    const dp = dragProgress.value;
    if (isDragging.value === 1 || dp > 0.001) {
      return {
        opacity: interpolate(dp, [0, 1], [0.56, 0.12], Extrapolation.CLAMP),
      };
    }
    return {
      opacity: interpolate(progress.value, [0, 0.78, 1], [0, 0.46, 0.56], Extrapolation.CLAMP),
    };
  });

  const shellStyle = useAnimatedStyle(() => {
    const w = screenWVal.value;
    const h = screenHVal.value;
    const pp = predictiveProgress.value;
    if (predictiveActive.value === 1 || pp > 0.001) {
      const frame = computePredictiveBackShellFrame(
        pp,
        predictiveDeltaY.value,
        predictiveEdge.value,
        w,
        h,
      );
      const gpu = computeGpuShellTransform(frame, w, h);
      return {
        left: 0,
        top: 0,
        width: w,
        height: h,
        borderRadius: gpu.borderRadius,
        backgroundColor: surfaceBg,
        transform: [
          { translateX: gpu.translateX },
          { translateY: gpu.translateY },
          { scale: gpu.scale },
        ],
      };
    }
    const dp = dragProgress.value;
    if (isDragging.value === 1 || dp > 0.001) {
      const frame = computeDragShellFrame(dragX.value, dragY.value, dp, w, h);
      const gpu = computeGpuShellTransform(frame, w, h);
      return {
        left: 0,
        top: 0,
        width: w,
        height: h,
        borderRadius: gpu.borderRadius,
        backgroundColor: surfaceBg,
        transform: [
          { translateX: gpu.translateX },
          { translateY: gpu.translateY },
          { scale: gpu.scale },
        ],
      };
    }

    const p = progress.value;
    const fromDrag = dismissingFromDrag.value === 1;
    const endX = fromDrag ? dismissStartX.value : 0;
    const endY = fromDrag ? dismissStartY.value : 0;
    const endW = fromDrag ? dismissStartW.value : w;
    const endH = fromDrag ? dismissStartH.value : h;
    const endR = fromDrag ? dismissStartR.value : 0;

    const left = interpolate(p, [0, 1], [srcX.value, endX]);
    const top = interpolate(p, [0, 1], [srcY.value, endY]);
    const width = interpolate(p, [0, 1], [srcW.value, endW]);
    const height = interpolate(p, [0, 1], [srcH.value, endH]);
    const borderRadius = fromDrag
      ? interpolate(p, [0, 1], [shape.extraLarge, endR], Extrapolation.CLAMP)
      : interpolate(p, [0, 0.84, 1], [shape.extraLarge, 10, 0], Extrapolation.CLAMP);

    return {
      left: 0,
      top: 0,
      width,
      height,
      borderRadius,
      backgroundColor: interpolateColor(p, [0, 0.52, 1], [cardBg, surfaceBg, surfaceBg]),
      transform: [{ translateX: left }, { translateY: top }],
    };
  });

  // Obramowanie karty mieszka na osobnej nakładce z animowanym opacity, aby Yoga nie przeliczała borderWidth.
  const shellBorderOverlayStyle = useAnimatedStyle(() => {
    const w = screenWVal.value;
    const h = screenHVal.value;
    const pp = predictiveProgress.value;
    if (predictiveActive.value === 1 || pp > 0.001) {
      const frame = computePredictiveBackShellFrame(
        pp,
        predictiveDeltaY.value,
        predictiveEdge.value,
        w,
        h,
      );
      const gpu = computeGpuShellTransform(frame, w, h);
      return {
        opacity: pp > 0.02 ? 1 : 0,
        borderRadius: gpu.borderRadius,
        borderColor: cardBorder,
      };
    }
    const dp = dragProgress.value;
    if (isDragging.value === 1 || dp > 0.001) {
      const frame = computeDragShellFrame(dragX.value, dragY.value, dp, w, h);
      const gpu = computeGpuShellTransform(frame, w, h);
      return {
        opacity: dp > 0.02 ? 1 : 0,
        borderRadius: gpu.borderRadius,
        borderColor: cardBorder,
      };
    }
    const p = progress.value;
    const fromDrag = dismissingFromDrag.value === 1;
    const endR = fromDrag ? dismissStartR.value : 0;
    const borderRadius = fromDrag
      ? interpolate(p, [0, 1], [shape.extraLarge, endR], Extrapolation.CLAMP)
      : interpolate(p, [0, 0.84, 1], [shape.extraLarge, 10, 0], Extrapolation.CLAMP);
    return {
      opacity: fromDrag
        ? 1
        : p < 0.995
          ? interpolate(p, [0, 0.55, 1], [1, 0, 0], Extrapolation.CLAMP)
          : 0,
      borderRadius,
      borderColor: cardBorder,
    };
  });

  // Stały rozmiar ekranu szczegółów w środku: zero przeliczania Yoga layoutu w trakcie animacji.
  const detailLayerStyle = useAnimatedStyle(() => {
    const w = screenWVal.value;
    const h = screenHVal.value;
    const pp = predictiveProgress.value;
    if (predictiveActive.value === 1 || pp > 0.001) {
      return {
        opacity: 1,
        transform: [],
      };
    }
    const dp = dragProgress.value;
    if (isDragging.value === 1 || dp > 0.001) {
      return {
        opacity: 1,
        transform: [],
      };
    }

    const p = progress.value;
    const fromDrag = dismissingFromDrag.value === 1;
    const endW = fromDrag ? dismissStartW.value : w;
    const currentW = interpolate(p, [0, 1], [srcW.value, endW]);
    const scale = w > 0 ? currentW / w : 1;
    const anchorOffset = topLeftScaleTranslation(w, h, scale);
    // Delikatne przesunięcie pionowe przybliża kartę podsumowania do górnej krawędzi karty źródłowej.
    const summaryLift = fromDrag ? 0 : (1 - p) * -(topInset + 40) * 0.58;

    return {
      opacity: fromDrag
        ? interpolate(p, [0.14, 0.65], [0, 1], Extrapolation.CLAMP)
        : interpolate(p, [0.16, 0.68], [0, 1], Extrapolation.CLAMP),
      transform: [
        { translateX: anchorOffset.x },
        { translateY: anchorOffset.y + summaryLift },
        { scale },
      ],
    };
  });

  // Podgląd klikniętej karty płynnie krzyżuje się z ekranem szczegółów przy p bliskim 0.
  const cardGhostStyle = useAnimatedStyle(() => {
    if (
      predictiveActive.value === 1 ||
      predictiveProgress.value > 0.001 ||
      isDragging.value === 1 ||
      dragProgress.value > 0.001
    ) {
      return { opacity: 0 };
    }
    const p = progress.value;
    const fromDrag = dismissingFromDrag.value === 1;
    const endW = fromDrag ? dismissStartW.value : screenWVal.value;
    const currentW = interpolate(p, [0, 1], [srcW.value, endW]);
    const baseW = Math.max(1, srcW.value);
    const scale = currentW / baseW;
    const anchorOffset = topLeftScaleTranslation(srcW.value, srcH.value, scale);
    return {
      opacity: interpolate(p, [0, 0.36], [1, 0], Extrapolation.CLAMP),
      transform: [{ translateX: anchorOffset.x }, { translateY: anchorOffset.y }, { scale }],
    };
  });

  // Wewnętrzny pasek w karcie-duchu ukrywa się, gdy aktywny jest wspólny latający pasek.
  const ghostStripStyle = useAnimatedStyle(() => ({
    opacity: useSharedStrip.value === 1 ? 0 : 1,
  }));

  // Docelowy pasek w ConnectionSummary ukrywa się na czas lotu wspólnego paska (handoff w 1 klatce UI).
  const targetStripAnimatedStyle = useAnimatedStyle(() => ({
    opacity: useSharedStrip.value === 1 ? 0 : 1,
  }));

  const headerAnimatedStyle = useAnimatedStyle(() => {
    if (
      predictiveActive.value === 1 ||
      predictiveProgress.value > 0.001 ||
      isDragging.value === 1 ||
      dragProgress.value > 0.001
    ) {
      return { opacity: 1, transform: [{ translateY: 0 }] };
    }
    const p = progress.value;
    return {
      opacity: interpolate(p, [0.34, 0.84], [0, 1], Extrapolation.CLAMP),
      transform: [{ translateY: interpolate(p, [0.34, 1], [-8, 0], Extrapolation.CLAMP) }],
    };
  });

  const belowSummaryAnimatedStyle = useAnimatedStyle(() => {
    if (
      predictiveActive.value === 1 ||
      predictiveProgress.value > 0.001 ||
      isDragging.value === 1 ||
      dragProgress.value > 0.001
    ) {
      return { opacity: 1, transform: [{ translateY: 0 }] };
    }
    const p = progress.value;
    if (isClosingVal.value === 1) {
      return {
        opacity: interpolate(p, [0.55, 0.95], [0, 1], Extrapolation.CLAMP),
        transform: [{ translateY: interpolate(p, [0.55, 1], [12, 0], Extrapolation.CLAMP) }],
      };
    }
    return {
      opacity: interpolate(p, [0.28, 0.86], [0, 1], Extrapolation.CLAMP),
      transform: [{ translateY: interpolate(p, [0.28, 1], [16, 0], Extrapolation.CLAMP) }],
    };
  });

  // Wspólny latający pasek JourneyStrip: płynny lot na GPU między kartą listy a ConnectionSummary.
  const flyingStripStyle = useAnimatedStyle(() => {
    if (useSharedStrip.value === 0) {
      return { opacity: 0 };
    }
    const p = progress.value;
    const fromDrag = dismissingFromDrag.value === 1;
    const endX = fromDrag ? dragStripX.value : dstStripX.value;
    const endY = fromDrag ? dragStripY.value : dstStripY.value;
    const endW = fromDrag ? dragStripW.value : dstStripW.value;
    const endH = fromDrag ? dragStripH.value : dstStripH.value;

    const currentX = interpolate(p, [0, 1], [srcStripX.value, endX]);
    const currentY = interpolate(p, [0, 1], [srcStripY.value, endY]);
    const currentW = interpolate(p, [0, 1], [srcStripW.value, endW]);
    const currentH = interpolate(p, [0, 1], [srcStripH.value, endH]);

    const baseW = Math.max(1, srcStripW.value);
    const baseH = Math.max(1, srcStripH.value);
    const scaleX = currentW / baseW;
    const scaleY = currentH / baseH;
    const anchorX = (baseW * (scaleX - 1)) / 2;
    const anchorY = (baseH * (scaleY - 1)) / 2;

    return {
      opacity: source.dimmed ? interpolate(p, [0, 1], [0.72, 1], Extrapolation.CLAMP) : 1,
      transform: [
        { translateX: currentX + anchorX },
        { translateY: currentY + anchorY },
        { scaleX },
        { scaleY },
      ],
    };
  });

  const renderProps = useMemo<MorphShellRenderProps>(
    () => ({
      onTargetStripRect: handleTargetStripRect,
      targetStripAnimatedStyle,
      headerAnimatedStyle,
      belowSummaryAnimatedStyle,
      requestClose,
    }),
    [
      belowSummaryAnimatedStyle,
      handleTargetStripRect,
      headerAnimatedStyle,
      requestClose,
      targetStripAnimatedStyle,
    ],
  );

  return (
    <GestureDetector gesture={backPanGesture}>
      <View style={styles.root} onLayout={handleRootLayout} collapsable={false}>
        <Animated.View
          style={[StyleSheet.absoluteFill, styles.scrim, scrimStyle]}
          pointerEvents="none"
        />

        <Animated.View style={[styles.shell, shellStyle]} collapsable={false}>
          <Animated.View
            style={[styles.detailLayer, { width: screenW, height: screenH }, detailLayerStyle]}
            collapsable={false}
          >
            {children(renderProps)}
          </Animated.View>

          <Animated.View
            pointerEvents="none"
            style={[
              styles.cardGhost,
              { width: source.cardRect.width, height: source.cardRect.height },
              cardGhostStyle,
            ]}
            collapsable={false}
          >
            <ConnectionCardMorphPreview
              item={source.connection}
              dimmed={source.dimmed}
              stripAnimatedStyle={ghostStripStyle}
              alternatives={source.alternatives}
            />
          </Animated.View>
          <Animated.View
            pointerEvents="none"
            style={[
              StyleSheet.absoluteFill,
              { borderWidth: cardBorderWidth },
              shellBorderOverlayStyle,
            ]}
            collapsable={false}
          />
        </Animated.View>

        {hasTransitStrip && (
          <Animated.View
            pointerEvents="none"
            style={[
              styles.flyingStrip,
              {
                width: source.stripRect!.width,
                height: source.stripRect!.height,
              },
              flyingStripStyle,
            ]}
            collapsable={false}
          >
            <JourneyStrip insights={stripInsights} interactive={false} />
          </Animated.View>
        )}
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  scrim: {
    backgroundColor: scheme.scrim,
  },
  shell: {
    position: 'absolute',
    overflow: 'hidden',
  },
  detailLayer: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
  cardGhost: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
  flyingStrip: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
});
