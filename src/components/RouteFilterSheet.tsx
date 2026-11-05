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
  BusFront,
  CableCar,
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

  // Kompaktowa, precyzyjnie wyliczona wysokość gwarantuje, że cały arkusz
  // (wraz z przyciskiem "Gotowe") mieści się w widoku ekranu bez ucinania
  // na żadnym urządzeniu i nie wypycha footera poza dolną krawędź.
  const HANDLE_HEIGHT = 24;
  const maxAvailable = windowHeight - insets.top - insets.bottom - 16;
  const baseContentHeight = 390 + Math.max(0, fontScale - 1) * 180;
  const sheetHeight = Math.min(maxAvailable, Math.max(340, baseContentHeight));
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
        return <TramFront size={16} color={color} />;
      case 'bus':
      case 'trolleybus':
        return <BusFront size={16} color={color} />;
      case 'train':
      case 'subway':
        return <TrainFront size={16} color={color} />;
      case 'cable':
        return <CableCar size={16} color={color} />;
      default:
        return <Layers size={16} color={color} />;
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
            <Text style={styles.sectionTitle}>{s.routesFilters.vehiclesSection}</Text>
            <View style={styles.pillsWrap}>
              <ModeChip
                label={s.routesFilters.allVehicles}
                icon={
                  <Layers
                    size={16}
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

  // Szerokość zewnętrzna minus 2px border i 4px padding wewnętrznego.
  const indicatorStyle = useAnimatedStyle(() => {
    const w =
      containerWidth.value > 0 ? (containerWidth.value - 6) / Math.max(1, options.length) : 0;
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
    transform: [{ translateX: activeSV.value * 16 }],
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
            <Activity size={16} color={active ? scheme.primary : scheme.onSurfaceVariant} />
          </View>
          <View style={styles.liveCardTexts}>
            <Text
              style={[styles.liveCardTitle, active && styles.liveCardTitleActive]}
              numberOfLines={1}
            >
              {title}
            </Text>
            <Text style={styles.liveCardSub} numberOfLines={1}>
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
    paddingTop: spacing.xs,
    paddingBottom: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: scheme.outlineVariant,
  },
  headerTitleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  title: {
    ...type.titleMedium,
    fontSize: 18,
    color: scheme.onSurface,
    fontWeight: '600',
  },
  countBadge: {
    minWidth: 20,
    height: 20,
    borderRadius: shape.full,
    backgroundColor: scheme.secondaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  countBadgeText: {
    ...type.labelSmall,
    fontSize: 11,
    color: scheme.onSecondaryContainer,
    fontWeight: '700',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  resetBtn: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: shape.small,
  },
  resetText: {
    ...type.labelMedium,
    color: scheme.primary,
    fontWeight: '600',
  },
  closeBtn: {
    width: 32,
    height: 32,
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
    paddingTop: 12,
    paddingBottom: 8,
  },
  section: {
    marginBottom: 12,
  },
  sectionTitle: {
    ...type.labelSmall,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: scheme.onSurfaceVariant,
    marginBottom: 6,
    fontWeight: '700',
  },
  pillsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
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
    ...type.labelMedium,
    fontSize: 13,
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
    padding: 2,
    borderWidth: 1,
    borderColor: scheme.outlineVariant,
    overflow: 'hidden',
  },
  segmentIndicator: {
    position: 'absolute',
    top: 2,
    left: 2,
    bottom: 2,
    borderRadius: shape.full,
    backgroundColor: scheme.secondaryContainer,
    zIndex: 0,
  },
  segmentBtn: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: shape.full,
    minHeight: 44,
    zIndex: 1,
  },
  segmentText: {
    ...type.labelSmall,
    fontSize: 12,
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
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: shape.medium,
    borderWidth: 1,
    minHeight: 48,
  },
  liveCardLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
    paddingRight: 10,
  },
  liveIconCircle: {
    width: 28,
    height: 28,
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  liveIconCircleActive: {
    backgroundColor: 'rgba(92, 219, 190, 0.16)',
  },
  liveCardTexts: {
    flex: 1,
    gap: 1,
  },
  liveCardTitle: {
    ...type.labelLarge,
    fontSize: 13,
    color: scheme.onSurface,
    fontWeight: '600',
  },
  liveCardTitleActive: {
    color: scheme.onSurface,
  },
  liveCardSub: {
    ...type.bodySmall,
    fontSize: 11,
    color: scheme.onSurfaceVariant,
  },
  switchTrack: {
    width: 38,
    height: 22,
    borderRadius: 11,
    backgroundColor: scheme.surfaceContainerHighest,
    padding: 2,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  switchTrackActive: {
    backgroundColor: scheme.primary,
  },
  switchThumb: {
    width: 18,
    height: 18,
    borderRadius: 9,
  },
  pressed: {
    opacity: 0.8,
  },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: 10,
    paddingBottom: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: scheme.outlineVariant,
    backgroundColor: scheme.surfaceContainer,
  },
  doneBtn: {
    minHeight: 46,
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
