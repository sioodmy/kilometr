import React, { useCallback, useEffect, useMemo, useRef } from 'react';
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
} from 'react-native-reanimated';
import {
  Activity,
  ArrowUpDown,
  BusFront,
  CableCar,
  Check,
  Layers,
  TrainFront,
  TramFront,
  X,
} from './icons';
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
  onSelectMode: (mode: RouteModeFilter) => void;
  onSelectTransfers: (transfers: RouteTransfersFilter) => void;
  onToggleLiveOnly: () => void;
  onReset: () => void;
  onClose: () => void;
}

// Spring używany do przesuwania wskaźników i przełączników.
// M3 expressive: szybki, ale z wyrazistym wygaszeniem.
const springConfig = {
  damping: 20,
  stiffness: 420,
  mass: 0.8,
  reduceMotion: ReduceMotion.System,
} as const;

export function RouteFilterSheet({
  availableModes,
  selectedMode,
  transfersFilter,
  liveOnly,
  onSelectMode,
  onSelectTransfers,
  onToggleLiveOnly,
  onReset,
  onClose,
}: RouteFilterSheetProps) {
  const s = useStrings();
  const insets = useSafeAreaInsets();
  const { height: windowHeight, fontScale } = useWindowDimensions();
  const sheetRef = useRef<BottomSheet>(null);

  // Arkusz ma oddychać: sekcje, chipy i przycisk "Gotowe" dostają więcej
  // przestrzeni niż w starym kompaktowym układzie, a przy powiększonej
  // czcionce wysokość rośnie razem z treścią. Gdy zabraknie miejsca,
  // środkowa część przewija się, footer zostaje na dole.
  const HANDLE_HEIGHT = 28;
  const maxAvailable = windowHeight - insets.top - insets.bottom - 16;
  const baseContentHeight = 470 + Math.max(0, fontScale - 1) * 200;
  const sheetHeight = Math.min(maxAvailable, Math.max(380, baseContentHeight));
  const snapPoints = useMemo(() => [sheetHeight], [sheetHeight]);

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
    (liveOnly ? 1 : 0);
  const hasActiveFilters = activeCount > 0;

  const handleModePress = (mode: RouteModeFilter) => {
    void Haptics.selectionAsync().catch(() => {});
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
    void Haptics.selectionAsync().catch(() => {});
    onReset();
  };

  const handleDonePress = () => {
    void Haptics.selectionAsync().catch(() => {});
    onClose();
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
      snapPoints={snapPoints}
      topInset={insets.top}
      bottomInset={insets.bottom}
      enableDynamicSizing={false}
      enablePanDownToClose
      onClose={onClose}
      backgroundStyle={styles.sheet}
      handleIndicatorStyle={styles.handle}
      backdropComponent={renderBackdrop}
    >
      <View
        style={[styles.sheetContainer, { height: sheetHeight - HANDLE_HEIGHT }]}
        accessibilityViewIsModal
      >
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
              <X size={22} color={scheme.onSurfaceVariant} />
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
            <View style={styles.sectionHead}>
              <View style={styles.sectionIcon}>
                <Layers size={18} color={scheme.onPrimaryContainer} />
              </View>
              <Text style={styles.sectionTitle}>{s.routesFilters.vehiclesSection}</Text>
            </View>
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
            <View style={styles.sectionHead}>
              <View style={styles.sectionIcon}>
                <ArrowUpDown size={18} color={scheme.onPrimaryContainer} />
              </View>
              <Text style={styles.sectionTitle}>{s.routesFilters.transfersSection}</Text>
            </View>
            <TransfersSegment
              options={transferOptions}
              activeKey={transfersFilter}
              onSelect={handleTransfersPress}
            />
          </View>

          <View style={styles.section}>
            <View style={styles.sectionHead}>
              <View style={styles.sectionIcon}>
                <Activity size={18} color={scheme.onPrimaryContainer} />
              </View>
              <Text style={styles.sectionTitle}>{s.routesFilters.liveSection}</Text>
            </View>
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
            onPress={handleDonePress}
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
      {active && <Check size={16} color={scheme.onSecondaryContainer} />}
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
  const containerWidth = useSharedValue(0);
  const activeIndex = options.findIndex((o) => o.key === activeKey);
  const progress = useSharedValue(activeIndex);

  useEffect(() => {
    progress.value = reduceMotion ? activeIndex : withSpring(activeIndex, springConfig);
  }, [activeIndex, progress, reduceMotion]);

  // Szerokość zewnętrzna minus 2px border i 8px paddingu wewnętrznego.
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
    transform: [{ translateX: activeSV.value * 22 }],
    backgroundColor: interpolateColor(activeSV.value, [0, 1], [scheme.outline, scheme.onPrimary]),
  }));

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="switch"
      accessibilityState={{ checked: active }}
      accessibilityLabel={`${title}, ${subtitle}`}
    >
      <Animated.View style={[styles.liveCard, containerStyle]}>
        <View style={styles.liveCardLeft}>
          <View style={[styles.liveIconCircle, active && styles.liveIconCircleActive]}>
            <Activity size={20} color={active ? scheme.primary : scheme.onSurfaceVariant} />
          </View>
          <View style={styles.liveCardTexts}>
            <Text
              style={[styles.liveCardTitle, active && styles.liveCardTitleActive]}
              numberOfLines={1}
            >
              {title}
            </Text>
            <Text style={styles.liveCardSub} numberOfLines={2}>
              {subtitle}
            </Text>
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
    backgroundColor: scheme.surfaceContainerLow,
    borderTopLeftRadius: shape.extraLarge,
    borderTopRightRadius: shape.extraLarge,
  },
  sheetContainer: {
    overflow: 'hidden',
  },
  handle: {
    backgroundColor: scheme.outlineVariant,
    width: 36,
    height: 4,
    borderRadius: 2,
    marginTop: 10,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: spacing.xl,
    paddingRight: spacing.md,
    paddingBottom: spacing.md,
    gap: spacing.sm,
  },
  headerTitleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flexShrink: 1,
  },
  title: {
    ...type.titleLarge,
    color: scheme.onSurface,
    fontWeight: '500',
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
    fontWeight: '700',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  resetBtn: {
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
    borderRadius: shape.full,
  },
  resetText: {
    ...type.labelLarge,
    color: scheme.primary,
    fontWeight: '600',
  },
  closeBtn: {
    width: 48,
    height: 48,
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    gap: spacing.lg,
  },
  section: {
    gap: spacing.sm,
  },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  sectionIcon: {
    width: 32,
    height: 32,
    borderRadius: shape.full,
    backgroundColor: scheme.primaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionTitle: {
    ...type.titleSmall,
    fontSize: 15,
    color: scheme.onSurface,
    fontWeight: '600',
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
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainerHigh,
    borderWidth: 1,
    borderColor: scheme.outlineVariant,
    minHeight: 48,
  },
  chipActive: {
    backgroundColor: scheme.secondaryContainer,
    borderColor: scheme.secondaryContainer,
  },
  chipText: {
    ...type.labelLarge,
    color: scheme.onSurface,
    fontWeight: '500',
  },
  chipTextActive: {
    color: scheme.onSecondaryContainer,
    fontWeight: '600',
  },
  segmentContainer: {
    flexDirection: 'row',
    backgroundColor: scheme.surfaceContainerHigh,
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
    backgroundColor: scheme.secondaryContainer,
    zIndex: 0,
  },
  segmentBtn: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: shape.full,
    minHeight: 48,
    zIndex: 1,
  },
  segmentText: {
    ...type.labelLarge,
    color: scheme.onSurfaceVariant,
    fontWeight: '600',
    textAlign: 'center',
  },
  segmentTextActive: {
    color: scheme.onSecondaryContainer,
    fontWeight: '700',
  },
  liveCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: shape.large,
    borderWidth: 1,
    minHeight: 72,
    gap: 12,
  },
  liveCardLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
    paddingRight: 4,
  },
  liveIconCircle: {
    width: 40,
    height: 40,
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainerHighest,
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
    fontSize: 15,
    color: scheme.onSurface,
    fontWeight: '600',
  },
  liveCardTitleActive: {
    color: scheme.onSurface,
  },
  liveCardSub: {
    ...type.bodySmall,
    color: scheme.onSurfaceVariant,
    lineHeight: 17,
  },
  switchTrack: {
    width: 54,
    height: 32,
    borderRadius: 16,
    backgroundColor: scheme.surfaceContainerHighest,
    padding: 3,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  switchTrackActive: {
    backgroundColor: scheme.primary,
  },
  switchThumb: {
    width: 26,
    height: 26,
    borderRadius: 13,
  },
  pressed: {
    opacity: 0.8,
  },
  footer: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: scheme.outlineVariant,
    backgroundColor: scheme.surfaceContainerLow,
  },
  doneBtn: {
    minHeight: 56,
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
    fontSize: 16,
    color: scheme.onPrimary,
    fontWeight: '600',
  },
});
