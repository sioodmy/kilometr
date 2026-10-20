import { cloneElement, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import {
  AccessibilityInfo,
  BackHandler,
  findNodeHandle,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type PressableProps,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import * as Haptics from 'expo-haptics';
import Animated, {
  FadeIn,
  FadeOut,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowUp, Check, Footprints, X } from 'lucide-react-native';
import { useStrings } from '../i18n';
import { formatWalkTime, useWalkSpeedMps, walkMinutesFor } from '../services/settings';
import { motion } from '../theme/motion';
import { elev, scheme, shape, type } from '../theme/tokens';
import type { Connection } from '../types/models';
import { ConnectionSummary } from './ConnectionSummary';
import { LineBadge } from './LineBadge';

const POP_DISTANCE = 72;
const peekSpring = { damping: 26, stiffness: 420, mass: 0.8, reduceMotion: ReduceMotion.System };

function subtleHaptic() {
  if (Platform.OS === 'android') {
    void Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Segment_Frequent_Tick).catch(() => {});
  } else if (Platform.OS === 'ios') {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft).catch(() => {});
  }
}

export interface ConnectionPeekHandlers {
  show: (item: Connection, sticky?: boolean) => void;
  ready: (ready: boolean) => void;
  release: (item: Connection, open: boolean) => void;
}

export function ConnectionPeekTarget({
  item,
  handlers,
  children,
}: {
  item: Connection;
  handlers?: ConnectionPeekHandlers;
  children: ReactElement<PressableProps>;
}) {
  const active = useRef(false);
  const ready = useRef(false);
  const peeked = useRef(false);
  const popHapticSent = useRef(false);
  const gesture = useMemo(
    () =>
      Gesture.Pan()
        .enabled(!!handlers)
        .activateAfterLongPress(350)
        .maxPointers(1)
        .shouldCancelWhenOutside(false)
        .runOnJS(true)
        .onStart(() => {
          active.current = true;
          peeked.current = true;
          ready.current = false;
          popHapticSent.current = false;
          handlers?.show(item);
          subtleHaptic();
        })
        .onUpdate(({ translationY }) => {
          const next = translationY <= -POP_DISTANCE;
          if (ready.current !== next) {
            ready.current = next;
            handlers?.ready(next);
            if (next && !popHapticSent.current) {
              popHapticSent.current = true;
              subtleHaptic();
            }
          }
        })
        .onEnd(({ translationY }) => {
          active.current = false;
          handlers?.release(item, translationY <= -POP_DISTANCE);
        })
        .onFinalize(() => {
          if (active.current) handlers?.release(item, false);
          active.current = false;
        }),
    [handlers, item],
  );

  return handlers ? (
    <GestureDetector gesture={gesture}>
      {cloneElement(children, {
        onPressIn: (event) => {
          if (!active.current) peeked.current = false;
          children.props.onPressIn?.(event);
        },
        onPress: (event) => {
          if (!peeked.current) children.props.onPress?.(event);
        },
      })}
    </GestureDetector>
  ) : (
    children
  );
}

export function ConnectionPeek({
  item,
  ready,
  sticky,
  offline,
  onClose,
  onOpen,
}: {
  item: Connection;
  ready: boolean;
  sticky: boolean;
  offline: boolean;
  onClose: () => void;
  onOpen: () => void;
}) {
  const s = useStrings();
  const insets = useSafeAreaInsets();
  const { height, width } = useWindowDimensions();
  const walkMps = useWalkSpeedMps();
  const titleRef = useRef<Text>(null);
  const [focused, setFocused] = useState<'close' | 'open' | null>(null);
  const entrance = useSharedValue(0);
  const lift = useSharedValue(0);

  useEffect(() => {
    entrance.value = withSpring(1, peekSpring);
  }, [entrance]);
  useEffect(() => {
    lift.value = withSpring(ready ? 1 : 0, peekSpring);
  }, [lift, ready]);
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [onClose]);

  const animatedStyle = useAnimatedStyle(
    () => ({
      opacity: entrance.value,
      transform: [
        { scale: 0.94 + entrance.value * 0.06 },
        { translateY: (1 - entrance.value) * 16 - lift.value * 12 },
      ],
    }),
    [entrance, lift],
  );

  const content = (
    <Animated.View
      entering={FadeIn.duration(120).reduceMotion(ReduceMotion.System)}
      exiting={FadeOut.duration(motion.state.duration).reduceMotion(ReduceMotion.System)}
      pointerEvents={sticky ? 'auto' : 'none'}
      style={[styles.overlay, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}
      accessibilityViewIsModal={sticky}
      accessibilityElementsHidden={!sticky}
      importantForAccessibility={sticky ? 'yes' : 'no-hide-descendants'}
      onAccessibilityEscape={onClose}
    >
      <View style={[StyleSheet.absoluteFill, styles.scrim]} />
      {sticky && (
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessible={false}
          focusable={false}
        />
      )}
      <Animated.View
        style={[
          styles.preview,
          { maxHeight: height - insets.top - insets.bottom - 48 },
          animatedStyle,
        ]}
      >
        <View style={styles.header}>
          <Text ref={titleRef} style={styles.title} accessibilityRole="header">
            {s.connection.previewTitle}
          </Text>
          {sticky && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={s.common.close}
              onPress={onClose}
              onFocus={() => setFocused('close')}
              onBlur={() => setFocused(null)}
              style={({ pressed }) => [
                styles.close,
                focused === 'close' && styles.focused,
                pressed && styles.pressed,
              ]}
            >
              <X size={22} color={scheme.onSurface} />
            </Pressable>
          )}
        </View>
        <ScrollView contentContainerStyle={styles.content} bounces={false}>
          <ConnectionSummary
            item={item}
            offline={offline}
            availableWidth={Math.min(width - 48, 464)}
          />
          <View style={styles.legs}>
            {item.legs.map((leg, index) => (
              <View key={`${leg.id}-${index}`} style={styles.leg}>
                <View style={styles.legHeading}>
                  {leg.mode === 'walk' ? (
                    <Footprints size={18} color={scheme.onSurfaceVariant} />
                  ) : (
                    <LineBadge line={leg.line} mode={leg.mode} compact />
                  )}
                  <Text style={styles.legMeta}>
                    {leg.mode === 'walk'
                      ? leg.walkM != null && leg.walkM > 0
                        ? formatWalkTime(walkMinutesFor(leg.walkM, walkMps))
                        : s.connection.walkLeg
                      : leg.direction
                        ? s.notification.directionTo(leg.direction)
                        : s.notification.stops(leg.stopsCount)}
                  </Text>
                </View>
                <View style={styles.stopRow}>
                  <Text style={styles.stopTime}>{leg.departAt}</Text>
                  <Text style={styles.stopName}>{leg.fromStop}</Text>
                </View>
                <View style={styles.stopRow}>
                  <Text style={[styles.stopTime, styles.secondary]}>{leg.arriveAt}</Text>
                  <Text style={[styles.stopName, styles.secondary]}>{leg.toStop}</Text>
                </View>
                {leg.platformCode && leg.mode !== 'walk' && (
                  <Text style={styles.platform}>{s.notification.platform(leg.platformCode)}</Text>
                )}
              </View>
            ))}
          </View>
        </ScrollView>
        {sticky ? (
          <Pressable
            accessibilityRole="button"
            onPress={onOpen}
            onFocus={() => setFocused('open')}
            onBlur={() => setFocused(null)}
            style={({ pressed }) => [
              styles.open,
              focused === 'open' && styles.openFocused,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.openLabel}>{s.connection.previewOpen}</Text>
          </Pressable>
        ) : (
          <View style={[styles.gestureHint, ready && styles.gestureReady]}>
            {ready ? (
              <Check size={20} color={scheme.onPrimaryContainer} />
            ) : (
              <ArrowUp size={20} color={scheme.onSurfaceVariant} />
            )}
            <Text style={[styles.hintText, ready && styles.readyText]}>
              {ready ? s.connection.previewRelease : s.connection.previewSwipe}
            </Text>
          </View>
        )}
      </Animated.View>
    </Animated.View>
  );

  return sticky ? (
    <Modal
      transparent
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
      onShow={() => {
        const tag = findNodeHandle(titleRef.current);
        if (tag) AccessibilityInfo.setAccessibilityFocus(tag);
      }}
    >
      {content}
    </Modal>
  ) : (
    content
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    zIndex: 20,
    elevation: 20,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  scrim: { backgroundColor: scheme.scrim, opacity: 0.64 },
  preview: {
    width: '100%',
    maxWidth: 480,
    flexShrink: 1,
    backgroundColor: scheme.surfaceContainerHigh,
    borderRadius: 32,
    padding: 8,
    ...elev.level3,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  title: { ...type.titleMedium, fontWeight: '600', color: scheme.onSurface, flex: 1, minWidth: 0 },
  close: {
    minWidth: 48,
    minHeight: 48,
    flexShrink: 0,
    borderRadius: shape.large,
    borderWidth: 2,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: { gap: 8 },
  legs: { paddingHorizontal: 16 },
  leg: {
    paddingVertical: 14,
    gap: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: scheme.outlineVariant,
  },
  legHeading: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  legMeta: { ...type.bodyMedium, color: scheme.onSurfaceVariant, flexShrink: 1 },
  stopRow: { flexDirection: 'row', alignItems: 'baseline', gap: 12 },
  stopTime: {
    ...type.bodyMedium,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
    color: scheme.onSurface,
    flexShrink: 0,
  },
  stopName: { ...type.bodyMedium, color: scheme.onSurface, flex: 1, minWidth: 0 },
  secondary: { color: scheme.onSurfaceVariant, fontWeight: '400' },
  platform: { ...type.bodySmall, color: scheme.onSurfaceVariant },
  gestureHint: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderRadius: shape.extraLarge,
  },
  gestureReady: { backgroundColor: scheme.primaryContainer },
  hintText: { ...type.labelLarge, color: scheme.onSurfaceVariant, flexShrink: 1 },
  readyText: { color: scheme.onPrimaryContainer },
  open: {
    minHeight: 56,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: scheme.primary,
    borderRadius: shape.extraLarge,
    padding: 14,
    borderWidth: 2,
    borderColor: 'transparent',
    marginTop: 8,
  },
  openLabel: {
    ...type.labelLarge,
    fontWeight: '700',
    color: scheme.onPrimary,
    textAlign: 'center',
  },
  focused: { borderColor: scheme.onSurface },
  openFocused: { borderColor: scheme.onPrimary },
  pressed: { opacity: 0.8 },
});
