// Statyczna mapka nawigacyjna widgetu: kawałek trasy wokół użytkownika,
// obrócony kompasem tak, że kierunek jazdy jest zawsze w górze.
//
// Świadomie bez WebView i bez kafelków: w promieniu kilkudziesięciu metrów
// kafelki tylko szumią, a drugi silnik MapLibre na karcie kosztuje baterię.
// Wszystko rysujemy wektorowo (react-native-svg), więc mapka jest ostra na
// każdej gęstości ekranu, działa bez sieci i nie ma gestów: nie da się jej
// przybliżyć ani przewinąć, a dotknięcie trafia w cały widget nad nią.
//
// Skala jest STAŁA. Zmienna skala skakała przy każdym kroku, a właśnie przy
// podchodzeniu do przystanku instrukcja jest najważniejsza.

import React, { useId, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, {
  Circle,
  ClipPath,
  Defs,
  G,
  Path,
  Polygon,
  RadialGradient,
  Stop,
  Text as SvgText,
} from 'react-native-svg';
import { scheme, shape } from '../theme/tokens';
import type { Coord } from '../services/routeGeometry';

interface NavMiniMapProps {
  /** cała trasa ([lat, lon]); mapka sama wycina odcinek przed użytkownikiem */
  path: Coord[];
  /** pozycja użytkownika (środek mapki). Przekazuj stabilną referencję. */
  user: Coord;
  /** miejsce następnego manewru, jeśli jest */
  maneuverAt?: Coord | null;
  /** przystanek, do którego idziemy */
  stop?: Coord | null;
  /** kurs urządzenia w stopniach (0 = północ). null = mapa ustawiona na północ */
  headingDeg?: number | null;
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
  accent,
  size = 108,
  radiusM = 120,
  lookaheadM = 260,
}: NavMiniMapProps) {
  // Id do ClipPath musi być unikalne, gdy na ekranie stoi więcej mapek.
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const clipId = `navClip${uid}`;
  const gradId = `navFill${uid}`;

  // Rzut całej trasy na metry to najcięższa część. Liczymy ją tylko przy
  // zmianie pozycji lub trasy, a nie przy każdym obrocie kompasu.
  const ahead = useMemo(() => {
    const local = path.map((p) => toMeters(user, p));
    return routeAhead(local, lookaheadM);
  }, [path, user, lookaheadM]);

  const maneuverM = useMemo(
    () => (maneuverAt ? toMeters(user, maneuverAt) : null),
    [maneuverAt, user],
  );
  const stopM = useMemo(() => (stop ? toMeters(user, stop) : null), [stop, user]);

  const c = size / 2;
  const scale = c / radiusM;
  const rot = headingDeg == null ? 0 : -headingDeg * DEG;
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);

  const toScreen = (p: Pt): Pt => ({
    x: c + (p.x * cos - p.y * sin) * scale,
    y: c + (p.x * sin + p.y * cos) * scale,
  });
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

  // Kierunek jazdy zawsze w górę, więc stożek „patrzenia” ma stały kształt.
  const cone = (() => {
    if (headingDeg == null) return null;
    const L = c * 0.78;
    const a = 28 * DEG;
    return [
      `${c},${c}`,
      `${(c - Math.sin(a) * L).toFixed(1)},${(c - Math.cos(a) * L).toFixed(1)}`,
      `${(c + Math.sin(a) * L).toFixed(1)},${(c - Math.cos(a) * L).toFixed(1)}`,
    ].join(' ');
  })();

  // Strzałka manewru tylko wtedy, gdy mieści się w kadrze. Poza kadrem
  // kierunek i tak pokazuje ikona nad mapką.
  const maneuver = (() => {
    if (!maneuverM) return null;
    const s = toScreen(maneuverM);
    if (!inFrame(s, 8)) return null;
    return arrowPoints(s.x, s.y, Math.atan2(s.y - c, s.x - c), 7, 5.5);
  })();

  // Przystanek: kropka, gdy jest w kadrze; poza kadrem trójkąt na krawędzi.
  const stopMarker = (() => {
    if (!stopM) return null;
    const s = toScreen(stopM);
    if (inFrame(s, 8)) return { kind: 'dot' as const, x: s.x, y: s.y };
    const edge = onRim(s);
    return { kind: 'edge' as const, points: arrowPoints(edge.x, edge.y, edge.angle, 6, 5) };
  })();

  // Literka N na krawędzi pokazuje, gdzie jest północ, także gdy mapa
  // jest obrócona kompasem.
  const north = onRim(toScreen({ x: 0, y: -radiusM }));

  return (
    <View
      style={[styles.frame, { width: size, height: size, borderRadius: size / 2 }]}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
    >
      <Svg width={size} height={size}>
        <Defs>
          <ClipPath id={clipId}>
            <Circle cx={c} cy={c} r={c} />
          </ClipPath>
          <RadialGradient id={gradId} cx="50%" cy="50%" rx="50%" ry="50%">
            <Stop offset="0" stopColor={scheme.surfaceContainer} />
            <Stop offset="1" stopColor={scheme.surfaceContainerLowest} />
          </RadialGradient>
        </Defs>

        <G clipPath={`url(#${clipId})`}>
          <Circle cx={c} cy={c} r={c} fill={`url(#${gradId})`} />
          {/* Pierścień w połowie zasięgu: skala bez podpisów. */}
          <Circle
            cx={c}
            cy={c}
            r={c / 2}
            fill="none"
            stroke={scheme.outlineVariant}
            strokeOpacity={0.5}
            strokeWidth={1}
            strokeDasharray="2 3"
          />

          {routeD ? (
            <>
              <Path
                d={routeD}
                stroke={scheme.surfaceContainerHighest}
                strokeWidth={8}
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <Path
                d={routeD}
                stroke={accent}
                strokeWidth={4}
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </>
          ) : null}

          {cone ? <Polygon points={cone} fill={scheme.primary} fillOpacity={0.16} /> : null}

          {maneuver ? <Polygon points={maneuver} fill={scheme.onSurface} /> : null}

          {stopMarker?.kind === 'dot' ? (
            <Circle
              cx={stopMarker.x}
              cy={stopMarker.y}
              r={6.5}
              fill={accent}
              stroke={scheme.surfaceContainerLowest}
              strokeWidth={2}
            />
          ) : stopMarker?.kind === 'edge' ? (
            <Polygon points={stopMarker.points} fill={accent} />
          ) : null}

          {/* Użytkownik zawsze w środku, niezależnie od kadru. */}
          <Circle cx={c} cy={c} r={11} fill={scheme.primary} fillOpacity={0.18} />
          <Circle
            cx={c}
            cy={c}
            r={5.5}
            fill={scheme.primary}
            stroke={scheme.surfaceContainerLowest}
            strokeWidth={2}
          />

          <SvgText
            x={north.x}
            y={north.y + 3}
            fill={scheme.onSurfaceVariant}
            fontSize={9}
            fontWeight="700"
            textAnchor="middle"
          >
            N
          </SvgText>
        </G>
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
