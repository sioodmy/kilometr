// Nawigacja na karcie połączenia: mini-mapka z trasą wyznaczoną po
// chodnikach + instrukcja następnego manewru.
//
// Radar sprzed tego mieścił w sobie tylko „w którą stronę jest przystanek”.
// Teraz, gdy noga piesza ma prawdziwą geometrię ulic, pokazujemy to, co
// człowiek musi zrobić: skręt, odległość i dokąd dojść. Przyciski „Mapa
// trasy” i „Nawiguj” zastąpiła cała karta: dotknięcie miniapki otwiera
// pełną mapę.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as Location from 'expo-location';
import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpLeft,
  ArrowUpRight,
  BusFront,
  CornerDownLeft,
  CornerDownRight,
  CornerUpLeft,
  CornerUpRight,
  Footprints,
  LocateFixed,
  MapPinned,
  Navigation2,
  RotateCcw,
  Signpost,
  TramFront,
  TrainFront,
} from 'lucide-react-native';
import { elev, scheme, shape, type } from '../theme/tokens';
import type { Connection } from '../types/models';
import { getLineColors, inferTransitMode, LineBadge } from './LineBadge';
import { useWalkSpeedMps, walkMinutesFor } from '../services/settings';

import { useStrings, type Strings } from '../i18n';
import { NavMiniMap } from './NavMiniMap';
import { buildMapRoute, fetchLegGeometry, type Coord } from '../services/routeGeometry';
import {
  buildRoutePath,
  nextGuidance,
  nextGuidanceAfter,
  type Guidance,
  type ManeuverKind,
} from '../services/turnManeuver';

interface StopCompassCardProps {
  connection: Connection;
  /** Otwiera ekran „Mapa trasy”. Cała karta jest w tym celu klikalna. */
  onOpenMap?: () => void;
}

/** Poniżej tej odległości do przystanku radar był czytelniejszy niż mapa. */
const COMPASS_ONLY_M = 100;
/**
 * Fixy gorsze niż to odrzucamy: GPS w budynku kłamie o kilkadziesiąt metrów.
 */
const MAX_ACCURACY_M = 60;
/**
 * Dalej niż to od trasy nie prowadzimy po manewrach. Rzut na linię i tak
 * coś znajdzie, ale to będzie przypadkowy punkt: „wysiadaj 5,4 km” stojąc
 * 4 km od trasy jest kłamstwem, które gorsze od braku instrukcji.
 */
const OFF_ROUTE_M = 45;

function calculateDistanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371e3;
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
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function getDirectionLabel(relAngle: number, s: Strings): string {
  if (relAngle <= 20 || relAngle >= 340) return s.compass.ahead;
  if (relAngle < 70) return s.compass.slightRight;
  if (relAngle <= 110) return s.compass.right;
  if (relAngle < 160) return s.compass.backRight;
  if (relAngle <= 200) return s.compass.back;
  if (relAngle < 250) return s.compass.backLeft;
  if (relAngle <= 290) return s.compass.left;
  return s.compass.slightLeft;
}

/** Ikona manewru: kierunek skrętu albo środek transportu przy wsiadaniu. */
function maneuverIcon(kind: ManeuverKind) {
  switch (kind) {
    case 'straight':
    case 'depart':
      return ArrowUp;
    case 'slightLeft':
      return ArrowUpLeft;
    case 'slightRight':
      return ArrowUpRight;
    case 'left':
      return CornerUpLeft;
    case 'right':
      return CornerUpRight;
    case 'sharpLeft':
      return CornerDownLeft;
    case 'sharpRight':
      return CornerDownRight;
    case 'uturn':
      return RotateCcw;
    case 'arrive':
      return MapPinned;
    default:
      return CornerUpRight;
  }
}

function legIcon(mode: string, line?: string) {
  const m = inferTransitMode(mode as never, line);
  if (m === 'tram') return TramFront;
  if (m === 'bus') return BusFront;
  if (m === 'train') return TrainFront;
  return Signpost;
}

function normalizeAngle(a: number): number {
  return ((a % 360) + 360) % 360;
}

export function StopCompassCard({ connection, onOpenMap }: StopCompassCardProps) {
  const s = useStrings();
  // Czas dojścia liczony z tempa wybranego profilu w ustawieniach.
  const walkMps = useWalkSpeedMps();
  // Znajdź etapy podróży
  const transitLegs = useMemo(() => {
    return connection.legs.filter((l) => l.mode !== 'walk');
  }, [connection.legs]);

  const [selectedLegIdx, setSelectedLegIdx] = useState(0);

  const activeLeg = transitLegs[selectedLegIdx] || connection.legs[0];

  const targetLat = activeLeg?.fromLat ?? (activeLeg?.toLat != null ? activeLeg.toLat : undefined);
  const targetLon = activeLeg?.fromLon ?? (activeLeg?.toLon != null ? activeLeg.toLon : undefined);
  const stopName = activeLeg?.fromStop || connection.fromTitle;
  const platform = activeLeg?.platformCode;

  const resolvedMode = inferTransitMode(activeLeg?.mode, activeLeg?.line);
  const { bg: lineAccent, fg: lineFg } = getLineColors(activeLeg?.line, activeLeg?.mode);
  const TargetIcon = legIcon(activeLeg?.mode ?? 'walk', activeLeg?.line);

  const [userLocation, setUserLocation] = useState<{ lat: number; lon: number } | null>(null);
  const [locState, setLocState] = useState<'seeking' | 'ok' | 'denied' | 'noFix'>('seeking');
  const [deviceHeading, setDeviceHeading] = useState<number | null>(null);
  // Filtrowany kurs urządzenia (stopnie). Surowy magnetometr skacze ±10°,
  // wygładzamy low-pass na wektorze + histereza, żeby kompas nie migotał.
  const headingVec = useRef<{ x: number; y: number } | null>(null);
  const lastAppliedHeading = useRef(0);
  const lastLoc = useRef<{ lat: number; lon: number } | null>(null);

  useEffect(() => {
    let locSub: Location.LocationSubscription | null = null;
    let headingSub: Location.LocationSubscription | null = null;
    let isMounted = true;

    const HEADING_ALPHA = 0.12;
    const HEADING_HYSTERESIS_DEG = 2;
    const MIN_MOVE_M = 4;
    // Ten efekt NIE może zależeć od deviceHeading: applyHeading ustawia ten
    // stan, więc zależność od niego kasowała i odtwarzała subskrypcję GPS przy
    // każdej zmianie kursu, czyli praktycznie non stop w ruchu. Efektem było
    // „nie mam jeszcze Twojej pozycji", mimo działającego GPS.
    // Fakt, że mamy kurs urządzenia, trzymamy w ref-ie.
    const hasDeviceHeading = { current: false };
    let hasFix = false;

    function applyHeading(rawDeg: number) {
      if (!isMounted) return;
      const rad = (rawDeg * Math.PI) / 180;
      const vx = Math.sin(rad);
      const vy = Math.cos(rad);
      const prev = headingVec.current;
      const sx = prev ? prev.x + (vx - prev.x) * HEADING_ALPHA : vx;
      const sy = prev ? prev.y + (vy - prev.y) * HEADING_ALPHA : vy;
      headingVec.current = { x: sx, y: sy };
      const deg = normalizeAngle((Math.atan2(sx, sy) * 180) / Math.PI);
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
            // Nawigacja potrzebuje dokładności, nie oszczędności baterii:
            // BestForNavigation włącza surowy GPS i czujniki bezwładnościowe.
            accuracy: Location.Accuracy.BestForNavigation,
            timeInterval: 1500,
            distanceInterval: MIN_MOVE_M,
          },
          (loc) => {
            if (!isMounted) return;
            const acc = loc.coords.accuracy ?? 0;
            const next = { lat: loc.coords.latitude, lon: loc.coords.longitude };
            const prev = lastLoc.current;

            if (prev) {
              // Mamy już pozycję, więc odrzucamy słabe fixy: inaczej strzałka
              // skacze o dziesiątki metrów, gdy telefon łapie fix w budynku.
              if (acc > MAX_ACCURACY_M) return;
              const moved = calculateDistanceMeters(prev.lat, prev.lon, next.lat, next.lon);
              if (moved < MIN_MOVE_M) return; // szum GPS, nie ruszaj UI
              // Gdy telefon nie daje kursu (silny magnes, wnętrze auta),
              // bierzemy kierunek z samego ruchu.
              if (!hasDeviceHeading.current && moved >= Math.max(8, acc)) {
                applyHeading(calculateBearing(prev.lat, prev.lon, next.lat, next.lon));
              }
            }
            // Pierwszy fix przyjmujemy nawet ze słabą dokładnością. Bez tego
            // przy gorszym sygnale ekran wisiał na „czekam na pozycję" mimo
            // że lokalizacja działała; koleje fixy same się poprawiają.
            lastLoc.current = next;
            hasFix = true;
            setUserLocation(next);
            setLocState('ok');
          },
        );
        if (!isMounted) {
          locSub.remove();
          return;
        }

        headingSub = await Location.watchHeadingAsync((h) => {
          if (!isMounted) return;
          const trueH = h.trueHeading >= 0 ? h.trueHeading : h.magHeading;
          if (trueH >= 0) {
            hasDeviceHeading.current = true;
            applyHeading(trueH);
          }
        });
        if (!isMounted) headingSub.remove();
      } catch (err) {
        console.log('[StopCompassCard] Tracking error:', err);
        if (isMounted) setLocState('noFix');
      }
    }

    startTracking();

    // Po 12 s bez fixu pokazujemy realny stan. Bez GPS na zimno (zimny start,
    // słaby widok nieba) pierwszy fix potrafi zająć kilkanaście sekund, więc
    // dajemy mu na to czas, zamiast zamykać temat po 8 s.
    const noFixTimer = setTimeout(() => {
      if (isMounted && !hasFix) setLocState((prev) => (prev === 'seeking' ? 'noFix' : prev));
    }, 12000);

    return () => {
      isMounted = false;
      clearTimeout(noFixTimer);
      locSub?.remove();
      headingSub?.remove();
    };
  }, []);

  // ─── Geometria trasy ─────────────────────────────────────────
  // Nogi sklejone w jeden ciąg wierzchołków; proste odcinki jako zapas,
  // prawdziwe ulice dociągają w tle i zastępują je w pamięci.
  const mapRoute = useMemo(() => buildMapRoute(connection), [connection]);
  const { coords, spans } = useMemo(
    () => buildRoutePath(mapRoute.legs),
    [mapRoute],
  );
  const [realPath, setRealPath] = useState<Coord[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const out: Coord[] = [];
      for (const leg of mapRoute.legs) {
        if (cancelled) return;
        const geo = await fetchLegGeometry(leg).catch(() => null);
        if (geo && geo.length > 1) {
          for (const c of geo) {
            const last = out[out.length - 1];
            if (last && Math.abs(last[0] - c[0]) < 1e-7 && Math.abs(last[1] - c[1]) < 1e-7) continue;
            out.push(c);
          }
        } else {
          for (const st of leg.stops) {
            const c: Coord = [st.lat, st.lon];
            const last = out[out.length - 1];
            if (last && Math.abs(last[0] - c[0]) < 1e-7 && Math.abs(last[1] - c[1]) < 1e-7) continue;
            out.push(c);
          }
        }
      }
      if (!cancelled && out.length > 1) setRealPath(out);
    })();
    return () => {
      cancelled = true;
    };
  }, [mapRoute]);

  const drawPath = realPath ?? coords;

  // Surowa instrukcja liczona zawsze, żeby znać odległość od trasy. Poniżej
  // progu nie pokazujemy jej wcale, bo rzut jest wtedy zmyślony.
  const rawGuidance: Guidance | null = useMemo(() => {
    if (!userLocation) return null;
    const pos: Coord = [userLocation.lat, userLocation.lon];
    if (realPath && realPath.length > 1) {
      const g = nextGuidance(realPath, spans, pos);
      if (g) return g;
    }
    return nextGuidance(coords, spans, pos);
  }, [userLocation, realPath, coords, spans]);

  const offRouteM = rawGuidance?.offsetM ?? null;
  const offRoute = offRouteM != null && offRouteM > OFF_ROUTE_M;
  const guidance = offRoute ? null : rawGuidance;

  const nextUp = useMemo(() => {
    if (!userLocation) return null;
    const pos: Coord = [userLocation.lat, userLocation.lon];
    const src = realPath && realPath.length > 1 ? realPath : coords;
    return nextGuidanceAfter(src, spans, pos);
  }, [userLocation, realPath, coords, spans]);

  const { distanceM, relativeAngle } = useMemo(() => {
    if (!userLocation || targetLat == null || targetLon == null) {
      return { distanceM: null, relativeAngle: 0 };
    }
    const dist = calculateDistanceMeters(
      userLocation.lat,
      userLocation.lon,
      targetLat,
      targetLon,
    );
    const bearing = calculateBearing(
      userLocation.lat,
      userLocation.lon,
      targetLat,
      targetLon,
    );
    const rel = (bearing - (deviceHeading ?? 0) + 360) % 360;
    return { distanceM: Math.round(dist / 5) * 5, relativeAngle: rel };
  }, [userLocation, targetLat, targetLon, deviceHeading]);

  const hasTarget = targetLat != null && targetLon != null;
  const compassReady = hasTarget && distanceM != null;

  const compassHint = !hasTarget
    ? s.compass.noCoords
    : locState === 'denied'
      ? s.compass.locOff
      : s.compass.locWaiting;

  const walkMin = distanceM != null ? walkMinutesFor(distanceM, walkMps) : null;
  const directionLabel = compassReady ? getDirectionLabel(relativeAngle, s) : compassHint;

  // Do 100 m do przystanku zostawiamy radar: mapa w tej skali i tak nic
  // nie wnosi, a kierunek względem Twego kursu jest czytelniejszy.
  const useMiniMap = guidance != null && distanceM != null && distanceM > COMPASS_ONLY_M;

  // Przy wsiadaniu i wysiadaniu liczy się środek transportu, przy skręcie
  // kierunek zawrotu. Jedna ikona na instrukcję, żeby rzecz nie migotała.
  const ManeuverIcon = useMemo(() => {
    if (!guidance) return null;
    const kind = guidance.maneuver.kind;
    if (kind === 'alight') {
      return legIcon(guidance.leg.mode, guidance.leg.line);
    }
    if (kind === 'board') {
      // Wsiadasz w to, co jest dalej, a nie w to, po czym idziesz.
      const i = mapRoute.legs.findIndex((l) => l.id === guidance.leg.id);
      const next = mapRoute.legs[i + 1];
      return legIcon(next?.mode ?? guidance.leg.mode, next?.line);
    }
    if (kind === 'arrive') return Footprints;
    return maneuverIcon(kind);
  }, [guidance, mapRoute]);

  const maneuverLabel = useMemo(() => {
    if (!guidance) return null;
    const m = s.map.maneuver;
    switch (guidance.maneuver.kind) {
      case 'depart':
        return m.depart;
      case 'straight':
        return m.straight;
      case 'slightLeft':
        return m.slightLeft;
      case 'left':
        return m.left;
      case 'sharpLeft':
        return m.sharpLeft;
      case 'slightRight':
        return m.slightRight;
      case 'right':
        return m.right;
      case 'sharpRight':
        return m.sharpRight;
      case 'uturn':
        return m.uturn;
      case 'board':
        return m.board;
      case 'alight':
        return m.alight;
      case 'arrive':
        return m.arrive;
      default:
        return m.straight;
    }
  }, [guidance, s]);

  const distText = guidance
    ? s.compass.distanceText(Math.round(guidance.maneuver.distanceM))
    : null;

  // „Potem” pokazujemy tylko wtedy, gdy następny manewr jest wyraźnie
  // dalej niż obecny. Inaczej dwie linijki mówią to samo.
  const nextUpText = useMemo(() => {
    if (!nextUp) return null;
    const gap = nextUp.maneuver.distanceM - (guidance?.maneuver.distanceM ?? 0);
    if (gap < 40) return null;
    const label = s.map.maneuver;
    const kind = nextUp.maneuver.kind;
    const what =
      kind === 'board'
        ? label.board
        : kind === 'alight'
          ? label.alight
          : kind === 'arrive'
            ? label.arrive
            : kind === 'straight'
              ? label.straight
              : kind === 'slightLeft'
                ? label.slightLeft
                : kind === 'left'
                  ? label.left
                  : kind === 'sharpLeft'
                    ? label.sharpLeft
                    : kind === 'slightRight'
                      ? label.slightRight
                      : kind === 'right'
                        ? label.right
                        : kind === 'sharpRight'
                          ? label.sharpRight
                          : label.uturn;
    return `${label.then} ${what.toLocaleLowerCase()} · ${s.compass.distanceText(Math.round(nextUp.maneuver.distanceM))}`;
  }, [nextUp, guidance, s]);

  const openMap = useCallback(() => {
    onOpenMap?.();
  }, [onOpenMap]);

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={styles.cardHeaderIcon}>
          <Navigation2 size={18} color={scheme.primary} />
        </View>
        <View style={styles.cardHeaderText}>
          <Text style={styles.cardTitle}>{s.compass.title}</Text>
          <Text style={styles.cardSubtitle}>{s.compass.followCompass}</Text>
        </View>
      </View>

      {transitLegs.length > 1 && (
        <View style={styles.tabsSection}>
          <Text style={styles.sectionLabel}>{s.compass.chooseChange}</Text>
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
                    pressed && { opacity: 0.7 },
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

      <View style={styles.stopInfo}>
        <View style={styles.badgeRow}>
          {activeLeg && <LineBadge mode={activeLeg.mode} line={activeLeg.line} />}
          {activeLeg?.direction && (
            <Text style={styles.directionText} numberOfLines={1}>
              {s.compass.directionPrefix(activeLeg.direction)}
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

      {/* ─── Nawigacja ─────────────────────────────────────── */}
      {useMiniMap && guidance && ManeuverIcon && maneuverLabel && userLocation ? (
        <Pressable
          onPress={openMap}
          style={({ pressed }) => [styles.navBlock, pressed && { opacity: 0.9 }]}
          accessibilityRole="button"
          accessibilityLabel={s.map.maneuver.miniMapA11y(maneuverLabel, distText ?? '')}
        >
          <View style={styles.navVisualRow}>
            <NavMiniMap
              path={drawPath}
              user={[userLocation.lat, userLocation.lon]}
              target={guidance.maneuver.at}
              headingDeg={deviceHeading}
              accent={guidance.leg.color || lineAccent}
              size={124}
            />
            <View style={styles.navTextCol}>
              <View style={styles.maneuverRow}>
                <View style={[styles.maneuverBadge, { backgroundColor: scheme.tertiaryContainer }]}>
                  <ManeuverIcon size={22} color={scheme.onTertiaryContainer} />
                </View>
                <View style={styles.maneuverCopy}>
                  <Text style={styles.maneuverText} numberOfLines={2}>
                    {maneuverLabel}
                  </Text>
                  {distText ? (
                    <Text style={styles.maneuverDist}>{distText}</Text>
                  ) : null}
                </View>
              </View>
              {nextUpText ? (
                <Text style={styles.nextUp} numberOfLines={1}>
                  {nextUpText}
                </Text>
              ) : null}
              {distanceM != null ? (
                <Text style={styles.navFooter} numberOfLines={1}>
                  {s.compass.distanceText(distanceM)} {s.compass.straight}
                  {walkMin != null ? ` · ${s.compass.walkMins(walkMin)}` : ''}
                </Text>
              ) : null}
            </View>
          </View>
        </Pressable>
      ) : compassReady ? (
        /* Do 100 m do przystanku radar jest czytelniejszy niż mapa. */
        <View style={styles.compassRow}>
          <View style={styles.dialContainer}>
            <View style={styles.dial}>
              <View style={styles.innerRing} />
              <View style={styles.crosshairV} />
              <View style={styles.crosshairH} />
              <View style={styles.pointerContainer}>
                <View style={[styles.pointerBeam, { backgroundColor: lineAccent }]} />
                <View style={[styles.stopTargetBadge, { backgroundColor: lineAccent }]}>
                  <TargetIcon size={16} color={lineFg} />
                </View>
              </View>
              <View style={styles.userPulse}>
                <View style={styles.userDot} />
              </View>
            </View>
          </View>
          <View style={styles.distanceInfo}>
            <Text style={styles.directionGuide}>{directionLabel}</Text>
            <Text style={styles.distanceNumber}>{s.compass.distanceText(distanceM!)}</Text>
            <Text style={styles.distanceLabel} numberOfLines={1}>
              {s.compass.straight}
            </Text>
            {walkMin != null && (
              <View style={styles.walkBadge}>
                <Text style={styles.walkEst}>{s.compass.walkMins(walkMin)}</Text>
              </View>
            )}
          </View>
        </View>
      ) : (
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
          accessibilityLabel={s.compass.openSettingsA11y}
        >
          <Text style={styles.settingsBtnText}>{s.compass.enableLoc}</Text>
        </Pressable>
      )}
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

  // ─── Nawigacja ─────────────────────────────────────────────
  navBlock: {
    backgroundColor: scheme.surfaceContainerLowest,
    borderRadius: shape.medium,
    padding: 12,
    gap: 10,
  },
  navVisualRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  navTextCol: {
    flex: 1,
    minWidth: 0,
    gap: 6,
  },
  maneuverRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  maneuverBadge: {
    width: 40,
    height: 40,
    borderRadius: shape.medium,
    alignItems: 'center',
    justifyContent: 'center',
  },
  maneuverCopy: {
    flex: 1,
    minWidth: 0,
  },
  maneuverText: {
    ...type.titleSmall,
    fontWeight: '700',
    color: scheme.onSurface,
  },
  maneuverDist: {
    ...type.labelLarge,
    fontWeight: '700',
    color: scheme.primary,
    marginTop: 1,
  },
  nextUp: {
    ...type.labelSmall,
    color: scheme.onSurfaceVariant,
  },
  navFooter: {
    ...type.labelSmall,
    color: scheme.onSurfaceVariant,
  },

  // ─── Radar (do 100 m) ─────────────────────────────────────
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
});