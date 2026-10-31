import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Maximize2 } from './icons';
import { useStrings } from '../i18n';
import type { Connection } from '../types/models';
import { acquireMapServer } from '../services/mapServerLease';
import { buildMapRoute, resolveGeometry, type Coord } from '../services/routeGeometry';
import { scheme, shape, type } from '../theme/tokens';
import { RouteMap, type RouteMapHandle } from './RouteMap';

export function RouteMapCard({ connection, onOpenMap }: {
  connection: Connection;
  onOpenMap: () => void;
}) {
  const s = useStrings();
  const route = useMemo(() => buildMapRoute(connection), [connection]);
  const mapRef = useRef<RouteMapHandle>(null);
  const geometry = useRef(new Map<string, Coord[]>());
  const [offlineBase, setOfflineBase] = useState<string | null | undefined>();
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [attempt, setAttempt] = useState(0);
  const [focused, setFocused] = useState<string | null>(null);

  useEffect(() => {
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
  }, [attempt]);

  useEffect(() => {
    if (status !== 'loading') return;
    const timer = setTimeout(() => setStatus('error'), 20_000);
    return () => clearTimeout(timer);
  }, [status, attempt]);

  useEffect(() => {
    const abort = new AbortController();
    geometry.current.clear();
    void resolveGeometry(route, (legId, coords) => {
      if (abort.signal.aborted) return;
      geometry.current.set(legId, coords);
      mapRef.current?.setGeometry(legId, coords);
    }, abort.signal);
    return () => abort.abort();
  }, [route]);

  return (
    <View style={styles.card}>
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
        {offlineBase !== undefined && (
          <View style={StyleSheet.absoluteFill} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <RouteMap key={attempt} ref={mapRef} route={route} offlineBase={offlineBase}
              paddingTop={24} paddingBottom={24}
              onReady={() => {
                geometry.current.forEach((coords, legId) => mapRef.current?.setGeometry(legId, coords));
                mapRef.current?.fit();
              }}
              onTilesStatus={(ok) => setStatus(ok ? 'ready' : 'error')}
              onError={() => setStatus('error')} />
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
  statusText: { ...type.bodyMedium, color: scheme.onSurface, textAlign: 'center' },
  retry: { paddingHorizontal: 16 },
});
