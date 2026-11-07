import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  InteractionManager,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { ChevronLeft, ChevronRight, Footprints, MapPin, Maximize2 } from './icons';
import { LineBadge } from './LineBadge';
import { useStrings } from '../i18n';
import type { Connection } from '../types/models';
import type { MapRoute } from '../map/types';
import {
  buildMapStages,
  resolveStageSelection,
  useEnrichedConnection,
  type MapStage,
} from '../map/stages';
import { acquireMapServerForRoute } from '../services/mapServerLease';
import { buildMapRoute, resolveGeometry, type Coord } from '../services/routeGeometry';
import { formatWalkDistance } from '../services/settings';
import { scheme, shape, spacing, type } from '../theme/tokens';
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
  onOpenMap,
}: {
  connection: Connection;
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

  const mountMap = useCallback(() => setReadyToMountMap(true), []);

  // WebView (MapLibre GL) to ciężki proces. Montuj go, gdy karta jest blisko
  // viewportu, albo dopiero po tapnięciu placeholdera.
  const measureCard = useCallback(() => {
    if (measuredRef.current) return;
    const node = cardRef.current;
    if (!node) return;
    node.measureInWindow((_x, y, _w, h) => {
      measuredRef.current = true;
      if (y < windowHeight + 160 && y + h > -160) {
        InteractionManager.runAfterInteractions(mountMap);
        // Fallback: zadania InteractionManagera potrafią nie domknąć się przy animacjach.
        setTimeout(mountMap, 600);
      }
    });
  }, [mountMap, windowHeight]);

  useEffect(() => {
    if (!readyToMountMap) return;
    let cancelled = false;
    let release: (() => void) | undefined;
    setOfflineBase(undefined);
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
  }, [attempt, readyToMountMap, route]);

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
  }, [route, readyToMountMap]);

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

  return (
    <View ref={cardRef} collapsable={false} onLayout={measureCard} style={styles.card}>
      <View style={styles.header}>
        <View style={styles.headerTitleWrap}>
          <Text style={styles.title}>{s.map.title}</Text>
          {activeStage && (
            <View style={styles.stageCountChip}>
              <Text style={styles.stageCountText}>
                {activeStage.stageNumber}/{stages.length}
              </Text>
            </View>
          )}
        </View>
        <Pressable
          onPress={openFullscreen}
          accessibilityRole="button"
          accessibilityLabel={s.compass.openMap}
          hitSlop={6}
          onFocus={() => setFocused('open')}
          onBlur={() => setFocused(null)}
          style={({ pressed }) => [
            styles.button,
            pressed && styles.pressed,
            focused === 'open' && styles.focused,
          ]}
        >
          <Maximize2 size={21} color={scheme.onSurface} />
        </Pressable>
      </View>

      {stages.length > 1 && (
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
              style={[
                styles.stagePillLabel,
                activeStage === null && styles.stagePillLabelActive,
              ]}
              numberOfLines={1}
            >
              {s.map.showWholeRoute}
            </Text>
          </Pressable>

          {stages.map((st) => {
            const isSelected = activeStage?.id === st.id;
            const isWalk = st.leg.mode === 'walk';
            const walkLabel = formatWalkDistance(st.walkM ?? 0);
            const sub = stagePillSubtitle(st, s.map.board, s.map.alight);
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
                <Text
                  style={[
                    styles.stageIndex,
                    isSelected && styles.stageIndexActive,
                  ]}
                >
                  {st.stageNumber}.
                </Text>
                {isWalk ? (
                  <>
                    <Footprints
                      size={13}
                      color={isSelected ? scheme.onPrimaryContainer : scheme.onSurfaceVariant}
                    />
                    <Text
                      style={[
                        styles.stagePillLabel,
                        isSelected && styles.stagePillLabelActive,
                      ]}
                      numberOfLines={1}
                    >
                      {walkLabel}
                    </Text>
                  </>
                ) : (
                  <>
                    <LineBadge mode={st.leg.mode} line={st.leg.line} compact active={isSelected} />
                    <Text
                      style={[
                        styles.stagePillLabel,
                        isSelected && styles.stagePillLabelActive,
                      ]}
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
      )}

      <View style={styles.map}>
        {!readyToMountMap ? (
          <Pressable
            onPress={mountMap}
            accessibilityRole="button"
            accessibilityLabel={s.compass.mapTapToLoad}
            onFocus={() => setFocused('map')}
            onBlur={() => setFocused(null)}
            style={({ pressed }) => [
              styles.status,
              styles.placeholder,
              pressed && styles.pressed,
              focused === 'map' && styles.focused,
            ]}
          >
            <MapPin size={22} color={scheme.onSurfaceVariant} />
            <Text style={styles.statusText}>{s.compass.mapTapToLoad}</Text>
          </Pressable>
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
                    selectedLegId={activeStage?.legId ?? null}
                    focusCoords={activeStage?.focusCoords ?? null}
                    stopRange={activeStage?.stopRange ?? null}
                    focusMaxZoom={activeStage?.focusMaxZoom ?? null}
                    offlineBase={offlineBase}
                    paddingTop={24}
                    paddingBottom={24}
                    paddingLeft={24}
                    paddingRight={24}
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
            {status !== 'ready' && (
              <View style={styles.status} accessibilityLiveRegion="polite">
                {status === 'loading' && <ActivityIndicator color={scheme.primary} />}
                <Text style={styles.statusText}>
                  {status === 'loading' ? s.compass.mapLoading : s.compass.mapFailed}
                </Text>
                {status === 'error' && (
                  <Pressable
                    onPress={() => setAttempt((value) => value + 1)}
                    accessibilityRole="button"
                    onFocus={() => setFocused('retry')}
                    onBlur={() => setFocused(null)}
                    style={({ pressed }) => [
                      styles.button,
                      styles.retry,
                      pressed && styles.pressed,
                      focused === 'retry' && styles.focused,
                    ]}
                  >
                    <Text style={styles.statusText}>{s.compass.mapRetry}</Text>
                  </Pressable>
                )}
              </View>
            )}
          </>
        )}
      </View>

      {activeStage && (
        <View style={styles.stageFooter}>
          <Pressable
            onPress={() => handleStepStage(-1)}
            accessibilityRole="button"
            accessibilityLabel={s.map.backA11y}
            hitSlop={6}
            onFocus={() => setFocused('prev-stage')}
            onBlur={() => setFocused(null)}
            style={({ pressed }) => [
              styles.stepBtn,
              pressed && styles.pressed,
              focused === 'prev-stage' && styles.focused,
            ]}
          >
            <ChevronLeft size={18} color={scheme.onSurface} />
          </Pressable>

          <Pressable
            onPress={openFullscreen}
            accessibilityRole="button"
            accessibilityLabel={s.compass.openMap}
            style={styles.stageFooterBody}
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
              {activeStage.stopsCount > 0 ? ` \u2022 ${s.map.legStops(activeStage.stopsCount)}` : ''}
            </Text>
          </Pressable>

          <Pressable
            onPress={() => handleStepStage(1)}
            accessibilityRole="button"
            accessibilityLabel={s.map.stagesTitle}
            hitSlop={6}
            onFocus={() => setFocused('next-stage')}
            onBlur={() => setFocused(null)}
            style={({ pressed }) => [
              styles.stepBtn,
              pressed && styles.pressed,
              focused === 'next-stage' && styles.focused,
            ]}
          >
            <ChevronRight size={18} color={scheme.onSurface} />
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: scheme.surfaceContainerLow,
    borderRadius: shape.large,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: scheme.outlineVariant,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 16,
    paddingRight: 8,
    paddingVertical: 6,
  },
  headerTitleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    flex: 1,
  },
  title: {
    ...type.titleSmall,
    color: scheme.onSurface,
  },
  stageCountChip: {
    backgroundColor: scheme.primaryContainer,
    borderRadius: shape.full,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  stageCountText: {
    ...type.labelSmall,
    color: scheme.onPrimaryContainer,
    fontVariant: ['tabular-nums'],
  },
  stageRail: {
    paddingHorizontal: 12,
    paddingBottom: 10,
    gap: 6,
    alignItems: 'center',
  },
  stagePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 36,
    paddingHorizontal: 11,
    paddingVertical: 5,
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainerHigh,
    borderWidth: 1.5,
    borderColor: 'transparent',
    maxWidth: 210,
  },
  stagePillActive: {
    backgroundColor: scheme.primaryContainer,
    borderColor: scheme.primary,
  },
  stageIndex: {
    ...type.labelSmall,
    color: scheme.onSurfaceVariant,
    fontVariant: ['tabular-nums'],
  },
  stageIndexActive: {
    color: scheme.onPrimaryContainer,
  },
  stagePillLabel: {
    ...type.labelMedium,
    color: scheme.onSurfaceVariant,
    flexShrink: 1,
  },
  stagePillLabelActive: {
    color: scheme.onPrimaryContainer,
  },
  map: {
    height: 248,
    backgroundColor: scheme.surfaceContainerLowest,
  },
  status: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 16,
    backgroundColor: scheme.surfaceContainerLowest,
  },
  placeholder: {
    backgroundColor: scheme.surfaceContainerLow,
  },
  statusText: {
    ...type.bodySmall,
    color: scheme.onSurfaceVariant,
    textAlign: 'center',
  },
  button: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: shape.full,
  },
  retry: {
    paddingHorizontal: 16,
    backgroundColor: scheme.surfaceContainerHigh,
  },
  stageFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 6,
    gap: 6,
    backgroundColor: scheme.surfaceContainer,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: scheme.outlineVariant,
  },
  stepBtn: {
    width: 40,
    height: 40,
    borderRadius: shape.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: scheme.surfaceContainerHigh,
  },
  stageFooterBody: {
    flex: 1,
    paddingHorizontal: 4,
    gap: 1,
  },
  stageFooterStops: {
    ...type.labelLarge,
    color: scheme.onSurface,
  },
  stageFooterMeta: {
    ...type.bodySmall,
    color: scheme.onSurfaceVariant,
    fontVariant: ['tabular-nums'],
  },
  pressed: { opacity: 0.75 },
  focused: { borderWidth: 2, borderColor: scheme.primary },
});
