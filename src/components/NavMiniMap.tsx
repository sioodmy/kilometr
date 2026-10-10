// Mała, statyczna mapka nawigacyjna: kawałek trasy wokół użytkownika
// obrócony tak, żeby kierunek jazdy zawsze był w górę.
//
// Świadomie bez WebView i bez kafelków: na 124 px kafelki tylko szumiałyby,
// a drugi WebView z MapLibre kosztowałby silnik renderujący na karcie z
// nawigacją. Ścieżkę rysujemy wektorowo (react-native-svg), więc jest ostra na
// każdej gęstości ekranu i nie wymaga sieci.
//
// Skala jest STAŁA: mapka pokazuje zawsze ten sam promień wokół użytkownika.
// Skala zależna od długości trasy skakała przy każdym kroku i gubiła się
// przy podejściu do przystanku, a to właśnie wtedy instrukcja jest najważniejsza.

import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Path, Polygon } from 'react-native-svg';
import { scheme, shape } from '../theme/tokens';
import type { Coord } from '../services/routeGeometry';

interface NavMiniMapProps {
  /** trasa do narysowania ([lat, lon]) */
  path: Coord[];
  /** pozycja użytkownika */
  user: Coord;
  /** miejsce manewru */
  target?: Coord | null;
  /** kurs użytkownika w stopniach (0 = północ). null = brak kompasu */
  headingDeg?: number | null;
  /** kolor nogi, po której idziemy */
  accent: string;
  size?: number;
  /** promień widzenia [m] */
  radiusM?: number;
  /** ile metrów trasy pokazać przed użytkownikiem */
  lookaheadM?: number;
}

function toRad(d: number): number {
  return (d * Math.PI) / 180;
}

/** Odwzorowanie WGS84 na płaszczyznę w metrach; w promieniu 120 m to bardzo dokładne. */
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
  size = 124,
  radiusM = 110,
  lookaheadM = 260,
}: NavMiniMapProps) {
  const geometry = useMemo(() => {
    const c = size / 2;
    const userM = toMeters(user, user);
    const scale = c / radiusM;

    // Bez kompasu zostawiamy „północ w górze”: zmyślony obrót myli bardziej,
    // niż pomaga. Kierunek jazdy i tak widać po strzałce.
    const rot = headingDeg == null ? 0 : -headingDeg;
    const cos = Math.cos(toRad(rot));
    const sin = Math.sin(toRad(rot));

    const project = (p: { x: number; y: number }) => {
      const dx = p.x - userM.x;
      const dy = p.y - userM.y;
      const rx = dx * cos - dy * sin;
      const ry = dx * sin + dy * cos;
      return { x: c + rx * scale, y: c + ry * scale };
    };

    // Tracę tylko odcinek przed użytkownikiem: to, co jest za nim, na mapce
    // tej skali i tak by wypadło poza kadr.
    const ahead: Coord[] = [path[0] ?? user];
    let walked = 0;
    for (let i = 1; i < path.length; i++) {
      const a = toMeters(user, path[i - 1]);
      const b = toMeters(user, path[i]);
      walked += Math.hypot(b.x - a.x, b.y - a.y);
      ahead.push(path[i]);
      if (walked >= lookaheadM) break;
    }

    const screen = ahead.map((p) => project(toMeters(user, p)));
    const d = screen
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
      .join(' ');

    const targetScreen = target ? project(toMeters(user, target)) : null;
    // Strzałkę rysujemy tylko wtedy, gdy manewr mieści się w kadrze.
    const targetVisible =
      targetScreen != null &&
      Math.hypot(targetScreen.x - c, targetScreen.y - c) <= c - 6;

    return { d, targetScreen, targetVisible, c };
  }, [path, user, target, headingDeg, size, radiusM, lookaheadM]);

  const arrow = useMemo(() => {
    if (!geometry.targetScreen || !geometry.targetVisible) return null;
    const { x, y } = geometry.targetScreen;
    const { c } = geometry;
    const ang = Math.atan2(y - c, x - c);
    // Strzałka wskazuje manewr: podstawa z tyłu, ostrze w stronę celu.
    const back = 11;
    const w = 5;
    const tipX = x + Math.cos(ang) * 2;
    const tipY = y + Math.sin(ang) * 2;
    const bx = x - Math.cos(ang) * back;
    const by = y - Math.sin(ang) * back;
    const perp = ang + Math.PI / 2;
    return [
      `${tipX.toFixed(1)},${tipY.toFixed(1)}`,
      `${(bx + Math.cos(perp) * w).toFixed(1)},${(by + Math.sin(perp) * w).toFixed(1)}`,
      `${(bx - Math.cos(perp) * w).toFixed(1)},${(by - Math.sin(perp) * w).toFixed(1)}`,
    ].join(' ');
  }, [geometry]);

  return (
    <View
      style={[
        styles.frame,
        { width: size, height: size, borderRadius: size / 2 },
      ]}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
    >
      <Svg width={size} height={size}>
        {/* Podkład: bez niego koło zlewa się z kolorem karty. */}
        <Circle cx={geometry.c} cy={geometry.c} r={geometry.c} fill={scheme.surfaceContainerLow} />
        <Path
          d={geometry.d}
          stroke={scheme.surfaceContainerHighest}
          strokeWidth={7}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <Path
          d={geometry.d}
          stroke={accent}
          strokeWidth={3.5}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {arrow ? <Polygon points={arrow} fill={scheme.onSurface} /> : null}
        {/* Użytkownik zawsze w środku, niezależnie od kadru. */}
        <Circle
          cx={geometry.c}
          cy={geometry.c}
          r={7}
          fill={scheme.primary}
          stroke={scheme.surfaceContainerHigh}
          strokeWidth={2.5}
        />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    overflow: 'hidden',
    backgroundColor: scheme.surfaceContainerLow,
    borderRadius: shape.full,
  },
});

export default NavMiniMap;