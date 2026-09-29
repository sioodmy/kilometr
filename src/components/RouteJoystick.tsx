// Sterowanie trasą w dolnym menu (nie osobny podmenu).
//
// Oś X: przelot wzdłuż trasy (Start ◄──► Meta).
// Oś Y: przybliżanie i oddalanie mapy (Zoom + ▲ / Zoom − ▼).
// Sam pad to jednocześnie miniaturowa mapa: widać nitkę trasy dalej,
// kursor na trasie i naszą własną pozycję.
//
// Zbudowany z czystego PanRespondera i Animated z React Native, ze
// sprężynowym powrotem gałki do środka po zwolnieniu kciuka.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { SkipBack, SkipForward } from 'lucide-react-native';
import type { Coord } from '../services/routeGeometry';
import { scheme, shape, type } from '../theme/tokens';
import { RouteMiniMap } from './RouteMiniMap';
import { useStrings } from '../i18n';

const JOYSTICK_RADIUS = 46;
const PUCK_RADIUS = 19;
const MAX_DEFLECTION = JOYSTICK_RADIUS - 11;
const DEADZONE = 0.08;
/** Mini-mapa pad'a nie musi chodzić 60 fps — wystarczy ~15, reszta to szum. */
const MINI_MAP_HZ = 15;

export interface RouteJoystickProps {
  /** Pełna trasa — mini-mapa w padzie rysuje z niej odcinek przed kursorem. */
  coords: Coord[];
  progress: number;
  zoom: number;
  /** Najbliższy przystanek przed punktem kursu. */
  aheadStopName?: string;
  aheadStopDistanceM?: number;
  /** Nasza pozycja względem punktu kursu (null = brak fixa GPS). */
  userDistanceM?: number | null;
  user?: { lat: number; lon: number } | null;
  vehicle?: { lat: number; lon: number; color: string } | null;
  onNavigate: (progress: number, zoom: number, duration?: number) => void;
  onJumpStart: () => void;
  onJumpFinish: () => void;
}

export function RouteJoystick({
  coords,
  progress,
  zoom,
  aheadStopName,
  aheadStopDistanceM,
  userDistanceM,
  user,
  vehicle,
  onNavigate,
  onJumpStart,
  onJumpFinish,
}: RouteJoystickProps) {
  const s = useStrings();
  // Płynna pozycja gałki
  const pan = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;

  // Wartości sterujące w refach (do pętli requestAnimationFrame)
  const progressRef = useRef(progress);
  progressRef.current = progress;
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  const rateRef = useRef({ x: 0, y: 0 });
  const animFrameRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number>(0);
  const loopActiveRef = useRef<boolean>(false);

  const [trackWidth, setTrackWidth] = useState(240);
  // Mini-mapa dostaje throttlowany postęp, bo pad przesuwa się 60 razy
  // na sekundę, a przeliczanie kilkunastu odcinków w każdej klatce
  // nie wnosiłoby nic poza jankiem.
  const [miniProgress, setMiniProgress] = useState(progress);
  const lastMiniAt = useRef(0);

  const updateLoop = useCallback(() => {
    if (!loopActiveRef.current) return;

    const now = Date.now();
    const dt = Math.min((now - (lastTimeRef.current || now)) / 1000, 0.1);
    lastTimeRef.current = now;

    const rx = rateRef.current.x;
    const ry = rateRef.current.y;

    let hasChanged = false;
    let nextProg = progressRef.current;
    let nextZoom = zoomRef.current;

    // Oś X: Start (lewo) -> Meta (prawo)
    if (Math.abs(rx) > DEADZONE) {
      const sign = rx > 0 ? 1 : -1;
      const magnitude = (Math.abs(rx) - DEADZONE) / (1 - DEADZONE);
      // Nieliniowa krzywa: precyzja przy lekkim wychyleniu, szybkość przy mocnym
      const speed = 0.18; // pełna trasa w ~5.5s przy maksymalnym wychyleniu
      const deltaProg = sign * Math.pow(magnitude, 1.35) * speed * dt;
      nextProg = Math.max(0, Math.min(1, nextProg + deltaProg));
      hasChanged = true;
    }

    // Oś Y: Zoom + (góra, ujemne dy) / Zoom - (dół, dodatnie dy)
    if (Math.abs(ry) > DEADZONE) {
      const sign = ry > 0 ? 1 : -1;
      const magnitude = (Math.abs(ry) - DEADZONE) / (1 - DEADZONE);
      const zoomSpeed = 3.2; // 3.2 poziomy zoomu na sekundę przy max wychyleniu
      const deltaZoom = sign * Math.pow(magnitude, 1.35) * zoomSpeed * dt;
      nextZoom = Math.max(11.0, Math.min(18.5, nextZoom + deltaZoom));
      hasChanged = true;
    }

    if (hasChanged) {
      progressRef.current = nextProg;
      zoomRef.current = nextZoom;
      onNavigate(nextProg, nextZoom, 0);
    }

    animFrameRef.current = requestAnimationFrame(updateLoop);
  }, [onNavigate]);

  const startLoop = useCallback(() => {
    if (loopActiveRef.current) return;
    loopActiveRef.current = true;
    lastTimeRef.current = Date.now();
    animFrameRef.current = requestAnimationFrame(updateLoop);
  }, [updateLoop]);

  const stopLoop = useCallback(() => {
    loopActiveRef.current = false;
    if (animFrameRef.current != null) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    rateRef.current = { x: 0, y: 0 };
  }, []);

  useEffect(() => {
    return () => {
      stopLoop();
    };
  }, [stopLoop]);

  // Throttling postępu dla mini-mapy (albo ~15 Hz, albo od razu po puszczeniu).
  useEffect(() => {
    const now = Date.now();
    if (now - lastMiniAt.current < 1000 / MINI_MAP_HZ) return;
    lastMiniAt.current = now;
    setMiniProgress(progress);
  }, [progress]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        startLoop();
      },
      onPanResponderMove: (_, gestureState) => {
        const { dx, dy } = gestureState;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const clampedDist = Math.min(dist, MAX_DEFLECTION);
        const angle = Math.atan2(dy, dx);
        const targetX = clampedDist * Math.cos(angle);
        const targetY = clampedDist * Math.sin(angle);

        pan.setValue({ x: targetX, y: targetY });

        // Normalizacja do [-1, 1]
        // dy jest ujemne przy ruchu w górę (czyli Zoom +) -> odwracamy oś Y
        rateRef.current = {
          x: targetX / MAX_DEFLECTION,
          y: -targetY / MAX_DEFLECTION,
        };
      },
      onPanResponderRelease: () => {
        stopLoop();
        setMiniProgress(progressRef.current);
        Animated.spring(pan, {
          toValue: { x: 0, y: 0 },
          friction: 6,
          tension: 45,
          useNativeDriver: false,
        }).start();
      },
      onPanResponderTerminate: () => {
        stopLoop();
        setMiniProgress(progressRef.current);
        Animated.spring(pan, {
          toValue: { x: 0, y: 0 },
          friction: 6,
          tension: 45,
          useNativeDriver: false,
        }).start();
      },
    }),
  ).current;

  // Przeciąganie palcem po pasku postępu trasy. Wcześniej obsługiwane było
  // wyłącznie `onPress`, mimo że podpis pod sliderem obiecywał „przeciągnij” —
  // mapa przeskakiwała dopiero po puszczeniu palca i to w miejscu, gdzie
  // palec zaczął, a nie gdzie skończył.
  //
  // Szerokość paska i `onNavigate` idą przez refy, a nie z domknięcia. Dlaczego:
  // `PanResponder.create` w `useRef` powstaje raz i na zawsze trzyma funkcje z
  // pierwszego renderu, czyli sprzed `onLayout`. Bez refów `x` dzieliłby się
  // przez zapamiętane `trackWidth = 240` zamiast przez zmierzone — kursor nie
  // szedłby 1:1 za palcem, a w poziomie (szeroki pasek) nigdy nie doszedłby
  // do końca trasy, bo 100 % wypadałoby na 35 % szerokości.
  const trackWidthRef = useRef(trackWidth);
  trackWidthRef.current = trackWidth;
  const onNavigateRef = useRef(onNavigate);
  onNavigateRef.current = onNavigate;

  const seekTo = useCallback((x: number, duration: number) => {
    const w = trackWidthRef.current;
    if (w <= 0) return;
    const p = Math.max(0, Math.min(1, x / w));
    progressRef.current = p;
    onNavigateRef.current(p, zoomRef.current, duration);
  }, []);

  const trackPanResponder = useRef(
    PanResponder.create({
      // Przejmuje gest od razu, żeby już pierwszy ruch palca coś robił.
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => seekTo(e.nativeEvent.locationX, 90),
      onPanResponderMove: (e) => seekTo(e.nativeEvent.locationX, 0),
      onPanResponderTerminationRequest: () => false,
    }),
  ).current;

  // SeekBar dla TalkBacka: rola „adjustable” bez `accessibilityValue` i bez
  // `onAccessibilityAction` jest dla czytnika ekranu martwa.
  const handleTrackA11y = (delta: number) => {
    const next = Math.max(0, Math.min(1, progressRef.current + delta));
    progressRef.current = next;
    onNavigate(next, zoomRef.current, 160);
  };

  const handleTrackLayout = (e: LayoutChangeEvent) => {
    setTrackWidth(e.nativeEvent.layout.width);
  };

  const percent = Math.round(progress * 100);

  const ahead = useMemo(() => {
    if (!aheadStopName) return s.joystick.routeEnd;
    if (aheadStopDistanceM == null) return aheadStopName;
    return `${aheadStopName} · ${Math.round(aheadStopDistanceM)} m`;
  }, [aheadStopName, aheadStopDistanceM, s]);

  const userLabel =
    userDistanceM == null
      ? s.joystick.noGps
      : userDistanceM < 25
        ? s.joystick.onTrack
        : s.joystick.offTrack(Math.round(userDistanceM));

  return (
    <View style={styles.row}>
      {/* Pad = jednocześnie joystick i radar kierunkowy trasy */}
      <View style={styles.padWrap}>
        <RouteMiniMap
          coords={coords}
          progress={miniProgress}
          size={JOYSTICK_RADIUS * 2}
          user={user}
          vehicle={vehicle}
        />
        {/* Gałka leży na podglądzie, a nie obok niego. */}
        <View style={styles.puckLayer} {...panResponder.panHandlers}>
          <Animated.View
            style={[
              styles.puck,
              { transform: [{ translateX: pan.x }, { translateY: pan.y }] },
            ]}
          >
            <View style={styles.puckRing} />
            <View style={styles.puckCore} />
          </Animated.View>
        </View>
        {/* Podpowiedzi osi — tylko cztery strzałki, bez tekstu. */}
        <Text style={[styles.axisHint, styles.axisTop]}>▲</Text>
        <Text style={[styles.axisHint, styles.axisBottom]}>▼</Text>
        <Text style={[styles.axisHint, styles.axisLeft]}>◄</Text>
        <Text style={[styles.axisHint, styles.axisRight]}>►</Text>
      </View>

      <View style={styles.info}>
        <Text style={styles.aheadLabel} numberOfLines={1}>
          {s.joystick.nextUp(ahead)}
        </Text>
        <Text style={styles.metaLabel} numberOfLines={1}>
          {s.joystick.zoomUser(userLabel, zoom.toFixed(1))}
        </Text>

        <View style={styles.trackRow}>
          <Pressable
            onPress={onJumpStart}
            hitSlop={8}
            style={({ pressed }) => [styles.jumpBtn, pressed && styles.jumpBtnPressed]}
            accessibilityRole="button"
            accessibilityLabel={s.joystick.goStartA11y}
          >
            <SkipBack size={16} color={scheme.onSurface} />
          </Pressable>

          <View
            style={styles.trackHit}
            onLayout={handleTrackLayout}
            // `box-only`, żeby `locationX` zawsze liczył się względem paska.
            // Bez tego celem dotyku potrafi zostać wypełnienie albo uchwyt i
            // przy przeciąganiu po nich pozycja skacze o kilkanaście pikseli.
            pointerEvents="box-only"
            {...trackPanResponder.panHandlers}
            accessible
            accessibilityRole="adjustable"
            accessibilityLabel={s.joystick.progressA11y}
            accessibilityHint="Przeciągnij palcem albo użyj strzałek, aby przesunąć widok wzdłuż trasy"
            accessibilityValue={{ min: 0, max: 100, now: percent }}
            accessibilityActions={[
              { name: 'increment', label: 'Dalej wzdłuż trasy' },
              { name: 'decrement', label: 'Wstecz wzdłuż trasy' },
            ]}
            onAccessibilityAction={(e) => {
              if (e.nativeEvent.actionName === 'increment') handleTrackA11y(0.05);
              else if (e.nativeEvent.actionName === 'decrement') handleTrackA11y(-0.05);
            }}
          >
            <View style={styles.track}>
              <View style={[styles.trackFill, { width: `${percent}%` }]} />
              <View style={[styles.thumb, { left: `${percent}%` }]} />
            </View>
          </View>

          <Pressable
            onPress={onJumpFinish}
            hitSlop={8}
            style={({ pressed }) => [styles.jumpBtn, pressed && styles.jumpBtnPressed]}
            accessibilityRole="button"
            accessibilityLabel={s.joystick.goEndA11y}
          >
            <SkipForward size={16} color={scheme.onSurface} />
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  padWrap: {
    width: JOYSTICK_RADIUS * 2,
    height: JOYSTICK_RADIUS * 2,
    borderRadius: JOYSTICK_RADIUS,
    borderWidth: 1,
    borderColor: scheme.outlineVariant,
    overflow: 'hidden',
  },
  puckLayer: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
  },
  puck: {
    position: 'absolute',
    left: JOYSTICK_RADIUS - PUCK_RADIUS,
    top: JOYSTICK_RADIUS - PUCK_RADIUS,
    width: PUCK_RADIUS * 2,
    height: PUCK_RADIUS * 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  puckRing: {
    position: 'absolute',
    width: PUCK_RADIUS * 2,
    height: PUCK_RADIUS * 2,
    borderRadius: PUCK_RADIUS,
    borderWidth: 2,
    borderColor: scheme.primary,
    backgroundColor: 'rgba(17,20,20,0.35)',
  },
  puckCore: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: scheme.primary,
  },
  axisHint: {
    position: 'absolute',
    fontSize: 9,
    fontWeight: '700',
    color: scheme.onSurfaceVariant,
    opacity: 0.5,
  },
  axisTop: { top: 3, alignSelf: 'center' },
  axisBottom: { bottom: 3, alignSelf: 'center' },
  axisLeft: { left: 4, top: JOYSTICK_RADIUS - 6 },
  axisRight: { right: 4, top: JOYSTICK_RADIUS - 6 },
  info: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  aheadLabel: {
    ...type.labelLarge,
    fontWeight: '700',
    color: scheme.onSurface,
  },
  metaLabel: {
    ...type.labelSmall,
    color: scheme.onSurfaceVariant,
  },
  trackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
  },
  jumpBtn: {
    width: 40,
    height: 40,
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainerHighest,
    alignItems: 'center',
    justifyContent: 'center',
  },
  jumpBtnPressed: {
    opacity: 0.7,
  },
  // Cel dotyku szerszy niż widoczny pasek. `hitSlop` działa tylko na
  // `Pressable`, więc na gołym `View` był martwy — wcześniejszy `Pressable`
  // dawał ~28 px, a po zamianie na `View` zostało 8 px, czyli wąski pasek
  // pod palcem. 32 px mieści się w wierszu bez zmiany wysokości (przyciski
  // skokowe mają 40 px).
  trackHit: {
    flex: 1,
    height: 32,
    justifyContent: 'center',
  },
  track: {
    height: 8,
    backgroundColor: scheme.surfaceContainerLowest,
    borderRadius: 4,
    justifyContent: 'center',
  },
  trackFill: {
    height: '100%',
    backgroundColor: scheme.primary,
    borderRadius: 4,
  },
  thumb: {
    position: 'absolute',
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: scheme.primary,
    borderWidth: 2,
    borderColor: scheme.surfaceContainerHigh,
    marginLeft: -7,
  },
});
