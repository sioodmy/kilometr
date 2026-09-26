// Komponent wirtualnego joysticka do nawigacji po trasie.
//
// Oś X: przelot wzdłuż trasy (Start ◄──► Meta).
// Oś Y: przybliżanie i oddalanie mapy (Zoom + ▲ / Zoom − ▼).
//
// Zbudowany z użyciem czystego PanRespondera i Animated z React Native,
// ze sprężynowym powrotem do środka po zwolnieniu kciuka.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
} from 'react-native';
import { Maximize, X, ZoomIn, ZoomOut } from 'lucide-react-native';
import type { MapRoute } from '../map/types';
import { scheme, type } from '../theme/tokens';

const JOYSTICK_RADIUS = 56;
const PUCK_RADIUS = 24;
const MAX_DEFLECTION = JOYSTICK_RADIUS - 12; // 44px
const DEADZONE = 0.08;

export interface RouteJoystickProps {
  route: MapRoute;
  progress: number;
  zoom: number;
  nearestStopName?: string;
  currentLegLine?: string;
  currentLegMode?: string;
  onNavigate: (progress: number, zoom: number, duration?: number) => void;
  onJumpStart: () => void;
  onJumpFinish: () => void;
  onFit: () => void;
  onClose: () => void;
}

export function RouteJoystick({
  route,
  progress,
  zoom,
  nearestStopName,
  currentLegLine,
  currentLegMode,
  onNavigate,
  onJumpStart,
  onJumpFinish,
  onFit,
  onClose,
}: RouteJoystickProps) {
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
        Animated.spring(pan, {
          toValue: { x: 0, y: 0 },
          friction: 6,
          tension: 45,
          useNativeDriver: false,
        }).start();
      },
      onPanResponderTerminate: () => {
        stopLoop();
        Animated.spring(pan, {
          toValue: { x: 0, y: 0 },
          friction: 6,
          tension: 45,
          useNativeDriver: false,
        }).start();
      },
    }),
  ).current;

  // Bezpośrednie kliknięcie / przeciągnięcie po pasku postępu trasy
  const handleTrackTouch = (e: GestureResponderEvent) => {
    const x = e.nativeEvent.locationX;
    if (trackWidth > 0) {
      const p = Math.max(0, Math.min(1, x / trackWidth));
      onNavigate(p, zoomRef.current, 300);
    }
  };

  const handleTrackLayout = (e: LayoutChangeEvent) => {
    setTrackWidth(e.nativeEvent.layout.width);
  };

  const percent = Math.round(progress * 100);

  return (
    <View style={styles.card}>
      {/* Nagłówek: postęp trasy i zamknięcie */}
      <View style={styles.header}>
        <View style={styles.titleWrap}>
          <Text style={styles.badgeText}>🕹️ Nawigacja trasą</Text>
          <Text style={styles.percentText}>{percent}%</Text>
        </View>
        <Pressable
          onPress={onClose}
          hitSlop={10}
          style={({ pressed }) => [styles.closeBtn, pressed && { opacity: 0.7 }]}
          accessibilityRole="button"
          accessibilityLabel="Zamknij sterowanie joystickiem"
        >
          <X size={18} color={scheme.onSurfaceVariant} />
        </Pressable>
      </View>

      {/* Info o bieżącej lokalizacji na trasie */}
      <View style={styles.statusRow}>
        <Text style={styles.statusText} numberOfLines={1}>
          {nearestStopName ? `📍 ${nearestStopName}` : `${route.fromTitle} → ${route.toTitle}`}
          {currentLegLine ? ` • Linia ${currentLegLine}` : ''}
        </Text>
        <Text style={styles.zoomPill}>Zoom {zoom.toFixed(1)}x</Text>
      </View>

      {/* Oś trasy (interaktywny suwak start -> meta) */}
      <View style={styles.scrubberSection}>
        <View style={styles.scrubberLabels}>
          <Text style={styles.scrubberLabel} numberOfLines={1}>
            {route.fromTitle}
          </Text>
          <Text style={[styles.scrubberLabel, styles.scrubberLabelEnd]} numberOfLines={1}>
            {route.toTitle}
          </Text>
        </View>

        <Pressable
          style={styles.track}
          onLayout={handleTrackLayout}
          onPress={handleTrackTouch}
          hitSlop={{ top: 8, bottom: 8 }}
          accessibilityRole="adjustable"
          accessibilityLabel="Oś postępu trasy"
        >
          <View style={[styles.trackFill, { width: `${percent}%` }]} />
          <View style={[styles.thumb, { left: `${percent}%` }]} />
        </Pressable>
      </View>

      {/* Główny pad 2D joysticka */}
      <View style={styles.joystickArea}>
        <View style={styles.joystickOuter}>
          {/* Etykiety osi */}
          <Text style={[styles.axisLabel, styles.axisTop]}>▲ Zoom +</Text>
          <Text style={[styles.axisLabel, styles.axisBottom]}>▼ Zoom −</Text>
          <Text style={[styles.axisLabel, styles.axisLeft]}>◄ Start</Text>
          <Text style={[styles.axisLabel, styles.axisRight]}>Meta ►</Text>

          {/* Linie celownika osi X / Y */}
          <View style={styles.crosshairH} />
          <View style={styles.crosshairV} />

          {/* Ruchoma gałka joysticka */}
          <Animated.View
            style={[
              styles.puck,
              {
                transform: [{ translateX: pan.x }, { translateY: pan.y }],
              },
            ]}
            {...panResponder.panHandlers}
          >
            <View style={styles.puckCenter} />
          </Animated.View>
        </View>
      </View>

      {/* Dolny pasek szybkich akcji */}
      <View style={styles.actionsRow}>
        <Pressable
          onPress={onJumpStart}
          style={({ pressed }) => [styles.actionBtn, pressed && styles.actionBtnPressed]}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel="Przejdź do startu trasy"
        >
          <Text style={styles.actionBtnText}>Początek</Text>
        </Pressable>

        <Pressable
          onPress={onFit}
          style={({ pressed }) => [styles.actionBtn, styles.actionBtnAccent, pressed && styles.actionBtnPressed]}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel="Dopasuj widok do całej trasy"
        >
          <Maximize size={14} color={scheme.onPrimaryContainer} />
          <Text style={[styles.actionBtnText, styles.actionBtnAccentText]}>Dopasuj</Text>
        </Pressable>

        <Pressable
          onPress={onJumpFinish}
          style={({ pressed }) => [styles.actionBtn, pressed && styles.actionBtnPressed]}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel="Przejdź do końca trasy"
        >
          <Text style={styles.actionBtnText}>Koniec</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: scheme.surfaceContainerHigh,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: scheme.outlineVariant,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  titleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  badgeText: {
    ...type.labelMedium,
    color: scheme.primary,
    fontWeight: '700',
  },
  percentText: {
    ...type.labelSmall,
    color: scheme.onSurfaceVariant,
    fontVariant: ['tabular-nums'],
    fontWeight: '800',
    backgroundColor: scheme.surfaceContainerHighest,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 6,
  },
  closeBtn: {
    padding: 4,
    borderRadius: 999,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 8,
  },
  statusText: {
    ...type.bodySmall,
    color: scheme.onSurface,
    fontWeight: '600',
    flex: 1,
  },
  zoomPill: {
    ...type.labelSmall,
    color: scheme.onTertiaryContainer,
    backgroundColor: scheme.tertiaryContainer,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    fontVariant: ['tabular-nums'],
    fontWeight: '700',
  },
  scrubberSection: {
    marginBottom: 10,
  },
  scrubberLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  scrubberLabel: {
    ...type.labelSmall,
    color: scheme.onSurfaceVariant,
    fontSize: 10,
    maxWidth: '48%',
  },
  scrubberLabelEnd: {
    textAlign: 'right',
  },
  track: {
    height: 8,
    backgroundColor: scheme.surfaceContainerLowest,
    borderRadius: 4,
    justifyContent: 'center',
    overflow: 'visible',
    position: 'relative',
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
    borderColor: scheme.surface,
    marginLeft: -7,
  },
  joystickArea: {
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 4,
  },
  joystickOuter: {
    width: JOYSTICK_RADIUS * 2,
    height: JOYSTICK_RADIUS * 2,
    borderRadius: JOYSTICK_RADIUS,
    backgroundColor: scheme.surfaceContainerLowest,
    borderWidth: 1.5,
    borderColor: scheme.outlineVariant,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  crosshairH: {
    position: 'absolute',
    left: 8,
    right: 8,
    height: 1,
    backgroundColor: scheme.outlineVariant,
    opacity: 0.4,
  },
  crosshairV: {
    position: 'absolute',
    top: 8,
    bottom: 8,
    width: 1,
    backgroundColor: scheme.outlineVariant,
    opacity: 0.4,
  },
  axisLabel: {
    position: 'absolute',
    ...type.labelSmall,
    fontSize: 9,
    fontWeight: '700',
    color: scheme.onSurfaceVariant,
    opacity: 0.85,
  },
  axisTop: {
    top: 4,
  },
  axisBottom: {
    bottom: 4,
  },
  axisLeft: {
    left: 6,
  },
  axisRight: {
    right: 6,
  },
  puck: {
    width: PUCK_RADIUS * 2,
    height: PUCK_RADIUS * 2,
    borderRadius: PUCK_RADIUS,
    backgroundColor: scheme.secondaryContainer,
    borderWidth: 2,
    borderColor: scheme.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: scheme.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 6,
    elevation: 4,
  },
  puckCenter: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: scheme.primary,
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginTop: 8,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 7,
    borderRadius: 12,
    backgroundColor: scheme.surfaceContainerHighest,
  },
  actionBtnPressed: {
    opacity: 0.7,
  },
  actionBtnAccent: {
    backgroundColor: scheme.primaryContainer,
  },
  actionBtnText: {
    ...type.labelMedium,
    color: scheme.onSurface,
    fontWeight: '700',
  },
  actionBtnAccentText: {
    color: scheme.onPrimaryContainer,
  },
});
