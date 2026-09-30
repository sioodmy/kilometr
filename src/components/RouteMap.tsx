// Komponent mapy trasy: WebView z MapLibre GL, kafelkami OSM w stylu M3,
// geometrią trasy i przystankami.
//
// Cała logika mapowa żyje w `src/map/routeMapDocument.ts`, a ten komponent
// zajmuje się:
//  - cyklem życia WebView (restart po ubiciu procesu przez system),
//  - mostkiem komunikatów w obie strony,
//  - trzymaniem marginesów dopasowania do panelu,
//  - blokadą zewnętrznych URL-i (poza atrybucją).

import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { buildRouteMapDocument } from '../map/routeMapDocument';
import type { MapInMessage, MapOutMessage, MapRoute, MapStopRole, MapVehicle } from '../map/types';
import { scheme } from '../theme/tokens';

export interface MapStopTap {
  stopId: string;
  legId: string;
  name: string;
  role: MapStopRole;
  arriveSec?: number;
}

export interface RouteMapHandle {
  /** Podmienia pojedynczą nogę na prawdziwą geometrię ulic. */
  setGeometry: (legId: string, coords: [number, number][]) => void;
  /** Dopasuj widok do trasy (całej albo wybranej nogi — patrz selectedLegId). */
  fit: () => void;
  /** Wymuś ponowne wczytanie silnika mapy (np. po ubiciu procesu WebView). */
  reload: () => void;
}

interface RouteMapProps {
  route: MapRoute | null;
  vehicle?: MapVehicle | null;
  user?: { lat: number; lon: number; heading: number | null } | null;
  selectedLegId?: string | null;
  /** Wysokość panelu pod mapą — tyle marginesu zostawiamy przy dopasowaniu. */
  paddingBottom?: number;
  /** Pasek u góry zasłania trasę, więc dopasowanie musi go zostawić. */
  paddingTop?: number;
  onReady?: () => void;
  onStopTap?: (stop: MapStopTap) => void;
  onLegTap?: (legId: string) => void;
  /** false = kafelki się nie ładują, true = mapa wróciła do normy. */
  onTilesStatus?: (ok: boolean) => void;
  onError?: (message: string) => void;
}

/**
 * GeoJSON chce [lon, lat], a reszta aplikacji (routeGeometry, OSRM, projekcje)
 * trzyma [lat, lon]. Zamiana jest tu jedynym miejscem, gdzie te dwa światy
 * się stykają.
 */
const toGeoJson = (coords: [number, number][]): [number, number][] =>
  coords.map(([lat, lon]) => [lon, lat]);

export const RouteMap = forwardRef<RouteMapHandle, RouteMapProps>(function RouteMap(
  {
    route,
    vehicle = null,
    user = null,
    selectedLegId = null,
    paddingBottom = 190,
    paddingTop = 42,
    onReady,
    onStopTap,
    onLegTap,
    onTilesStatus,
    onError,
  },
  ref,
) {
  const webRef = useRef<WebView>(null);
  const firstLoad = useRef(true);
  const padRef = useRef<[number, number, number, number]>([42, 42, paddingBottom, 42]);
  padRef.current = [paddingTop, 42, paddingBottom, 42];

  const [attempt, setAttempt] = useState(0);

  const html = useMemo(
    () => buildRouteMapDocument({ route, vehicle, user, selectedLegId }),
    [route?.id, attempt],
  );

  const send = useCallback((msg: MapInMessage) => {
    webRef.current?.injectJavaScript(
      `window.dispatchEvent(new MessageEvent('message',{data:${JSON.stringify(JSON.stringify(msg))}}));true;`,
    );
  }, []);

  const restart = useCallback(() => {
    firstLoad.current = true;
    setAttempt((a) => a + 1);
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      setGeometry: (legId, coords) =>
        send({ t: 'geometry', legId, coords: toGeoJson(coords), approx: false }),
      fit: () => send({ t: 'fit', pad: padRef.current }),
      reload: restart,
    }),
    [restart, send],
  );

  useEffect(() => {
    send({ t: 'vehicle', vehicle });
  }, [send, vehicle]);

  useEffect(() => {
    if (user) send({ t: 'user', ...user });
  }, [send, user]);

  useEffect(() => {
    send({ t: 'select', legId: selectedLegId, pad: padRef.current });
  }, [send, selectedLegId]);

  const handleMessage = useCallback(
    (event: WebViewMessageEvent) => {
      let msg: MapOutMessage;
      try {
        msg = JSON.parse(event.nativeEvent.data) as MapOutMessage;
      } catch {
        return;
      }
      if (msg.t === 'ready') {
        onReady?.();
        return;
      }
      if (msg.t === 'error') {
        onError?.(msg.message);
        return;
      }
      if (msg.t === 'stopTap') {
        onStopTap?.(msg);
        return;
      }
      if (msg.t === 'legTap') {
        onLegTap?.(msg.legId);
        return;
      }
      if (msg.t === 'tiles') {
        onTilesStatus?.(msg.ok);
        return;
      }
      if (msg.t === 'open') {
        void Linking.openURL(msg.url).catch(() => {});
      }
    },
    [onError, onLegTap, onReady, onStopTap, onTilesStatus],
  );

  return (
    <View style={styles.wrap}>
      <WebView
        key={attempt}
        ref={webRef}
        style={styles.web}
        source={{ html }}
        originWhitelist={['*']}
        onMessage={handleMessage}
        onShouldStartLoadWithRequest={() => {
          if (firstLoad.current) {
            firstLoad.current = false;
            return true;
          }
          return false;
        }}
        setSupportMultipleWindows={false}
        javaScriptCanOpenWindowsAutomatically={false}
        scrollEnabled={false}
        bounces={false}
        overScrollMode="never"
        showsVerticalScrollIndicator={false}
        setBuiltInZoomControls={false}
        androidLayerType="hardware"
        onContentProcessDidTerminate={restart}
        onRenderProcessGone={restart}
        onError={() => onError?.('map-load-failed')}
        onHttpError={(e) => {
          if (e.nativeEvent.url === 'about:blank') restart();
        }}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: scheme.surface },
  web: { flex: 1, backgroundColor: scheme.surface },
});
