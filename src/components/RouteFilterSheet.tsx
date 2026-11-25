import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import BottomSheet, {
  BottomSheetBackdrop,
  type BottomSheetBackdropProps,
  BottomSheetScrollView,
  useBottomSheetSpringConfigs,
} from '@gorhom/bottom-sheet';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import Animated, {
  FadeIn,
  FadeOut,
  interpolate,
  interpolateColor,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import {
  Activity,
  ArrowUpDown,
  BusFront,
  CableCar,
  Check,
  Layers,
  SlidersHorizontal,
  TrainFront,
  TramFront,
  X,
} from './icons';
import { SpringPressable } from './SpringPressable';
import { motion } from '../theme/motion';
import { useSheetBackHandler } from '../hooks/useSheetBackHandler';
import {
  DESKTOP_SHEET_TOP_SPACER_HEIGHT,
  DesktopSheetTopSpacer,
  getDesktopSheetProps,
  useEscapeKey,
  useWebLayout,
} from '../theme/layout';
import { scheme, shape, spacing, type } from '../theme/tokens';
import { useStrings } from '../i18n';
import type { LegMode } from '../types/models';

export type RouteModeFilter = 'all' | LegMode;
export type RouteTransfersFilter = 'all' | 'max1' | 'direct';

export interface RouteFilterSheetProps {
  availableModes: LegMode[];
  selectedMode: RouteModeFilter;
  transfersFilter: RouteTransfersFilter;
  liveOnly: boolean;
  resultCount?: number;
  onSelectMode: (mode: RouteModeFilter) => void;
  onSelectTransfers: (transfers: RouteTransfersFilter) => void;
  onToggleLiveOnly: () => void;
  onReset: () => void;
  onClose: () => void;
}

const SPRING_FAST = motion.spring.spatialFast;
const HANDLE_HEIGHT = 24;

function SheetHandle() {
  return (
    <View style={styles.handleContainer}>
      <View style={styles.handle} />
    </View>
  );
}

export function RouteFilterSheet({
  availableModes,
  selectedMode,
  transfersFilter,
  liveOnly,
  resultCount,
  onSelectMode,
  onSelectTransfers,
  onToggleLiveOnly,
  onReset,
  onClose,
}: RouteFilterSheetProps) {
  const s = useStrings();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const webLayout = useWebLayout();
  const { height: windowHeight, fontScale } = useWindowDimensions();
  const sheetRef = useRef<BottomSheet>(null);

  const maxAvailable = webLayout.isMedium
    ? windowHeight - 96
    : windowHeight - insets.top - insets.bottom - 16;
  const baseContentHeight = 520 + Math.max(0, fontScale - 1) * 220;
  const sheetHeight = Math.min(maxAvailable, Math.max(400, baseContentHeight));
  const sheetProps = getDesktopSheetProps(webLayout, insets.bottom, 540, sheetHeight);
  const snapPoints = useMemo(() => [sheetHeight], [sheetHeight]);
  const animationConfigs = useBottomSheetSpringConfigs(motion.sheet);

  const requestClose = useCallback(() => {
    sheetRef.current?.close();
  }, []);
  useEscapeKey(true, requestClose);

  const { onSheetChange } = useSheetBackHandler(sheetRef, onClose);

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        disappearsOnIndex={-1}
        appearsOnIndex={0}
        opacity={0.58}
        pressBehavior="close"
        accessibilityLabel={s.routesFilters.closeA11y}
        accessibilityRole="button"
      />
    ),
    [s.routesFilters.closeA11y],
  );

  const activeCount =
    (selectedMode !== 'all' ? 1 : 0) +
    (transfersFilter !== 'all' ? 1 : 0) +
    (liveOnly ? 1 : 0);
  const hasActiveFilters = activeCount > 0;

  const handleModePress = (mode: RouteModeFilter) => {
    onSelectMode(selectedMode === mode ? 'all' : mode);
  };

  const handleTransfersPress = (transfers: RouteTransfersFilter) => {
    void Haptics.selectionAsync().catch(() => {});
    onSelectTransfers(transfers);
  };

  const handleToggleLive = () => {
    void Haptics.selectionAsync().catch(() => {});
    onToggleLiveOnly();
  };

  const handleResetPress = () => {
    onReset();
  };

  const handleDonePress = () => {
    requestClose();
  };

  const getModeLabel = (mode: LegMode) => {
    switch (mode) {
      case 'tram':
        return s.settings.modeTram;
      case 'bus':
        return s.settings.modeBus;
      case 'train':
        return s.settings.modeTrain;
      case 'cable':
        return s.settings.modeCable;
      case 'trolleybus':
        return s.settings.modeTrolleybus;
      case 'subway':
        return s.settings.modeSubway;
      default:
        return mode;
    }
  };

  const renderModeIcon = (mode: LegMode, color: string) => {
    switch (mode) {
      case 'tram':
        return <TramFront size={17} color={color} />;
      case 'bus':
      case 'trolleybus':
        return <BusFront size={17} color={color} />;
      case 'train':
      case 'subway':
        return <TrainFront size={17} color={color} />;
      case 'cable':
        return <CableCar size={17} color={color} />;
      default:
        return <Layers size={17} color={color} />;
    }
  };

  const transferOptions: {
    key: RouteTransfersFilter;
    label: string;
  }[] = [
    { key: 'all', label: s.routesFilters.transfersAll },
    { key: 'max1', label: s.routesFilters.transfersMax1 },
    { key: 'direct', label: s.routesFilters.transfersDirect },
  ];

  const doneLabel =
    resultCount != null
      ? `${s.routesFilters.done} · ${s.connection.connections(resultCount)}`
      : s.routesFilters.done;

  return (
    <BottomSheet
      ref={sheetRef}
      index={0}
      snapPoints={snapPoints}
      animationConfigs={animationConfigs}
      handleComponent={webLayout.isMedium ? DesktopSheetTopSpacer : SheetHandle}
      topInset={insets.top}
      bottomInset={sheetProps.bottomInset}
      detached={sheetProps.detached}
      style={sheetProps.sheetStyle}
      enableDynamicSizing={false}
      enablePanDownToClose={!webLayout.isMedium}
      onChange={onSheetChange}
      onClose={onClose}
      backgroundStyle={[styles.sheet, sheetProps.backgroundExtraStyle]}
      backdropComponent={renderBackdrop}
    >
      <View
        style={[
          styles.sheetContainer,
          { height: sheetHeight - (webLayout.isMedium ? DESKTOP_SHEET_TOP_SPACER_HEIGHT : HANDLE_HEIGHT) },
        ]}
        accessibilityViewIsModal
      >
        <View style={styles.header}>
          <View style={styles.headerTitleWrap}>
            <View style={styles.headerIconBadge}>
              <SlidersHorizontal size={18} color={scheme.onPrimaryContainer} />
            </View>
            <Text style={styles.title} accessibilityRole="header" numberOfLines={1}>
              {s.routesFilters.title}
            </Text>
            {hasActiveFilters && (
              <Animated.View
                entering={reduceMotion ? undefined : FadeIn.duration(140)}
                exiting={reduceMotion ? undefined : FadeOut.duration(100)}
                style={styles.countBadge}
              >
                <Text style={styles.countBadgeText}>{activeCount}</Text>
              </Animated.View>
            )}
          </View>

          <View style={styles.headerRight}>
            {hasActiveFilters && (
              <Animated.View
                entering={reduceMotion ? undefined : FadeIn.duration(140)}
                exiting={reduceMotion ? undefined : FadeOut.duration(100)}
              >
                <SpringPressable
                  onPress={handleResetPress}
                  scaleDelta={0.04}
                  haptic="selection"
                  style={styles.resetBtn}
                  accessibilityRole="button"
                  accessibilityLabel={s.routesFilters.resetA11y}
                  hitSlop={4}
                >
                  <Text style={styles.resetText}>{s.routesFilters.reset}</Text>
                </SpringPressable>
              </Animated.View>
            )}

            <SpringPressable
              onPress={requestClose}
              scaleDelta={0.06}
              haptic="selection"
              style={styles.closeBtn}
              accessibilityRole="button"
              accessibilityLabel={s.routesFilters.closeA11y}
            >
              <X size={20} color={scheme.onSurface} />
            </SpringPressable>
          </View>
        </View>

        <BottomSheetScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          nestedScrollEnabled
          overScrollMode="never"
        >
          <View style={styles.sectionCard}>
            <View style={styles.sectionHead}>
              <View style={styles.sectionIcon}>
                <Layers size={16} color={scheme.onSecondaryContainer} />
              </View>
              <Text style={styles.sectionTitle}>{s.routesFilters.vehiclesSection}</Text>
            </View>
            <View style={styles.pillsWrap}>
              <ModeChip
                label={s.routesFilters.allVehicles}
                icon={
                  <Layers
                    size={17}
                    color={
                      selectedMode === 'all' ? scheme.onPrimaryContainer : scheme.onSurfaceVariant
                    }
                  />
                }
                active={selectedMode === 'all'}
                onPress={() => handleModePress('all')}
              />
              {availableModes.map((mode) => {
                const active = selectedMode === mode;
                return (
                  <ModeChip
                    key={mode}
                    label={getModeLabel(mode)}
                    icon={renderModeIcon(
                      mode,
                      active ? scheme.onPrimaryContainer : scheme.onSurfaceVariant,
                    )}
                    active={active}
                    onPress={() => handleModePress(mode)}
                  />
                );
              })}
            </View>
          </View>

          <View style={styles.sectionCard}>
            <View style={styles.sectionHead}>
              <View style={styles.sectionIcon}>
                <ArrowUpDown size={16} color={scheme.onSecondaryContainer} />
              </View>
              <Text style={styles.sectionTitle}>{s.routesFilters.transfersSection}</Text>
            </View>
            <TransfersSegment
              options={transferOptions}
              activeKey={transfersFilter}
              onSelect={handleTransfersPress}
            />
          </View>

          <LiveToggle
            sectionTitle={s.routesFilters.liveSection}
            title={s.routesFilters.liveOnly}
            subtitle={s.routesFilters.liveOnlyHint}
            active={liveOnly}
            onPress={handleToggleLive}
          />
        </BottomSheetScrollView>

        <View style={styles.footer}>
          <SpringPressable
            onPress={handleDonePress}
            scaleDelta={0.02}
            haptic="light"
            style={styles.doneBtn}
            accessibilityRole="button"
            accessibilityLabel={doneLabel}
          >
            <Text style={styles.doneText}>{doneLabel}</Text>
          </SpringPressable>
        </View>
      </View>
    </BottomSheet>
  );
}

function ModeChip({
  label,
  icon,
  active,
  onPress,
}: {
  label: string;
  icon: React.ReactNode;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <SpringPressable
      onPress={onPress}
      scaleDelta={0.035}
      haptic="selection"
      style={[styles.chip, active && styles.chipActive]}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: active }}
      accessibilityLabel={label}
    >
      {icon}
      <Text style={[styles.chipText, active && styles.chipTextActive]} numberOfLines={1}>
        {label}
      </Text>
      {active && <Check size={15} color={scheme.onPrimaryContainer} />}
    </SpringPressable>
  );
}

function TransfersSegment({
  options,
  activeKey,
  onSelect,
}: {
  options: { key: RouteTransfersFilter; label: string }[];
  activeKey: RouteTransfersFilter;
  onSelect: (key: RouteTransfersFilter) => void;
}) {
  const reduceMotion = useReducedMotion();
  const containerWidth = useSharedValue(0);
  const activeIndex = options.findIndex((o) => o.key === activeKey);
  const progress = useSharedValue(activeIndex);

  useEffect(() => {
    progress.value = reduceMotion ? activeIndex : withSpring(activeIndex, SPRING_FAST);
  }, [activeIndex, progress, reduceMotion]);

  const indicatorStyle = useAnimatedStyle(() => {
    const w =
      containerWidth.value > 0 ? (containerWidth.value - 10) / Math.max(1, options.length) : 0;
    return {
      width: w,
      transform: [{ translateX: progress.value * w }],
      opacity: w > 0 ? 1 : 0,
    };
  });

  return (
    <View
      style={styles.segmentContainer}
      onLayout={(e) => {
        containerWidth.value = e.nativeEvent.layout.width;
      }}
    >
      <Animated.View style={[styles.segmentIndicator, indicatorStyle]} />
      {options.map((opt) => {
        const active = activeKey === opt.key;
        return (
          <Pressable
            key={opt.key}
            onPress={() => onSelect(opt.key)}
            style={styles.segmentBtn}
            accessibilityRole="radio"
            accessibilityState={{ selected: active }}
            accessibilityLabel={opt.label}
          >
            <Text style={[styles.segmentText, active && styles.segmentTextActive]} numberOfLines={1}>
              {opt.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function LiveToggle({
  sectionTitle,
  title,
  subtitle,
  active,
  onPress,
}: {
  sectionTitle: string;
  title: string;
  subtitle: string;
  active: boolean;
  onPress: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const activeSV = useSharedValue(active ? 1 : 0);

  useEffect(() => {
    activeSV.value = reduceMotion ? (active ? 1 : 0) : withSpring(active ? 1 : 0, SPRING_FAST);
  }, [active, activeSV, reduceMotion]);

  const containerStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      activeSV.value,
      [0, 1],
      [scheme.surfaceContainerLow, scheme.primaryContainer + '36'],
    ),
    borderColor: interpolateColor(activeSV.value, [0, 1], [scheme.outlineVariant, scheme.primary]),
  }));

  const trackStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      activeSV.value,
      [0, 1],
      [scheme.surfaceContainerHighest, scheme.primary],
    ),
    borderColor: interpolateColor(activeSV.value, [0, 1], [scheme.outline, scheme.primary]),
  }));

  const thumbStyle = useAnimatedStyle(() => {
    const size = interpolate(activeSV.value, [0, 1], [16, 24]);
    const translateX = interpolate(activeSV.value, [0, 1], [5, 22]);
    return {
      width: size,
      height: size,
      borderRadius: size / 2,
      transform: [{ translateX }],
      backgroundColor: interpolateColor(activeSV.value, [0, 1], [scheme.outline, scheme.onPrimary]),
    };
  });

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="switch"
      accessibilityState={{ checked: active }}
      accessibilityLabel={`${sectionTitle}, ${title}, ${subtitle}`}
    >
      <Animated.View style={[styles.liveCard, containerStyle]}>
        <View style={styles.liveCardLeft}>
          <View style={[styles.liveIconCircle, active && styles.liveIconCircleActive]}>
            <Activity
              size={18}
              color={active ? scheme.onPrimaryContainer : scheme.onSecondaryContainer}
            />
          </View>
          <View style={styles.liveCardTexts}>
            <Text style={styles.liveCardTitle} numberOfLines={1}>
              {title}
            </Text>
            <Text style={styles.liveCardSub} numberOfLines={2}>
              {subtitle}
            </Text>
          </View>
        </View>
        <Animated.View style={[styles.switchTrack, trackStyle]}>
          <Animated.View style={[styles.switchThumb, thumbStyle]}>
            {active && <Check size={14} color={scheme.primary} />}
          </Animated.View>
        </Animated.View>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  sheet: {
    backgroundColor: scheme.surfaceContainer,
    borderTopLeftRadius: shape.extraLarge,
    borderTopRightRadius: shape.extraLarge,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: scheme.outlineVariant,
  },
  sheetContainer: {
    overflow: 'hidden',
  },
  handleContainer: {
    height: HANDLE_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  handle: {
    backgroundColor: scheme.outlineVariant,
    width: 36,
    height: 4,
    borderRadius: 2,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 20,
    paddingRight: 16,
    paddingBottom: 14,
    gap: spacing.sm,
  },
  headerTitleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
    minWidth: 0,
  },
  headerIconBadge: {
    width: 34,
    height: 34,
    borderRadius: 12,
    backgroundColor: scheme.primaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 20,
    lineHeight: 26,
    color: scheme.onSurface,
    fontWeight: '800',
    letterSpacing: -0.3,
    flexShrink: 1,
  },
  countBadge: {
    minWidth: 24,
    height: 24,
    borderRadius: shape.full,
    backgroundColor: scheme.secondaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  countBadgeText: {
    ...type.labelMedium,
    color: scheme.onSecondaryContainer,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  resetBtn: {
    minHeight: 38,
    justifyContent: 'center',
    paddingHorizontal: 14,
    borderRadius: shape.full,
    backgroundColor: scheme.secondaryContainer,
  },
  resetText: {
    ...type.labelMedium,
    color: scheme.onSecondaryContainer,
    fontWeight: '700',
  },
  closeBtn: {
    width: 44,
    height: 44,
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainerHigh,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: scheme.outlineVariant,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 4,
    paddingBottom: 20,
    gap: 14,
  },
  sectionCard: {
    backgroundColor: scheme.surfaceContainerLow,
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: scheme.outlineVariant,
    padding: 14,
    gap: 12,
  },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  sectionIcon: {
    width: 28,
    height: 28,
    borderRadius: shape.full,
    backgroundColor: scheme.secondaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionTitle: {
    ...type.titleSmall,
    fontSize: 15,
    color: scheme.onSurface,
    fontWeight: '700',
    flexShrink: 1,
  },
  pillsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainer,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: scheme.outlineVariant,
    minHeight: 44,
  },
  chipActive: {
    backgroundColor: scheme.primaryContainer,
    borderWidth: 1,
    borderColor: scheme.primary,
  },
  chipText: {
    ...type.labelLarge,
    color: scheme.onSurface,
    fontWeight: '600',
  },
  chipTextActive: {
    color: scheme.onPrimaryContainer,
    fontWeight: '800',
  },
  segmentContainer: {
    flexDirection: 'row',
    backgroundColor: scheme.surfaceContainer,
    borderRadius: shape.full,
    padding: 4,
    borderWidth: 1,
    borderColor: scheme.outlineVariant,
    overflow: 'hidden',
  },
  segmentIndicator: {
    position: 'absolute',
    top: 4,
    left: 4,
    bottom: 4,
    borderRadius: shape.full,
    backgroundColor: scheme.primaryContainer,
    zIndex: 0,
  },
  segmentBtn: {
    flex: 1,
    paddingVertical: 11,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: shape.full,
    minHeight: 44,
    zIndex: 1,
  },
  segmentText: {
    ...type.labelLarge,
    color: scheme.onSurfaceVariant,
    fontWeight: '600',
    textAlign: 'center',
  },
  segmentTextActive: {
    color: scheme.onPrimaryContainer,
    fontWeight: '800',
  },
  liveCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderRadius: 22,
    borderWidth: 1,
    minHeight: 74,
  },
  liveCardLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
    minWidth: 0,
  },
  liveIconCircle: {
    width: 38,
    height: 38,
    borderRadius: shape.full,
    backgroundColor: scheme.secondaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  liveIconCircleActive: {
    backgroundColor: scheme.primaryContainer,
  },
  liveCardTexts: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  liveCardTitle: {
    ...type.titleSmall,
    fontSize: 15,
    fontWeight: '700',
    color: scheme.onSurface,
  },
  liveCardSub: {
    ...type.bodySmall,
    color: scheme.onSurfaceVariant,
  },
  switchTrack: {
    width: 52,
    height: 32,
    borderRadius: shape.full,
    borderWidth: 1.5,
    justifyContent: 'center',
  },
  switchThumb: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: scheme.outlineVariant,
  },
  doneBtn: {
    minHeight: 54,
    borderRadius: shape.full,
    backgroundColor: scheme.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  doneText: {
    ...type.labelLarge,
    fontSize: 15,
    color: scheme.onPrimary,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
});
