// Komponent mapy trasy: WebView z MapLibre GL, kafelkami OSM w stylu M3,
// geometrią trasy, przystankami i pojazdem na żywo.
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
  center: (lat: number, lon: number, zoom?: number, duration?: number) => void;
  /** Wskaźnik pozycji na trasie (kursor przy sterowaniu joystickiem) */
  setCursor: (coords: { lat: number; lon: number } | null) => void;
  /** Wymuś ponowne wczytanie silnika mapy (np. po ubiciu procesu WebView). */
  reload: () => void;
}

interface RouteMapProps {
  route: MapRoute | null;
  vehicle?: MapVehicle | null;
  follow?: boolean;
  user?: { lat: number; lon: number; heading: number | null } | null;
  selectedLegId?: string | null;
  /** Wysokość panelu pod mapą — tyle marginesu zostawiamy przy dopasowaniu. */
  paddingBottom?: number;
  onReady?: () => void;
  onStopTap?: (stop: MapStopTap) => void;
  onLegTap?: (legId: string) => void;
  /** Użytkownik zaczął przesuwać mapę — śledzenie pojazdu się wyłącza. */
  onUserMoved?: () => void;
  /** false = kafelki się nie ładują, true = mapa wróciła do normy. */
  onTilesStatus?: (ok: boolean) => void;
  onError?: (message: string) => void;
}

export const RouteMap = forwardRef<RouteMapHandle, RouteMapProps>(function RouteMap(
  {
    route,
    vehicle = null,
    follow = false,
    user = null,
    selectedLegId = null,
    paddingBottom = 190,
    onReady,
    onStopTap,
    onLegTap,
    onUserMoved,
    onTilesStatus,
    onError,
  },
  ref,
) {
  const webRef = useRef<WebView>(null);
  // Pierwsza nawigacja to zawsze nasz dokument (iOS/Android raportują w niej
  // `about:blank`); kolejne, czyli linki atrybucji, blokujemy.
  const firstLoad = useRef(true);
  // Marginesy dopasowania idą z aplikacji (panele mają różne wysokości), więc
  // trzymamy je w refie i dokładamy do każdego dopasowania.
  const padRef = useRef<[number, number, number, number]>([42, 42, paddingBottom, 42]);
  padRef.current = [42, 42, paddingBottom, 42];
  // WebView ginie bez ostrzeżenia (iOS ubija proces, Android zwalnia pamięć) —
  // inkrement wymusza montowanie od nowa, a stan wraca z bootstrapu.
  const [attempt, setAttempt] = useState(0);

  // Dokument przerabiamy tylko dla nowej trasy. Każde przerysowanie ekranu
  // (np. nowy odczyt GPS) nie może zrywać kafelków i pozycji na mapie.
  const html = useMemo(
    () => buildRouteMapDocument({ route, vehicle, follow, user, selectedLegId }),
    [route?.id, attempt],
  );

  const send = useCallback((msg: MapInMessage) => {
    webRef.current?.injectJavaScript(
      `window.dispatchEvent(new MessageEvent('message',{data:${JSON.stringify(JSON.stringify(msg))}}));true;`,
    );
  }, []);

  // Nowy dokument (po ubiciu procesu WebView) to nowa pierwsza nawigacja —
  // inaczej blokada nawigacji zatrzymałaby mapę na pustym ekranie.
  const restart = useCallback(() => {
    firstLoad.current = true;
    setAttempt((a) => a + 1);
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      setGeometry: (legId, coords) => send({ t: 'geometry', legId, coords, approx: false }),
      fit: () => send({ t: 'fit', pad: padRef.current }),
      center: (lat, lon, zoom, duration) => send({ t: 'center', lat, lon, zoom, duration }),
      setCursor: (coords) =>
        coords
          ? send({ t: 'cursor', lat: coords.lat, lon: coords.lon })
          : send({ t: 'clearCursor' }),
      reload: restart,
    }),
    [restart, send],
  );

  useEffect(() => {
    send({ t: 'vehicle', vehicle });
  }, [send, vehicle]);

  useEffect(() => {
    send({ t: 'follow', on: follow });
  }, [send, follow]);

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
      if (msg.t === 'userMoved') {
        onUserMoved?.();
        return;
      }
      if (msg.t === 'tiles') {
        onTilesStatus?.(msg.ok);
        return;
      }
      if (msg.t === 'open') {
        // Linki atrybucji muszą otworzyć się w przeglądarce — WebView jest
        // zablokowany dla nawigacji, bo ma tylko pokazywać mapę.
        void Linking.openURL(msg.url).catch(() => {});
      }
    },
    [onError, onLegTap, onReady, onStopTap, onTilesStatus, onUserMoved, send],
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
        // Gesty w pełni obsługuje mapa, a nie scroller pod spodem.
        scrollEnabled={false}
        bounces={false}
        overScrollMode="never"
        showsVerticalScrollIndicator={false}
        setBuiltInZoomControls={false}
        androidLayerType="hardware"
        onContentProcessDidTerminate={restart}
        onRenderProcessGone={restart}
        onError={() => onError?.('Nie udało się załadować mapy')}
        onHttpError={(e) => {
          // Główny dokument HTML nigdy nie idzie przez http://, więc każdy
          // błąd HTTP dotyczy zasobów (kafelki) — nie zabijamy całej mapy.
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
