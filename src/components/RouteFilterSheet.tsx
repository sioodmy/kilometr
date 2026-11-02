import React, { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import BottomSheet, {
  BottomSheetBackdrop,
  type BottomSheetBackdropProps,
  BottomSheetScrollView,
} from '@gorhom/bottom-sheet';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import Animated, {
  interpolateColor,
  ReduceMotion,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import {
  Activity,
  ArrowUpDown,
  BusFront,
  CableCar,
  Check,
  Compass,
  Footprints,
  Layers,
  TrainFront,
  TramFront,
  X,
  Zap,
} from './icons';
import { scheme, shape, spacing, type } from '../theme/tokens';
import { motion } from '../theme/motion';
import { useStrings } from '../i18n';
import type { LegMode } from '../types/models';
import type { RouteStyle } from '../services/routing/types';

export type RouteModeFilter = 'all' | LegMode;
export type RouteTransfersFilter = 'all' | 'max1' | 'direct';

export interface RouteFilterSheetProps {
  availableModes: LegMode[];
  selectedMode: RouteModeFilter;
  sortMode: RouteStyle;
  defaultSortMode: RouteStyle;
  transfersFilter: RouteTransfersFilter;
  liveOnly: boolean;
  onSelectMode: (mode: RouteModeFilter) => void;
  onSelectSort: (sort: RouteStyle) => void;
  onSelectTransfers: (transfers: RouteTransfersFilter) => void;
  onToggleLiveOnly: () => void;
  onReset: () => void;
  onClose: () => void;
}

// Spring używany do przesuwania wskaźników i przełączników.
// M3 expressive: szybki, ale z wyrazistym wygaszeniem.
const springConfig = {
  damping: 22,
  stiffness: 280,
  reduceMotion: ReduceMotion.System,
} as const;

export function RouteFilterSheet({
  availableModes,
  selectedMode,
  sortMode,
  defaultSortMode,
  transfersFilter,
  liveOnly,
  onSelectMode,
  onSelectSort,
  onSelectTransfers,
  onToggleLiveOnly,
  onReset,
  onClose,
}: RouteFilterSheetProps) {
  const s = useStrings();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const sheetRef = useRef<BottomSheet>(null);
  // Wysokość pikselowa zamiast procentów, bo content musi mieć jawną
  // wysokość, żeby sticky footer nie wypadł poza sheet.
  const sheetHeight = Math.min(
    windowHeight - insets.top - insets.bottom - 16,
    Math.round(windowHeight * 0.82),
  );

  useEffect(() => {
    const back = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => back.remove();
  }, [onClose]);

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        disappearsOnIndex={-1}
        appearsOnIndex={0}
        opacity={0.6}
        pressBehavior="close"
      />
    ),
    [],
  );

  const activeCount =
    (selectedMode !== 'all' ? 1 : 0) +
    (transfersFilter !== 'all' ? 1 : 0) +
    (sortMode !== defaultSortMode ? 1 : 0) +
    (liveOnly ? 1 : 0);
  const hasActiveFilters = activeCount > 0;

  const handleModePress = (mode: RouteModeFilter) => {
    void Haptics.selectionAsync().catch(() => {});
    onSelectMode(selectedMode === mode ? 'all' : mode);
  };

  const handleSortPress = (mode: RouteStyle) => {
    void Haptics.selectionAsync().catch(() => {});
    onSelectSort(mode);
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
    void Haptics.selectionAsync().catch(() => {});
    onReset();
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
        return <TramFront size={18} color={color} />;
      case 'bus':
      case 'trolleybus':
        return <BusFront size={18} color={color} />;
      case 'train':
      case 'subway':
        return <TrainFront size={18} color={color} />;
      case 'cable':
        return <CableCar size={18} color={color} />;
      default:
        return <Layers size={18} color={color} />;
    }
  };

  const sortOptions: {
    key: RouteStyle;
    label: string;
    desc: string;
    renderIcon: (color: string) => React.ReactNode;
  }[] = [
    {
      key: 'balanced',
      label: s.routesFilters.sortOptimal,
      desc: s.routesFilters.sortOptimalDesc,
      renderIcon: (color) => <Compass size={20} color={color} />,
    },
    {
      key: 'fastest',
      label: s.routesFilters.sortFastest,
      desc: s.routesFilters.sortFastestDesc,
      renderIcon: (color) => <Zap size={20} color={color} />,
    },
    {
      key: 'fewerTransfers',
      label: s.routesFilters.sortFewerTransfers,
      desc: s.routesFilters.sortFewerTransfersDesc,
      renderIcon: (color) => <ArrowUpDown size={20} color={color} />,
    },
    {
      key: 'lessWalking',
      label: s.routesFilters.sortLessWalking,
      desc: s.routesFilters.sortLessWalkingDesc,
      renderIcon: (color) => <Footprints size={20} color={color} />,
    },
  ];

  const transferOptions: {
    key: RouteTransfersFilter;
    label: string;
  }[] = [
    { key: 'all', label: s.routesFilters.transfersAll },
    { key: 'max1', label: s.routesFilters.transfersMax1 },
    { key: 'direct', label: s.routesFilters.transfersDirect },
  ];

  return (
    <BottomSheet
      ref={sheetRef}
      index={0}
      snapPoints={[sheetHeight]}
      bottomInset={insets.bottom}
      enablePanDownToClose
      onClose={onClose}
      backgroundStyle={styles.sheet}
      handleIndicatorStyle={styles.handle}
      backdropComponent={renderBackdrop}
    >
      <View style={[styles.sheetContainer, { height: sheetHeight - 24 }]}>
        <View style={styles.header}>
          <View style={styles.headerTitleWrap}>
            <Text style={styles.title} accessibilityRole="header">
              {s.routesFilters.title}
            </Text>
            {hasActiveFilters && (
              <View style={styles.countBadge}>
                <Text style={styles.countBadgeText}>{activeCount}</Text>
              </View>
            )}
          </View>

          <View style={styles.headerRight}>
            {hasActiveFilters && (
              <Pressable
                onPress={handleResetPress}
                style={({ pressed }) => [styles.resetBtn, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel={s.routesFilters.resetA11y}
                hitSlop={8}
              >
                <Text style={styles.resetText}>{s.routesFilters.reset}</Text>
              </Pressable>
            )}

            <Pressable
              onPress={onClose}
              style={({ pressed }) => [styles.closeBtn, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel={s.routesFilters.closeA11y}
              hitSlop={8}
            >
              <X size={20} color={scheme.onSurfaceVariant} />
            </Pressable>
          </View>
        </View>

        <BottomSheetScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          nestedScrollEnabled
          overScrollMode="never"
        >
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{s.routesFilters.sortSection}</Text>
            <View style={styles.sortGrid}>
              {sortOptions.map((opt) => (
                <SortRow
                  key={opt.key}
                  label={opt.label}
                  desc={opt.desc}
                  renderIcon={opt.renderIcon}
                  active={sortMode === opt.key}
                  onPress={() => handleSortPress(opt.key)}
                />
              ))}
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{s.routesFilters.vehiclesSection}</Text>
            <View style={styles.pillsWrap}>
              <ModeChip
                label={s.routesFilters.allVehicles}
                icon={
                  <Layers
                    size={18}
                    color={
                      selectedMode === 'all' ? scheme.onSecondaryContainer : scheme.onSurfaceVariant
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
                      active ? scheme.onSecondaryContainer : scheme.onSurfaceVariant,
                    )}
                    active={active}
                    onPress={() => handleModePress(mode)}
                  />
                );
              })}
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{s.routesFilters.transfersSection}</Text>
            <TransfersSegment
              options={transferOptions}
              activeKey={transfersFilter}
              onSelect={handleTransfersPress}
            />
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{s.routesFilters.liveSection}</Text>
            <LiveToggle
              title={s.routesFilters.liveOnly}
              subtitle={s.routesFilters.liveOnlyHint}
              active={liveOnly}
              onPress={handleToggleLive}
            />
          </View>
        </BottomSheetScrollView>

        <View style={styles.footer}>
          <Pressable
            onPress={onClose}
            style={({ pressed }) => [styles.doneBtn, pressed && styles.doneBtnPressed]}
            accessibilityRole="button"
            accessibilityLabel={s.routesFilters.done}
          >
            <Text style={styles.doneText}>{s.routesFilters.done}</Text>
          </Pressable>
        </View>
      </View>
    </BottomSheet>
  );
}

function SortRow({
  label,
  desc,
  renderIcon,
  active,
  onPress,
}: {
  label: string;
  desc: string;
  renderIcon: (color: string) => React.ReactNode;
  active: boolean;
  onPress: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const activeSV = useSharedValue(active ? 1 : 0);

  useEffect(() => {
    activeSV.value = reduceMotion ? (active ? 1 : 0) : withTiming(active ? 1 : 0, motion.state);
  }, [active, activeSV, reduceMotion]);

  const containerStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      activeSV.value,
      [0, 1],
      [scheme.surfaceContainerLow, scheme.primaryContainer],
    ),
    borderColor: interpolateColor(activeSV.value, [0, 1], [scheme.outlineVariant, scheme.primary]),
  }));

  return (
    <Pressable
      onPress={onPress}
      style={styles.sortCardWrap}
      accessibilityRole="radio"
      accessibilityState={{ selected: active }}
      accessibilityLabel={`${label}, ${desc}`}
    >
      <Animated.View style={[styles.sortCard, containerStyle]}>
        <View style={styles.sortCardTop}>
          <View style={[styles.sortIconCircle, active && styles.sortIconCircleActive]}>
            {renderIcon(active ? scheme.onPrimaryContainer : scheme.onSurfaceVariant)}
          </View>
          {active && <Check size={18} color={scheme.primary} />}
        </View>
        <Text
          style={[styles.sortCardTitle, active && styles.sortCardTitleActive]}
          numberOfLines={1}
        >
          {label}
        </Text>
        <Text style={[styles.sortCardDesc, active && styles.sortCardDescActive]} numberOfLines={2}>
          {desc}
        </Text>
      </Animated.View>
    </Pressable>
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
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.chip, active && styles.chipActive, pressed && styles.pressed]}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: active }}
      accessibilityLabel={label}
    >
      {icon}
      <Text style={[styles.chipText, active && styles.chipTextActive]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
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
  const [containerWidth, setContainerWidth] = useState(0);
  const activeIndex = options.findIndex((o) => o.key === activeKey);
  const progress = useSharedValue(activeIndex);

  useEffect(() => {
    progress.value = reduceMotion ? activeIndex : withSpring(activeIndex, springConfig);
  }, [activeIndex, progress, reduceMotion]);

  const segmentWidth = containerWidth > 0 ? (containerWidth - 6) / 3 : 0;
  const indicatorStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: progress.value * segmentWidth }],
  }));

  return (
    <View
      style={styles.segmentContainer}
      onLayout={(e) => setContainerWidth(e.nativeEvent.layout.width)}
    >
      <Animated.View style={[styles.segmentIndicator, { width: segmentWidth }, indicatorStyle]} />
      {options.map((opt) => {
        const active = activeKey === opt.key;
        return (
          <Pressable
            key={opt.key}
            onPress={() => onSelect(opt.key)}
            style={({ pressed }) => [styles.segmentBtn, pressed && styles.pressed]}
            accessibilityRole="radio"
            accessibilityState={{ selected: active }}
            accessibilityLabel={opt.label}
          >
            <Text style={[styles.segmentText, active && styles.segmentTextActive]}>
              {opt.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function LiveToggle({
  title,
  subtitle,
  active,
  onPress,
}: {
  title: string;
  subtitle: string;
  active: boolean;
  onPress: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const activeSV = useSharedValue(active ? 1 : 0);

  useEffect(() => {
    activeSV.value = reduceMotion ? (active ? 1 : 0) : withSpring(active ? 1 : 0, springConfig);
  }, [active, activeSV, reduceMotion]);

  const containerStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      activeSV.value,
      [0, 1],
      [scheme.surfaceContainerLow, scheme.surfaceContainerHigh],
    ),
    borderColor: interpolateColor(activeSV.value, [0, 1], [scheme.outlineVariant, scheme.primary]),
  }));

  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: activeSV.value * 20 }],
    backgroundColor: interpolateColor(activeSV.value, [0, 1], [scheme.outline, scheme.onPrimary]),
  }));

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="switch"
      accessibilityState={{ checked: active }}
      accessibilityLabel={title}
    >
      <Animated.View style={[styles.liveCard, containerStyle]}>
        <View style={styles.liveCardLeft}>
          <View style={[styles.liveIconCircle, active && styles.liveIconCircleActive]}>
            <Activity
              size={18}
              color={active ? scheme.onPrimaryContainer : scheme.onSurfaceVariant}
            />
          </View>
          <View style={styles.liveCardTexts}>
            <Text style={[styles.liveCardTitle, active && styles.liveCardTitleActive]}>
              {title}
            </Text>
            <Text style={styles.liveCardSub}>{subtitle}</Text>
          </View>
        </View>
        <View style={[styles.switchTrack, active && styles.switchTrackActive]}>
          <Animated.View style={[styles.switchThumb, thumbStyle]} />
        </View>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  sheet: {
    backgroundColor: scheme.surfaceContainer,
    borderTopLeftRadius: shape.extraLarge,
    borderTopRightRadius: shape.extraLarge,
  },
  sheetContainer: {
    overflow: 'hidden',
  },
  handle: {
    backgroundColor: scheme.outlineVariant,
    width: 32,
    height: 4,
    borderRadius: 2,
    marginTop: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: scheme.outlineVariant,
  },
  headerTitleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  title: {
    ...type.titleLarge,
    color: scheme.onSurface,
    fontWeight: '600',
  },
  countBadge: {
    minWidth: 22,
    height: 22,
    borderRadius: shape.full,
    backgroundColor: scheme.secondaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  countBadgeText: {
    ...type.labelSmall,
    color: scheme.onSecondaryContainer,
    fontWeight: '700',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  resetBtn: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: shape.small,
  },
  resetText: {
    ...type.labelLarge,
    color: scheme.primary,
    fontWeight: '600',
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
  },
  section: {
    marginBottom: spacing.xl,
  },
  sectionTitle: {
    ...type.labelMedium,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: scheme.onSurfaceVariant,
    marginBottom: spacing.md,
    fontWeight: '700',
  },
  sortGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  sortCardWrap: {
    width: '48%',
  },
  sortCard: {
    flex: 1,
    padding: spacing.md,
    borderRadius: shape.large,
    borderWidth: 1,
    minHeight: 104,
    gap: spacing.xs,
  },
  sortCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  sortIconCircle: {
    width: 36,
    height: 36,
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sortIconCircleActive: {
    backgroundColor: scheme.primaryContainer,
  },
  sortCardTitle: {
    ...type.labelLarge,
    color: scheme.onSurface,
    fontWeight: '600',
  },
  sortCardTitleActive: {
    color: scheme.onPrimaryContainer,
    fontWeight: '700',
  },
  sortCardDesc: {
    ...type.bodySmall,
    color: scheme.onSurfaceVariant,
  },
  sortCardDescActive: {
    color: scheme.onPrimaryContainer,
    opacity: 0.85,
  },
  pillsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainerLow,
    borderWidth: 1,
    borderColor: scheme.outlineVariant,
    minHeight: 44,
  },
  chipActive: {
    backgroundColor: scheme.secondaryContainer,
    borderColor: scheme.secondaryContainer,
  },
  chipText: {
    ...type.labelLarge,
    color: scheme.onSurface,
    fontWeight: '600',
  },
  chipTextActive: {
    color: scheme.onSecondaryContainer,
    fontWeight: '700',
  },
  segmentContainer: {
    flexDirection: 'row',
    backgroundColor: scheme.surfaceContainerLow,
    borderRadius: shape.full,
    padding: 3,
    borderWidth: 1,
    borderColor: scheme.outlineVariant,
  },
  segmentIndicator: {
    position: 'absolute',
    top: 3,
    left: 3,
    bottom: 3,
    borderRadius: shape.full,
    backgroundColor: scheme.secondaryContainer,
    zIndex: 0,
  },
  segmentBtn: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: shape.full,
    minHeight: 44,
    zIndex: 1,
  },
  segmentText: {
    ...type.labelMedium,
    color: scheme.onSurfaceVariant,
    fontWeight: '600',
  },
  segmentTextActive: {
    color: scheme.onSecondaryContainer,
    fontWeight: '700',
  },
  liveCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.md,
    borderRadius: shape.large,
    borderWidth: 1,
  },
  liveCardLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    flex: 1,
    paddingRight: spacing.md,
  },
  liveIconCircle: {
    width: 40,
    height: 40,
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  liveIconCircleActive: {
    backgroundColor: scheme.primaryContainer,
  },
  liveCardTexts: {
    flex: 1,
    gap: 2,
  },
  liveCardTitle: {
    ...type.titleSmall,
    color: scheme.onSurface,
    fontWeight: '600',
  },
  liveCardTitleActive: {
    color: scheme.primary,
  },
  liveCardSub: {
    ...type.bodySmall,
    color: scheme.onSurfaceVariant,
  },
  switchTrack: {
    width: 44,
    height: 24,
    borderRadius: 12,
    backgroundColor: scheme.surfaceContainerHighest,
    padding: 2,
    justifyContent: 'center',
  },
  switchTrackActive: {
    backgroundColor: scheme.primary,
  },
  switchThumb: {
    width: 20,
    height: 20,
    borderRadius: 10,
  },
  pressed: {
    opacity: 0.8,
  },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: scheme.outlineVariant,
    backgroundColor: scheme.surfaceContainer,
  },
  doneBtn: {
    minHeight: 48,
    borderRadius: shape.full,
    backgroundColor: scheme.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneBtnPressed: {
    opacity: 0.85,
  },
  doneText: {
    ...type.labelLarge,
    color: scheme.onPrimary,
    fontWeight: '700',
    fontSize: 15,
  },
});
