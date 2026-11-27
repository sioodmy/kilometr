// Komponent pełnoekranowej mapy pojazdów i przystanków na żywo.
// Przesyła paczki pozycji, warstwę przystanków, trasę wybranego pojazdu, korytarze utrudnień,
// pozycję użytkownika oraz wybór przez mostek WebView.

import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Linking, Platform, StyleSheet, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { WebMapFrame, type WebMapFrameHandle } from './WebMapFrame';
import {
  buildLiveVehiclesMapDocument,
  type LiveMapDelaySegmentItem,
  type LiveMapDisruptionItem,
  type LiveMapInMessage,
  type LiveMapOutMessage,
  type LiveMapPoiItem,
  type LiveMapSelectedRoute,
  type LiveMapStopItem,
  type LiveMapVehicleItem,
} from '../map/liveVehiclesMapDocument';
import {
  getCachedBundledMapLibreHead,
  loadBundledMapLibreHead,
  mapDocumentSource,
} from '../map/bundledMapLibre';
import { getActiveCitySync, useActiveCity } from '../services/cityStore';
import { scheme } from '../theme/tokens';

export interface LiveVehiclesMapHandle {
  /** Płynnie centruje mapę na zadanej pozycji. */
  centerOn: (lat: number, lon: number, zoom?: number) => void;
  /** Dopasowuje kadr do pełnej trasy aktualnie wybranego pojazdu. */
  fitRoute: () => void;
  /** Przybliża lub oddala mapę o zadany krok zoomu. */
  zoomBy: (delta: number) => void;
  /** Wymusza przeładowanie WebView po błędzie renderera. */
  reload: () => void;
}

interface LiveVehiclesMapProps {
  vehicles: LiveMapVehicleItem[];
  stops?: LiveMapStopItem[];
  disruptions?: LiveMapDisruptionItem[];
  delaySegments?: LiveMapDelaySegmentItem[];
  selectedId: string | null;
  selectedStopId?: string | null;
  selectedRoute?: LiveMapSelectedRoute | null;
  selectedDisruptionId?: string | null;
  selectedDelayId?: string | null;
  showDisruptions?: boolean;
  showDelays?: boolean;
  showStops?: boolean;
  pois?: LiveMapPoiItem[];
  selectedPoiId?: number | null;
  showPois?: boolean;
  userLat?: number | null;
  userLon?: number | null;
  offlineBase?: string | null;
  bottomOffset?: number;
  onSelectVehicle?: (vehicleId: string) => void;
  onSelectStop?: (stopId: string) => void;
  onSelectPoi?: (poiId: number) => void;
  onSelectDisruption?: (disruptionId: string) => void;
  onSelectDelay?: (delayId: string) => void;
  onClearSelection?: () => void;
  onUserDrag?: () => void;
  onZoomModeChange?: (mode: 'dots' | 'pills') => void;
  onViewportChange?: (bbox: [number, number, number, number], zoom: number) => void;
  onTilesStatus?: (ok: boolean) => void;
  onError?: (message: string) => void;
  onReady?: () => void;
  onRendered?: () => void;
  onReloading?: () => void;
}

/** Mapa wszystkich aktywnych pojazdów live, przystanków i korytarzy utrudnień. */
export const LiveVehiclesMap = forwardRef<LiveVehiclesMapHandle, LiveVehiclesMapProps>(
  function LiveVehiclesMap(
    {
      vehicles,
      stops = [],
      disruptions = [],
      delaySegments = [],
      selectedId,
      selectedStopId = null,
      selectedRoute = null,
      selectedDisruptionId = null,
      selectedDelayId = null,
      showDisruptions = true,
      showDelays = false,
      showStops = true,
      pois = [],
      selectedPoiId = null,
      showPois = true,
      userLat = null,
      userLon = null,
      offlineBase = null,
      bottomOffset = 0,
      onSelectVehicle,
      onSelectStop,
      onSelectPoi,
      onSelectDisruption,
      onSelectDelay,
      onClearSelection,
      onUserDrag,
      onZoomModeChange,
      onViewportChange,
      onTilesStatus,
      onError,
      onReady,
      onRendered,
      onReloading,
    },
    ref,
  ) {
    const webRef = useRef<WebView>(null);
    const webFrameRef = useRef<WebMapFrameHandle>(null);
    const firstLoad = useRef(true);
    const readyRef = useRef(false);
    const { cityId } = useActiveCity();
    const [attempt, setAttempt] = useState(0);
    const [mapLibreHead, setMapLibreHead] = useState<string | null>(() =>
      getCachedBundledMapLibreHead(),
    );
    useEffect(() => {
      if (mapLibreHead !== null) return;
      let cancelled = false;
      void loadBundledMapLibreHead()
        .then((head) => {
          if (!cancelled) setMapLibreHead(head);
        })
        .catch((err) => {
          if (!cancelled) onError?.(err instanceof Error ? err.message : 'maplibre-load-failed');
        });
      return () => {
        cancelled = true;
      };
    }, [mapLibreHead, onError]);

    const vehiclesRef = useRef(vehicles);
    vehiclesRef.current = vehicles;
    const stopsRef = useRef(stops);
    stopsRef.current = stops;
    const disruptionsRef = useRef(disruptions);
    disruptionsRef.current = disruptions;
    const delaySegmentsRef = useRef(delaySegments);
    delaySegmentsRef.current = delaySegments;
    const selectedIdRef = useRef(selectedId);
    selectedIdRef.current = selectedId;
    const selectedStopIdRef = useRef(selectedStopId);
    selectedStopIdRef.current = selectedStopId;
    const selectedRouteRef = useRef(selectedRoute);
    selectedRouteRef.current = selectedRoute;
    const selectedDisruptionIdRef = useRef(selectedDisruptionId);
    selectedDisruptionIdRef.current = selectedDisruptionId;
    const selectedDelayIdRef = useRef(selectedDelayId);
    selectedDelayIdRef.current = selectedDelayId;
    const showDisruptionsRef = useRef(showDisruptions);
    showDisruptionsRef.current = showDisruptions;
    const showDelaysRef = useRef(showDelays);
    showDelaysRef.current = showDelays;
    const showStopsRef = useRef(showStops);
    showStopsRef.current = showStops;
    const poisRef = useRef(pois);
    poisRef.current = pois;
    const selectedPoiIdRef = useRef(selectedPoiId);
    selectedPoiIdRef.current = selectedPoiId;
    const showPoisRef = useRef(showPois);
    showPoisRef.current = showPois;

    const userPos = useMemo<[number, number] | null>(
      () =>
        userLat != null && userLon != null && Number.isFinite(userLat) && Number.isFinite(userLon)
          ? [userLon, userLat]
          : null,
      [userLat, userLon],
    );
    const userPosRef = useRef(userPos);
    userPosRef.current = userPos;
    const bottomOffsetRef = useRef(bottomOffset);
    bottomOffsetRef.current = bottomOffset;

    const initialCenter = useMemo<[number, number] | null>(() => {
      if (userPosRef.current) return userPosRef.current;
      try {
        const c = getActiveCitySync().center;
        return [c.lon, c.lat];
      } catch {
        return null;
      }
    }, [cityId, attempt]);

    const html = useMemo(() => {
      if (mapLibreHead === null) return null;
      readyRef.current = false;
      firstLoad.current = true;
      return buildLiveVehiclesMapDocument({
        center: initialCenter,
        offlineBase,
        vehicles: vehiclesRef.current,
        stops: stopsRef.current,
        disruptions: disruptionsRef.current,
        delaySegments: delaySegmentsRef.current,
        selectedId: selectedIdRef.current,
        selectedStopId: selectedStopIdRef.current,
        selectedRoute: selectedRouteRef.current ?? null,
        selectedDisruptionId: selectedDisruptionIdRef.current,
        selectedDelayId: selectedDelayIdRef.current,
        showDisruptions: showDisruptionsRef.current,
        showDelays: showDelaysRef.current,
        showStops: showStopsRef.current,
        pois: poisRef.current,
        selectedPoiId: selectedPoiIdRef.current,
        showPois: showPoisRef.current,
        userPos: userPosRef.current,
        mapLibreHead,
      });
    }, [attempt, cityId, initialCenter, mapLibreHead, offlineBase]);

    const send = useCallback((msg: LiveMapInMessage) => {
      if (Platform.OS === 'web') {
        webFrameRef.current?.postMessage(JSON.stringify(msg));
        return;
      }
      webRef.current?.injectJavaScript(
        `window.dispatchEvent(new MessageEvent('message',{data:${JSON.stringify(JSON.stringify(msg))}}));true;`,
      );
    }, []);

    const restart = useCallback(() => {
      firstLoad.current = true;
      readyRef.current = false;
      onReloading?.();
      setAttempt((a) => a + 1);
    }, [onReloading]);

    useImperativeHandle(
      ref,
      () => ({
        centerOn: (lat, lon, zoom) => send({ t: 'center', lat, lon, zoom }),
        fitRoute: () => send({ t: 'fitRoute' }),
        zoomBy: (delta) => send({ t: 'zoom', delta }),
        reload: restart,
      }),
      [restart, send],
    );

    useEffect(() => {
      if (!readyRef.current) return;
      send({ t: 'vehicles', vehicles, selectedId: selectedIdRef.current });
    }, [send, vehicles]);

    useEffect(() => {
      if (!readyRef.current) return;
      send({ t: 'selected', id: selectedId });
    }, [selectedId, send]);

    useEffect(() => {
      if (!readyRef.current) return;
      send({ t: 'selectedRoute', route: selectedRoute ?? null });
    }, [selectedRoute, send]);

    useEffect(() => {
      if (!readyRef.current) return;
      send({ t: 'stops', stops, selectedStopId: selectedStopIdRef.current });
    }, [send, stops]);

    useEffect(() => {
      if (!readyRef.current) return;
      send({ t: 'selectedStop', stopId: selectedStopId });
    }, [selectedStopId, send]);

    useEffect(() => {
      if (!readyRef.current) return;
      send({ t: 'stopsVisible', visible: showStops });
    }, [send, showStops]);

    useEffect(() => {
      if (!readyRef.current) return;
      send({
        t: 'pois',
        pois,
        selectedPoiId: selectedPoiIdRef.current,
        visible: showPois,
      });
    }, [pois, send, showPois]);

    useEffect(() => {
      if (!readyRef.current) return;
      send({ t: 'selectedPoi', poiId: selectedPoiId });
    }, [selectedPoiId, send]);

    useEffect(() => {
      if (!readyRef.current) return;
      send({
        t: 'disruptions',
        disruptions,
        selectedDisruptionId,
        visible: showDisruptions,
      });
    }, [disruptions, selectedDisruptionId, send, showDisruptions]);

    useEffect(() => {
      if (!readyRef.current) return;
      send({
        t: 'delaySegments',
        segments: delaySegments,
        selectedDelayId,
        visible: showDelays,
      });
    }, [delaySegments, selectedDelayId, send, showDelays]);

    useEffect(() => {
      if (!readyRef.current) return;
      send({ t: 'user', lat: userPos?.[1] ?? null, lon: userPos?.[0] ?? null });
    }, [send, userPos]);

    useEffect(() => {
      if (!readyRef.current) return;
      send({ t: 'pad', bottom: bottomOffset });
    }, [bottomOffset, send]);

    const handleRawMessage = useCallback(
      (raw: string) => {
        let msg: LiveMapOutMessage;
        try {
          msg = JSON.parse(raw) as LiveMapOutMessage;
        } catch {
          return;
        }
        if (msg.t === 'ready') {
          readyRef.current = true;
          send({
            t: 'disruptions',
            disruptions: disruptionsRef.current,
            selectedDisruptionId: selectedDisruptionIdRef.current,
            visible: showDisruptionsRef.current,
          });
          send({
            t: 'delaySegments',
            segments: delaySegmentsRef.current,
            selectedDelayId: selectedDelayIdRef.current,
            visible: showDelaysRef.current,
          });
          send({ t: 'selectedRoute', route: selectedRouteRef.current ?? null });
          send({ t: 'stops', stops: stopsRef.current, selectedStopId: selectedStopIdRef.current });
          send({ t: 'stopsVisible', visible: showStopsRef.current });
          send({
            t: 'pois',
            pois: poisRef.current,
            selectedPoiId: selectedPoiIdRef.current,
            visible: showPoisRef.current,
          });
          send({ t: 'vehicles', vehicles: vehiclesRef.current, selectedId: selectedIdRef.current });
          if (userPosRef.current) {
            send({ t: 'user', lat: userPosRef.current[1], lon: userPosRef.current[0] });
          }
          if (bottomOffsetRef.current > 0) {
            send({ t: 'pad', bottom: bottomOffsetRef.current });
          }
          onReady?.();
          return;
        }
        if (msg.t === 'rendered') {
          onRendered?.();
          return;
        }
        if (msg.t === 'select') {
          onSelectVehicle?.(msg.vehicleId);
          return;
        }
        if (msg.t === 'selectStop') {
          onSelectStop?.(msg.stopId);
          return;
        }
        if (msg.t === 'selectPoi') {
          onSelectPoi?.(msg.poiId);
          return;
        }
        if (msg.t === 'selectDisruption') {
          onSelectDisruption?.(msg.disruptionId);
          return;
        }
        if (msg.t === 'selectDelay') {
          onSelectDelay?.(msg.delayId);
          return;
        }
        if (msg.t === 'clearSelect') {
          onClearSelection?.();
          return;
        }
        if (msg.t === 'userDrag') {
          onUserDrag?.();
          return;
        }
        if (msg.t === 'zoomMode') {
          onZoomModeChange?.(msg.mode);
          return;
        }
        if (msg.t === 'viewport') {
          onViewportChange?.(msg.bbox, msg.zoom);
          return;
        }
        if (msg.t === 'tiles') {
          onTilesStatus?.(msg.ok);
          return;
        }
        if (msg.t === 'error') {
          onError?.(msg.message);
          return;
        }
        if (msg.t === 'open') {
          void Linking.openURL(msg.url).catch(() => {});
        }
      },
      [
        onClearSelection,
        onError,
        onReady,
        onRendered,
        onSelectDelay,
        onSelectDisruption,
        onSelectPoi,
        onSelectStop,
        onSelectVehicle,
        onTilesStatus,
        onUserDrag,
        onViewportChange,
        onZoomModeChange,
        send,
      ],
    );

    const handleMessage = useCallback(
      (event: WebViewMessageEvent) => handleRawMessage(event.nativeEvent.data),
      [handleRawMessage],
    );

    if (html === null) {
      return <View style={styles.wrap} />;
    }

    if (Platform.OS === 'web') {
      return (
        <View style={styles.wrap}>
          <WebMapFrame
            key={attempt}
            ref={webFrameRef}
            html={html}
            title="Mapa na żywo"
            onMessage={handleRawMessage}
            onError={() => onError?.('map-load-failed')}
          />
        </View>
      );
    }

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
  },
);

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    backgroundColor: scheme.surface,
  },
  web: {
    flex: 1,
    backgroundColor: 'transparent',
  },
});
