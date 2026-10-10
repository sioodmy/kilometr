// Mapka widgetu nawigacji: prawdziwe kafle OSM z trasą, obrócone tak, że
// kierunek jazdy jest zawsze w górze.
//
// Drugi silnik MapLibre na karcie byłby za ciężki, więc tło to kilka
// rastrowych kafli OSM (zwykłe <Image>, cache na dysku), a trasa leży na nich
// wektorem. Nie ma gestów: nie da się przybliżyć ani przewinąć, a dotknięcie
// trafia w cały widget nad mapką.
//
// Obrót NIE przerysowuje komponentu. Kafle i trasę rysujemy raz w układzie
// „północ w górę”, a obraca je transform na wątku UI (Reanimated). Kurs z
// kompasu ląduje w shared value bez setState, więc magnetometr nie mieli
// JS-a i mapa nie laguje. Skala jest STAŁA.

import React, { useMemo } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import Animated, { type SharedValue, useAnimatedStyle } from 'react-native-reanimated';
import Svg, { Circle, Path, Polygon, Text as SvgText } from 'react-native-svg';
import { shape } from '../theme/tokens';
import type { Coord } from '../services/routeGeometry';
import { OSM_ATTRIBUTION, OSM_ATTRIBUTION_LONG, useNavTiles } from '../services/navTiles';

interface NavMiniMapProps {
  /** cała trasa ([lat, lon]); mapka sama wycina odcinek przed użytkownikiem */
  path: Coord[];
  /** pozycja użytkownika (środek mapki). Przekazuj stabilną referencję. */
  user: Coord;
  /** miejsce następnego manewru, jeśli jest */
  maneuverAt?: Coord | null;
  /** przystanek, do którego idziemy */
  stop?: Coord | null;
  /** kurs urządzenia w stopniach (0 = północ). null = brak kompasu */
  headingDeg?: number | null;
  /**
   * Obrót tarczy w stopniach (0 = północ w górze, znormalizowane do
   * -180..180, żeby nie kręciła przy przejściu przez północ). Ustawiany z
   * kompasu BEZ re-renderu, więc mapa obraca się płynnie.
   */
  rotationSV: SharedValue<number>;
  /** kolor trasy i przystanku */
  accent: string;
  size?: number;
  /** promień widzenia [m] */
  radiusM?: number;
  /** ile metrów trasy pokazać przed użytkownikiem */
  lookaheadM?: number;
}

interface Pt {
  x: number;
  y: number;
}

const DEG = Math.PI / 180;

// Kafle OSM są zawsze jasne, więc znaczniki muszą być ciemne niezależnie od
// motywu aplikacji. To celowy wyjątek od tokenów (czytelność mapy).
const PAPER = '#F2EFE9';
const INK = '#201D19';
const ROUTE_CASING = '#33302B';
const USER_FILL = '#0B7A75';

/** Płaska projekcja wokół użytkownika w metrach. Oś y rośnie w dół, jak na ekranie. */
function toMeters(origin: Coord, p: Coord): Pt {
  const kx = Math.cos(origin[0] * DEG) * 111320;
  return { x: (p[1] - origin[1]) * kx, y: -(p[0] - origin[0]) * 111320 };
}

/**
 * Odcinek trasy zaczynający się w rzucie użytkownika na trasę i idący
 * `lookaheadM` metrów do przodu. Użytkownik leży w (0, 0).
 */
function routeAhead(path: Pt[], lookaheadM: number): Pt[] {
  if (path.length < 2) return [];
  let bestI = 0;
  let bestT = 0;
  let bestD = Infinity;
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i];
    const b = path[i + 1];
    const vx = b.x - a.x;
    const vy = b.y - a.y;
    const len2 = vx * vx + vy * vy;
    const t = len2 > 0 ? Math.min(1, Math.max(0, -(a.x * vx + a.y * vy) / len2)) : 0;
    const d = Math.hypot(a.x + vx * t, a.y + vy * t);
    if (d < bestD) {
      bestD = d;
      bestI = i;
      bestT = t;
    }
  }
  const a = path[bestI];
  const b = path[bestI + 1];
  const out: Pt[] = [{ x: a.x + (b.x - a.x) * bestT, y: a.y + (b.y - a.y) * bestT }];
  let walked = 0;
  let prev = out[0];
  for (let i = bestI + 1; i < path.length && walked < lookaheadM; i++) {
    const p = path[i];
    walked += Math.hypot(p.x - prev.x, p.y - prev.y);
    out.push(p);
    prev = p;
  }
  return out;
}

/** Trójkąt-strzałka: ostrze w kierunku `angle`, podstawa z tyłu, środek w (cx, cy). */
function arrowPoints(cx: number, cy: number, angle: number, len: number, half: number): string {
  const ux = Math.cos(angle);
  const uy = Math.sin(angle);
  const px = -uy;
  const py = ux;
  const pts = [
    { x: cx + ux * len, y: cy + uy * len },
    { x: cx - ux * len * 0.6 + px * half, y: cy - uy * len * 0.6 + py * half },
    { x: cx - ux * len * 0.6 - px * half, y: cy - uy * len * 0.6 - py * half },
  ];
  return pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
}

export function NavMiniMap({
  path,
  user,
  maneuverAt = null,
  stop = null,
  headingDeg = null,
  rotationSV,
  accent,
  size = 108,
  radiusM = 120,
  lookaheadM = 260,
}: NavMiniMapProps) {
  const c = size / 2;
  // Ekranowych pikseli na metr. Ta sama skala dla kafli i trasy.
  const sppm = c / radiusM;

  // Rzut całej trasy na metry liczymy tylko przy zmianie pozycji lub trasy,
  // nigdy przy obrocie (ten robi transform).
  const ahead = useMemo(() => {
    const local = path.map((p) => toMeters(user, p));
    return routeAhead(local, lookaheadM);
  }, [path, user, lookaheadM]);

  const maneuverM = useMemo(
    () => (maneuverAt ? toMeters(user, maneuverAt) : null),
    [maneuverAt, user],
  );
  const stopM = useMemo(() => (stop ? toMeters(user, stop) : null), [stop, user]);

  // Północ w górze, bez obrotu. Obraca cała warstwa przez transform.
  const toScreen = (p: Pt): Pt => ({ x: c + p.x * sppm, y: c + p.y * sppm });
  const inFrame = (p: Pt, margin: number) => Math.hypot(p.x - c, p.y - c) <= c - margin;

  /** Punkt na krawędzi mapki w kierunku `s` oraz kąt tego kierunku. */
  const onRim = (s: Pt) => {
    const dx = s.x - c;
    const dy = s.y - c;
    const len = Math.hypot(dx, dy) || 1;
    const r = c - 9;
    return { x: c + (dx / len) * r, y: c + (dy / len) * r, angle: Math.atan2(dy, dx) };
  };

  const routeD = ahead
    .map((p, i) => {
      const s = toScreen(p);
      return `${i === 0 ? 'M' : 'L'}${s.x.toFixed(1)} ${s.y.toFixed(1)}`;
    })
    .join(' ');

  // Strzałka manewru tylko wtedy, gdy mieści się w kadrze. Poza kadrem
  // kierunek i tak pokazuje ikona nad mapką.
  const maneuver = (() => {
    if (!maneuverM) return null;
    const s = toScreen(maneuverM);
    if (!inFrame(s, 8)) return null;
    return arrowPoints(s.x, s.y, Math.atan2(s.y - c, s.x - c), 7, 5.5);
  })();

  // Przystanek: kropka, gdy jest w kadrze; poza kadrem trójkąt na krawędzi.
  // Leży w obracanej warstwie, więc krawędź sama podąża za kompasem.
  const stopMarker = (() => {
    if (!stopM) return null;
    const s = toScreen(stopM);
    if (inFrame(s, 8)) return { kind: 'dot' as const, x: s.x, y: s.y };
    const edge = onRim(s);
    return { kind: 'edge' as const, points: arrowPoints(edge.x, edge.y, edge.angle, 6, 5) };
  })();

  // Kafle w metrach względem użytkownika; na ekran tą samą skalą co trasa.
  const tiles = useNavTiles(user[0], user[1], radiusM);

  const rotStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotationSV.value}deg` }],
  }));

  // Literka N pokazuje północ. Pozycję liczymy ze stanu kompasu (rzadkie
  // aktualizacje), a nie z shared value, żeby nie przerysowywać przy obrocie.
  const north = (() => {
    if (headingDeg == null) return null;
    const r = ((-headingDeg % 360) + 360) % 360;
    const rad = r * DEG;
    // Północ w układzie północ-w-górze to góra tarczy; obracamy o ten sam kąt
    // co warstwę i przyciskamy do krawędzi.
    const e = onRim({ x: c + Math.sin(rad) * c, y: c - Math.cos(rad) * c });
    return e;
  })();

  return (
    <View
      style={[styles.frame, { width: size, height: size, borderRadius: size / 2 }]}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
    >
      {/* Obracana warstwa: kafle + trasa w układzie północ-w-górze. */}
      <Animated.View style={[{ width: size, height: size }, rotStyle]}>
        {tiles.map((t) =>
          t.uri ? (
            <Image
              key={`${t.x}/${t.y}`}
              source={{ uri: t.uri }}
              fadeDuration={0}
              style={{
                position: 'absolute',
                left: c + t.dxM * sppm,
                top: c + t.dyM * sppm,
                width: t.sizeM * sppm,
                height: t.sizeM * sppm,
              }}
            />
          ) : null,
        )}
        <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
          {/* Pierścień w połowie zasięgu: skala bez podpisów. */}
          <Circle
            cx={c}
            cy={c}
            r={c / 2}
            fill="none"
            stroke={ROUTE_CASING}
            strokeOpacity={0.35}
            strokeWidth={1}
            strokeDasharray="2 3"
          />
          {routeD ? (
            <>
              <Path
                d={routeD}
                stroke={ROUTE_CASING}
                strokeWidth={7}
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <Path
                d={routeD}
                stroke={accent}
                strokeWidth={3.5}
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </>
          ) : null}
          {maneuver ? <Polygon points={maneuver} fill={INK} /> : null}
          {stopMarker?.kind === 'dot' ? (
            <Circle cx={stopMarker.x} cy={stopMarker.y} r={6.5} fill={accent} stroke="#fff" strokeWidth={2} />
          ) : stopMarker?.kind === 'edge' ? (
            <Polygon points={stopMarker.points} fill={accent} stroke="#fff" strokeWidth={1} />
          ) : null}
        </Svg>
      </Animated.View>

      {/* Stałe nakładki: nie obracają się z mapą. */}
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        {headingDeg != null ? (
          <Polygon
            points={`${c},${c} ${(c - Math.sin(28 * DEG) * c * 0.78).toFixed(1)},${(c - Math.cos(28 * DEG) * c * 0.78).toFixed(1)} ${(c + Math.sin(28 * DEG) * c * 0.78).toFixed(1)},${(c - Math.cos(28 * DEG) * c * 0.78).toFixed(1)}`}
            fill={USER_FILL}
            fillOpacity={0.2}
          />
        ) : null}
        <Circle cx={c} cy={c} r={11} fill={USER_FILL} fillOpacity={0.22} />
        <Circle cx={c} cy={c} r={5.5} fill={USER_FILL} stroke="#fff" strokeWidth={2} />
        {north ? (
          <SvgText
            x={north.x}
            y={north.y + 3}
            fill={INK}
            fontSize={9}
            fontWeight="700"
            textAnchor="middle"
          >
            N
          </SvgText>
        ) : null}
      </Svg>

      <Text style={styles.credit} accessibilityLabel={OSM_ATTRIBUTION_LONG}>
        {OSM_ATTRIBUTION}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    overflow: 'hidden',
    backgroundColor: PAPER,
    borderRadius: shape.full,
  },
  credit: {
    position: 'absolute',
    bottom: 5,
    alignSelf: 'center',
    fontSize: 8,
    lineHeight: 10,
    fontWeight: '600',
    color: INK,
    backgroundColor: 'rgba(255,255,255,0.72)',
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 1,
    overflow: 'hidden',
  },
});

export default NavMiniMap;
