import { memo, useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  FadeIn,
  FadeOut,
  LinearTransition,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { AlertCircle, Check, Download, RefreshCw } from './icons';
import { MorphingLoader } from './MorphingLoader';
import { SpringPressable } from './SpringPressable';
import { motion } from '../theme/motion';
import { scheme, shape, type } from '../theme/tokens';
import { useStrings } from '../i18n';
import type { DataStatus } from '../services/dataManager';

interface TimetableBackgroundPillProps {
  cityGen: string;
  status: DataStatus;
  checking?: boolean;
  onRetry: () => void;
}

/**
 * Kompaktowy wskaźnik pobierania rozkładu w tle nad stopką onboardingu.
 * Zastępuje osobny blokujący krok pobierania, zachowując pełną kontrolę przy błędzie sieci.
 */
export const TimetableBackgroundPill = memo(function TimetableBackgroundPill({
  cityGen,
  status,
  checking = false,
  onRetry,
}: TimetableBackgroundPillProps) {
  const s = useStrings();
  const reduceMotion = useReducedMotion();
  const barProgress = useSharedValue(0);

  const isWorking = status.state === 'downloading' || status.state === 'importing';
  const isCheckingEmpty = checking && status.state === 'empty';
  const pct = isWorking ? Math.max(0, Math.min(100, Math.round(status.progress * 100))) : 0;

  useEffect(() => {
    const target = isWorking ? Math.max(0.06, Math.min(1, status.progress)) : 0;
    if (reduceMotion) {
      barProgress.value = target;
    } else {
      barProgress.value = withTiming(target, { duration: 240, easing: motion.state.easing });
    }
  }, [barProgress, isWorking, reduceMotion, status]);

  const progressFillStyle = useAnimatedStyle(() => ({
    width: `${Math.round(barProgress.value * 100)}%`,
  }));

  const label =
    status.state === 'downloading'
      ? s.onboarding.bgDlDownloading(cityGen, pct)
      : status.state === 'importing'
        ? s.onboarding.bgDlImporting(cityGen, pct)
        : status.state === 'ready'
          ? s.onboarding.bgDlReady(cityGen)
          : status.state === 'error'
            ? s.onboarding.bgDlError
            : s.onboarding.bgDlPending(cityGen);

  return (
    <Animated.View
      entering={reduceMotion ? undefined : FadeIn.duration(200)}
      exiting={reduceMotion ? undefined : FadeOut.duration(150)}
      layout={reduceMotion ? undefined : LinearTransition.springify().damping(24).stiffness(320)}
      style={[
        styles.pill,
        status.state === 'ready' && styles.pillReady,
        status.state === 'error' && styles.pillError,
      ]}
      accessibilityLiveRegion="polite"
    >
      <View style={styles.row}>
        <View
          style={[
            styles.iconBox,
            status.state === 'ready' && styles.iconReady,
            status.state === 'error' && styles.iconError,
          ]}
        >
          {isWorking || isCheckingEmpty ? (
            <MorphingLoader size={16} color={scheme.primary} />
          ) : status.state === 'ready' ? (
            <Check size={14} color={scheme.onSuccessContainer} />
          ) : status.state === 'error' ? (
            <AlertCircle size={15} color={scheme.onErrorContainer} />
          ) : (
            <Download size={14} color={scheme.onSurfaceVariant} />
          )}
        </View>

        <Text
          style={[
            styles.text,
            status.state === 'ready' && styles.textReady,
            status.state === 'error' && styles.textError,
          ]}
          numberOfLines={1}
        >
          {label}
        </Text>

        {(status.state === 'error' || (status.state === 'empty' && !isCheckingEmpty)) && (
          <SpringPressable
            onPress={onRetry}
            haptic="selection"
            hitSlop={8}
            style={[styles.actionBtn, status.state === 'error' && styles.actionBtnError]}
            accessibilityRole="button"
          >
            {status.state === 'error' ? (
              <RefreshCw size={13} color={scheme.onErrorContainer} />
            ) : (
              <Download size={13} color={scheme.onPrimaryContainer} />
            )}
            <Text
              style={[styles.actionText, status.state === 'error' && styles.actionTextError]}
            >
              {status.state === 'error' ? s.onboarding.bgDlRetry : s.onboarding.bgDlStart}
            </Text>
          </SpringPressable>
        )}
      </View>

      {isWorking && (
        <View style={styles.progressTrack} pointerEvents="none">
          <Animated.View style={[styles.progressFill, progressFillStyle]} />
        </View>
      )}
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  pill: {
    borderRadius: shape.large,
    backgroundColor: scheme.surfaceContainerLow,
    borderWidth: 2,
    borderColor: scheme.outlineVariant,
    overflow: 'hidden',
  },
  pillReady: {
    backgroundColor: scheme.surfaceContainerLow,
    borderColor: `${scheme.success}44`,
  },
  pillError: {
    backgroundColor: `${scheme.errorContainer}66`,
    borderColor: `${scheme.error}55`,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 42,
  },
  iconBox: {
    width: 26,
    height: 26,
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconReady: {
    backgroundColor: scheme.successContainer,
  },
  iconError: {
    backgroundColor: scheme.errorContainer,
  },
  text: {
    ...type.labelMedium,
    color: scheme.onSurface,
    flex: 1,
    fontVariant: ['tabular-nums'],
  },
  textReady: {
    color: scheme.onSurface,
  },
  textError: {
    color: scheme.onErrorContainer,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    minHeight: 32,
    borderRadius: shape.full,
    backgroundColor: scheme.primaryContainer,
  },
  actionBtnError: {
    backgroundColor: scheme.errorContainer,
  },
  actionText: {
    ...type.labelSmall,
    color: scheme.onPrimaryContainer,
    fontWeight: '700',
  },
  actionTextError: {
    color: scheme.onErrorContainer,
  },
  progressTrack: {
    height: 3,
    backgroundColor: scheme.surfaceContainerHighest,
    width: '100%',
  },
  progressFill: {
    height: '100%',
    backgroundColor: scheme.primary,
  },
});
