import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  InteractionManager,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { MapPin, Maximize2 } from './icons';
import { useStrings } from '../i18n';
import type { Connection } from '../types/models';
import type { MapRoute } from '../map/types';
import { acquireMapServer } from '../services/mapServerLease';
import { buildMapRoute, resolveGeometry, type Coord } from '../services/routeGeometry';
import { scheme, shape, type } from '../theme/tokens';
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

export function RouteMapCard({ connection, onOpenMap }: {
  connection: Connection;
  onOpenMap: () => void;
}) {
  const s = useStrings();
  const shapeKey = useMemo(() => routeShapeKey(connection), [connection]);
  const builtRoute = useRef<{ key: string; route: MapRoute } | null>(null);
  const route = useMemo(() => {
    if (builtRoute.current?.key === shapeKey) return builtRoute.current.route;
    const next = buildMapRoute(connection);
    builtRoute.current = { key: shapeKey, route: next };
    return next;
  }, [connection, shapeKey]);
  const mapRef = useRef<RouteMapHandle>(null);
  const geometry = useRef(new Map<string, Coord[]>());
  const [offlineBase, setOfflineBase] = useState<string | null | undefined>();
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [attempt, setAttempt] = useState(0);
  const [focused, setFocused] = useState<string | null>(null);
  const [readyToMountMap, setReadyToMountMap] = useState(false);
  const cardRef = useRef<View>(null);
  const measuredRef = useRef(false);
  const { height: windowHeight } = useWindowDimensions();

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
    void acquireMapServer().then((lease) => {
      if (cancelled) { lease.release(); return; }
      release = lease.release;
      setOfflineBase(lease.base);
    }).catch(() => {
      if (!cancelled) setOfflineBase(null);
    });
    return () => { cancelled = true; release?.(); };
  }, [attempt, readyToMountMap]);

  useEffect(() => {
    if (!readyToMountMap || status !== 'loading') return;
    const timer = setTimeout(() => setStatus('error'), 20_000);
    return () => clearTimeout(timer);
  }, [status, attempt, readyToMountMap]);

  useEffect(() => {
    if (!readyToMountMap) return;
    const abort = new AbortController();
    geometry.current.clear();
    void resolveGeometry(route, (legId, coords) => {
      if (abort.signal.aborted) return;
      geometry.current.set(legId, coords);
      mapRef.current?.setGeometry(legId, coords, true);
    }, abort.signal);
    return () => abort.abort();
  }, [route, readyToMountMap]);

  return (
    <View ref={cardRef} collapsable={false} onLayout={measureCard} style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.title}>{s.map.title}</Text>
        <Pressable onPress={onOpenMap} accessibilityRole="button"
          accessibilityLabel={s.compass.openMap}
          onFocus={() => setFocused('open')} onBlur={() => setFocused(null)}
          style={({ pressed }) => [styles.button, pressed && styles.pressed, focused === 'open' && styles.focused]}>
          <Maximize2 size={21} color={scheme.onSurface} />
        </Pressable>
      </View>
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
              <View style={StyleSheet.absoluteFill} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                <RouteMap
                  key={attempt}
                  ref={mapRef}
                  route={route}
                  offlineBase={offlineBase}
                  paddingTop={20}
                  paddingBottom={20}
                  paddingLeft={20}
                  paddingRight={20}
                  fitOnGeometry
                  maxZoom={16}
                  onReady={() => {
                    geometry.current.forEach((coords, legId) => mapRef.current?.setGeometry(legId, coords));
                    mapRef.current?.fit();
                  }}
                  onTilesStatus={(ok) => setStatus(ok ? 'ready' : 'error')}
                  onError={() => setStatus('error')}
                />
              </View>
            )}
            {status !== 'ready' && (
              <View style={styles.status} accessibilityLiveRegion="polite">
                {status === 'loading' && <ActivityIndicator color={scheme.primary} />}
                <Text style={styles.statusText}>{status === 'loading' ? s.compass.mapLoading : s.compass.mapFailed}</Text>
                {status === 'error' && (
                  <Pressable onPress={() => setAttempt((value) => value + 1)} accessibilityRole="button"
                    onFocus={() => setFocused('retry')} onBlur={() => setFocused(null)}
                    style={({ pressed }) => [styles.button, styles.retry, pressed && styles.pressed, focused === 'retry' && styles.focused]}>
                    <Text style={styles.statusText}>{s.compass.mapRetry}</Text>
                  </Pressable>
                )}
              </View>
            )}
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: shape.large, overflow: 'hidden', backgroundColor: scheme.surfaceContainer },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 16, paddingRight: 8, paddingVertical: 4 },
  title: { ...type.titleMedium, color: scheme.onSurface, flex: 1, flexShrink: 1 },
  button: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'transparent', borderRadius: shape.medium },
  pressed: { opacity: 0.75 },
  focused: { borderColor: scheme.primary },
  map: { height: 240, justifyContent: 'center', alignItems: 'center' },
  status: { padding: 16, gap: 10, alignItems: 'center', backgroundColor: scheme.surfaceContainerHigh, borderRadius: shape.medium, maxWidth: '100%' },
  placeholder: { minWidth: 220, borderWidth: 2, borderColor: 'transparent' },
  statusText: { ...type.bodyMedium, color: scheme.onSurface, textAlign: 'center' },
  retry: { paddingHorizontal: 16 },
});
