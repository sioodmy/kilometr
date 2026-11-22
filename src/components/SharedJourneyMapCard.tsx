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
  Clock3,
  Footprints,
  LocateFixed,
  Maximize2,
  RefreshCw,
  ShieldCheck,
  X,
} from './icons';
import { LineBadge } from './LineBadge';
import { MorphingLoader } from './MorphingLoader';
import { RouteMap, type RouteMapHandle } from './RouteMap';
import { useStrings } from '../i18n';
import { buildMapStages, resolveStageSelection, type MapStage } from '../map/stages';
import type { MapRoute, MapVehicle } from '../map/types';
import { acquireMapServerForRoute } from '../services/mapServerLease';
import { resolveGeometry, type Coord } from '../services/routeGeometry';
import { formatWalkDistance } from '../services/settings';
import { scheme, shape, type } from '../theme/tokens';

function stageLabel(stage: MapStage, boardLabel: string, alightLabel: string): string {
  if (stage.endpointRole === 'start') return `${boardLabel}: ${stage.fromStop}`;
  if (stage.endpointRole === 'end') return `${alightLabel}: ${stage.toStop}`;
  return stage.toStop || stage.fromStop;
}

export function SharedJourneyMapCard({
  mapRoute,
  vehicle,
  ended,
  loading,
  onRetryData,
}: {
  mapRoute: MapRoute | null;
  vehicle: MapVehicle | null;
  ended: boolean;
  loading: boolean;
  onRetryData: () => void;
}) {
  const s = useStrings();
  const mapRef = useRef<RouteMapHandle>(null);
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

  const handleReady = useCallback(() => {
    setMapFailed(false);
    for (const [legId, coords] of geometryRef.current.entries()) {
      mapRef.current?.setGeometry(legId, coords);
    }
    mapRef.current?.fit();
  }, []);

  const handleSelectStage = useCallback((stageId: string | null) => {
    setSelectedStageId((curr) => (curr === stageId ? null : stageId));
  }, []);

  const handleLegTap = useCallback(
    (legId: string) => {
      const next = resolveStageSelection(stages, legId, selectedStageId);
      setSelectedStageId(next?.id ?? null);
    },
    [stages, selectedStageId],
  );

  const hasApprox = !!mapRoute?.legs.some((leg) => leg.approx);
  const footerNote = !vehicle && !ended ? s.share.noVehicle : s.share.vehicleOnly;

  const renderStageRail = () => {
    if (stages.length <= 1) return null;
    return (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.stageRail}
        overScrollMode="never"
      >
        <Pressable
          onPress={() => handleSelectStage(null)}
          accessibilityRole="button"
          accessibilityState={{ selected: activeStage === null }}
          accessibilityLabel={s.map.showWholeRoute}
          hitSlop={4}
          onFocus={() => setFocused('stage-all')}
          onBlur={() => setFocused(null)}
          style={({ pressed }) => [
            styles.stagePill,
            activeStage === null && styles.stagePillActive,
            pressed && styles.pressed,
            focused === 'stage-all' && styles.focused,
          ]}
        >
          <Text
            style={[styles.stagePillLabel, activeStage === null && styles.stagePillLabelActive]}
            numberOfLines={1}
          >
            {s.map.showWholeRoute}
          </Text>
        </Pressable>

        {stages.map((st) => {
          const isSelected = activeStage?.id === st.id;
          const isWalk = st.leg.mode === 'walk';
          const walkLabel = formatWalkDistance(st.walkM ?? 0);
          const sub = stageLabel(st, s.map.board, s.map.alight);
          const focusKey = `stage-${st.id}`;
          return (
            <Pressable
              key={st.id}
              onPress={() => handleSelectStage(st.id)}
              accessibilityRole="button"
              accessibilityState={{ selected: isSelected }}
              accessibilityLabel={
                isWalk
                  ? s.map.walkStageA11y(walkLabel)
                  : s.map.lineStageA11y(st.leg.line ?? '', sub)
              }
              hitSlop={4}
              onFocus={() => setFocused(focusKey)}
              onBlur={() => setFocused(null)}
              style={({ pressed }) => [
                styles.stagePill,
                isSelected && [styles.stagePillActive, { borderColor: st.leg.color }],
                pressed && styles.pressed,
                focused === focusKey && styles.focused,
              ]}
            >
              <Text style={[styles.stageIndex, isSelected && styles.stageIndexActive]}>
                {st.stageNumber}.
              </Text>
              {isWalk ? (
                <>
                  <Footprints
                    size={13}
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
                  <LineBadge leg={st.leg} compact active={isSelected} />
                  <Text
                    style={[styles.stagePillLabel, isSelected && styles.stagePillLabelActive]}
                    numberOfLines={1}
                  >
                    {sub}
                  </Text>
                </>
              )}
            </Pressable>
          );
        })}
      </ScrollView>
    );
  };

  const renderMapContent = (isModal: boolean) => {
    if (!mapRoute) {
      return (
        <View style={styles.mapEmpty}>
          {loading && <MorphingLoader variant="contained" size={30} />}
          <Text style={styles.emptyText}>
            {loading ? s.share.geometryLoading : s.share.mapUnavailable}
          </Text>
          {!loading && (
            <Pressable
              onPress={onRetryData}
              accessibilityRole="button"
              onFocus={() => setFocused('retry-data')}
              onBlur={() => setFocused(null)}
              style={({ pressed }) => [
                styles.inlineBtn,
                pressed && styles.pressed,
                focused === 'retry-data' && styles.focused,
              ]}
            >
              <RefreshCw size={16} color={scheme.onSecondaryContainer} />
              <Text style={styles.inlineBtnText}>{s.share.retryMap}</Text>
            </Pressable>
          )}
        </View>
      );
    }

    return (
      <View style={isModal ? styles.modalMapWrap : styles.mapWrap}>
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
            paddingTop={isModal ? 24 : 28}
            paddingBottom={isModal ? 32 : 28}
            showPoi={isModal}
            onReady={handleReady}
            onLegTap={handleLegTap}
            onError={() => setMapFailed(true)}
            onTilesStatus={(ok) => setMapFailed(!ok)}
          />
        )}

        <Pressable
          onPress={() => mapRef.current?.fit()}
          accessibilityRole="button"
          accessibilityLabel={s.share.fitMap}
          onFocus={() => setFocused('fit')}
          onBlur={() => setFocused(null)}
          style={({ pressed }) => [
            styles.fitFab,
            pressed && styles.pressed,
            focused === 'fit' && styles.focused,
          ]}
        >
          <LocateFixed size={20} color={scheme.onSurface} />
        </Pressable>

        {mapFailed && (
          <View style={styles.errorOverlay}>
            <Text style={styles.errorOverlayText} accessibilityRole="alert">
              {s.share.mapError}
            </Text>
            <Pressable
              onPress={() => {
                setMapFailed(false);
                mapRef.current?.reload();
              }}
              accessibilityRole="button"
              onFocus={() => setFocused('retry-map')}
              onBlur={() => setFocused(null)}
              style={({ pressed }) => [
                styles.inlineBtn,
                pressed && styles.pressed,
                focused === 'retry-map' && styles.focused,
              ]}
            >
              <RefreshCw size={16} color={scheme.onSecondaryContainer} />
              <Text style={styles.inlineBtnText}>{s.share.retryMap}</Text>
            </Pressable>
          </View>
        )}
      </View>
    );
  };

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.headerTitleWrap}>
          <Text style={styles.title} accessibilityRole="header">
            {s.share.map}
          </Text>
          {activeStage && (
            <View style={styles.stageBadge}>
              <Text style={styles.stageBadgeText}>
                {activeStage.stageNumber}/{stages.length}
              </Text>
            </View>
          )}
        </View>
        {mapRoute && (
          <Pressable
            onPress={() => setExpanded(true)}
            accessibilityRole="button"
            accessibilityLabel={s.share.expandMap}
            hitSlop={4}
            onFocus={() => setFocused('expand')}
            onBlur={() => setFocused(null)}
            style={({ pressed }) => [
              styles.iconBtn,
              pressed && styles.pressed,
              focused === 'expand' && styles.focused,
            ]}
          >
            <Maximize2 size={20} color={scheme.onSurface} />
          </Pressable>
        )}
      </View>

      {renderStageRail()}

      {!expanded ? renderMapContent(false) : <View style={styles.mapWrap} />}

      <View style={styles.footer}>
        {!vehicle && !ended ? (
          <Clock3 size={15} color={scheme.onSurfaceVariant} />
        ) : (
          <ShieldCheck size={15} color={scheme.onSurfaceVariant} />
        )}
        <Text style={styles.footerText}>
          {footerNote}
          {hasApprox && (vehicle || ended) ? ` · ${s.share.approximateGeometry}` : ''}
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
              <Text style={styles.title}>{s.share.map}</Text>
              {activeStage && (
                <View style={styles.stageBadge}>
                  <Text style={styles.stageBadgeText}>
                    {activeStage.stageNumber}/{stages.length}
                  </Text>
                </View>
              )}
            </View>
            <Pressable
              onPress={() => setExpanded(false)}
              accessibilityRole="button"
              accessibilityLabel={s.share.closeMap}
              onFocus={() => setFocused('close-map')}
              onBlur={() => setFocused(null)}
              style={({ pressed }) => [
                styles.iconBtn,
                pressed && styles.pressed,
                focused === 'close-map' && styles.focused,
              ]}
            >
              <X size={22} color={scheme.onSurface} />
            </Pressable>
          </View>
          {expanded && renderMapContent(true)}
          <View style={styles.modalRailWrap}>{renderStageRail()}</View>
        </SafeAreaView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: shape.extraLarge,
    backgroundColor: scheme.surfaceContainerLow,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingLeft: 20,
    paddingRight: 10,
    paddingTop: 14,
    paddingBottom: 10,
  },
  headerTitleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
    minWidth: 0,
  },
  title: {
    ...type.titleMedium,
    fontWeight: '700',
    color: scheme.onSurface,
    flexShrink: 1,
  },
  stageBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: shape.full,
    backgroundColor: scheme.primaryContainer,
  },
  stageBadgeText: {
    ...type.labelSmall,
    fontWeight: '700',
    color: scheme.onPrimaryContainer,
  },
  iconBtn: {
    width: 48,
    height: 48,
    borderRadius: shape.medium,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  stageRail: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 8,
  },
  stagePill: {
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainerHigh,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  stagePillActive: {
    backgroundColor: scheme.primaryContainer,
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
    maxWidth: 150,
  },
  stagePillLabelActive: {
    color: scheme.onPrimaryContainer,
  },
  mapWrap: {
    height: 288,
    marginHorizontal: 12,
    borderRadius: shape.large,
    overflow: 'hidden',
    backgroundColor: scheme.surfaceContainerHighest,
  },
  modalMapWrap: {
    flex: 1,
    backgroundColor: scheme.surfaceContainerHighest,
  },
  fitFab: {
    position: 'absolute',
    right: 12,
    bottom: 12,
    width: 48,
    height: 48,
    borderRadius: shape.large,
    backgroundColor: scheme.surfaceContainerHigh,
    borderWidth: 1,
    borderColor: scheme.outlineVariant,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mapEmpty: {
    marginHorizontal: 12,
    padding: 24,
    gap: 12,
    alignItems: 'center',
    borderRadius: shape.large,
    backgroundColor: scheme.surfaceContainerHigh,
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
    paddingHorizontal: 16,
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
  footer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  footerText: {
    ...type.bodySmall,
    color: scheme.onSurfaceVariant,
    lineHeight: 18,
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
    gap: 8,
    paddingLeft: 20,
    paddingRight: 10,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: scheme.outlineVariant,
  },
  modalRailWrap: {
    paddingTop: 12,
    backgroundColor: scheme.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: scheme.outlineVariant,
  },
  focused: {
    borderColor: scheme.onSurface,
  },
  pressed: {
    opacity: 0.78,
  },
});
