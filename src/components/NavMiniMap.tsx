// Mała, statyczna mapka nawigacyjna: kawałek trasy wokół użytkownika
// obrócony tak, żeby kierunek jazdy zawsze był w górę.
//
// Świadomie bez WebView i bez kafelków: na 120 px kafelki tylko szumia, a
// WebView z MapLibre kosztowałby drugi silnik renderujący na karcie z
// nawigacją. Ścieżkę rysujemy wektorowo (react-native-svg), więc mapa jest
// ostra na każdej gęstości ekranu i nie wymaga sieci.

import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, G, Path, Polygon } from 'react-native-svg';
import { scheme, shape } from '../theme/tokens';
import type { Coord } from '../services/routeGeometry';
import { distanceM } from '../services/routeGeometry';

interface NavMiniMapProps {
  /** trasa do narysowania ([lat, lon]) */
  path: Coord[];
  /** pozycja użytkownika */
  user: Coord;
  /** miejsce manewru (strzałka na trasie) */
  target?: Coord | null;
  /** kurs użytkownika w stopniach (0 = północ). null = brak kompasu */
  headingDeg?: number | null;
  /** kolor nogi po której idziemy */
  accent: string;
  size?: number;
}

function toRad(d: number): number {
  return (d * Math.PI) / 180;
}

/**
 * Odwzorowanie WGS84 na płaszczyznę w metrach. Do kilkuset metrów
 * ekwirectangularna projekcja jest wystarczająca i tania.
 */
function toMeters(origin: Coord, p: Coord): { x: number; y: number } {
  const kx = Math.cos(toRad(origin[0])) * 111320;
  return { x: (p[1] - origin[1]) * kx, y: -(p[0] - origin[0]) * 111320 };
}

export function NavMiniMap({
  path,
  user,
  target = null,
  headingDeg = null,
  accent,
  size = 120,
}: NavMiniMapProps) {
  const geometry = useMemo(() => {
    const c = size / 2;
    const pts = path.map((p) => toMeters(user, p));

    // Kadrowanie: bierzemy tyle trasy, ile wejdzie w kwadrat, z zapasem,
    // żeby użytkownik widział zakręt zanim do niego dojdzie.
    const maxExtent = Math.max(
      30,
      ...pts.map((p) => Math.max(Math.abs(p.x), Math.abs(p.y))),
    );
    const scale = (c - 14) / maxExtent;

    // Obrót tak, żeby kierunek jazdy był w górze. Bez kompasu zostawiamy
    // mapę „północ w górze”, bo zmyślony obrót myli bardziej niż pomaga.
    const rot = headingDeg == null ? 0 : -headingDeg;
    const cos = Math.cos(toRad(rot));
    const sin = Math.sin(toRad(rot));

    const project = (p: { x: number; y: number }) => {
      const rx = p.x * cos - p.y * sin;
      const ry = p.x * sin + p.y * cos;
      return { x: c + rx * scale, y: c + ry * scale };
    };

    const screen = pts.map(project);
    const d = screen.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');

    const targetScreen = target ? project(toMeters(user, target)) : null;
    return { d, targetScreen, c };
  }, [path, user, target, headingDeg, size]);

  const arrow = useMemo(() => {
    if (!geometry.targetScreen) return null;
    // Strzałka wskazująca manewr: trójkąt skierowana w stronę punktu.
    const { x, y } = geometry.targetScreen;
    const { c } = geometry;
    const ang = Math.atan2(y - c, x - c);
    const back = Math.min(18, Math.max(9, Math.hypot(x - c, y - c) * 0.5));
    const tipX = x;
    const tipY = y;
    const bx = x - Math.cos(ang) * back;
    const by = y - Math.sin(ang) * back;
    const perp = ang + Math.PI / 2;
    const w = 4.5;
    return [
      `${tipX.toFixed(1)},${tipY.toFixed(1)}`,
      `${(bx + Math.cos(perp) * w).toFixed(1)},${(by + Math.sin(perp) * w).toFixed(1)}`,
      `${(bx - Math.cos(perp) * w).toFixed(1)},${(by - Math.sin(perp) * w).toFixed(1)}`,
    ].join(' ');
  }, [geometry]);

  return (
    <View
      style={[styles.frame, { width: size, height: size, borderRadius: size / 2 }]}
      accessible={false}
    >
      <Svg width={size} height={size}>
        {/* Trasa: obrys, żeby linia nie ginęła na tle podkładu. */}
        <Path d={geometry.d} stroke={scheme.surfaceContainerLowest} strokeWidth={7} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <Path d={geometry.d} stroke={accent} strokeWidth={3.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        {arrow ? <Polygon points={arrow} fill={scheme.onSurface} /> : null}
        {/* Użytkownik zawsze w środku, niezależnie od kadru. */}
        <Circle cx={geometry.c} cy={geometry.c} r={7} fill={scheme.primary} stroke={scheme.surfaceContainerHigh} strokeWidth={2.5} />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    overflow: 'hidden',
    backgroundColor: scheme.surfaceContainerLowest,
    borderRadius: shape.full,
  },
});

export default NavMiniMap;