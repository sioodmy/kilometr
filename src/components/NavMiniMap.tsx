import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import Svg, { Circle, Polygon } from 'react-native-svg';
import type { Coord } from '../services/routeGeometry';
import { buildNavMapDocument } from '../map/navMapDocument';
import { getActiveCitySync, useActiveCity } from '../services/cityStore';
import { acquireMapServer } from '../services/mapServerLease';
import { scheme } from '../theme/tokens';

interface NavMiniMapProps {
  path: Coord[];
  user: Coord | null;
  stop: Coord | null;
  headingDeg: number | null;
  accuracyM: number | null;
  accent: string;
  style?: StyleProp<ViewStyle>;
}

interface NavMapRouteUpdate {
  path: Coord[];
  stop: Coord | null;
  accent: string;
}

interface NavMapCameraUpdate {
  user: Coord | null;
  heading: number | null;
}

export function NavMiniMap({
  path,
  user,
  stop,
  headingDeg,
  accuracyM,
  accent,
  style,
}: NavMiniMapProps) {
  const webRef = useRef<WebView>(null);
  const ready = useRef(false);
  const { cityId } = useActiveCity();
  // undefined = czekamy na lokalny serwer; nie ładuj CDN zanim wiemy.
  const [offlineBase, setOfflineBase] = useState<string | null | undefined>(undefined);
  const latestRoute = useRef<NavMapRouteUpdate>({ path, stop, accent });
  const latestCamera = useRef<NavMapCameraUpdate>({ user, heading: headingDeg });
  const lastSentCamera = useRef<{ lat: number; lon: number; heading: number | null } | null>(null);
  latestRoute.current = { path, stop, accent };
  latestCamera.current = { user, heading: headingDeg };

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
    void acquireMapServer().then((lease) => {
      if (cancelled) {
        lease.release();
        return;
      }
      release = lease.release;
      setOfflineBase(lease.base);
    });
    return () => {
      cancelled = true;
      release?.();
    };
  }, []);

  const sendRoute = useCallback(() => {
    if (!ready.current) return;
    webRef.current?.injectJavaScript(
      `window.__navRoute(${JSON.stringify(latestRoute.current)});true;`,
    );
  }, []);

  const sendCamera = useCallback((force = false) => {
    if (!ready.current) return;
    const cur = latestCamera.current;
    if (!cur.user) return;
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
    webRef.current?.injectJavaScript(
      `window.__navCamera(${JSON.stringify(cur)});true;`,
    );
  }, []);

  const sendAll = useCallback(() => {
    sendRoute();
    sendCamera(true);
  }, [sendCamera, sendRoute]);

  useEffect(sendRoute, [sendRoute, path, stop, accent]);
  useEffect(() => {
    sendCamera(false);
  }, [sendCamera, user, headingDeg]);

  const onMessage = useCallback(
    (event: WebViewMessageEvent) => {
      try {
        const message = JSON.parse(event.nativeEvent.data) as { t?: string };
        if (message.t === 'ready') {
          ready.current = true;
          sendAll();
        }
      } catch {
        ready.current = false;
      }
    },
    [sendAll],
  );

  const onLoadStart = useCallback(() => {
    ready.current = false;
    lastSentCamera.current = null;
  }, []);

  const onError = useCallback(() => {
    ready.current = false;
  }, []);

  const accuracyRadius = accuracyM != null ? Math.min(36, Math.max(6, accuracyM * 0.8)) : 0;
  const userColor = scheme.primary;

  return (
    <View style={[styles.frame, style]}>
      {html ? (
        <WebView
          ref={webRef}
          style={styles.web}
          pointerEvents="none"
          source={offlineBase ? { html, baseUrl: `${offlineBase}/` } : { html }}
          originWhitelist={['*']}
          onMessage={onMessage}
          onLoadStart={onLoadStart}
          onError={onError}
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
      {user ? (
        <View pointerEvents="none" style={styles.markerOverlay}>
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
              <Polygon
                points="40,38 28,14 52,14"
                fill={userColor}
                fillOpacity={0.26}
              />
            ) : null}
            <Circle cx={40} cy={40} r={10} fill={userColor} fillOpacity={0.22} />
            <Circle cx={40} cy={40} r={5} fill={userColor} stroke="#FFFFFF" strokeWidth={2} />
          </Svg>
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

export default NavMiniMap;
