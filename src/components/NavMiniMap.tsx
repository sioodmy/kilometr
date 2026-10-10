import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import Svg, { Circle } from 'react-native-svg';
import type { Coord } from '../services/routeGeometry';
import { buildNavMapDocument } from '../map/navMapDocument';
import { acquireMapServer } from '../services/mapServerLease';

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
  const [offlineBase, setOfflineBase] = useState<string | null>(null);
  const latestRoute = useRef<NavMapRouteUpdate>({ path, stop, accent });
  const latestCamera = useRef<NavMapCameraUpdate>({ user, heading: headingDeg });
  latestRoute.current = { path, stop, accent };
  latestCamera.current = { user, heading: headingDeg };

  const html = useMemo(() => buildNavMapDocument({ offlineBase }), [offlineBase]);

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

  const sendCamera = useCallback(() => {
    if (!ready.current) return;
    webRef.current?.injectJavaScript(
      `window.__navCamera(${JSON.stringify(latestCamera.current)});true;`,
    );
  }, []);

  const sendAll = useCallback(() => {
    sendRoute();
    sendCamera();
  }, [sendCamera, sendRoute]);

  useEffect(sendRoute, [sendRoute, path, stop, accent]);
  useEffect(sendCamera, [sendCamera, user, headingDeg]);

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
  }, []);

  const onError = useCallback(() => {
    ready.current = false;
  }, []);

  const accuracyRadius = accuracyM != null ? Math.min(40, Math.max(6, accuracyM * 0.8)) : 0;

  return (
    <View style={[styles.frame, style]}>
      <WebView
        ref={webRef}
        style={styles.web}
        pointerEvents="none"
        source={{ html }}
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
      {user ? (
        <Svg pointerEvents="none" style={StyleSheet.absoluteFill}>
          {accuracyRadius > 0 ? (
            <Circle
              cx="50%"
              cy="50%"
              r={accuracyRadius}
              fill={accent}
              fillOpacity={0.13}
              stroke={accent}
              strokeOpacity={0.3}
              strokeWidth={1}
            />
          ) : null}
          <Circle cx="50%" cy="50%" r={10} fill={accent} fillOpacity={0.22} />
          <Circle cx="50%" cy="50%" r={5} fill={accent} stroke="#FFFFFF" strokeWidth={2} />
        </Svg>
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
});

export default NavMiniMap;
