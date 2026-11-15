// Komponent pelnoekranowej mapy pojazdow i przystankow na zywo w stylu zbiorkom.live.
// Przesyla paczki pozycji, warstwe przystankow, korytarze utrudnien, pozycje uzytkownika oraz wybor przez mostek WebView.

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
import {
  buildLiveVehiclesMapDocument,
  type LiveMapDisruptionItem,
  type LiveMapInMessage,
  type LiveMapOutMessage,
  type LiveMapStopItem,
  type LiveMapVehicleItem,
} from '../map/liveVehiclesMapDocument';
import { mapDocumentSource } from '../map/bundledMapLibre';
import { getActiveCitySync, useActiveCity } from '../services/cityStore';
import { scheme } from '../theme/tokens';

export interface LiveVehiclesMapHandle {
  /** Plynnie centruje mape na zadanej pozycji. */
  centerOn: (lat: number, lon: number, zoom?: number) => void;
  /** Wymusza przeladowanie WebView po bledzie renderera. */
  reload: () => void;
}

interface LiveVehiclesMapProps {
  vehicles: LiveMapVehicleItem[];
  stops?: LiveMapStopItem[];
  disruptions?: LiveMapDisruptionItem[];
  selectedId: string | null;
  selectedStopId?: string | null;
  selectedDisruptionId?: string | null;
  showDisruptions?: boolean;
  userLat?: number | null;
  userLon?: number | null;
  offlineBase?: string | null;
  bottomOffset?: number;
  onSelectVehicle?: (vehicleId: string) => void;
  onSelectStop?: (stopId: string) => void;
  onSelectDisruption?: (disruptionId: string) => void;
  onClearSelection?: () => void;
  onTilesStatus?: (ok: boolean) => void;
  onError?: (message: string) => void;
  onReady?: () => void;
}

/** Mapa wszystkich aktywnych pojazdow live, przystankow i korytarzy utrudnien. */
export const LiveVehiclesMap = forwardRef<LiveVehiclesMapHandle, LiveVehiclesMapProps>(
  function LiveVehiclesMap(
    {
      vehicles,
      stops = [],
      disruptions = [],
      selectedId,
      selectedStopId = null,
      selectedDisruptionId = null,
      showDisruptions = true,
      userLat = null,
      userLon = null,
      offlineBase = null,
      bottomOffset = 0,
      onSelectVehicle,
      onSelectStop,
      onSelectDisruption,
      onClearSelection,
      onTilesStatus,
      onError,
      onReady,
    },
    ref,
  ) {
    const webRef = useRef<WebView>(null);
    const firstLoad = useRef(true);
    const readyRef = useRef(false);
    const { cityId } = useActiveCity();
    const [attempt, setAttempt] = useState(0);

    const vehiclesRef = useRef(vehicles);
    vehiclesRef.current = vehicles;
    const stopsRef = useRef(stops);
    stopsRef.current = stops;
    const disruptionsRef = useRef(disruptions);
    disruptionsRef.current = disruptions;
    const selectedIdRef = useRef(selectedId);
    selectedIdRef.current = selectedId;
    const selectedStopIdRef = useRef(selectedStopId);
    selectedStopIdRef.current = selectedStopId;
    const selectedDisruptionIdRef = useRef(selectedDisruptionId);
    selectedDisruptionIdRef.current = selectedDisruptionId;
    const showDisruptionsRef = useRef(showDisruptions);
    showDisruptionsRef.current = showDisruptions;

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
      readyRef.current = false;
      firstLoad.current = true;
      return buildLiveVehiclesMapDocument({
        center: initialCenter,
        offlineBase,
        vehicles: vehiclesRef.current,
        stops: stopsRef.current,
        disruptions: disruptionsRef.current,
        selectedId: selectedIdRef.current,
        selectedStopId: selectedStopIdRef.current,
        selectedDisruptionId: selectedDisruptionIdRef.current,
        showDisruptions: showDisruptionsRef.current,
        userPos: userPosRef.current,
      });
    }, [attempt, cityId, initialCenter, offlineBase]);

    const send = useCallback((msg: LiveMapInMessage) => {
      webRef.current?.injectJavaScript(
        `window.dispatchEvent(new MessageEvent('message',{data:${JSON.stringify(JSON.stringify(msg))}}));true;`,
      );
    }, []);

    const restart = useCallback(() => {
      firstLoad.current = true;
      readyRef.current = false;
      setAttempt((a) => a + 1);
    }, []);

    useImperativeHandle(
      ref,
      () => ({
        centerOn: (lat, lon, zoom) => send({ t: 'center', lat, lon, zoom }),
        reload: restart,
      }),
      [restart, send],
    );

    useEffect(() => {
      if (!readyRef.current) return;
      send({ t: 'vehicles', vehicles, selectedId });
    }, [selectedId, send, vehicles]);

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
      send({
        t: 'disruptions',
        disruptions,
        selectedDisruptionId,
        visible: showDisruptions,
      });
    }, [disruptions, selectedDisruptionId, send, showDisruptions]);

    useEffect(() => {
      if (!readyRef.current || !userPos) return;
      send({ t: 'user', lat: userPos[1], lon: userPos[0] });
    }, [send, userPos]);

    useEffect(() => {
      if (!readyRef.current) return;
      send({ t: 'pad', bottom: bottomOffset });
    }, [bottomOffset, send]);

    const handleMessage = useCallback(
      (event: WebViewMessageEvent) => {
        let msg: LiveMapOutMessage;
        try {
          msg = JSON.parse(event.nativeEvent.data) as LiveMapOutMessage;
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
          send({ t: 'stops', stops: stopsRef.current, selectedStopId: selectedStopIdRef.current });
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
        if (msg.t === 'select') {
          onSelectVehicle?.(msg.vehicleId);
          return;
        }
        if (msg.t === 'selectStop') {
          onSelectStop?.(msg.stopId);
          return;
        }
        if (msg.t === 'selectDisruption') {
          onSelectDisruption?.(msg.disruptionId);
          return;
        }
        if (msg.t === 'clearSelect') {
          onClearSelection?.();
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
        onSelectDisruption,
        onSelectStop,
        onSelectVehicle,
        onTilesStatus,
        send,
      ],
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
