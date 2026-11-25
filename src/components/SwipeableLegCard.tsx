import React, { useCallback, useMemo } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { ChevronLeft, ChevronRight, RefreshCw } from './icons';
import { resolveLegBadgeColors } from './LineBadge';
import { MorphingLoader } from './MorphingLoader';
import { secondsToTimeString } from '../gtfs/geo';
import type { LegSwapSlotState, SwapDirection } from '../hooks/useLegAlternatives';
import { useStrings } from '../i18n';
import type { LegAlternative } from '../services/routing/legAlternatives';
import { motion } from '../theme/motion';
import { scheme, shape, type } from '../theme/tokens';

/** Próg przesunięcia (px), powyżej którego puszczenie karty podmienia kurs. */
const SWAP_THRESHOLD_PX = 56;
/** Maksymalny skok wizualny przy ciągnięciu w dostępnym kierunku. */
const MAX_PULL_PX = 96;
/** Maksymalny gumowy odciąg, gdy w danym kierunku brak alternatyw. */
const MAX_EDGE_PULL_PX = 22;

function MiniLinePill({ alt }: { alt: LegAlternative }) {
  const { bg, fg } = resolveLegBadgeColors({ mode: alt.mode, line: alt.line });
  return (
    <View style={[styles.miniPill, { backgroundColor: bg }]}>
      <Text style={[styles.miniPillText, { color: fg }]} numberOfLines={1}>
        {alt.line}
      </Text>
    </View>
  );
}

interface SwipeableLegCardProps {
  legId: string;
  slot?: LegSwapSlotState;
  currentLine?: string;
  onSwap?: (legId: string, direction: SwapDirection) => void;
  onRetry?: (legId: string) => void;
  renderCard: (footer: React.ReactNode) => React.ReactNode;
}

/**
 * Opakowuje kartę miejskiej nogi w gest przesunięcia w lewo/prawo (wcześniejszy/późniejszy
 * pasujący kurs) oraz dostępny pasek sterujący z podglądem najbliższych alternatyw.
 * Dopóki slot nie ma gotowych alternatyw, błędu lub jawnego ładowania, renderuje kartę
 * bez tworzenia hooków Reanimated ani GestureDetector.
 */
export const SwipeableLegCard = React.memo(function SwipeableLegCard(
  props: SwipeableLegCardProps,
) {
  const { slot, renderCard } = props;
  const hasInteractiveSlot = Boolean(
    slot?.swappable &&
      (slot.status === 'error' ||
        slot.loadingDirection !== null ||
        (slot.status === 'ready' &&
          (slot.hasEarlier ||
            slot.hasLater ||
            slot.canLoadMoreEarlier ||
            slot.canLoadMoreLater))),
  );
  if (!hasInteractiveSlot || !slot) {
    return <>{renderCard(null)}</>;
  }
  return <SwipeableLegCardActive {...props} slot={slot} />;
});

interface ActiveSwipeableLegCardProps extends Omit<SwipeableLegCardProps, 'slot'> {
  slot: LegSwapSlotState;
}

const SwipeableLegCardActive = React.memo(function SwipeableLegCardActive({
  legId,
  slot,
  currentLine,
  onSwap,
  onRetry,
  renderCard,
}: ActiveSwipeableLegCardProps) {
  const t = useStrings();
  const reducedMotion = useReducedMotion();
  const translateX = useSharedValue(0);
  const crossedThreshold = useSharedValue(false);

  const isBusy = slot.loadingDirection != null;
  const canGoEarlier = Boolean(slot.hasEarlier || slot.canLoadMoreEarlier);
  const canGoLater = Boolean(slot.hasLater || slot.canLoadMoreLater);
  const gestureEnabled =
    Platform.OS !== 'web' &&
    slot.status === 'ready' &&
    !isBusy &&
    (canGoEarlier || canGoLater) &&
    onSwap != null;

  const fireThresholdHaptic = useCallback(() => {
    void Haptics.selectionAsync().catch(() => {});
  }, []);

  const triggerSwap = useCallback(
    (direction: SwapDirection) => {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      onSwap?.(legId, direction);
    },
    [legId, onSwap],
  );

  const handleRetry = useCallback(() => {
    onRetry?.(legId);
  }, [legId, onRetry]);

  const handleButtonSwap = useCallback(
    (direction: SwapDirection) => {
      if (!onSwap || isBusy) return;
      if (direction === 'earlier' && !canGoEarlier) return;
      if (direction === 'later' && !canGoLater) return;
      triggerSwap(direction);
      if (!reducedMotion) {
        translateX.value = direction === 'earlier' ? -18 : 18;
        translateX.value = withSpring(0, motion.spring.spatialFast);
      }
    },
    [canGoEarlier, canGoLater, isBusy, onSwap, reducedMotion, translateX, triggerSwap],
  );

  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        .enabled(gestureEnabled)
        .activeOffsetX([-18, 18])
        .failOffsetY([-12, 12])
        .onTouchesDown((e, stateManager) => {
          'worklet';
          const touch = e.allTouches[0];
          // Lewa krawędź zostaje dla systemowego lub nawigacyjnego gestu wstecz.
          if (touch && touch.absoluteX < 32) {
            stateManager.fail();
          }
        })
        .onBegin(() => {
          crossedThreshold.value = false;
        })
        .onUpdate((e) => {
          const raw = e.translationX;
          const goingEarlier = raw > 0;
          const allowed = goingEarlier ? canGoEarlier : canGoLater;
          const abs = Math.abs(raw);
          const sign = goingEarlier ? 1 : -1;

          if (!allowed) {
            translateX.value = sign * Math.min(MAX_EDGE_PULL_PX, abs * 0.18);
            crossedThreshold.value = false;
            return;
          }

          const damped =
            abs <= SWAP_THRESHOLD_PX
              ? abs
              : Math.min(MAX_PULL_PX, SWAP_THRESHOLD_PX + (abs - SWAP_THRESHOLD_PX) * 0.35);
          translateX.value = sign * damped;

          const past = abs >= SWAP_THRESHOLD_PX;
          if (past && !crossedThreshold.value) {
            crossedThreshold.value = true;
            runOnJS(fireThresholdHaptic)();
          } else if (!past && crossedThreshold.value) {
            crossedThreshold.value = false;
          }
        })
        .onEnd((e) => {
          const wantEarlier =
            canGoEarlier &&
            (e.translationX >= SWAP_THRESHOLD_PX ||
              (e.velocityX >= 600 && e.translationX >= 22));
          const wantLater =
            canGoLater &&
            (e.translationX <= -SWAP_THRESHOLD_PX ||
              (e.velocityX <= -600 && e.translationX <= -22));

          if (wantEarlier) {
            runOnJS(triggerSwap)('earlier');
            if (reducedMotion) {
              translateX.value = 0;
            } else {
              translateX.value = -24;
              translateX.value = withSpring(0, motion.spring.spatialFast);
            }
          } else if (wantLater) {
            runOnJS(triggerSwap)('later');
            if (reducedMotion) {
              translateX.value = 0;
            } else {
              translateX.value = 24;
              translateX.value = withSpring(0, motion.spring.spatialFast);
            }
          } else {
            translateX.value = withSpring(0, motion.spring.spatialFast);
          }
        })
        .onFinalize(() => {
          crossedThreshold.value = false;
        }),
    [
      canGoEarlier,
      canGoLater,
      crossedThreshold,
      fireThresholdHaptic,
      gestureEnabled,
      reducedMotion,
      translateX,
      triggerSwap,
    ],
  );

  const cardMotionStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  const leftTrayStyle = useAnimatedStyle(() => ({
    opacity: interpolate(translateX.value, [8, SWAP_THRESHOLD_PX], [0, 1], Extrapolation.CLAMP),
    transform: [
      {
        scale: interpolate(
          translateX.value,
          [0, SWAP_THRESHOLD_PX],
          [0.92, 1],
          Extrapolation.CLAMP,
        ),
      },
    ],
  }));

  const rightTrayStyle = useAnimatedStyle(() => ({
    opacity: interpolate(translateX.value, [-SWAP_THRESHOLD_PX, -8], [1, 0], Extrapolation.CLAMP),
    transform: [
      {
        scale: interpolate(
          translateX.value,
          [-SWAP_THRESHOLD_PX, 0],
          [1, 0.92],
          Extrapolation.CLAMP,
        ),
      },
    ],
  }));

  const showError = slot.status === 'error';
  const showBar =
    !showError &&
    (slot.loadingDirection !== null ||
      (slot.status === 'ready' && (canGoEarlier || canGoLater)));

  const earlierTime = slot.earlierAlt
    ? secondsToTimeString(slot.earlierAlt.effectiveDepartureSec)
    : null;
  const laterTime = slot.laterAlt
    ? secondsToTimeString(slot.laterAlt.effectiveDepartureSec)
    : null;
  const normCurrent = (currentLine ?? '').trim().toUpperCase();
  const earlierDiffLine =
    slot.earlierAlt != null && slot.earlierAlt.line.trim().toUpperCase() !== normCurrent;
  const laterDiffLine =
    slot.laterAlt != null && slot.laterAlt.line.trim().toUpperCase() !== normCurrent;

  const footer = showError ? (
    <View style={styles.footerDock}>
      <View style={styles.errorFooter}>
        <Text style={styles.errorText} numberOfLines={2}>
          {t.leg.swapError}
        </Text>
        {onRetry ? (
          <Pressable
            onPress={handleRetry}
            accessibilityRole="button"
            accessibilityLabel={t.leg.swapRetry}
            style={({ pressed }) => [styles.retryBtn, pressed && styles.pressed]}
          >
            <RefreshCw size={14} color={scheme.primary} />
            <Text style={styles.retryText}>{t.leg.swapRetry}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  ) : showBar ? (
    <View style={styles.footerDock}>
      <View style={styles.footerBar}>
        <Pressable
          onPress={() => handleButtonSwap('earlier')}
          disabled={!canGoEarlier || isBusy}
          accessibilityRole="button"
          accessibilityLabel={
            slot.earlierAlt && earlierTime
              ? t.leg.swapEarlierA11y(slot.earlierAlt.line, earlierTime)
              : t.leg.swapLoadMoreEarlierA11y
          }
          accessibilityState={{ disabled: !canGoEarlier || isBusy }}
          style={({ pressed }) => [
            styles.stepBtn,
            styles.stepBtnLeft,
            !canGoEarlier && styles.stepBtnDisabled,
            pressed && canGoEarlier && !isBusy && styles.pressed,
          ]}
        >
          {slot.loadingDirection === 'earlier' ? (
            <View style={styles.loadingRow}>
              <MorphingLoader size={15} color={scheme.primary} />
              <Text style={styles.stepLabelMuted} numberOfLines={1}>
                {t.leg.swapLoading}
              </Text>
            </View>
          ) : (
            <>
              <ChevronLeft
                size={15}
                color={canGoEarlier ? scheme.onSurfaceVariant : scheme.outlineVariant}
              />
              <Text style={styles.stepLabel} numberOfLines={1}>
                {t.leg.swapEarlier}
              </Text>
              {slot.earlierAlt && earlierTime ? (
                <View style={styles.stepMeta}>
                  {earlierDiffLine ? <MiniLinePill alt={slot.earlierAlt} /> : null}
                  <Text style={styles.stepTime} numberOfLines={1}>
                    {earlierTime}
                  </Text>
                </View>
              ) : null}
            </>
          )}
        </Pressable>

        <View style={styles.stepDivider} />

        <Pressable
          onPress={() => handleButtonSwap('later')}
          disabled={!canGoLater || isBusy}
          accessibilityRole="button"
          accessibilityLabel={
            slot.laterAlt && laterTime
              ? t.leg.swapLaterA11y(slot.laterAlt.line, laterTime)
              : t.leg.swapLoadMoreLaterA11y
          }
          accessibilityState={{ disabled: !canGoLater || isBusy }}
          style={({ pressed }) => [
            styles.stepBtn,
            styles.stepBtnRight,
            !canGoLater && styles.stepBtnDisabled,
            pressed && canGoLater && !isBusy && styles.pressed,
          ]}
        >
          {slot.loadingDirection === 'later' ? (
            <View style={styles.loadingRow}>
              <Text style={styles.stepLabelMuted} numberOfLines={1}>
                {t.leg.swapLoading}
              </Text>
              <MorphingLoader size={15} color={scheme.primary} />
            </View>
          ) : (
            <>
              {slot.laterAlt && laterTime ? (
                <View style={styles.stepMeta}>
                  <Text style={styles.stepTime} numberOfLines={1}>
                    {laterTime}
                  </Text>
                  {laterDiffLine ? <MiniLinePill alt={slot.laterAlt} /> : null}
                </View>
              ) : null}
              <Text style={styles.stepLabel} numberOfLines={1}>
                {t.leg.swapLater}
              </Text>
              <ChevronRight
                size={15}
                color={canGoLater ? scheme.onSurfaceVariant : scheme.outlineVariant}
              />
            </>
          )}
        </Pressable>
      </View>
    </View>
  ) : null;

  return (
    <View style={styles.outer}>
      {gestureEnabled ? (
        <View style={styles.traysLayer} pointerEvents="none" importantForAccessibility="no-hide-descendants">
          <Animated.View style={[styles.traySide, styles.trayLeft, leftTrayStyle]}>
            <ChevronLeft
              size={18}
              color={canGoEarlier ? scheme.primary : scheme.onSurfaceVariant}
            />
            <View style={styles.trayTextCol}>
              {slot.earlierAlt && earlierTime ? (
                <View style={styles.trayPreviewRow}>
                  <MiniLinePill alt={slot.earlierAlt} />
                  <Text style={styles.trayTime} numberOfLines={1}>
                    {earlierTime}
                  </Text>
                </View>
              ) : null}
              <Text style={styles.trayLabel} numberOfLines={1}>
                {canGoEarlier ? t.leg.swapEarlier : t.leg.swapNoEarlier}
              </Text>
            </View>
          </Animated.View>

          <Animated.View style={[styles.traySide, styles.trayRight, rightTrayStyle]}>
            <View style={[styles.trayTextCol, styles.trayTextRight]}>
              {slot.laterAlt && laterTime ? (
                <View style={styles.trayPreviewRow}>
                  <Text style={styles.trayTime} numberOfLines={1}>
                    {laterTime}
                  </Text>
                  <MiniLinePill alt={slot.laterAlt} />
                </View>
              ) : null}
              <Text style={styles.trayLabel} numberOfLines={1}>
                {canGoLater ? t.leg.swapLater : t.leg.swapNoLater}
              </Text>
            </View>
            <ChevronRight
              size={18}
              color={canGoLater ? scheme.primary : scheme.onSurfaceVariant}
            />
          </Animated.View>
        </View>
      ) : null}

      <GestureDetector gesture={panGesture}>
        <Animated.View style={cardMotionStyle}>{renderCard(footer)}</Animated.View>
      </GestureDetector>
    </View>
  );
});

const styles = StyleSheet.create({
  outer: {
    position: 'relative',
    borderRadius: shape.extraLarge,
    overflow: 'hidden',
  },
  traysLayer: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: scheme.surfaceContainerHigh,
    borderRadius: shape.extraLarge,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
  },
  traySide: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    maxWidth: '46%',
  },
  trayLeft: {
    justifyContent: 'flex-start',
  },
  trayRight: {
    justifyContent: 'flex-end',
  },
  trayTextCol: {
    gap: 2,
    flexShrink: 1,
  },
  trayTextRight: {
    alignItems: 'flex-end',
  },
  trayPreviewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  trayTime: {
    ...type.labelLarge,
    color: scheme.onSurface,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  trayLabel: {
    ...type.labelSmall,
    color: scheme.onSurfaceVariant,
  },
  footerDock: {
    marginTop: 12,
    marginHorizontal: -14,
    marginBottom: -16,
    backgroundColor: scheme.surfaceContainerLow,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: scheme.outlineVariant,
    borderBottomLeftRadius: shape.extraLarge,
    borderBottomRightRadius: shape.extraLarge,
  },
  footerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    minHeight: 44,
  },
  stepBtn: {
    flex: 1,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 6,
    borderRadius: shape.medium,
  },
  stepBtnLeft: {
    justifyContent: 'flex-start',
  },
  stepBtnRight: {
    justifyContent: 'flex-end',
  },
  stepBtnDisabled: {
    opacity: 0.36,
  },
  pressed: {
    opacity: 0.72,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 1,
  },
  stepLabel: {
    ...type.labelMedium,
    color: scheme.onSurfaceVariant,
    fontWeight: '600',
    flexShrink: 1,
  },
  stepMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flexShrink: 0,
  },
  stepTime: {
    ...type.labelSmall,
    color: scheme.onSurfaceVariant,
    fontWeight: '500',
    fontVariant: ['tabular-nums'],
  },
  stepLabelMuted: {
    ...type.labelMedium,
    color: scheme.onSurfaceVariant,
    flexShrink: 1,
  },
  stepDivider: {
    width: StyleSheet.hairlineWidth,
    height: 18,
    backgroundColor: scheme.outlineVariant,
    marginHorizontal: 4,
  },
  miniPill: {
    borderRadius: shape.extraSmall,
    paddingHorizontal: 5,
    paddingVertical: 1,
    minWidth: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  miniPillText: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '800',
  },
  errorFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingLeft: 14,
    paddingRight: 8,
    minHeight: 44,
  },
  errorText: {
    ...type.bodySmall,
    color: scheme.onSurfaceVariant,
    flex: 1,
  },
  retryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    minHeight: 44,
    paddingHorizontal: 10,
    borderRadius: shape.medium,
  },
  retryText: {
    ...type.labelLarge,
    color: scheme.primary,
    fontWeight: '700',
  },
});
