import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import Svg, { Circle, Polygon } from 'react-native-svg';
import { BusFront, TrainFront, TramFront } from 'lucide-react-native';
import type { Coord } from '../services/routeGeometry';
import type { LegMode } from '../types/models';
import { useStrings } from '../i18n';
import { buildNavMapDocument } from '../map/navMapDocument';
import { getActiveCitySync, useActiveCity } from '../services/cityStore';
import { acquireMapServer } from '../services/mapServerLease';
import { scheme, type } from '../theme/tokens';

interface NavMiniMapProps {
  path: Coord[];
  user: Coord | null;
  stop: Coord | null;
  headingDeg: number | null;
  accuracyM: number | null;
  accent: string;
  vehicleMode?: LegMode;
  onOpenMap?: () => void;
  style?: StyleProp<ViewStyle>;
}

interface NavMapRouteUpdate {
  path: Coord[];
  stop: Coord | null;
  accent: string;
  riding: boolean;
}

interface NavMapCameraUpdate {
  user: Coord | null;
  heading: number | null;
  riding: boolean;
}

export function NavMiniMap({
  path,
  user,
  stop,
  headingDeg,
  accuracyM,
  accent,
  vehicleMode,
  onOpenMap,
  style,
}: NavMiniMapProps) {
  const s = useStrings();
  const riding = vehicleMode != null;
  const webRef = useRef<WebView>(null);
  const ready = useRef(false);
  const { cityId } = useActiveCity();
  // undefined = czekamy na lokalny serwer; nie ładuj CDN zanim wiemy.
  const [offlineBase, setOfflineBase] = useState<string | null | undefined>(undefined);
  const [mapState, setMapState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [retry, setRetry] = useState(0);
  const [focused, setFocused] = useState(false);
  const [retryFocused, setRetryFocused] = useState(false);
  const latestRoute = useRef<NavMapRouteUpdate>({ path, stop, accent, riding });
  const latestCamera = useRef<NavMapCameraUpdate>({ user, heading: headingDeg, riding });
  const lastSentCamera = useRef<{ lat: number; lon: number; heading: number | null } | null>(null);
  latestRoute.current = { path, stop, accent, riding };
  latestCamera.current = { user, heading: headingDeg, riding };

  const html = useMemo(() => {
    if (offlineBase === undefined) return null;
    let center: [number, number] | null = null;
    try {
      const c = getActiveCitySync().center;
      center = [c.lon, c.lat];
    } catch {
      center = null;
    }
    return buildNavMapDocument({ offlineBase, center });
  }, [offlineBase, cityId]);

  useEffect(() => {
    let cancelled = false;
    let release: (() => void) | null = null;
    setOfflineBase(undefined);
    setMapState('loading');
    void acquireMapServer()
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
  }, [cityId, retry]);

  useEffect(() => {
    if (mapState !== 'loading') return;
    const timer = setTimeout(() => setMapState('error'), 20_000);
    return () => clearTimeout(timer);
  }, [mapState, retry]);

  const sendRoute = useCallback(() => {
    if (!ready.current) return;
    webRef.current?.injectJavaScript(
      `window.__navRoute(${JSON.stringify(latestRoute.current)});true;`,
    );
  }, []);

  const sendCamera = useCallback((force = false) => {
    if (!ready.current) return;
    const cur = latestCamera.current;
    if (!cur.user) {
      lastSentCamera.current = null;
      webRef.current?.injectJavaScript(`window.__navCamera(${JSON.stringify(cur)});true;`);
      return;
    }
    const prev = lastSentCamera.current;
    if (!force && prev) {
      const dLatM = (cur.user[0] - prev.lat) * 111320;
      const dLonM = (cur.user[1] - prev.lon) * 70000;
      const movedM = Math.hypot(dLatM, dLonM);
      let headingDiff = 0;
      if (cur.heading != null && prev.heading != null) {
        headingDiff = Math.abs(cur.heading - prev.heading) % 360;
        if (headingDiff > 180) headingDiff = 360 - headingDiff;
      } else if (cur.heading !== prev.heading) {
        headingDiff = 180;
      }
      if (movedM < 0.35 && headingDiff < 1.2) return;
    }
    lastSentCamera.current = {
      lat: cur.user[0],
      lon: cur.user[1],
      heading: cur.heading,
    };
    webRef.current?.injectJavaScript(`window.__navCamera(${JSON.stringify(cur)});true;`);
  }, []);

  const sendAll = useCallback(() => {
    sendRoute();
    sendCamera(true);
  }, [sendCamera, sendRoute]);

  useEffect(sendRoute, [sendRoute, path, stop, accent, riding]);
  useEffect(() => {
    lastSentCamera.current = null;
    sendCamera(true);
  }, [sendCamera, riding]);
  useEffect(() => {
    sendCamera(false);
  }, [sendCamera, user, headingDeg, path]);

  const onMessage = useCallback(
    (event: WebViewMessageEvent) => {
      try {
        const message = JSON.parse(event.nativeEvent.data) as { t?: string; state?: string };
        if (message.t === 'ready') {
          ready.current = true;
          sendAll();
        }
        if (
          message.t === 'tiles' &&
          (message.state === 'ready' || message.state === 'loading' || message.state === 'error')
        ) {
          setMapState(message.state);
        }
      } catch {}
    },
    [sendAll],
  );

  const onLoadStart = useCallback(() => {
    ready.current = false;
    lastSentCamera.current = null;
    setMapState('loading');
  }, []);

  const onError = useCallback(() => {
    ready.current = false;
    setMapState('error');
  }, []);

  const accuracyRadius = accuracyM != null ? Math.min(36, Math.max(6, accuracyM * 0.8)) : 0;
  const userColor = scheme.primary;
  const VehicleIcon =
    vehicleMode === 'tram'
      ? TramFront
      : vehicleMode === 'train' || vehicleMode === 'subway'
        ? TrainFront
        : BusFront;

  return (
    <View style={[styles.frame, style]}>
      {html ? (
        <WebView
          key={`${cityId}:${retry}`}
          ref={webRef}
          style={styles.web}
          pointerEvents="none"
          source={offlineBase ? { html, baseUrl: `${offlineBase}/` } : { html }}
          originWhitelist={['*']}
          onMessage={onMessage}
          onLoadStart={onLoadStart}
          onError={onError}
          onHttpError={onError}
          onRenderProcessGone={onError}
          onContentProcessDidTerminate={onError}
          accessible={false}
          importantForAccessibility="no-hide-descendants"
          scrollEnabled={false}
          bounces={false}
          overScrollMode="never"
          showsVerticalScrollIndicator={false}
          showsHorizontalScrollIndicator={false}
          setSupportMultipleWindows={false}
          javaScriptCanOpenWindowsAutomatically={false}
          setBuiltInZoomControls={false}
          androidLayerType="hardware"
          allowsBackForwardNavigationGestures={false}
        />
      ) : null}
      {user && mapState === 'ready' ? (
        <View pointerEvents="none" style={styles.markerOverlay}>
          {riding ? (
            <View style={styles.vehicleMarker}>
              <VehicleIcon size={24} color={scheme.onPrimary} strokeWidth={2.2} />
            </View>
          ) : (
            <Svg width={80} height={80} viewBox="0 0 80 80">
              {accuracyRadius > 0 ? (
                <Circle
                  cx={40}
                  cy={40}
                  r={accuracyRadius}
                  fill={userColor}
                  fillOpacity={0.13}
                  stroke={userColor}
                  strokeOpacity={0.3}
                  strokeWidth={1}
                />
              ) : null}
              {headingDeg != null ? (
                <Polygon points="40,38 28,14 52,14" fill={userColor} fillOpacity={0.26} />
              ) : null}
              <Circle cx={40} cy={40} r={10} fill={userColor} fillOpacity={0.22} />
              <Circle cx={40} cy={40} r={5} fill={userColor} stroke="#FFFFFF" strokeWidth={2} />
            </Svg>
          )}
        </View>
      ) : null}
      {onOpenMap ? (
        <Pressable
          style={[StyleSheet.absoluteFill, focused && styles.focused]}
          onPress={onOpenMap}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          accessibilityRole="button"
          accessibilityLabel={s.compass.openMap}
        />
      ) : null}
      {mapState !== 'ready' ? (
        <View style={styles.statusOverlay} pointerEvents="box-none">
          <View style={styles.statusCopy} accessibilityLiveRegion="polite">
            {mapState === 'loading' ? <ActivityIndicator color={scheme.primary} /> : null}
            <Text style={styles.statusText}>
              {mapState === 'loading' ? s.compass.mapLoading : s.compass.mapFailed}
            </Text>
            {mapState === 'error' ? (
              <Pressable
                onPress={() => setRetry((value) => value + 1)}
                onFocus={() => setRetryFocused(true)}
                onBlur={() => setRetryFocused(false)}
                style={[styles.retry, retryFocused && styles.focused]}
                accessibilityRole="button"
                accessibilityLabel={s.compass.mapRetry}
              >
                <Text style={styles.retryText}>{s.compass.mapRetry}</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    minWidth: 0,
    height: 112,
    overflow: 'hidden',
    borderRadius: 14,
    backgroundColor: '#101413',
  },
  web: { flex: 1, backgroundColor: '#101413' },
  vehicleMarker: {
    width: 42,
    height: 42,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: scheme.onSurface,
    backgroundColor: scheme.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  focused: { borderWidth: 2, borderColor: scheme.primary },
  statusOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  statusCopy: {
    maxWidth: '100%',
    padding: 16,
    gap: 10,
    alignItems: 'center',
    backgroundColor: scheme.surfaceContainerHigh,
    borderRadius: 12,
  },
  statusText: { ...type.bodyMedium, color: scheme.onSurface, textAlign: 'center' },
  retry: {
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: 'transparent',
    backgroundColor: scheme.secondaryContainer,
    justifyContent: 'center',
  },
  retryText: { ...type.labelLarge, color: scheme.onSecondaryContainer },
  markerOverlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
