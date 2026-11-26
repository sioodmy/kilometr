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
import {
  EDGE_BACK_ZONE_PX,
  MAX_SHARED_STRIP_RETURN_SCROLL_Y,
  computeCloseDurationMs,
  computeDragShellFrame,
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
  damping: 29,
  stiffness: 360,
  mass: 0.82,
  overshootClamping: true,
  reduceMotion: ReduceMotion.System,
};

const CLOSE_EASING = Easing.bezier(0.2, 0, 0, 1);
const OPEN_SETTLE_FALLBACK_MS = 420;
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

  const walkMps = useWalkSpeedMps();
  const thresholds = useTransferThresholds();
  const stripInsights = useMemo(
    () => analyzeConnection(connection, walkMps, thresholds),
    [connection, walkMps, thresholds],
  );
  const hasTransitStrip = stripInsights.transitLegs.length > 0 && source.stripRect != null;

  const cardColors = resolveCardColors(source.variant);
  const surfaceBg = scheme.surface;
  const cardBg = cardColors.bg;
  const cardBorder = cardColors.border;
  const cardBorderWidth = cardColors.borderWidth;

  const openStartedRef = useRef(false);
  const openSettledRef = useRef(false);
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

  // Stan interaktywnego gestu wstecz (lewa krawędź).
  const edgeEligible = useSharedValue(false);
  const isDragging = useSharedValue(0);
  const touchStartX = useSharedValue(0);
  const touchStartY = useSharedValue(0);
  const dragX = useSharedValue(0);
  const dragY = useSharedValue(0);
  const dragProgress = useSharedValue(0);

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
    if (hiddenCardId && hiddenCardId.value === source.normalizedId) {
      hiddenCardId.value = '';
    }
  }, [hiddenCardId, source.normalizedId]);

  // Ukrywamy oryginalną kartę na liście w tej samej klatce, w której montuje się morphShell.
  useLayoutEffect(() => {
    if (hiddenCardId) {
      hiddenCardId.value = source.normalizedId;
    }
    return () => {
      if (hiddenCardId && hiddenCardId.value === source.normalizedId) {
        hiddenCardId.value = '';
      }
    };
  }, [hiddenCardId, source.normalizedId]);

  const markOpenSettled = useCallback(() => {
    if (openSettledRef.current || closingRef.current) return;
    openSettledRef.current = true;
    useSharedStrip.value = 0;
    onSettledRef.current();
  }, [useSharedStrip]);

  const beginOpenAnimation = useCallback(() => {
    if (openStartedRef.current || closingRef.current) return;
    openStartedRef.current = true;
    progress.value = withSpring(1, OPEN_SPRING, (finished) => {
      'worklet';
      if (finished) {
        useSharedStrip.value = 0;
        runOnJS(markOpenSettled)();
      }
    });
  }, [markOpenSettled, progress, useSharedStrip]);

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

  // Bezpieczny start i finalizacja otwierania, gdyby pasek nie istniał lub callback się opóźnił.
  useEffect(() => {
    const startTimer = setTimeout(
      () => {
        beginOpenAnimation();
      },
      hasTransitStrip ? STRIP_MEASURE_FALLBACK_MS : 0,
    );

    const settleTimer = setTimeout(() => {
      markOpenSettled();
    }, OPEN_SETTLE_FALLBACK_MS);

    return () => {
      clearTimeout(startTimer);
      clearTimeout(settleTimer);
    };
  }, [beginOpenAnimation, hasTransitStrip, markOpenSettled]);

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
    void transition.measureCard(source.connectionId).then((measured) => {
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
    source.connectionId,
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
    isClosingVal.value = 1;
    dismissingFromDrag.value = 0;
    isDragging.value = 0;
    dragX.value = 0;
    dragY.value = 0;
    dragProgress.value = 0;

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
          if (hiddenCardId && hiddenCardId.value === source.normalizedId) {
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
    progress,
    refreshSourceCardGeometryInFlight,
    scrollYRef,
    source.normalizedId,
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
            if (hiddenCardId && hiddenCardId.value === source.normalizedId) {
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
      progress,
      refreshSourceCardGeometryInFlight,
      scrollYRef,
      source.normalizedId,
      useSharedStrip,
    ],
  );

  // Android: gest krawędziowy i przycisk wstecz zwijają ekran z powrotem do karty na liście.
  useFocusEffect(
    useCallback(() => {
      if (Platform.OS === 'web') return undefined;
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        if (!canInterceptBackRef.current) return false;
        requestClose();
        return true;
      });
      return () => sub.remove();
    }, [requestClose]),
  );

  // Interaktywny gest wstecz z lewej krawędzi (iOS i Android): ręczna aktywacja na wątku UI
  // nie blokuje pionowego scrollowania ani gestów SwipeableLegCard w głębi ekranu.
  const backPanGesture = useMemo(
    () =>
      Gesture.Pan()
        .enabled(Platform.OS !== 'web')
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
    const dp = dragProgress.value;
    if (isDragging.value === 1 || dp > 0.001) {
      const frame = computeDragShellFrame(dragX.value, dragY.value, dp, w, h);
      return {
        left: frame.x,
        top: frame.y,
        width: frame.width,
        height: frame.height,
        borderRadius: frame.radius,
        backgroundColor: surfaceBg,
        borderWidth: dp > 0.02 ? StyleSheet.hairlineWidth : 0,
        borderColor: cardBorder,
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
      left,
      top,
      width,
      height,
      borderRadius,
      backgroundColor: interpolateColor(p, [0, 0.52, 1], [cardBg, surfaceBg, surfaceBg]),
      borderWidth: p < 0.995 || fromDrag ? cardBorderWidth : 0,
      borderColor: interpolateColor(
        p,
        [0, 0.55, 1],
        [cardBorder, 'rgba(0,0,0,0)', 'rgba(0,0,0,0)'],
      ),
    };
  });

  // Stały rozmiar ekranu szczegółów w środku: zero przeliczania Yoga layoutu w trakcie animacji.
  const detailLayerStyle = useAnimatedStyle(() => {
    const w = screenWVal.value;
    const h = screenHVal.value;
    const dp = dragProgress.value;
    if (isDragging.value === 1 || dp > 0.001) {
      const frame = computeDragShellFrame(dragX.value, dragY.value, dp, w, h);
      const offset = topLeftScaleTranslation(w, h, frame.scale);
      return {
        opacity: 1,
        transform: [{ translateX: offset.x }, { translateY: offset.y }, { scale: frame.scale }],
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
    if (isDragging.value === 1 || dragProgress.value > 0.001) {
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
    if (isDragging.value === 1 || dragProgress.value > 0.001) {
      return { opacity: 1, transform: [{ translateY: 0 }] };
    }
    const p = progress.value;
    return {
      opacity: interpolate(p, [0.34, 0.84], [0, 1], Extrapolation.CLAMP),
      transform: [{ translateY: interpolate(p, [0.34, 1], [-8, 0], Extrapolation.CLAMP) }],
    };
  });

  const belowSummaryAnimatedStyle = useAnimatedStyle(() => {
    if (isDragging.value === 1 || dragProgress.value > 0.001) {
      return { opacity: 1, transform: [{ translateY: 0 }] };
    }
    const p = progress.value;
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
            />
          </Animated.View>
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
