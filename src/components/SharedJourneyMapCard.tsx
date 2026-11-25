import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  ChevronLeft,
  ChevronRight,
  Clock3,
  Footprints,
  LocateFixed,
  MapPinned,
  Maximize2,
  Minus,
  Plus,
  RefreshCw,
  ShieldCheck,
  X,
} from './icons';
import { LineBadge } from './LineBadge';
import { LiveSensors } from './LiveDot';
import { MorphingLoader } from './MorphingLoader';
import { RouteMap, type RouteMapHandle } from './RouteMap';
import { SpringPressable } from './SpringPressable';
import { useStrings } from '../i18n';
import { buildMapStages, resolveStageSelection, type MapStage } from '../map/stages';
import type { MapRoute, MapVehicle } from '../map/types';
import { acquireMapServerForRoute } from '../services/mapServerLease';
import { resolveGeometry, type Coord } from '../services/routeGeometry';
import { formatWalkDistance } from '../services/settings';
import { elev, scheme, shape, type } from '../theme/tokens';
import type { Connection } from '../types/models';

function stageLabel(stage: MapStage, boardLabel: string, alightLabel: string): string {
  if (stage.endpointRole === 'start') return `${boardLabel}: ${stage.fromStop}`;
  if (stage.endpointRole === 'end') return `${alightLabel}: ${stage.toStop}`;
  if (stage.segmentIndex && stage.segmentCount) {
    return `${stage.segmentIndex}/${stage.segmentCount} ${stage.toStop}`;
  }
  return stage.toStop || stage.fromStop;
}

export function SharedJourneyMapCard({
  connection,
  mapRoute,
  vehicle,
  ended,
  loading,
  onRetryData,
  desktopFill = false,
}: {
  connection: Connection;
  mapRoute: MapRoute | null;
  vehicle: MapVehicle | null;
  ended: boolean;
  loading: boolean;
  onRetryData: () => void;
  desktopFill?: boolean;
}) {
  const s = useStrings();
  const mapRef = useRef<RouteMapHandle>(null);
  const railRef = useRef<ScrollView>(null);
  const pillOffsets = useRef<Record<string, number>>({});
  const geometryRef = useRef(new Map<string, Coord[]>());
  const [geometryVersion, setGeometryVersion] = useState(0);
  const [offlineBase, setOfflineBase] = useState<string | null | undefined>();
  const [mapFailed, setMapFailed] = useState(false);
  const [selectedStageId, setSelectedStageId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [focused, setFocused] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      let release = () => {};
      void acquireMapServerForRoute(mapRoute)
        .then((lease) => {
          if (cancelled) {
            lease.release();
            return;
          }
          release = lease.release;
          setOfflineBase(lease.base);
        })
        .catch(() => {
          if (!cancelled) setOfflineBase(null);
        });
      return () => {
        cancelled = true;
        release();
      };
    }, [mapRoute]),
  );

  useEffect(() => {
    if (!mapRoute) return;
    const abort = new AbortController();
    geometryRef.current.clear();
    setMapFailed(false);
    void resolveGeometry(
      mapRoute,
      (legId, coords) => {
        if (abort.signal.aborted) return;
        geometryRef.current.set(legId, coords);
        setGeometryVersion((v) => v + 1);
        mapRef.current?.setGeometry(legId, coords, true);
      },
      abort.signal,
    ).catch(() => {});
    return () => abort.abort();
  }, [mapRoute]);

  const stages = useMemo(() => {
    void geometryVersion;
    return buildMapStages(mapRoute, geometryRef.current);
  }, [mapRoute, geometryVersion]);

  const activeStage = useMemo(
    () => (selectedStageId ? (stages.find((st) => st.id === selectedStageId) ?? null) : null),
    [selectedStageId, stages],
  );

  useEffect(() => {
    if (selectedStageId && !activeStage) setSelectedStageId(null);
  }, [selectedStageId, activeStage]);

  useEffect(() => {
    const key = activeStage?.id ?? 'all';
    const x = pillOffsets.current[key];
    if (typeof x === 'number') {
      railRef.current?.scrollTo({ x: Math.max(0, x - 20), animated: true });
    }
  }, [activeStage]);

  const handleReady = useCallback(() => {
    setMapFailed(false);
    for (const [legId, coords] of geometryRef.current.entries()) {
      mapRef.current?.setGeometry(legId, coords);
    }
    if (!activeStage) mapRef.current?.fit();
  }, [activeStage]);

  const handleSelectStage = useCallback((stageId: string | null) => {
    setSelectedStageId((curr) => (curr === stageId ? null : stageId));
  }, []);

  const handleStepStage = useCallback(
    (delta: -1 | 1) => {
      if (stages.length === 0) return;
      if (!activeStage) {
        setSelectedStageId(delta > 0 ? stages[0].id : stages[stages.length - 1].id);
        return;
      }
      const nextIdx = activeStage.stageNumber - 1 + delta;
      if (nextIdx < 0 || nextIdx >= stages.length) {
        setSelectedStageId(null);
      } else {
        setSelectedStageId(stages[nextIdx].id);
      }
    },
    [activeStage, stages],
  );

  const handleLegTap = useCallback(
    (legId: string) => {
      const next = resolveStageSelection(stages, legId, selectedStageId);
      setSelectedStageId(next?.id ?? null);
    },
    [stages, selectedStageId],
  );

  const hasApprox = !!mapRoute?.legs.some((leg) => leg.approx);
  const footerNote = !vehicle && !ended ? s.share.noVehicle : s.share.vehicleOnly;

  const summarySub = useMemo(() => {
    if (activeStage) return s.share.stageCounter(activeStage.stageNumber, stages.length);
    const base = `${connection.departAt} \u2192 ${connection.arriveAt} \u2022 ${s.share.duration(connection.durationMin)}`;
    return connection.transfers > 0
      ? `${base} \u2022 ${s.share.transfers(connection.transfers)}`
      : base;
  }, [activeStage, connection.arriveAt, connection.departAt, connection.durationMin, connection.transfers, s, stages.length]);

  const renderStageFooter = () => {
    if (!activeStage) return null;
    return (
      <View style={styles.stageFooter}>
        <SpringPressable
          onPress={() => handleStepStage(-1)}
          haptic="selection"
          accessibilityRole="button"
          accessibilityLabel={s.share.previousStage}
          onFocus={() => setFocused('prev-stage')}
          onBlur={() => setFocused(null)}
          style={[styles.stepBtn, focused === 'prev-stage' && styles.focused]}
        >
          <ChevronLeft size={20} color={scheme.onSurface} />
        </SpringPressable>

        <View style={styles.stageFooterBody}>
          <Text style={styles.stageFooterStops} numberOfLines={1}>
            {activeStage.endpointRole === 'start'
              ? `${s.map.board}: ${activeStage.fromStop}`
              : activeStage.endpointRole === 'end'
                ? `${s.map.alight}: ${activeStage.toStop}`
                : `${activeStage.fromStop} \u2192 ${activeStage.toStop}`}
          </Text>
          <Text style={styles.stageFooterMeta} numberOfLines={1}>
            {activeStage.endpointRole
              ? activeStage.departAt
              : `${activeStage.departAt} \u2192 ${activeStage.arriveAt}`}
            {activeStage.stopsCount > 0 ? ` \u2022 ${s.map.legStops(activeStage.stopsCount)}` : ''}
          </Text>
        </View>

        <SpringPressable
          onPress={() => handleStepStage(1)}
          haptic="selection"
          accessibilityRole="button"
          accessibilityLabel={s.share.nextStage}
          onFocus={() => setFocused('next-stage')}
          onBlur={() => setFocused(null)}
          style={[styles.stepBtn, focused === 'next-stage' && styles.focused]}
        >
          <ChevronRight size={20} color={scheme.onSurface} />
        </SpringPressable>
      </View>
    );
  };

  const renderStageRail = () => {
    if (stages.length <= 1) return null;
    return (
      <ScrollView
        ref={railRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.stageRailScroll}
        contentContainerStyle={styles.stageRail}
        overScrollMode="never"
      >
        <View
          onLayout={(e) => {
            pillOffsets.current.all = e.nativeEvent.layout.x;
          }}
        >
          <SpringPressable
            onPress={() => handleSelectStage(null)}
            haptic="selection"
            accessibilityRole="button"
            accessibilityState={{ selected: activeStage === null }}
            accessibilityLabel={s.map.showWholeRoute}
            onFocus={() => setFocused('stage-all')}
            onBlur={() => setFocused(null)}
            style={[
              styles.stagePill,
              activeStage === null && styles.stagePillActive,
              focused === 'stage-all' && styles.focused,
            ]}
          >
            <Text
              style={[styles.stagePillLabel, activeStage === null && styles.stagePillLabelActive]}
              numberOfLines={1}
            >
              {s.map.showWholeRoute}
            </Text>
          </SpringPressable>
        </View>

        {stages.map((st) => {
          const isSelected = activeStage?.id === st.id;
          const isWalk = st.leg.mode === 'walk';
          const walkLabel = formatWalkDistance(st.walkM ?? 0);
          const sub = stageLabel(st, s.map.board, s.map.alight);
          const focusKey = `stage-${st.id}`;
          return (
            <View
              key={st.id}
              onLayout={(e) => {
                pillOffsets.current[st.id] = e.nativeEvent.layout.x;
              }}
            >
              <SpringPressable
                onPress={() => handleSelectStage(st.id)}
                haptic="selection"
                accessibilityRole="button"
                accessibilityState={{ selected: isSelected }}
                accessibilityLabel={
                  isWalk
                    ? s.map.walkStageA11y(walkLabel)
                    : s.map.lineStageA11y(st.leg.line ?? '', sub)
                }
                onFocus={() => setFocused(focusKey)}
                onBlur={() => setFocused(null)}
                style={[
                  styles.stagePill,
                  isSelected && styles.stagePillActive,
                  focused === focusKey && styles.focused,
                ]}
              >
                <Text style={[styles.stageIndex, isSelected && styles.stageIndexActive]}>
                  {st.stageNumber}.
                </Text>
                {isWalk ? (
                  <>
                    <Footprints
                      size={14}
                      color={isSelected ? scheme.onPrimaryContainer : scheme.onSurfaceVariant}
                    />
                    <Text
                      style={[styles.stagePillLabel, isSelected && styles.stagePillLabelActive]}
                      numberOfLines={1}
                    >
                      {walkLabel}
                    </Text>
                  </>
                ) : (
                  <>
                    <LineBadge mode={st.leg.mode} line={st.leg.line} compact active={isSelected} />
                    <Text
                      style={[styles.stagePillLabel, isSelected && styles.stagePillLabelActive]}
                      numberOfLines={1}
                    >
                      {sub}
                    </Text>
                  </>
                )}
              </SpringPressable>
            </View>
          );
        })}
      </ScrollView>
    );
  };

  const renderMapContent = (isModal: boolean) => {
    if (!mapRoute) {
      return (
        <View style={[styles.mapEmpty, desktopFill && !isModal && styles.mapEmptyFill]}>
          {loading && <MorphingLoader variant="contained" size={32} startIndex={3} />}
          <Text style={styles.emptyText}>
            {loading ? s.share.geometryLoading : s.share.mapUnavailable}
          </Text>
          {!loading && (
            <SpringPressable
              onPress={onRetryData}
              haptic="selection"
              accessibilityRole="button"
              onFocus={() => setFocused('retry-data')}
              onBlur={() => setFocused(null)}
              style={[styles.inlineBtn, focused === 'retry-data' && styles.focused]}
            >
              <RefreshCw size={16} color={scheme.onSecondaryContainer} />
              <Text style={styles.inlineBtnText}>{s.share.retryMap}</Text>
            </SpringPressable>
          )}
        </View>
      );
    }

    return (
      <View
        style={
          isModal
            ? styles.modalMapWrap
            : [styles.mapWrap, desktopFill && styles.mapWrapDesktopFill]
        }
      >
        {offlineBase !== undefined && (
          <RouteMap
            ref={mapRef}
            route={mapRoute}
            vehicle={vehicle}
            selectedLegId={activeStage?.legId ?? null}
            focusCoords={activeStage?.focusCoords ?? null}
            stopRange={activeStage?.stopRange ?? null}
            focusMaxZoom={activeStage?.focusMaxZoom ?? null}
            offlineBase={offlineBase}
            paddingTop={isModal ? 32 : 36}
            paddingBottom={isModal ? 36 : 36}
            paddingLeft={28}
            paddingRight={28}
            fitOnGeometry
            maxZoom={isModal ? 17 : 16}
            showPoi={isModal}
            onReady={handleReady}
            onLegTap={handleLegTap}
            onError={() => setMapFailed(true)}
            onTilesStatus={(ok) => setMapFailed(!ok)}
          />
        )}

        {(activeStage || vehicle) && !mapFailed && (
          <View style={styles.canvasTopOverlay} pointerEvents="none">
            {activeStage ? (
              <View style={styles.canvasBadge}>
                <Text style={styles.canvasBadgeText}>
                  {s.share.stageCounter(activeStage.stageNumber, stages.length)}
                </Text>
              </View>
            ) : (
              <View />
            )}
            {vehicle && (
              <View style={[styles.canvasBadge, styles.canvasBadgeLive]}>
                <LiveSensors color={scheme.onPrimaryContainer} size={12} />
                <Text style={styles.canvasBadgeLiveText} numberOfLines={1}>
                  {s.share.vehicleLineLive(vehicle.line)}
                </Text>
              </View>
            )}
          </View>
        )}

        {isModal ? (
          <View style={styles.modalControlRail}>
            <SpringPressable
              onPress={() => mapRef.current?.zoomBy(1)}
              haptic="selection"
              accessibilityRole="button"
              accessibilityLabel={s.share.zoomIn}
              style={styles.mapFab}
            >
              <Plus size={20} color={scheme.onSurface} />
            </SpringPressable>
            <SpringPressable
              onPress={() => mapRef.current?.zoomBy(-1)}
              haptic="selection"
              accessibilityRole="button"
              accessibilityLabel={s.share.zoomOut}
              style={styles.mapFab}
            >
              <Minus size={20} color={scheme.onSurface} />
            </SpringPressable>
            <SpringPressable
              onPress={() => mapRef.current?.fit()}
              haptic="selection"
              accessibilityRole="button"
              accessibilityLabel={s.share.fitMap}
              style={styles.mapFab}
            >
              <LocateFixed size={20} color={scheme.onSurface} />
            </SpringPressable>
          </View>
        ) : (
          <SpringPressable
            onPress={() => mapRef.current?.fit()}
            haptic="selection"
            accessibilityRole="button"
            accessibilityLabel={s.share.fitMap}
            onFocus={() => setFocused('fit')}
            onBlur={() => setFocused(null)}
            style={[styles.fitFab, focused === 'fit' && styles.focused]}
          >
            <LocateFixed size={19} color={scheme.onSurface} />
          </SpringPressable>
        )}

        {mapFailed && (
          <View style={styles.errorOverlay}>
            <Text style={styles.errorOverlayText} accessibilityRole="alert">
              {s.share.mapError}
            </Text>
            <SpringPressable
              onPress={() => {
                setMapFailed(false);
                mapRef.current?.reload();
              }}
              haptic="selection"
              accessibilityRole="button"
              onFocus={() => setFocused('retry-map')}
              onBlur={() => setFocused(null)}
              style={[styles.inlineBtn, focused === 'retry-map' && styles.focused]}
            >
              <RefreshCw size={16} color={scheme.onSecondaryContainer} />
              <Text style={styles.inlineBtnText}>{s.share.retryMap}</Text>
            </SpringPressable>
          </View>
        )}
      </View>
    );
  };

  return (
    <View style={[styles.card, desktopFill && styles.cardDesktopFill]}>
      <View style={styles.header}>
        <View style={styles.headerTitleWrap}>
          <View style={styles.headerIconBadge}>
            <MapPinned size={19} color={scheme.onPrimaryContainer} />
          </View>
          <View style={styles.headerTextCol}>
            <Text style={styles.title} accessibilityRole="header" numberOfLines={1}>
              {s.share.map}
            </Text>
            <Text style={styles.subtitle} numberOfLines={1}>
              {summarySub}
            </Text>
          </View>
        </View>

        {mapRoute && (
          <SpringPressable
            onPress={() => setExpanded(true)}
            haptic="selection"
            accessibilityRole="button"
            accessibilityLabel={s.share.expandMap}
            onFocus={() => setFocused('expand')}
            onBlur={() => setFocused(null)}
            style={[styles.expandPill, focused === 'expand' && styles.focused]}
          >
            <Maximize2 size={15} color={scheme.onSecondaryContainer} />
            <Text style={styles.expandPillText} numberOfLines={1}>
              {s.share.fullscreenMap}
            </Text>
          </SpringPressable>
        )}
      </View>

      <View style={[styles.mapFrame, desktopFill && styles.mapFrameDesktopFill]}>
        {!expanded ? (
          renderMapContent(false)
        ) : (
          <View style={[styles.mapWrap, desktopFill && styles.mapWrapDesktopFill]} />
        )}
        {renderStageFooter()}
      </View>

      {renderStageRail()}

      <View style={styles.footer}>
        {!vehicle && !ended ? (
          <Clock3 size={14} color={scheme.onSurfaceVariant} style={styles.footerIcon} />
        ) : (
          <ShieldCheck size={14} color={scheme.primary} style={styles.footerIcon} />
        )}
        <Text style={styles.footerText}>
          {footerNote}
          {hasApprox && (vehicle || ended) ? ` \u00b7 ${s.share.approximateGeometry}` : ''}
        </Text>
      </View>

      <Modal
        visible={expanded}
        animationType="slide"
        onRequestClose={() => setExpanded(false)}
        statusBarTranslucent
      >
        <SafeAreaView style={styles.modalSafe} edges={['top', 'bottom']}>
          <View style={styles.modalHeader}>
            <View style={styles.headerTitleWrap}>
              <View style={styles.headerIconBadge}>
                <MapPinned size={19} color={scheme.onPrimaryContainer} />
              </View>
              <View style={styles.headerTextCol}>
                <Text style={styles.title} numberOfLines={1}>
                  {s.share.map}
                </Text>
                <Text style={styles.subtitle} numberOfLines={1}>
                  {summarySub}
                </Text>
              </View>
            </View>
            <Pressable
              onPress={() => setExpanded(false)}
              accessibilityRole="button"
              accessibilityLabel={s.share.closeMap}
              onFocus={() => setFocused('close-map')}
              onBlur={() => setFocused(null)}
              style={({ pressed }) => [
                styles.closeBtn,
                pressed && styles.pressed,
                focused === 'close-map' && styles.focused,
              ]}
            >
              <X size={21} color={scheme.onSurface} />
            </Pressable>
          </View>
          {expanded && renderMapContent(true)}
          <View style={styles.modalBottomSheet}>
            {renderStageFooter()}
            {stages.length > 1 && <View style={styles.modalRailInner}>{renderStageRail()}</View>}
          </View>
        </SafeAreaView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: scheme.surfaceContainer,
    borderRadius: shape.extraLarge,
    borderWidth: 2,
    borderColor: scheme.outlineVariant,
    padding: 14,
    gap: 12,
    ...elev.level1,
  },
  cardDesktopFill: {
    flex: 1,
    minHeight: 420,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  headerTitleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
    minWidth: 0,
  },
  headerIconBadge: {
    width: 40,
    height: 40,
    borderRadius: 14,
    backgroundColor: scheme.primaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  headerTextCol: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  title: {
    fontSize: 16,
    lineHeight: 20,
    fontWeight: '800',
    letterSpacing: -0.2,
    color: scheme.onSurface,
  },
  subtitle: {
    ...type.bodySmall,
    color: scheme.onSurfaceVariant,
    fontVariant: ['tabular-nums'],
  },
  expandPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 44,
    paddingHorizontal: 14,
    borderRadius: shape.full,
    backgroundColor: scheme.secondaryContainer,
    borderWidth: 2,
    borderColor: scheme.outlineVariant,
  },
  expandPillText: {
    ...type.labelMedium,
    fontWeight: '700',
    color: scheme.onSecondaryContainer,
  },
  mapFrame: {
    borderRadius: 22,
    overflow: 'hidden',
    backgroundColor: scheme.surfaceContainerLow,
    borderWidth: 2,
    borderColor: scheme.outlineVariant,
  },
  mapFrameDesktopFill: {
    flex: 1,
    minHeight: 380,
  },
  mapWrap: {
    height: 276,
    backgroundColor: scheme.surfaceContainerLowest,
  },
  mapWrapDesktopFill: {
    flex: 1,
    height: undefined,
    minHeight: 380,
  },
  modalMapWrap: {
    flex: 1,
    backgroundColor: scheme.surfaceContainerLowest,
  },
  canvasTopOverlay: {
    position: 'absolute',
    top: 10,
    left: 10,
    right: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  canvasBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: scheme.surfaceContainerHigh,
    borderRadius: shape.full,
    borderWidth: 2,
    borderColor: scheme.outlineVariant,
    paddingHorizontal: 11,
    paddingVertical: 5,
    ...elev.level2,
  },
  canvasBadgeText: {
    ...type.labelSmall,
    fontWeight: '700',
    color: scheme.onSurface,
    fontVariant: ['tabular-nums'],
  },
  canvasBadgeLive: {
    backgroundColor: scheme.primaryContainer,
    borderColor: scheme.primary,
  },
  canvasBadgeLiveText: {
    ...type.labelSmall,
    fontWeight: '700',
    color: scheme.onPrimaryContainer,
  },
  fitFab: {
    position: 'absolute',
    right: 10,
    bottom: 10,
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: scheme.surfaceContainerHigh,
    borderWidth: 2,
    borderColor: scheme.outlineVariant,
    alignItems: 'center',
    justifyContent: 'center',
    ...elev.level2,
  },
  modalControlRail: {
    position: 'absolute',
    right: 14,
    bottom: 18,
    gap: 8,
  },
  mapFab: {
    width: 46,
    height: 46,
    borderRadius: 15,
    backgroundColor: scheme.surfaceContainerHigh,
    borderWidth: 2,
    borderColor: scheme.outlineVariant,
    alignItems: 'center',
    justifyContent: 'center',
    ...elev.level2,
  },
  mapEmpty: {
    height: 220,
    padding: 24,
    gap: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: scheme.surfaceContainerLow,
  },
  mapEmptyFill: {
    flex: 1,
    height: undefined,
    minHeight: 360,
  },
  emptyText: {
    ...type.bodyMedium,
    color: scheme.onSurfaceVariant,
    textAlign: 'center',
    lineHeight: 20,
  },
  errorOverlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: scheme.surfaceContainerLow,
    padding: 24,
    gap: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorOverlayText: {
    ...type.bodyMedium,
    color: scheme.onSurface,
    textAlign: 'center',
    lineHeight: 21,
  },
  inlineBtn: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: shape.full,
    backgroundColor: scheme.secondaryContainer,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  inlineBtnText: {
    ...type.labelLarge,
    fontWeight: '700',
    color: scheme.onSecondaryContainer,
  },
  stageFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 10,
    gap: 8,
    backgroundColor: scheme.surfaceContainerLow,
    borderTopWidth: 2,
    borderTopColor: scheme.outlineVariant,
  },
  stepBtn: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: scheme.surfaceContainerHigh,
    borderWidth: 2,
    borderColor: scheme.outlineVariant,
  },
  stageFooterBody: {
    flex: 1,
    paddingHorizontal: 4,
    gap: 2,
    minWidth: 0,
  },
  stageFooterStops: {
    ...type.labelLarge,
    fontWeight: '700',
    color: scheme.onSurface,
  },
  stageFooterMeta: {
    ...type.bodySmall,
    color: scheme.onSurfaceVariant,
    fontVariant: ['tabular-nums'],
  },
  stageRailScroll: {
    flexGrow: 0,
    flexShrink: 0,
  },
  stageRail: {
    gap: 8,
    alignItems: 'center',
    paddingVertical: 2,
  },
  stagePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 44,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: scheme.surfaceContainerLow,
    borderWidth: 2,
    borderColor: scheme.outlineVariant,
    maxWidth: 236,
  },
  stagePillActive: {
    borderRadius: shape.full,
    backgroundColor: scheme.primaryContainer,
    borderWidth: 1.5,
    borderColor: scheme.primary,
  },
  stageIndex: {
    ...type.labelSmall,
    fontWeight: '700',
    color: scheme.onSurfaceVariant,
  },
  stageIndexActive: {
    color: scheme.onPrimaryContainer,
  },
  stagePillLabel: {
    ...type.labelMedium,
    fontWeight: '600',
    color: scheme.onSurfaceVariant,
    flexShrink: 1,
  },
  stagePillLabelActive: {
    color: scheme.onPrimaryContainer,
    fontWeight: '700',
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: scheme.surfaceContainerLow,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  footerIcon: {
    marginTop: 2,
    flexShrink: 0,
  },
  footerText: {
    ...type.bodySmall,
    color: scheme.onSurfaceVariant,
    lineHeight: 17,
    flex: 1,
    minWidth: 0,
  },
  modalSafe: {
    flex: 1,
    backgroundColor: scheme.surface,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 2,
    borderBottomColor: scheme.outlineVariant,
  },
  closeBtn: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: scheme.surfaceContainerHigh,
    borderWidth: 2,
    borderColor: scheme.outlineVariant,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalBottomSheet: {
    backgroundColor: scheme.surface,
    borderTopWidth: 2,
    borderTopColor: scheme.outlineVariant,
  },
  modalRailInner: {
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  focused: {
    borderColor: scheme.onSurface,
  },
  pressed: {
    opacity: 0.78,
  },
});
