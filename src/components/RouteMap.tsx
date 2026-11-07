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
import { mapDocumentSource } from '../map/bundledMapLibre';
import { getActiveCitySync, useActiveCity } from '../services/cityStore';
import type { MapInMessage, MapOutMessage, MapRoute, MapStopRole, MapVehicle } from '../map/types';
import { scheme } from '../theme/tokens';

interface MapStopTap {
  stopId: string;
  legId: string;
  name: string;
  role: MapStopRole;
  arriveSec?: number;
}

export interface RouteMapHandle {
  /** Podmienia pojedynczą nogę na prawdziwą geometrię ulic. */
  setGeometry: (legId: string, coords: [number, number][], fit?: boolean) => void;
  /** Dopasuj widok do trasy (całej albo wybranej nogi, patrz selectedLegId). */
  fit: () => void;
  /** Wymuś ponowne wczytanie silnika mapy (np. po ubiciu procesu WebView). */
  reload: () => void;
}

interface RouteMapProps {
  route: MapRoute | null;
  vehicle?: MapVehicle | null;
  selectedLegId?: string | null;
  /** Wycięty fragment geometrii [lat, lon][] aktywnego etapu (np. odcinek kolejowy). */
  focusCoords?: [number, number][] | null;
  /** Zakres indeksów przystanków [startIdx, endIdx] aktywnego etapu w `leg.stops`. */
  stopRange?: [number, number] | null;
  /** Ograniczenie maksymalnego przybliżenia przy kadrowaniu aktywnego etapu. */
  focusMaxZoom?: number | null;
  /**
   * Bazowy URL lokalnego serwera mapy. Gdy podany, kafle, glify i silnik
   * mapy idą z telefonu, więc mapa działa bez internetu.
   */
  offlineBase?: string | null;
  /** Marginesy widoku [top, right, bottom, left] w px. */
  padding?: [number, number, number, number];
  /** Wysokość panelu pod mapą: tyle marginesu zostawiamy przy dopasowaniu. */
  paddingBottom?: number;
  /** Pasek u góry zasłania trasę, więc dopasowanie musi go zostawić. */
  paddingTop?: number;
  paddingLeft?: number;
  paddingRight?: number;
  /** Etykiety POI pod trasą. Włącza je fullscreen szczegółów połączenia. */
  showPoi?: boolean;
  /** Automatyczny re-fit po dociągnięciu geometrii każdego odcinka trasy. */
  fitOnGeometry?: boolean;
  /** Maksymalny zoom dopasowania trasy (np. 16 dla widgetu, 17 dla mapy pełnoekranowej). */
  maxZoom?: number;
  onReady?: () => void;
  onStopTap?: (stop: MapStopTap) => void;
  onLegTap?: (legId: string) => void;
  /** false = kafelki się nie ładują, true = mapa wróciła do normy. */
  onTilesStatus?: (ok: boolean) => void;
  onError?: (message: string) => void;
}

/**
 * Klucz payloadu trasy: tick live nie może wysyłać jej ponownie ani resetować
 * kadru, dopóki nie zmieni się identyfikator albo geometria.
 */
function routeBridgeKey(route: MapRoute): string {
  return JSON.stringify([
    route.id,
    route.legs.map((leg) => [
      leg.id,
      leg.mode,
      leg.line ?? '',
      leg.fromStop,
      leg.toStop,
      leg.geometry?.length ?? 0,
      leg.stops.map((stop) => [stop.id, stop.lat, stop.lon]),
    ]),
  ]);
}

/** Oblicza geograficzny środek trasy dla początkowego kadru kamery. */
function routeCenter(route: MapRoute | null): [number, number] | null {
  if (!route?.legs?.length) return null;
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;
  let count = 0;
  for (const leg of route.legs) {
    if (leg.stops) {
      for (const s of leg.stops) {
        if (Number.isFinite(s.lat) && Number.isFinite(s.lon) && (s.lat !== 0 || s.lon !== 0)) {
          if (s.lat < minLat) minLat = s.lat;
          if (s.lat > maxLat) maxLat = s.lat;
          if (s.lon < minLon) minLon = s.lon;
          if (s.lon > maxLon) maxLon = s.lon;
          count++;
        }
      }
    }
    if (leg.geometry) {
      for (const p of leg.geometry) {
        const [lat, lon] = p;
        if (Number.isFinite(lat) && Number.isFinite(lon) && (lat !== 0 || lon !== 0)) {
          if (lat < minLat) minLat = lat;
          if (lat > maxLat) maxLat = lat;
          if (lon < minLon) minLon = lon;
          if (lon > maxLon) maxLon = lon;
          count++;
        }
      }
    }
  }
  if (count === 0) return null;
  return [(minLon + maxLon) / 2, (minLat + maxLat) / 2];
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
    selectedLegId = null,
    focusCoords = null,
    stopRange = null,
    focusMaxZoom = null,
    offlineBase = null,
    padding,
    paddingBottom = 190,
    paddingTop = 42,
    paddingLeft = 42,
    paddingRight = 42,
    showPoi = false,
    fitOnGeometry = false,
    maxZoom,
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

  const resolvedPadding = useMemo<[number, number, number, number]>(() => {
    if (padding && padding.length === 4) return padding;
    return [paddingTop, paddingRight, paddingBottom, paddingLeft];
  }, [padding, paddingTop, paddingRight, paddingBottom, paddingLeft]);

  const padRef = useRef<[number, number, number, number]>(resolvedPadding);
  padRef.current = resolvedPadding;

  const { cityId } = useActiveCity();
  const [attempt, setAttempt] = useState(0);
  const routeKey = useMemo(() => (route ? routeBridgeKey(route) : null), [route]);
  const sentRouteKey = useRef<string | null>(null);
  const sentRouteId = useRef<string | null>(null);

  const html = useMemo(() => {
    let center = routeCenter(route);
    if (!center) {
      try {
        const c = getActiveCitySync().center;
        center = [c.lon, c.lat];
      } catch {
        center = null;
      }
    }
    return buildRouteMapDocument({
      route,
      vehicle,
      selectedLegId,
      offlineBase,
      center,
      showPoi,
      padding: resolvedPadding,
      maxZoom,
      fitOnGeometry,
    });
    // Tylko to, co wymaga nowego dokumentu. Trasa, pojazd, wybór nogi i marginesy
    // idą potem wiadomościami (efekty niżej); nowe `html` przeładowuje cały
    // MapLibre w WebView, czyli kafle i kadr przy każdym ticku pojazdu.
    // cityId: ekran nie jest odmontowywany przy zmianie miasta (stos natywny).
  }, [route?.id, attempt, offlineBase, cityId, showPoi, maxZoom, fitOnGeometry]);

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
      setGeometry: (legId, coords, fit = false) =>
        send({ t: 'geometry', legId, coords: toGeoJson(coords), approx: false, fit, pad: padRef.current }),
      fit: () => send({ t: 'fit', pad: padRef.current }),
      reload: restart,
    }),
    [restart, send],
  );

  useEffect(() => {
    if (!route || routeKey == null) return;
    if (sentRouteKey.current === routeKey) return;
    // Nowy identyfikator = inna trasa, więc pierwszy kadr musi się dopasować.
    // Tick live z tym samym id nie rusza kamery.
    const refit = sentRouteId.current !== route.id;
    sentRouteKey.current = routeKey;
    sentRouteId.current = route.id;
    send({ t: 'route', route, fit: refit, pad: padRef.current });
  }, [route, routeKey, send]);

  useEffect(() => {
    send({ t: 'vehicle', vehicle });
  }, [send, vehicle]);

  const sendSelect = useCallback(() => {
    send({
      t: 'select',
      legId: selectedLegId,
      focusCoords: focusCoords && focusCoords.length > 0 ? toGeoJson(focusCoords) : null,
      stopRange: stopRange ?? null,
      maxZoom: focusMaxZoom ?? null,
      pad: padRef.current,
    });
  }, [focusCoords, focusMaxZoom, selectedLegId, send, stopRange]);

  useEffect(() => {
    sendSelect();
  }, [sendSelect, resolvedPadding]);

  const handleMessage = useCallback(
    (event: WebViewMessageEvent) => {
      let msg: MapOutMessage;
      try {
        msg = JSON.parse(event.nativeEvent.data) as MapOutMessage;
      } catch {
        return;
      }
      if (msg.t === 'ready') {
        if (selectedLegId) {
          sendSelect();
        }
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
    [onError, onLegTap, onReady, onStopTap, onTilesStatus, selectedLegId, sendSelect],
  );

  return (
    <View style={styles.wrap}>
      <WebView
        key={attempt}
        ref={webRef}
        style={styles.web}
        source={mapDocumentSource(html, offlineBase)}
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
        androidLayerType="none"
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
  web: { flex: 1, backgroundColor: 'transparent' },
});
