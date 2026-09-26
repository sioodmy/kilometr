// Miniaturowa mapa trasy wewnątrz joysticka.
//
// Pad nie jest pustym kołem: pokazuje kawałek trasy „dalej” (nitkę
// przebiegu), punkt, w którym jest teraz kursor, oraz naszą własną
// pozycję. To radar kierunkowy w skali 200 metrów — dokładnie tego brakowało,
// żeby świadomość, gdzie jedziemy, nie zależała od dużej mapy pod spodem.
//
// Wszystko rysujemy zwykłymi View (kilkanaście odcinków), bez WebView —
// pad ma być tani dla klatek, bo pozycja kursora zmienia się 60 razy
// na sekundę.

import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { scheme } from '../theme/tokens';
import { distanceM, interpolateRoute, type Coord } from '../services/routeGeometry';

/** Ile metrów widać od kursora do krawędzi pada. */
const DEFAULT_RANGE_M = 110;
/** Ile punktów trasy rysujemy — mniej = taniej na klatkę, więcej = gładziej. */
const MAX_POINTS = 18;

const M_PER_DEG_LAT = 111320;

export interface RouteMiniMapProps {
  coords: Coord[];
  progress: number;
  /** Promień widzenia w metrach. */
  rangeM?: number;
  size: number;
  user?: { lat: number; lon: number } | null;
  vehicle?: { lat: number; lon: number; color: string } | null;
  /** Kolor odcinka „przed nami” (domyślnie kolor trasy). */
  aheadColor?: string;
}

function project(
  point: Coord,
  center: Coord,
  scale: number,
  size: number,
): { x: number; y: number } {
  const mPerDegLon = M_PER_DEG_LAT * Math.cos((center[0] * Math.PI) / 180);
  return {
    x: (point[1] - center[1]) * mPerDegLon * scale + size / 2,
    // Północ do góry: oś Y ekranu rośnie w dół.
    y: -(point[0] - center[0]) * M_PER_DEG_LAT * scale + size / 2,
  };
}

export function RouteMiniMap({
  coords,
  progress,
  rangeM = DEFAULT_RANGE_M,
  size,
  user,
  vehicle,
  aheadColor = scheme.primary,
}: RouteMiniMapProps) {
  const view = useMemo(() => {
    if (!coords || coords.length < 2) return null;
    const { point: cursor } = interpolateRoute(coords, progress);
    // Trasa dalej (aż do końca albo do `rangeM` po przekroczeniu limitu).
    const ahead: Coord[] = [cursor];
    for (let i = coords.length - 1; i >= 0; i--) {
      if (distanceM(cursor, coords[i]) > rangeM * 2.2) break;
      ahead.push(coords[i]);
    }
    ahead.reverse();

    // Próbka co kilka punktów, żeby liczba odcinków była stała.
    const stride = Math.max(1, Math.ceil(ahead.length / MAX_POINTS));
    const points = ahead.filter((_, i) => i % stride === 0 || i === ahead.length - 1);
    if (points[points.length - 1] !== ahead[ahead.length - 1]) points.push(ahead[ahead.length - 1]);

    const scale = size / 2 / rangeM;
    const projected = points.map((p) => project(p, cursor, scale, size));
    const half = size / 2;
    const self = { x: half, y: half };

    // Odcinek „przed nami” dostaje akcent — to jest ta nitka trasy dalej.
    const behind: React.ReactNode[] = [];
    const aheadSegs: React.ReactNode[] = [];
    for (let i = 0; i < projected.length - 1; i++) {
      const a = projected[i];
      const b = projected[i + 1];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len < 0.6) continue;
      const seg = (
        <View
          key={`s${i}`}
          style={[
            styles.seg,
            {
              width: len,
              transform: [
                { translateX: a.x },
                { translateY: a.y - 1.5 },
                { rotateZ: `${Math.atan2(dy, dx)}rad` },
              ],
              backgroundColor: i >= 1 ? aheadColor : scheme.outlineVariant,
            },
          ]}
        />
      );
      (i >= 1 ? aheadSegs : behind).push(seg);
    }

    const userPt = user ? project([user.lat, user.lon], cursor, scale, size) : null;
    const userInside =
      userPt != null && userPt.x > 2 && userPt.x < size - 2 && userPt.y > 2 && userPt.y < size - 2;
    const vehiclePt = vehicle
      ? project([vehicle.lat, vehicle.lon], cursor, scale, size)
      : null;
    const vehicleInside =
      vehiclePt != null &&
      vehiclePt.x > 2 &&
      vehiclePt.x < size - 2 &&
      vehiclePt.y > 2 &&
      vehiclePt.y < size - 2;

    return {
      behind,
      aheadSegs,
      self,
      userPt,
      userInside,
      vehiclePt,
      vehicleInside,
      // Strzałka pojazdu wskazuje od kursora w stronę pojazdu (domyślnie
      // rysuje się w górę, stąd +90°), a nie na północ — w skali 200 m
      // czytelniejsze jest „pojazd jest tam”, niż kurs do świata.
      vehicleRot:
        vehiclePt != null
          ? (Math.atan2(vehiclePt.y - self.y, vehiclePt.x - self.x) * 180) / Math.PI + 90
          : 0,
    };
  }, [coords, progress, rangeM, size, user, vehicle, aheadColor]);

  if (!view) return <View style={{ width: size, height: size }} />;

  const { self, userPt, vehiclePt } = view;

  return (
    <View style={[styles.pad, { width: size, height: size }]}>
      {view.behind}
      {view.aheadSegs}

      {/* Własna pozycja: kółko z halo, jak na mapie. */}
      {userPt ? (
        <View
          style={[
            styles.user,
            {
              left: userPt.x - 5,
              top: userPt.y - 5,
              opacity: view.userInside ? 1 : 0.35,
            },
          ]}
        >
          <View style={styles.userHalo} />
        </View>
      ) : null}

      {/* Pojazd kursujący w promieniu padszego widoku. */}
      {vehiclePt ? (
        <View
          style={[
            styles.vehicle,
            {
              left: vehiclePt.x - 7,
              top: vehiclePt.y - 7,
              borderBottomColor: vehicle?.color ?? scheme.primary,
              opacity: view.vehicleInside ? 1 : 0.35,
              transform: [{ rotateZ: `${view.vehicleRot}deg` }],
            },
          ]}
        />
      ) : null}

      {/* Kursor: obręcz w miejscu, w którym jesteśmy na trasie. */}
      <View style={[styles.self, { left: self.x - 8, top: self.y - 8 }]}>
        <View style={styles.selfInner} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  pad: {
    position: 'relative',
    overflow: 'hidden',
    borderRadius: 999,
    backgroundColor: scheme.surfaceContainerLowest,
  },
  seg: {
    position: 'absolute',
    left: 0,
    top: 0,
    height: 3,
    borderRadius: 2,
    transformOrigin: 'left center',
  },
  self: {
    position: 'absolute',
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: scheme.primary,
    backgroundColor: 'rgba(92,219,190,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  selfInner: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: scheme.primary,
  },
  user: {
    position: 'absolute',
    width: 10,
    height: 10,
    borderRadius: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  userHalo: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: scheme.tertiary,
    borderWidth: 2,
    borderColor: scheme.surfaceContainerLowest,
  },
  vehicle: {
    position: 'absolute',
    width: 0,
    height: 0,
    borderLeftWidth: 7,
    borderRightWidth: 7,
    borderBottomWidth: 12,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
});
