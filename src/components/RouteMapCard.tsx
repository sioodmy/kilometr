// Karta mapy w szczegółach połączenia: leniwie montowany podgląd MapLibre GL,
// szybki wybór etapów podróży oraz przejście jednym dotknięciem do pełnego ekranu.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  InteractionManager,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import Animated, { FadeOut, ReduceMotion } from 'react-native-reanimated';
import {
  ChevronLeft,
  ChevronRight,
  Footprints,
  MapPin,
  MapPinned,
  Maximize2,
  RefreshCw,
} from './icons';
import { LineBadge } from './LineBadge';
import { MorphingLoader } from './MorphingLoader';
import { SpringPressable } from './SpringPressable';
import { useStrings } from '../i18n';
import type { Connection } from '../types/models';
import type { MapRoute, MapVehicle } from '../map/types';
import {
  buildMapStages,
  resolveStageSelection,
  useEnrichedConnection,
  type MapStage,
} from '../map/stages';
import { acquireMapServerForRoute } from '../services/mapServerLease';
import { buildMapRoute, resolveGeometry, type Coord } from '../services/routeGeometry';
import { formatWalkDistance } from '../services/settings';
import { elev, scheme, shape, type } from '../theme/tokens';
import { RouteMap, type RouteMapHandle } from './RouteMap';

/**
 * Sygnatura bryły trasy. Tick live zmienia godziny i opóźnienia, ale nie
 * przystanki ani przebieg, więc mapa dostaje ten sam route i nie resetuje kadru.
 */
function routeShapeKey(connection: Connection): string {
  return JSON.stringify([
    connection.id,
    connection.legs.map((leg) => [
      leg.id,
      leg.mode,
      leg.line ?? '',
      leg.fromStopId ?? leg.fromStop,
      leg.toStopId ?? leg.toStop,
      leg.fromLat,
      leg.fromLon,
      leg.toLat,
      leg.toLon,
      leg.geometry?.length ?? 0,
      (leg.intermediateStops ?? []).map((stop) => [stop.stopId, stop.lat, stop.lon]),
    ]),
  ]);
}

function stagePillSubtitle(stage: MapStage, boardLabel: string, alightLabel: string): string {
  if (stage.endpointRole === 'start') return `${boardLabel}: ${stage.fromStop}`;
  if (stage.endpointRole === 'end') return `${alightLabel}: ${stage.toStop}`;
  if (stage.segmentIndex && stage.segmentCount) {
    return `${stage.segmentIndex}/${stage.segmentCount} ${stage.toStop}`;
  }
  return stage.toStop || stage.fromStop;
}

export function RouteMapCard({
  connection,
  vehicle = null,
  onOpenMap,
}: {
  connection: Connection;
  vehicle?: MapVehicle | null;
  onOpenMap: (stageId?: string) => void;
}) {
  const s = useStrings();
  const enriched = useEnrichedConnection(connection) ?? connection;
  const shapeKey = useMemo(() => routeShapeKey(enriched), [enriched]);
  const builtRoute = useRef<{ key: string; route: MapRoute } | null>(null);
  const route = useMemo(() => {
    if (builtRoute.current?.key === shapeKey) return builtRoute.current.route;
    const next = buildMapRoute(enriched);
    builtRoute.current = { key: shapeKey, route: next };
    return next;
  }, [enriched, shapeKey]);

  const mapRef = useRef<RouteMapHandle>(null);
  const railRef = useRef<ScrollView>(null);
  const pillOffsets = useRef<Record<string, number>>({});
  const geometry = useRef(new Map<string, Coord[]>());
  const [geometryVersion, setGeometryVersion] = useState(0);
  const [offlineBase, setOfflineBase] = useState<string | null | undefined>();
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [attempt, setAttempt] = useState(0);
  const [focused, setFocused] = useState<string | null>(null);
  const [selectedStageId, setSelectedStageId] = useState<string | null>(null);
  const [readyToMountMap, setReadyToMountMap] = useState(false);
  const cardRef = useRef<View>(null);
  const measuredRef = useRef(false);
  const { height: windowHeight } = useWindowDimensions();

  const stages = useMemo(() => {
    void geometryVersion;
    return buildMapStages(route, geometry.current);
  }, [route, geometryVersion]);

  const activeStage = useMemo(
    () => resolveStageSelection(stages, selectedStageId),
    [stages, selectedStageId],
  );

  useEffect(() => {
    setSelectedStageId(null);
  }, [route.id]);

  // Automatycznie przewija poziomy pasek chipów do aktywnie wybranego etapu.
  useEffect(() => {
    const key = activeStage?.id ?? 'all';
    const x = pillOffsets.current[key];
    if (typeof x === 'number') {
      railRef.current?.scrollTo({ x: Math.max(0, x - 20), animated: true });
    }
  }, [activeStage]);

  const mountMap = useCallback(() => setReadyToMountMap(true), []);

  // WebView (MapLibre GL) jest ciężki: montujemy go dopiero, gdy karta zbliży się
  // do viewportu, albo po ręcznym dotknięciu placeholdera.
  const measureCard = useCallback(() => {
    if (measuredRef.current) return;
    const node = cardRef.current;
    if (!node) return;
    node.measureInWindow((_x, y, _w, h) => {
      measuredRef.current = true;
      if (y < windowHeight + 180 && y + h > -160) {
        InteractionManager.runAfterInteractions(mountMap);
        setTimeout(mountMap, 550);
      }
    });
  }, [mountMap, windowHeight]);

  const lastRouteId = useRef<string | null>(null);
  useEffect(() => {
    if (!readyToMountMap) return;
    let cancelled = false;
    let release: (() => void) | undefined;
    if (lastRouteId.current !== route?.id) {
      lastRouteId.current = route?.id ?? null;
      setOfflineBase(undefined);
    }
    setStatus('loading');
    void acquireMapServerForRoute(route)
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
      release?.();
    };
  }, [attempt, readyToMountMap, route?.id]);

  useEffect(() => {
    if (!readyToMountMap || status !== 'loading') return;
    const timer = setTimeout(() => setStatus('error'), 20_000);
    return () => clearTimeout(timer);
  }, [status, attempt, readyToMountMap]);

  useEffect(() => {
    if (!readyToMountMap) return;
    const abort = new AbortController();
    geometry.current.clear();
    void resolveGeometry(
      route,
      (legId, coords) => {
        if (abort.signal.aborted) return;
        geometry.current.set(legId, coords);
        setGeometryVersion((v) => v + 1);
        mapRef.current?.setGeometry(legId, coords, true);
      },
      abort.signal,
    );
    return () => abort.abort();
  }, [shapeKey, readyToMountMap]);

  const handleSelectStage = useCallback(
    (stageId: string | null) => {
      if (!readyToMountMap) setReadyToMountMap(true);
      setSelectedStageId((curr) => (curr === stageId ? null : stageId));
    },
    [readyToMountMap],
  );

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

  const openFullscreen = useCallback(() => {
    onOpenMap(activeStage?.id);
  }, [activeStage, onOpenMap]);

  const summarySub = useMemo(() => {
    if (activeStage) {
      return s.map.stageCounter(activeStage.stageNumber, stages.length);
    }
    const base = `${enriched.departAt} \u2192 ${enriched.arriveAt} \u2022 ${s.common.durMin(enriched.durationMin)}`;
    return enriched.transfers > 0
      ? `${base}${s.map.transfersSuffix(enriched.transfers)}`
      : base;
  }, [activeStage, enriched.arriveAt, enriched.departAt, enriched.durationMin, enriched.transfers, s, stages.length]);

  return (
    <View ref={cardRef} collapsable={false} onLayout={measureCard} style={styles.card}>
      <View style={styles.header}>
        <View style={styles.headerTitleWrap}>
          <View style={styles.headerIconBadge}>
            <MapPinned size={19} color={scheme.onPrimaryContainer} />
          </View>
          <View style={styles.headerTextCol}>
            <Text style={styles.title} numberOfLines={1}>
              {s.map.title}
            </Text>
            <Text style={styles.subtitle} numberOfLines={1}>
              {summarySub}
            </Text>
          </View>
        </View>

        <SpringPressable
          onPress={openFullscreen}
          haptic="selection"
          accessibilityRole="button"
          accessibilityLabel={s.compass.openMap}
          onFocus={() => setFocused('open')}
          onBlur={() => setFocused(null)}
          style={[styles.expandPill, focused === 'open' && styles.focused]}
        >
          <Maximize2 size={16} color={scheme.onSecondaryContainer} />
          <Text style={styles.expandPillText} numberOfLines={1}>
            {s.map.openFullscreen}
          </Text>
        </SpringPressable>
      </View>

      <View style={styles.mapFrame}>
        <View style={styles.map}>
          {!readyToMountMap ? (
            <SpringPressable
              onPress={mountMap}
              haptic="selection"
              accessibilityRole="button"
              accessibilityLabel={s.compass.mapTapToLoad}
              onFocus={() => setFocused('map')}
              onBlur={() => setFocused(null)}
              style={[styles.status, styles.placeholder, focused === 'map' && styles.focused]}
            >
              <View style={styles.placeholderIcon}>
                <MapPin size={24} color={scheme.onPrimaryContainer} />
              </View>
              <Text style={styles.placeholderTitle}>{s.compass.mapTapToLoad}</Text>
            </SpringPressable>
          ) : (
            <>
              {offlineBase !== undefined && (
                <Pressable
                  onPress={openFullscreen}
                  accessibilityRole="button"
                  accessibilityLabel={s.compass.openMap}
                  style={StyleSheet.absoluteFill}
                >
                  <View
                    style={StyleSheet.absoluteFill}
                    pointerEvents="none"
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                  >
                    <RouteMap
                      key={attempt}
                      ref={mapRef}
                      route={route}
                      vehicle={vehicle}
                      selectedLegId={activeStage?.legId ?? null}
                      focusCoords={activeStage?.focusCoords ?? null}
                      stopRange={activeStage?.stopRange ?? null}
                      focusMaxZoom={activeStage?.focusMaxZoom ?? null}
                      offlineBase={offlineBase}
                      paddingTop={32}
                      paddingBottom={32}
                      paddingLeft={28}
                      paddingRight={28}
                      fitOnGeometry
                      maxZoom={16}
                      onReady={() => {
                        geometry.current.forEach((coords, legId) =>
                          mapRef.current?.setGeometry(legId, coords),
                        );
                        if (!activeStage) mapRef.current?.fit();
                      }}
                      onTilesStatus={(ok) => setStatus(ok ? 'ready' : 'error')}
                      onError={() => setStatus('error')}
                    />
                  </View>
                </Pressable>
              )}

              {status === 'ready' && (activeStage || vehicle) && (
                <View style={styles.canvasTopOverlay} pointerEvents="none">
                  {activeStage && (
                    <View style={styles.canvasBadge}>
                      <Text style={styles.canvasBadgeText}>
                        {s.map.stageCounter(activeStage.stageNumber, stages.length)}
                      </Text>
                    </View>
                  )}
                  {vehicle && (
                    <View style={[styles.canvasBadge, styles.canvasBadgeLive]}>
                      <Text style={styles.canvasBadgeLiveText} numberOfLines={1}>
                        {s.map.liveVehiclePill(vehicle.line)}
                      </Text>
                    </View>
                  )}
                </View>
              )}

              {status !== 'ready' && (
                <Animated.View
                  exiting={FadeOut.duration(200).reduceMotion(ReduceMotion.System)}
                  style={styles.status}
                  accessibilityLiveRegion="polite"
                >
                  {status === 'loading' && <MorphingLoader variant="contained" size={30} startIndex={3} />}
                  <Text style={styles.statusText}>
                    {status === 'loading' ? s.compass.mapLoading : s.compass.mapFailed}
                  </Text>
                  {status === 'error' && (
                    <SpringPressable
                      onPress={() => setAttempt((value) => value + 1)}
                      haptic="selection"
                      accessibilityRole="button"
                      onFocus={() => setFocused('retry')}
                      onBlur={() => setFocused(null)}
                      style={[styles.retryBtn, focused === 'retry' && styles.focused]}
                    >
                      <RefreshCw size={16} color={scheme.onSecondaryContainer} />
                      <Text style={styles.retryText}>{s.map.retryMap}</Text>
                    </SpringPressable>
                  )}
                </Animated.View>
              )}
            </>
          )}
        </View>

        {activeStage && (
          <View style={styles.stageFooter}>
            <SpringPressable
              onPress={() => handleStepStage(-1)}
              haptic="selection"
              accessibilityRole="button"
              accessibilityLabel={s.map.backA11y}
              onFocus={() => setFocused('prev-stage')}
              onBlur={() => setFocused(null)}
              style={[styles.stepBtn, focused === 'prev-stage' && styles.focused]}
            >
              <ChevronLeft size={20} color={scheme.onSurface} />
            </SpringPressable>

            <Pressable
              onPress={openFullscreen}
              accessibilityRole="button"
              accessibilityLabel={s.compass.openMap}
              style={({ pressed }) => [styles.stageFooterBody, pressed && styles.pressed]}
            >
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
                {activeStage.stopsCount > 0
                  ? ` \u2022 ${s.map.legStops(activeStage.stopsCount)}`
                  : ''}
              </Text>
            </Pressable>

            <SpringPressable
              onPress={() => handleStepStage(1)}
              haptic="selection"
              accessibilityRole="button"
              accessibilityLabel={s.map.stagesTitle}
              onFocus={() => setFocused('next-stage')}
              onBlur={() => setFocused(null)}
              style={[styles.stepBtn, focused === 'next-stage' && styles.focused]}
            >
              <ChevronRight size={20} color={scheme.onSurface} />
            </SpringPressable>
          </View>
        )}
      </View>

      {stages.length > 1 && (
        <ScrollView
          ref={railRef}
          horizontal
          showsHorizontalScrollIndicator={false}
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
                style={[
                  styles.stagePillLabel,
                  activeStage === null && styles.stagePillLabelActive,
                ]}
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
            const sub = stagePillSubtitle(st, s.map.board, s.map.alight);
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
                      <LineBadge
                        mode={st.leg.mode}
                        line={st.leg.line}
                        compact
                        active={isSelected}
                      />
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
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: scheme.surfaceContainer,
    borderRadius: shape.extraLarge,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: scheme.outlineVariant,
    padding: 14,
    gap: 12,
    ...elev.level1,
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
    borderWidth: StyleSheet.hairlineWidth,
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
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: scheme.outlineVariant,
  },
  map: {
    height: 256,
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
    backgroundColor: scheme.surfaceContainerHigh,
    borderRadius: shape.full,
    borderWidth: StyleSheet.hairlineWidth,
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
  status: {
    position: 'absolute', top: 0, right: 0, bottom: 0, left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    padding: 18,
    backgroundColor: scheme.surfaceContainerLowest,
  },
  placeholder: {
    backgroundColor: scheme.surfaceContainerLow,
  },
  placeholderIcon: {
    width: 52,
    height: 52,
    borderRadius: 18,
    backgroundColor: scheme.primaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholderTitle: {
    ...type.labelLarge,
    fontWeight: '700',
    color: scheme.onSurface,
    textAlign: 'center',
  },
  statusText: {
    ...type.bodySmall,
    color: scheme.onSurfaceVariant,
    textAlign: 'center',
  },
  retryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 44,
    paddingHorizontal: 18,
    borderRadius: shape.full,
    backgroundColor: scheme.secondaryContainer,
  },
  retryText: {
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
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: scheme.outlineVariant,
  },
  stepBtn: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: scheme.surfaceContainerHigh,
    borderWidth: StyleSheet.hairlineWidth,
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
    borderWidth: StyleSheet.hairlineWidth,
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
    fontVariant: ['tabular-nums'],
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
  pressed: { opacity: 0.78 },
  focused: { borderWidth: 2, borderColor: scheme.primary },
});
