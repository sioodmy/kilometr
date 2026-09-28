import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as Location from 'expo-location';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import {
  BusFront,
  LocateFixed,
  Map as MapIcon,
  Navigation2,
  Signpost,
  TramFront,
} from 'lucide-react-native';
import { elev, scheme, shape, type } from '../theme/tokens';
import type { Connection, Leg } from '../types/models';
import { getLineColors, inferTransitMode, LineBadge } from './LineBadge';
import { useWalkSpeedMps, walkMinutesFor } from '../services/settings';

interface StopCompassCardProps {
  connection: Connection;
  /** Otwiera ekran „Mapa trasy” — przycisk siedzi tuż przy radarze. */
  onOpenMap?: () => void;
}

function calculateDistanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371e3; // Promień Ziemi w metrach
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

function calculateBearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  const θ = Math.atan2(y, x);
  return ((θ * 180) / Math.PI + 360) % 360;
}

function getDirectionLabel(relAngle: number): string {
  if (relAngle <= 20 || relAngle >= 340) return 'Prosto przed Tobą';
  if (relAngle < 70) return 'Lekko w prawo';
  if (relAngle <= 110) return 'Po Twojej prawej';
  if (relAngle < 160) return 'Za Tobą z prawej';
  if (relAngle <= 200) return 'Za Twoimi plecami';
  if (relAngle < 250) return 'Za Tobą z lewej';
  if (relAngle <= 290) return 'Po Twojej lewej';
  return 'Lekko w lewo';
}

export function StopCompassCard({ connection, onOpenMap }: StopCompassCardProps) {
  // Czas dojścia liczony z tempem chodzenia ustawionym przez użytkownika,
  // a nie z wpisanych na sztywno 80 m/min.
  const walkMps = useWalkSpeedMps();
  // Znajdź etapy podróży
  const transitLegs = useMemo(() => {
    return connection.legs.filter((l) => l.mode !== 'walk');
  }, [connection.legs]);

  const [selectedLegIdx, setSelectedLegIdx] = useState(0);

  const activeLeg: Leg | undefined = transitLegs[selectedLegIdx] || connection.legs[0];

  // Pobierz współrzędne konkretnego słupka/peronu
  const targetLat = activeLeg?.fromLat ?? (activeLeg?.toLat != null ? activeLeg.toLat : undefined);
  const targetLon = activeLeg?.fromLon ?? (activeLeg?.toLon != null ? activeLeg.toLon : undefined);
  const stopName = activeLeg?.fromStop || connection.fromTitle;
  const platform = activeLeg?.platformCode;

  const resolvedMode = inferTransitMode(activeLeg?.mode, activeLeg?.line);
  const { bg: lineAccent, fg: lineFg } = getLineColors(activeLeg?.line, activeLeg?.mode);
  const TargetIcon = resolvedMode === 'tram' ? TramFront : resolvedMode === 'bus' ? BusFront : Signpost;

  const [userLocation, setUserLocation] = useState<{ lat: number; lon: number } | null>(null);
  // Stan namierzania: bez niego „Namierzam…” wisiałoby w nieskończoność
  // (brak fixa GPS, wyłączona lokalizacja, środek budynku).
  const [locState, setLocState] = useState<'seeking' | 'ok' | 'denied' | 'noFix'>('seeking');
  // Filtrowany kurs urządzenia (stopnie). Surowy magnetometr skacze ±10° —
  // wygładzamy low-pass na wektorze + histereza 2°, żeby kompas nie migotał.
  const [deviceHeading, setDeviceHeading] = useState<number>(0);
  const animAngle = useSharedValue(0);
  const headingVec = useRef<{ x: number; y: number } | null>(null);
  const lastAppliedHeading = useRef(0);
  const lastLoc = useRef<{ lat: number; lon: number } | null>(null);

  useEffect(() => {
    let locSub: Location.LocationSubscription | null = null;
    let headingSub: Location.LocationSubscription | null = null;
    let isMounted = true;

    const HEADING_ALPHA = 0.12; // siła wygładzania kursu
    const HEADING_HYSTERESIS_DEG = 2; // poniżej tego progu ignoruj zmianę
    const MIN_MOVE_M = 4; // poniżej tego dystansu ignoruj ruch GPS

    function applyHeading(rawDeg: number) {
      if (!isMounted) return;
      const rad = (rawDeg * Math.PI) / 180;
      const vx = Math.sin(rad);
      const vy = Math.cos(rad);
      const prev = headingVec.current;
      const sx = prev ? prev.x + (vx - prev.x) * HEADING_ALPHA : vx;
      const sy = prev ? prev.y + (vy - prev.y) * HEADING_ALPHA : vy;
      headingVec.current = { x: sx, y: sy };
      let deg = (Math.atan2(sx, sy) * 180) / Math.PI;
      deg = ((deg % 360) + 360) % 360;
      let diff = Math.abs(deg - lastAppliedHeading.current) % 360;
      if (diff > 180) diff = 360 - diff;
      if (diff >= HEADING_HYSTERESIS_DEG) {
        lastAppliedHeading.current = deg;
        setDeviceHeading(deg);
      }
    }

    async function startTracking() {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (!isMounted) return;
        if (status !== 'granted') {
          setLocState('denied');
          return;
        }

        locSub = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.Balanced,
            timeInterval: 2000,
            distanceInterval: MIN_MOVE_M,
          },
          (loc) => {
            if (!isMounted) return;
            const next = { lat: loc.coords.latitude, lon: loc.coords.longitude };
            const prev = lastLoc.current;
            if (prev) {
              const moved = calculateDistanceMeters(prev.lat, prev.lon, next.lat, next.lon);
              if (moved < MIN_MOVE_M) return; // szum GPS — nie ruszaj UI
            }
            lastLoc.current = next;
            setUserLocation(next);
            setLocState('ok');
          }
        );

        headingSub = await Location.watchHeadingAsync((h) => {
          if (!isMounted) return;
          const trueH = h.trueHeading >= 0 ? h.trueHeading : h.magHeading;
          if (trueH >= 0) {
            applyHeading(trueH);
          }
        });
      } catch (err) {
        console.log('[StopCompassCard] Tracking error:', err);
        if (isMounted) setLocState('noFix');
      }
    }

    startTracking();

    // Po 8 s bez fixu przestajemy udawać, że czekamy — pokazujemy realny stan.
    const noFixTimer = setTimeout(() => {
      if (isMounted) setLocState((s) => (s === 'seeking' ? 'noFix' : s));
    }, 8000);

    return () => {
      isMounted = false;
      clearTimeout(noFixTimer);
      locSub?.remove();
      headingSub?.remove();
    };
  }, []);

  const { distanceM, relativeAngle } = useMemo(() => {
    if (!userLocation || targetLat == null || targetLon == null) {
      return { distanceM: null, relativeAngle: 0 };
    }

    const dist = calculateDistanceMeters(
      userLocation.lat,
      userLocation.lon,
      targetLat,
      targetLon
    );
    const bearing = calculateBearing(
      userLocation.lat,
      userLocation.lon,
      targetLat,
      targetLon
    );
    const rel = (bearing - deviceHeading + 360) % 360;

    // Zaokrąglij do 5 m — tekst dystansu nie skacze przy szumie GPS
    return { distanceM: Math.round(dist / 5) * 5, relativeAngle: rel };
  }, [userLocation, targetLat, targetLon, deviceHeading]);

  // Płynny obrót wskazówki najkrótszą drogą (bez pełnych obrotów przy 359°→0°)
  const pointerStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${animAngle.value}deg` }],
  }));

  // Kontra-obrót ikonki, żeby stała prosto niezależnie od kursu
  const counterStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${-animAngle.value}deg` }],
  }));

  useEffect(() => {
    const cur = animAngle.value % 360;
    const delta = ((relativeAngle - cur + 540) % 360) - 180;
    animAngle.value = withTiming(cur + delta, { duration: 280 });
  }, [animAngle, relativeAngle]);

  const handleOpenOrganicMaps = async () => {
    if (targetLat == null || targetLon == null) return;
    const label = `${stopName}${platform ? ` ${platform}` : ''}`;
    const omUrl = `om://maps?sll=${targetLat},${targetLon}&q=${encodeURIComponent(label)}`;
    const geoUrl = `geo:${targetLat},${targetLon}?q=${targetLat},${targetLon}(${encodeURIComponent(label)})`;
    const osmUrl = `https://www.openstreetmap.org/directions?to=${targetLat}%2C${targetLon}`;

    try {
      const canOm = await Linking.canOpenURL('om://');
      if (canOm) {
        await Linking.openURL(omUrl);
        return;
      }
    } catch (_) {}

    try {
      const canGeo = await Linking.canOpenURL(geoUrl);
      if (canGeo) {
        await Linking.openURL(geoUrl);
        return;
      }
    } catch (_) {}

    await Linking.openURL(osmUrl);
  };

  const hasTarget = targetLat != null && targetLon != null;
  // Kompas ma sens tylko z fixem GPS ORAZ współrzędnymi przystanku.
  const compassReady = hasTarget && distanceM != null;

  const compassHint = !hasTarget
    ? 'Ten przystanek nie ma współrzędnych w rozkładzie.'
    : locState === 'denied'
      ? 'Lokalizacja jest wyłączona — bez niej nie pokażę kierunku do przystanku.'
      : // Nagłówek karty już mówi „Brak pozycji GPS”, więc dolna linia tylko
        // podpowiada wyjście — jedno, krótkie zdanie zamiast trzech.
        'Kierunek i odległość pokażę, gdy znajdę sygnał GPS.';

  const walkMin = distanceM != null ? walkMinutesFor(distanceM, walkMps) : null;
  const directionLabel = compassReady ? getDirectionLabel(relativeAngle) : compassHint;

  // Bez fixa GPS nie ma kompasu, więc podpis „Kieruj się według kompasu” jest
  // obietnicą, której karta nie spełnia. W zamian mówi wprost, czego brakuje,
  // a wyjaśnienie u dołu zostaje jednolinijkowe — na ekranie w tramwaju
  // liczy się każda linia pionu.
  const noFix = !compassReady && locState !== 'denied' && hasTarget;

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={styles.cardHeaderIcon}>
          <Navigation2 size={18} color={scheme.primary} />
        </View>
        <View style={styles.cardHeaderText}>
          <Text style={styles.cardTitle}>Lokalizacja przystanku</Text>
          <Text style={styles.cardSubtitle} numberOfLines={1}>
            {noFix ? 'Brak pozycji GPS' : 'Kieruj się według kompasu'}
          </Text>
        </View>
      </View>
      
      {/* Przełącznik etapów podróży */}
      {transitLegs.length > 1 && (
        <View style={styles.tabsSection}>
          <Text style={styles.sectionLabel}>Wybierz przesiadkę:</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            overScrollMode="never"
            contentContainerStyle={styles.legTabs}
          >
            {transitLegs.map((leg, idx) => {
              const active = idx === selectedLegIdx;
              return (
                <Pressable
                  key={leg.id}
                  onPress={() => setSelectedLegIdx(idx)}
                  style={({ pressed }) => [
                    styles.legTab,
                    active && styles.legTabActive,
                    pressed && { opacity: 0.7, transform: [{ scale: 0.97 }] }
                  ]}
                >
                  <LineBadge mode={leg.mode} line={leg.line} />
                  <Text
                    style={[styles.legTabText, active && styles.legTabTextActive]}
                    numberOfLines={1}
                  >
                    {leg.fromStop}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      )}

      {/* Wybrany przystanek i słupek */}
      <View style={styles.stopInfo}>
        <View style={styles.badgeRow}>
          {activeLeg && <LineBadge mode={activeLeg.mode} line={activeLeg.line} />}
          {activeLeg?.direction && (
            <Text style={styles.directionText} numberOfLines={1}>
              kierunek {activeLeg.direction}
            </Text>
          )}
        </View>
        <Text style={styles.stopName}>{stopName}</Text>
        {platform ? (
          <View style={styles.platformBadge}>
            <Text style={styles.platformText}>{platform}</Text>
          </View>
        ) : null}
      </View>

      {/* Radar nawigujący w stronę przystanku + odległość */}
      {compassReady ? (
        <View style={styles.compassRow}>
          <View style={styles.dialContainer}>
            <View style={styles.dial}>
              {/* Wewnętrzny okrąg radaru */}
              <View style={styles.innerRing} />
              <View style={styles.crosshairV} />
              <View style={styles.crosshairH} />

              {/* Warstwa nawigacyjna obracana w stronę przystanku */}
              <Animated.View style={[styles.pointerContainer, pointerStyle]}>
                {/* Promień w stronę przystanku */}
                <View style={[styles.pointerBeam, { backgroundColor: lineAccent }]} />

                {/* Ikonka przystanku/pojazdu wskazująca dokładne położenie peronu */}
                <View style={[styles.stopTargetBadge, { backgroundColor: lineAccent }]}>
                  <Animated.View style={counterStyle}>
                    <TargetIcon size={16} color={lineFg} />
                  </Animated.View>
                </View>
              </Animated.View>

              {/* Punkt użytkownika w centrum (Twoja pozycja) */}
              <View style={styles.userPulse}>
                <View style={styles.userDot} />
              </View>
            </View>
          </View>

          {/* Dane odległości i wskazówka kierunku */}
          <View style={styles.distanceInfo}>
            <Text style={styles.directionGuide}>{directionLabel}</Text>
            <Text style={styles.distanceNumber}>
              {distanceM! >= 1000 ? `${(distanceM! / 1000).toFixed(1)} km` : `${distanceM} m`}
            </Text>
            <Text style={styles.distanceLabel} numberOfLines={1}>
              w linii prostej
            </Text>
            {walkMin != null && (
              <View style={styles.walkBadge}>
                <Text style={styles.walkEst}>~{walkMin} min pieszo</Text>
              </View>
            )}
          </View>
        </View>
      ) : (
        /* Bez fixu GPS kompas tylko by mylił — zostaje powód i wyjście z kartki. */
        <View style={styles.hintRow}>
          <LocateFixed size={18} color={scheme.onSurfaceVariant} />
          <Text style={styles.hintText}>{directionLabel}</Text>
        </View>
      )}

      {locState === 'denied' && hasTarget && (
        <Pressable
          onPress={() => void Linking.openSettings()}
          style={({ pressed }) => [styles.settingsBtn, pressed && { opacity: 0.8 }]}
          accessibilityRole="button"
          accessibilityLabel="Otwórz ustawienia aplikacji"
        >
          <Text style={styles.settingsBtnText}>Włącz lokalizację w ustawieniach</Text>
        </Pressable>
      )}

      {/* Akcje na dole karty: mapa trasy i nawigacja zewnętrzna stoją
          tuż pod radarem, w zasięgu kciuka — nie trzeba sięgać na górę. */}
      <View style={styles.actionRow}>
        {onOpenMap ? (
          <Pressable
            onPress={onOpenMap}
            style={({ pressed }) => [styles.mapBtn, pressed && { opacity: 0.85 }]}
            accessibilityRole="button"
            accessibilityLabel="Pokaż trasę na mapie"
          >
            <MapIcon size={18} color={scheme.onPrimary} />
            <Text style={styles.mapBtnText}>Mapa trasy</Text>
          </Pressable>
        ) : null}
        <Pressable
          onPress={handleOpenOrganicMaps}
          style={({ pressed }) => [
            styles.navBtn,
            !onOpenMap && styles.navBtnSolo,
            pressed && { opacity: 0.85 },
          ]}
          accessibilityRole="button"
          accessibilityLabel="Nawiguj do przystanku w Organic Maps"
        >
          <Navigation2
            size={18}
            color={onOpenMap ? scheme.onSecondaryContainer : scheme.onPrimary}
          />
          <Text
            style={[
              styles.navBtnText,
              !onOpenMap && styles.navBtnTextSolo,
            ]}
          >
            Nawiguj
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: scheme.surfaceContainerHigh,
    borderRadius: shape.large,
    padding: 16,
    gap: 12,
    ...elev.level2,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 4,
  },
  cardHeaderIcon: {
    width: 36,
    height: 36,
    borderRadius: shape.full,
    backgroundColor: scheme.secondaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitle: {
    ...type.titleMedium,
    fontWeight: '700',
    color: scheme.onSurface,
  },
  cardHeaderText: { flex: 1, minWidth: 0 },
  cardSubtitle: {
    ...type.labelMedium,
    color: scheme.onSurfaceVariant,
  },
  tabsSection: {
    gap: 6,
    marginTop: 4,
  },
  sectionLabel: {
    ...type.labelSmall,
    color: scheme.onSurfaceVariant,
    fontWeight: '600',
    marginBottom: 2,
  },
  legTabs: {
    flexDirection: 'row',
    gap: 8,
    paddingRight: 4,
  },
  legTab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: shape.small,
    backgroundColor: scheme.surfaceContainerHighest,
    flexShrink: 0,
  },
  legTabActive: {
    backgroundColor: scheme.secondaryContainer,
    borderColor: scheme.primary,
    borderWidth: 1,
  },
  legTabText: {
    ...type.labelSmall,
    color: scheme.onSurfaceVariant,
    maxWidth: 120,
  },
  legTabTextActive: {
    color: scheme.onSecondaryContainer,
    fontWeight: '700',
  },
  stopInfo: {
    gap: 6,
    backgroundColor: scheme.surfaceContainerHighest,
    borderRadius: shape.medium,
    padding: 12,
    marginTop: 4,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  directionText: {
    ...type.labelMedium,
    color: scheme.onSurfaceVariant,
    flexShrink: 1,
  },
  stopName: {
    ...type.titleMedium,
    fontWeight: '700',
    color: scheme.onSurface,
    marginTop: 4,
  },
  platformBadge: {
    alignSelf: 'flex-start',
    backgroundColor: scheme.secondaryContainer,
    borderRadius: shape.small,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginTop: 2,
  },
  platformText: {
    ...type.labelSmall,
    color: scheme.primary,
    fontWeight: '600',
  },
  compassRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
    gap: 16,
  },
  dialContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  dial: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: scheme.surfaceContainerHighest,
    borderWidth: 1.5,
    borderColor: scheme.outlineVariant,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    overflow: 'hidden',
  },
  innerRing: {
    position: 'absolute',
    width: 68,
    height: 68,
    borderRadius: 34,
    borderWidth: 1,
    borderColor: scheme.outlineVariant,
    opacity: 0.6,
  },
  crosshairV: {
    position: 'absolute',
    width: 1,
    height: '100%',
    backgroundColor: scheme.outlineVariant,
    opacity: 0.35,
  },
  crosshairH: {
    position: 'absolute',
    height: 1,
    width: '100%',
    backgroundColor: scheme.outlineVariant,
    opacity: 0.35,
  },
  pointerContainer: {
    position: 'absolute',
    width: 120,
    height: 120,
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  pointerBeam: {
    position: 'absolute',
    top: 26,
    width: 2.5,
    height: 34,
    borderRadius: 2,
    opacity: 0.75,
  },
  stopTargetBadge: {
    position: 'absolute',
    top: 4,
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: scheme.surface,
    ...elev.level1,
  },
  userPulse: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(0, 168, 132, 0.25)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  userDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: scheme.primary,
  },
  distanceInfo: {
    flex: 1,
    gap: 3,
    alignItems: 'flex-start',
  },
  hintRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: 12,
    borderRadius: shape.medium,
    backgroundColor: scheme.surfaceContainerHighest,
  },
  hintText: {
    ...type.bodyMedium,
    color: scheme.onSurfaceVariant,
    flex: 1,
    lineHeight: 19,
  },
  settingsBtn: {
    alignSelf: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: shape.full,
    backgroundColor: scheme.secondaryContainer,
  },
  settingsBtnText: {
    ...type.labelLarge,
    color: scheme.onSecondaryContainer,
    fontWeight: '600',
  },
  directionGuide: {
    ...type.labelMedium,
    color: scheme.primary,
    fontWeight: '700',
  },
  distanceNumber: {
    ...type.displaySmall,
    fontWeight: '800',
    color: scheme.onSurface,
  },
  distanceLabel: {
    ...type.bodySmall,
    color: scheme.onSurfaceVariant,
  },
  walkBadge: {
    backgroundColor: scheme.secondaryContainer,
    borderRadius: shape.small,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginTop: 2,
  },
  walkEst: {
    ...type.labelSmall,
    color: scheme.onSecondaryContainer,
    fontWeight: '600',
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 2,
  },
  mapBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: scheme.primary,
    borderRadius: shape.full,
    height: 48,
    ...elev.level1,
  },
  mapBtnText: {
    ...type.labelLarge,
    fontWeight: '700',
    color: scheme.onPrimary,
  },
  navBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: scheme.secondaryContainer,
    borderRadius: shape.full,
    height: 48,
  },
  navBtnSolo: {
    backgroundColor: scheme.primary,
  },
  navBtnText: {
    ...type.labelLarge,
    fontWeight: '700',
    color: scheme.onSecondaryContainer,
  },
  navBtnTextSolo: {
    color: scheme.onPrimary,
  },
});
