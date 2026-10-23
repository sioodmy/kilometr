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
import { Compass, LocateFixed, Route } from 'lucide-react-native';
import { useReducedMotion } from 'react-native-reanimated';
import type { Coord } from '../services/routeGeometry';
import { useStrings } from '../i18n';
import { buildNavMapDocument } from '../map/navMapDocument';
import { getActiveCitySync, useActiveCity } from '../services/cityStore';
import { acquireMapServer } from '../services/mapServerLease';
import { useDeviceHeading } from '../services/useDeviceHeading';
import { elev, scheme, shape, type } from '../theme/tokens';

interface NavMiniMapProps {
  targetId: string;
  path: Coord[];
  traveled?: Coord[];
  stops?: Coord[];
  user: Coord | null;
  vehicle?: Coord | null;
  stop: Coord | null;
  headingDeg: number | null;
  accuracyM: number | null;
  accent: string;
  riding: boolean;
  line?: string;
  style?: StyleProp<ViewStyle>;
}

interface NavMapCameraUpdate {
  user: Coord | null;
  vehicle: Coord | null;
  heading: number | null;
  userHeading: number | null;
  reduceMotion: boolean;
  headingOnly: boolean;
}

export function NavMiniMap({
  targetId,
  path,
  traveled,
  stops,
  user,
  vehicle = null,
  stop,
  headingDeg,
  accuracyM,
  accent,
  riding,
  line,
  style,
}: NavMiniMapProps) {
  const s = useStrings();
  const reduceMotion = useReducedMotion();
  const webRef = useRef<WebView>(null);
  const ready = useRef(false);
  const deviceHeading = useRef<number | null>(null);
  const { cityId } = useActiveCity();
  const [offlineBase, setOfflineBase] = useState<string | null | undefined>(undefined);
  const [mapState, setMapState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [retry, setRetry] = useState(0);
  const [following, setFollowing] = useState(true);
  const [northUp, setNorthUp] = useState(false);
  const [focused, setFocused] = useState<string | null>(null);
  const latestRoute = useRef({
    id: targetId,
    path,
    traveled,
    stops,
    stop,
    accent,
    riding,
    label: line,
  });
  const latestCamera = useRef<NavMapCameraUpdate>({
    user,
    vehicle,
    heading: headingDeg,
    userHeading: null,
    reduceMotion,
    headingOnly: false,
  });
  latestRoute.current = { id: targetId, path, traveled, stops, stop, accent, riding, label: line };
  latestCamera.current = {
    user,
    vehicle,
    heading: deviceHeading.current ?? headingDeg,
    userHeading: deviceHeading.current ?? (riding ? null : headingDeg),
    reduceMotion,
    headingOnly: false,
  };

  const html = useMemo(() => {
    if (offlineBase === undefined) return null;
    let center: [number, number] | null = null;
    try {
      const c = getActiveCitySync().center;
      center = [c.lon, c.lat];
    } catch {}
    return buildNavMapDocument({ offlineBase, center });
  }, [offlineBase, cityId]);

  useEffect(() => {
    let cancelled = false;
    let release: (() => void) | null = null;
    ready.current = false;
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
    if (ready.current)
      webRef.current?.injectJavaScript(
        `window.__navRoute(${JSON.stringify(latestRoute.current)});true;`,
      );
  }, []);
  const sendCamera = useCallback(() => {
    if (ready.current)
      webRef.current?.injectJavaScript(
        `window.__navCamera(${JSON.stringify(latestCamera.current)});true;`,
      );
  }, []);
  const onHeading = useCallback(
    (value: number | null) => {
      if (deviceHeading.current === value) return;
      deviceHeading.current = value;
      const current = latestCamera.current;
      current.heading = value ?? headingDeg;
      current.userHeading = value ?? (riding ? null : headingDeg);
      current.headingOnly = true;
      sendCamera();
    },
    [sendCamera, headingDeg, riding],
  );
  const compassState = useDeviceHeading(user != null || vehicle != null, onHeading);

  useEffect(sendRoute, [sendRoute, targetId, path, traveled, stops, stop, accent, riding, line]);
  useEffect(sendCamera, [sendCamera, user, vehicle, headingDeg, reduceMotion, targetId]);

  const onMessage = useCallback(
    (event: WebViewMessageEvent) => {
      try {
        const message: unknown = JSON.parse(event.nativeEvent.data);
        if (!message || typeof message !== 'object' || !('t' in message)) return;
        if (message.t === 'ready') {
          ready.current = true;
          sendRoute();
          sendCamera();
        } else if (message.t === 'tracking' && 'following' in message && 'northUp' in message) {
          setFollowing(message.following === true);
          setNorthUp(message.northUp === true);
        } else if (
          message.t === 'tiles' &&
          'state' in message &&
          (message.state === 'ready' || message.state === 'loading' || message.state === 'error')
        ) {
          setMapState(message.state);
        }
      } catch {}
    },
    [sendCamera, sendRoute],
  );

  const control = (action: 'follow' | 'north' | 'overview') => {
    if (ready.current)
      webRef.current?.injectJavaScript(`window.__navControl(${JSON.stringify(action)});true;`);
  };
  const onLoadStart = useCallback(() => {
    ready.current = false;
    setMapState('loading');
  }, []);
  const onError = useCallback(() => {
    ready.current = false;
    setMapState('error');
  }, []);
  const hint =
    accuracyM != null && accuracyM > 50
      ? s.compass.gpsWeak
      : compassState === 'calibrate'
        ? s.compass.calibrateCompass
        : null;

  return (
    <View style={[styles.frame, style]}>
      {html ? (
        <WebView
          key={`${cityId}:${retry}`}
          ref={webRef}
          style={styles.web}
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
          nestedScrollEnabled
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
      <View style={styles.topControls} pointerEvents="box-none">
        <Pressable
          onPress={() => control('north')}
          disabled={mapState !== 'ready'}
          onFocus={() => setFocused('north')}
          onBlur={() => setFocused(null)}
          accessibilityRole="button"
          accessibilityState={{ selected: northUp, disabled: mapState !== 'ready' }}
          accessibilityLabel={northUp ? s.compass.compassUp : s.compass.northUp}
          style={({ pressed }) => [
            styles.iconButton,
            northUp && styles.selected,
            pressed && styles.pressed,
            focused === 'north' && styles.focused,
          ]}
        >
          <Compass size={24} color={northUp ? scheme.onPrimaryContainer : scheme.onSurface} />
        </Pressable>
        <Pressable
          onPress={() => control('overview')}
          disabled={mapState !== 'ready'}
          onFocus={() => setFocused('overview')}
          onBlur={() => setFocused(null)}
          accessibilityRole="button"
          accessibilityState={{ disabled: mapState !== 'ready' }}
          accessibilityLabel={s.compass.routeOverview}
          style={({ pressed }) => [
            styles.iconButton,
            pressed && styles.pressed,
            focused === 'overview' && styles.focused,
          ]}
        >
          <Route size={23} color={scheme.onSurface} />
        </Pressable>
      </View>
      {hint ? (
        <View style={styles.hint}>
          <Text style={styles.hintText}>{hint}</Text>
        </View>
      ) : null}
      {mapState === 'ready' && (user || vehicle) ? (
        <Pressable
          onPress={() => control('follow')}
          onFocus={() => setFocused('follow')}
          onBlur={() => setFocused(null)}
          accessibilityRole="button"
          accessibilityState={{ selected: following }}
          accessibilityLabel={following ? s.compass.following : s.compass.recenter}
          style={({ pressed }) => [
            styles.followButton,
            following && styles.following,
            pressed && styles.pressed,
            focused === 'follow' && styles.focused,
          ]}
        >
          <LocateFixed size={23} color={following ? scheme.onPrimaryContainer : scheme.onPrimary} />
          {!following ? <Text style={styles.followText}>{s.compass.recenter}</Text> : null}
        </Pressable>
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
                onFocus={() => setFocused('retry')}
                onBlur={() => setFocused(null)}
                style={({ pressed }) => [
                  styles.retry,
                  pressed && styles.pressed,
                  focused === 'retry' && styles.focused,
                ]}
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
    overflow: 'hidden',
    borderRadius: shape.large,
    backgroundColor: '#101413',
  },
  web: { flex: 1, backgroundColor: '#101413' },
  topControls: { position: 'absolute', top: 12, right: 12, gap: 8 },
  iconButton: {
    width: 48,
    height: 48,
    borderRadius: shape.medium,
    borderWidth: 2,
    borderColor: 'transparent',
    backgroundColor: scheme.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
    ...elev.level2,
  },
  selected: { backgroundColor: scheme.primaryContainer },
  pressed: { opacity: 0.75 },
  focused: { borderColor: scheme.primary },
  followButton: {
    position: 'absolute',
    bottom: 14,
    left: 12,
    maxWidth: '70%',
    minHeight: 48,
    minWidth: 48,
    paddingHorizontal: 12,
    gap: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: shape.large,
    borderWidth: 2,
    borderColor: 'transparent',
    backgroundColor: scheme.primary,
    ...elev.level2,
  },
  following: { backgroundColor: scheme.primaryContainer },
  followText: { ...type.labelLarge, color: scheme.onPrimary, fontWeight: '700', flexShrink: 1 },
  hint: {
    position: 'absolute',
    top: 12,
    left: 12,
    right: 72,
    padding: 10,
    borderRadius: shape.small,
    backgroundColor: scheme.surfaceContainerHigh,
  },
  hintText: { ...type.bodySmall, color: scheme.onSurface },
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
    borderRadius: shape.medium,
  },
  statusText: { ...type.bodyMedium, color: scheme.onSurface, textAlign: 'center' },
  retry: {
    minHeight: 48,
    minWidth: 48,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: shape.medium,
    borderWidth: 2,
    borderColor: 'transparent',
    backgroundColor: scheme.secondaryContainer,
    justifyContent: 'center',
  },
  retryText: { ...type.labelLarge, color: scheme.onSecondaryContainer },
});
