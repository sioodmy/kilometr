import { useCallback, useEffect, useMemo, useRef } from 'react';
import { BackHandler, Platform, StyleSheet, Text, View } from 'react-native';
import BottomSheet, {
  BottomSheetBackdrop,
  type BottomSheetBackdropProps,
  BottomSheetScrollView,
  useBottomSheetSpringConfigs,
} from '@gorhom/bottom-sheet';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronLeft, ChevronRight, Maximize2, X } from './icons';
import { LineBadge } from './LineBadge';
import { SpringPressable } from './SpringPressable';
import { TimetableDeparturesView } from './TimetableDeparturesView';
import { useStrings } from '../i18n';
import {
  countPhysicalLineStops,
  lastPhysicalStopIndex,
  physicalStopOrdinal,
  stepPhysicalStopIndex,
  type LinePattern,
  type TransitLine,
} from '../services/lineTimetable';
import { motion } from '../theme/motion';
import { scheme, shape, type } from '../theme/tokens';

export interface StopDeparturesSheetProps {
  line: TransitLine;
  pattern: LinePattern;
  stopIndex: number;
  dateLabel: string;
  isToday: boolean;
  nowSec: number;
  railStroke: string;
  boardingIndex: number;
  alightingIndex: number;
  plannedDepartSec?: number | null;
  onSelectStopIndex: (index: number) => void;
  onOpenFullScreen: () => void;
  onClose: () => void;
}

/** Arkusz M3 Expressive z odjazdami wybranego przystanku, montowany bezpośrednio nad trasą linii. */
export function StopDeparturesSheet({
  line,
  pattern,
  stopIndex,
  dateLabel,
  isToday,
  nowSec,
  railStroke,
  boardingIndex,
  alightingIndex,
  plannedDepartSec,
  onSelectStopIndex,
  onOpenFullScreen,
  onClose,
}: StopDeparturesSheetProps) {
  const s = useStrings();
  const t = s.lineTimetable;
  const insets = useSafeAreaInsets();
  const sheetRef = useRef<BottomSheet>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const snapPoints = useMemo(() => ['74%', '92%'], []);
  const animationConfigs = useBottomSheetSpringConfigs(motion.sheet);
  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        appearsOnIndex={0}
        disappearsOnIndex={-1}
        accessibilityLabel={s.common.close}
      />
    ),
    [s.common.close],
  );

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      sheetRef.current?.close();
      return true;
    });
    return () => sub.remove();
  }, []);

  const stop = pattern.stops[stopIndex];
  if (!stop) return null;

  const totalStops = countPhysicalLineStops(pattern.stops);
  const currentOrdinal = physicalStopOrdinal(pattern.stops, stopIndex);
  const isTerminal = stopIndex === lastPhysicalStopIndex(pattern.stops);
  const prevIndex = stepPhysicalStopIndex(pattern.stops, stopIndex, -1);
  const nextIndex = stepPhysicalStopIndex(pattern.stops, stopIndex, 1);
  const canPrev = prevIndex >= 0;
  const canNext = nextIndex >= 0;
  const isBoarding = stopIndex === boardingIndex;
  const isAlighting = stopIndex === alightingIndex;

  return (
    <BottomSheet
      ref={sheetRef}
      index={0}
      snapPoints={snapPoints}
      animationConfigs={animationConfigs}
      enableDynamicSizing={false}
      topInset={insets.top}
      enablePanDownToClose
      onClose={() => onCloseRef.current()}
      backgroundStyle={styles.sheet}
      handleIndicatorStyle={styles.handle}
      backdropComponent={renderBackdrop}
    >
      <View style={styles.container} accessibilityViewIsModal>
        <View style={styles.header}>
          <View style={styles.headerIdentity}>
            <LineBadge line={line.shortName} mode={line.mode} size="medium" />
            <View style={styles.headerTextCol}>
              <Text style={styles.stopName} numberOfLines={2} accessibilityRole="header">
                {stop.name}
              </Text>
              <View style={styles.metaPillsRow}>
                {!!stop.code && (
                  <View style={styles.codePill}>
                    <Text style={styles.codePillText}>{t.stopCode(stop.code)}</Text>
                  </View>
                )}
                {isBoarding && (
                  <View style={styles.tripRolePill}>
                    <Text style={styles.tripRolePillText}>{t.boardingStop}</Text>
                  </View>
                )}
                {isAlighting && (
                  <View style={styles.tripRolePill}>
                    <Text style={styles.tripRolePillText}>{t.alightingStop}</Text>
                  </View>
                )}
              </View>
            </View>
          </View>
          <View style={styles.headerActions}>
            <SpringPressable
              onPress={onOpenFullScreen}
              haptic="selection"
              scaleDelta={0.05}
              accessibilityRole="button"
              accessibilityLabel={t.openFullScreen}
              style={styles.headerBtn}
            >
              <Maximize2 size={18} color={scheme.onSurfaceVariant} />
            </SpringPressable>
            <SpringPressable
              onPress={() => sheetRef.current?.close()}
              haptic="selection"
              scaleDelta={0.05}
              accessibilityRole="button"
              accessibilityLabel={s.common.close}
              style={styles.headerBtn}
            >
              <X size={20} color={scheme.onSurface} />
            </SpringPressable>
          </View>
        </View>

        <View style={styles.stopNavBar}>
          <SpringPressable
            onPress={() => canPrev && onSelectStopIndex(prevIndex)}
            disabled={!canPrev}
            haptic="selection"
            scaleDelta={0.06}
            accessibilityRole="button"
            accessibilityLabel={t.previousStop}
            accessibilityState={{ disabled: !canPrev }}
            style={[styles.stepBtn, !canPrev && styles.stepBtnDisabled]}
          >
            <ChevronLeft
              size={20}
              color={canPrev ? scheme.onSurface : scheme.outline}
            />
          </SpringPressable>
          <View style={styles.stopNavCenter}>
            <View style={styles.directionLine}>
              <View style={[styles.directionDot, { backgroundColor: railStroke }]} />
              <Text style={styles.directionText} numberOfLines={1}>
                {pattern.headsign}
              </Text>
            </View>
            <Text style={styles.stopIndexText} numberOfLines={1}>
              {currentOrdinal} / {totalStops} {'\u00b7'} {dateLabel}
            </Text>
          </View>
          <SpringPressable
            onPress={() => canNext && onSelectStopIndex(nextIndex)}
            disabled={!canNext}
            haptic="selection"
            scaleDelta={0.06}
            accessibilityRole="button"
            accessibilityLabel={t.nextStop}
            accessibilityState={{ disabled: !canNext }}
            style={[styles.stepBtn, !canNext && styles.stepBtnDisabled]}
          >
            <ChevronRight
              size={20}
              color={canNext ? scheme.onSurface : scheme.outline}
            />
          </SpringPressable>
        </View>

        <BottomSheetScrollView
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: Math.max(insets.bottom, 16) + 20 },
          ]}
          showsVerticalScrollIndicator={false}
        >
          <TimetableDeparturesView
            stop={stop}
            terminal={isTerminal}
            isToday={isToday}
            nowSec={nowSec}
            railStroke={railStroke}
            plannedDepartSec={isBoarding ? plannedDepartSec : null}
          />
        </BottomSheetScrollView>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  sheet: {
    backgroundColor: scheme.surfaceContainerLow,
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
  },
  handle: {
    backgroundColor: scheme.outline,
    width: 36,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
    paddingHorizontal: 18,
    paddingTop: 4,
    paddingBottom: 12,
  },
  headerIdentity: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  headerTextCol: {
    flex: 1,
    minWidth: 0,
    gap: 6,
  },
  stopName: {
    ...type.titleLarge,
    fontSize: 20,
    lineHeight: 25,
    fontWeight: '800',
    letterSpacing: -0.3,
    color: scheme.onSurface,
  },
  metaPillsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
  },
  codePill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: shape.small,
    backgroundColor: scheme.secondaryContainer,
  },
  codePillText: {
    ...type.labelSmall,
    fontWeight: '700',
    color: scheme.onSecondaryContainer,
  },
  tripRolePill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: shape.small,
    backgroundColor: scheme.primaryContainer,
  },
  tripRolePillText: {
    ...type.labelSmall,
    fontWeight: '700',
    color: scheme.onPrimaryContainer,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  headerBtn: {
    width: 44,
    height: 44,
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stopNavBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 14,
    marginBottom: 12,
    padding: 4,
    borderRadius: shape.extraLarge,
    backgroundColor: scheme.surfaceContainer,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: scheme.outlineVariant,
  },
  stepBtn: {
    width: 44,
    height: 44,
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBtnDisabled: {
    backgroundColor: scheme.surfaceContainerLow,
    opacity: 0.45,
  },
  stopNavCenter: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: 4,
  },
  directionLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    maxWidth: '100%',
  },
  directionDot: {
    width: 8,
    height: 8,
    borderRadius: shape.full,
    flexShrink: 0,
  },
  directionText: {
    ...type.labelLarge,
    fontWeight: '700',
    color: scheme.onSurface,
    flexShrink: 1,
  },
  stopIndexText: {
    ...type.bodySmall,
    fontSize: 11.5,
    color: scheme.onSurfaceVariant,
    fontVariant: ['tabular-nums'],
  },
  scrollContent: {
    paddingHorizontal: 14,
    paddingTop: 2,
    width: '100%',
    maxWidth: 640,
    alignSelf: 'center',
  },
});
