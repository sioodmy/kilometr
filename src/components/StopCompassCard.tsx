// Karta połączenia: w miejscu radaru pokazujemy kierunek do przystanku.
//
// Dalej niż 110 m od przystanku zamiast kompasu jest kompaktowy widget
// nawigacji: statyczna mapka obrócona kompasem po lewej, a po prawej ikona
// i odległość następnego manewru. Dotknięcie całego widgetu otwiera pełną
// mapę. Poniżej 90 m wraca radar, bo przy samym przystanku kierunek jest
// czytelniejszy niż mapa. Między progami zostaje to, co już było, żeby
// szum GPS na granicy nie przerzucał karty tam i z powrotem.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AppState,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import * as Location from 'expo-location';
import { useSharedValue } from 'react-native-reanimated';
import {
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
  Maximize2,
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
import {
  buildMapRoute,
  fetchFootRoute,
  fetchLegGeometry,
  projectRoutePoint,
  type Coord,
} from '../services/routeGeometry';
import {
  buildRoutePath,
  nextGuidance,
  nextGuidanceAfter,
  type Guidance,
  type LegSpan,
  type ManeuverKind,
} from '../services/turnManeuver';
import type { MapLeg } from '../map/types';

interface StopCompassCardProps {
  connection: Connection;
  /** Otwiera pełną mapę trasy. Cały widget nawigacji jest w tym celu klikalny. */
  onOpenMap?: () => void;
}

/** Powyżej tej odległości (w górę) radar ustępuje widgetowi nawigacji. */
const NAV_ON_M = 110;
/** Poniżej tej odległości (w dół) wraca radar. Pas 90-110 m trzyma poprzedni stan. */
const NAV_OFF_M = 90;
/**
 * Fixy gorsze niż to odrzucamy: GPS w budynku kłamie o kilkadziesiąt metrów.
 */
const MAX_ACCURACY_M = 60;
/**
 * Gdy od ostatniego dobrego fixa minęło tyle, łapiemy też słabsze (do
 * MAX_STALE_ACCURACY_M). Inaczej kropka stoi w miejscu w tunelu albo między
 * kamienicami, a odległość do przystanku przestaje być prawdziwa.
 */
const STALE_FIX_MS = 20000;
const MAX_STALE_ACCURACY_M = 150;
/**
 * Dalej niż to od trasy nie prowadzimy po manewrach. Rzut na linię i tak
 * coś znajdzie, ale to będzie przypadkowy punkt: „wysiadaj 5,4 km” stojąc
 * 4 km od trasy jest kłamstwem, które gorsze od braku instrukcji.
 */
const OFF_ROUTE_M = 45;
/**
 * Przyciąganie kropki do trasy (map matching do wyświetlania). Dopóki jesteś
 * w tym pasie, kropka siedzi na linii trasy zamiast skakać po chodniku.
 * Pomiar (odległość, offset) idzie z surowego GPS, żeby snap niczego nie
 * maskował.
 */
const SNAP_M = 25;
/** Przerouting widgetu: nie częściej niż tyle i tylko po takim ruchu. */
const REROUTE_COOLDOWN_MS = 30000;
const REROUTE_MIN_MOVE_M = 25;
/**
 * Przerouting ma sens tylko w strefie dojścia. Dalej niż to od przystanku
 * albo z większym zboczeniem prawdopodobnie jedziesz (a nie idziesz) albo
 * jesteś bardzo daleko. Wtedy nie palimy OSRM, tylko mówimy „idź do
 * przystanku”. Chroni też przed przeroutingiem pieszo, gdy siedzisz w busie.
 */
const REROUTE_MAX_DIST_M = 1500;
const REROUTE_MAX_OFFSET_M = 300;
/** Powyżej tego tempa (szybki bieg) nie przeroutowujemy, bo to nie spacer. */
const REROUTE_MAX_SPEED_MPS = 3.5;

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

/**
 * Zaokrąglenie do wartości, które czyta się z ekranu: 20 m, 50 m, 120 m.
 * Dokładne metry zmieniają się co sekundę i migotały na widgecie.
 */
function roundNavM(m: number): number {
  if (m < 50) return Math.max(0, Math.round(m / 5) * 5);
  if (m < 500) return Math.round(m / 10) * 10;
  return Math.round(m / 50) * 50;
}

/** Średnica mapki w widgecie. Na węższych ekranach mniejsza, żeby zmieściła się instrukcja. */
const NAV_MAP_SIZE = 108;
const NAV_MAP_SIZE_NARROW = 96;
/** Poniżej tej szerokości ekranu (dp) widget przechodzi w wariant kompaktowy. */
const NAV_NARROW_W = 360;

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

  const { width: winWidth } = useWindowDimensions();
  const navNarrow = winWidth < NAV_NARROW_W;
  const navMapSize = navNarrow ? NAV_MAP_SIZE_NARROW : NAV_MAP_SIZE;

  const [userLocation, setUserLocation] = useState<{ lat: number; lon: number } | null>(null);
  const [locState, setLocState] = useState<'seeking' | 'ok' | 'denied' | 'noFix'>('seeking');
  const [deviceHeading, setDeviceHeading] = useState<number | null>(null);
  // Filtrowany kurs urządzenia (stopnie). Surowy magnetometr skacze ±10°,
  // wygładzamy low-pass na wektorze + histereza, żeby kompas nie migotał.
  const headingVec = useRef<{ x: number; y: number } | null>(null);
  const lastAppliedHeading = useRef(0);
  const lastLoc = useRef<{ lat: number; lon: number } | null>(null);
  const lastGoodAt = useRef(0);
  // Obrót mapki na wątku UI. Kompas ustawia tylko tę wartość (bez setState),
  // więc magnetometr nie przerysowuje karty i mapa nie laguje.
  const rotationSV = useSharedValue(0);
  // Wygładzone tempo [m/s] do bramki przeroutingu (pieszo vs pojazd).
  const speedRef = useRef<{ v: number; at: number } | null>(null);
  const lastLocAt = useRef(0);
  // Świeża trasa piesza do przystanku, gdy zgubisz trasę. Tylko widget;
  // pełna mapa jej nie widzi i nie zmienia się.
  const [reroutePath, setReroutePath] = useState<Coord[] | null>(null);
  const [rerouting, setRerouting] = useState(false);
  const rerouteMeta = useRef<{ targetKey: string; at: number } | null>(null);
  const lastRerouteAttempt = useRef<{ at: number; lat: number; lon: number } | null>(null);
  // Użytkownik wraca z ustawień (np. włączył lokalizację), a karta miała
  // zostać na „wyłączona” aż do ponownego otwarcia ekranu. Po powrocie na
  // pierwszy plan podpinamy GPS od nowa.
  const [sessionKey, setSessionKey] = useState(0);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') setSessionKey((k) => k + 1);
    });
    return () => sub.remove();
  }, []);

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
      // Obrót warstwy idzie od razu na wątek UI (płynnie, bez renderu).
      // Normalizacja do -180..180, żeby przy przejściu przez północ mapa nie
      // kręciła pełnego koła (180° i -180° to to samo ułożenie).
      rotationSV.value = ((-deg + 540) % 360) - 180;
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

        // Ostatnia znana pozycja (świeża, do 2 min) pokazuje widget od razu,
        // zamiast czekać na pierwszy fix. Nie wpada do lastLoc, więc pierwszy
        // prawdziwy fix nadal przyjmujemy bez filtrów.
        const seed = await Location.getLastKnownPositionAsync({ maxAge: 120000 }).catch(
          () => null,
        );
        if (isMounted && seed && !lastLoc.current) {
          setUserLocation({ lat: seed.coords.latitude, lon: seed.coords.longitude });
          setLocState('ok');
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
              const stale = Date.now() - lastGoodAt.current > STALE_FIX_MS;
              if (acc > (stale ? MAX_STALE_ACCURACY_M : MAX_ACCURACY_M)) return;
              lastGoodAt.current = Date.now();
              const moved = calculateDistanceMeters(prev.lat, prev.lon, next.lat, next.lon);
              if (moved < MIN_MOVE_M) return; // szum GPS, nie ruszaj UI
              // Wygładzone tempo do bramki przeroutingu (spacer vs pojazd).
              const nowMs = Date.now();
              const dtS = lastLocAt.current > 0 ? (nowMs - lastLocAt.current) / 1000 : 0;
              if (dtS > 0) {
                const inst = Math.min(30, moved / dtS);
                const prevSp = speedRef.current;
                speedRef.current = {
                  v: prevSp ? prevSp.v + (inst - prevSp.v) * 0.4 : inst,
                  at: nowMs,
                };
              }
              lastLocAt.current = nowMs;
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
            lastGoodAt.current = Date.now();
            if (lastLocAt.current === 0) lastLocAt.current = Date.now();
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
  }, [sessionKey]);

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

  // Ścieżka bazowa (cała trasa). Surową instrukcję liczymy zawsze na surowym
  // GPS, żeby znać PRAWDZIWY offset od trasy. Snap jest tylko do wyświetlania.
  const basePath = realPath ?? coords;

  const baseGuidance: Guidance | null = useMemo(() => {
    if (!userLocation) return null;
    const pos: Coord = [userLocation.lat, userLocation.lon];
    if (realPath && realPath.length > 1) {
      const g = nextGuidance(realPath, spans, pos);
      if (g) return g;
    }
    return nextGuidance(coords, spans, pos);
  }, [userLocation, realPath, coords, spans]);

  const baseOffM = baseGuidance?.offsetM ?? null;
  const offRoute = baseOffM != null && baseOffM > OFF_ROUTE_M;

  const targetKey =
    targetLat != null && targetLon != null
      ? `${targetLat.toFixed(5)},${targetLon.toFixed(5)}`
      : null;

  // Jedna syntetyczna noga piesza na świeżej trasie. Samotny spacer kończy
  // się 'arrive', więc skręty i „potem” liczą się same, bez nowych funkcji.
  const rerouteSpans = useMemo<LegSpan[]>(() => {
    if (!reroutePath || reroutePath.length < 2) return [];
    const leg: MapLeg = {
      id: 'widget-reroute',
      mode: 'walk',
      color: lineAccent,
      fromStop: '',
      toStop: stopName,
      departAt: '',
      arriveAt: '',
      stopsCount: 0,
      live: false,
      stops: [],
      approx: false,
    };
    return [{ leg, start: 0, end: reroutePath.length - 1 }];
  }, [reroutePath, lineAccent, stopName]);

  const rerouteFresh =
    reroutePath != null &&
    reroutePath.length > 1 &&
    targetKey != null &&
    rerouteMeta.current?.targetKey === targetKey;

  // Aktywna ścieżka widgetu: świeży przerouting albo cała trasa.
  const activePath = rerouteFresh && reroutePath ? reroutePath : basePath;
  const activeSpans = rerouteFresh ? rerouteSpans : spans;

  // Kropka przyciągnięta do trasy, gdy jesteś blisko. Sam pomiar zostaje
  // surowy (powyżej), więc snap niczego nie maskuje, tylko uspokaja obraz.
  const displayPos: Coord | null = useMemo(() => {
    if (!userLocation) return null;
    const raw: Coord = [userLocation.lat, userLocation.lon];
    const p = projectRoutePoint(activePath, raw[0], raw[1]);
    if (p && p.offsetM <= SNAP_M) return [p.lat, p.lon];
    return raw;
  }, [userLocation, activePath]);

  const activeGuidance: Guidance | null = useMemo(() => {
    if (!userLocation) return null;
    const pos: Coord = [userLocation.lat, userLocation.lon];
    return nextGuidance(activePath, activeSpans, pos);
  }, [userLocation, activePath, activeSpans]);

  // Świeży przerouting, z którego też zboczyliśmy: czyścimy go w efekcie, a
  // tu pokazujemy zapas („idź do przystanku”), nie zmyśloną instrukcję.
  const rerouteLost =
    rerouteFresh && activeGuidance != null && activeGuidance.offsetM > REROUTE_MAX_OFFSET_M;
  const guidance = rerouteFresh
    ? (rerouteLost ? null : activeGuidance)
    : offRoute
      ? null
      : activeGuidance;

  const nextUp = useMemo(() => {
    if (!userLocation || !guidance) return null;
    const pos: Coord = [userLocation.lat, userLocation.lon];
    return nextGuidanceAfter(activePath, activeSpans, pos);
  }, [userLocation, guidance, activePath, activeSpans]);

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

  // Pozycja do mapki: przyciągnięta do trasy (displayPos jest memoizowane,
  // więc referencja jest stabilna i mapka nie liczy trasy od nowa co render).
  const userPos = displayPos;
  const stopPos = useMemo<Coord | null>(
    () => (targetLat != null && targetLon != null ? [targetLat, targetLon] : null),
    [targetLat, targetLon],
  );

  const compassHint = !hasTarget
    ? s.compass.noCoords
    : locState === 'denied'
      ? s.compass.locOff
      : s.compass.locWaiting;

  const walkMin = distanceM != null ? walkMinutesFor(distanceM, walkMps) : null;
  const directionLabel = compassReady ? getDirectionLabel(relativeAngle, s) : compassHint;

  // Histereza: przełączamy dopiero po przekroczeniu progu w jedną lub drugą
  // stronę. Bez tego szum GPS na granicy przerzucał kartę co kilka sekund.
  const [navMode, setNavMode] = useState(false);
  if (distanceM != null) {
    const nextNav = navMode ? distanceM > NAV_OFF_M : distanceM > NAV_ON_M;
    if (nextNav !== navMode) setNavMode(nextNav);
  }
  const showNav = navMode && distanceM != null;

  // Przerouting tylko w widgecie. Gdy zgubisz trasę w strefie dojścia i idziesz
  // pieszo, dociągamy świeżą trasę do przystanku. Pełna mapa tego nie widzi.
  useEffect(() => {
    // Cel się zmienił (inna przesiadka): stara trasa jest nieaktualna.
    if (rerouteMeta.current && rerouteMeta.current.targetKey !== targetKey) {
      rerouteMeta.current = null;
      setReroutePath(null);
    }
    if (rerouteLost) {
      // Zboczyliśmy i ze świeżej trasy: czyścimy, żeby nie prowadzić po zmyłce.
      // Trigger poniżej dociągnie kolejną, gdy minie cooldown i będzie ruch.
      rerouteMeta.current = null;
      setReroutePath(null);
      return;
    }
    if (!navMode || !hasTarget || !userLocation || !stopPos || !targetKey) return;
    if (!offRoute && baseGuidance) return; // na trasie, nie ma czego naprawiać
    if (rerouteFresh) return; // mamy świeżą
    if (distanceM == null || distanceM > REROUTE_MAX_DIST_M) return;
    if (baseOffM != null && baseOffM > REROUTE_MAX_OFFSET_M) return;
    const now = Date.now();
    const sp = speedRef.current;
    // Zastane tempo traktujemy jak stanie w miejscu (pieszo), nie jak jazdę.
    if (sp && now - sp.at <= 15000 && sp.v > REROUTE_MAX_SPEED_MPS) return;
    const last = lastRerouteAttempt.current;
    if (last && now - last.at < REROUTE_COOLDOWN_MS) return;
    if (
      last &&
      calculateDistanceMeters(last.lat, last.lon, userLocation.lat, userLocation.lon) <
        REROUTE_MIN_MOVE_M
    ) {
      return;
    }
    lastRerouteAttempt.current = { at: now, lat: userLocation.lat, lon: userLocation.lon };
    setRerouting(true);
    let cancelled = false;
    const ctrl = new AbortController();
    void fetchFootRoute([userLocation.lat, userLocation.lon], stopPos, ctrl.signal)
      .then((path) => {
        if (cancelled || !path || path.length < 2) return;
        rerouteMeta.current = { targetKey, at: Date.now() };
        setReroutePath(path);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setRerouting(false);
      });
    return () => {
      cancelled = true;
      ctrl.abort();
    };
  }, [
    navMode,
    hasTarget,
    userLocation,
    stopPos,
    targetKey,
    distanceM,
    offRoute,
    baseGuidance,
    baseOffM,
    rerouteFresh,
    rerouteLost,
  ]);

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
    ? s.compass.distanceText(roundNavM(guidance.maneuver.distanceM))
    : null;

  // Widget ma zawsze czytelny nagłówek. Bez instrukcji trasy (poza trasą,
  // brak geometrii) mówimy wprost, dokąd iść, a strzałka pokazuje kierunek.
  const headLabel = guidance && maneuverLabel ? maneuverLabel : s.compass.headToStop;
  const headDist =
    guidance && distText
      ? distText
      : distanceM != null
        ? s.compass.distanceText(roundNavM(distanceM))
        : '';
  const footerText =
    walkMin != null
      ? guidance && distanceM != null
        ? `${s.compass.navToStop(s.compass.distanceText(roundNavM(distanceM)))} · ${s.compass.walkMins(walkMin)}`
        : s.compass.walkMins(walkMin)
      : '';

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
      {showNav && userPos ? (
        // Cały widget jest jednym przyciskiem: dotknięcie otwiera pełną mapę.
        <Pressable
          onPress={openMap}
          style={({ pressed }) => [styles.navWidget, pressed && styles.navWidgetPressed]}
          accessibilityRole="button"
          accessibilityLabel={s.compass.navA11y(headLabel, headDist)}
        >
          <View style={styles.navRow}>
            <NavMiniMap
              path={activePath}
              user={userPos}
              maneuverAt={guidance?.maneuver.at ?? null}
              stop={stopPos}
              headingDeg={deviceHeading}
              rotationSV={rotationSV}
              accent={guidance?.leg.color || lineAccent}
              size={navMapSize}
            />
            <View style={styles.navCopy}>
              <View style={styles.navHead}>
                <View style={[styles.navArrowBadge, navNarrow && styles.navArrowBadgeNarrow]}>
                  {guidance && ManeuverIcon ? (
                    <ManeuverIcon size={30} strokeWidth={2.4} color={scheme.onPrimaryContainer} />
                  ) : (
                    <View style={{ transform: [{ rotate: `${relativeAngle}deg` }] }}>
                      <ArrowUp size={30} strokeWidth={2.4} color={scheme.onPrimaryContainer} />
                    </View>
                  )}
                </View>
                <View style={styles.navHeadText}>
                  <Text style={styles.navDistance} numberOfLines={1}>
                    {headDist}
                  </Text>
                  <Text style={styles.navInstruction} numberOfLines={2}>
                    {headLabel}
                  </Text>
                </View>
              </View>
              {rerouting ? (
                <Text style={styles.navNext} numberOfLines={1}>
                  {s.compass.rerouting}
                </Text>
              ) : nextUpText ? (
                <Text style={styles.navNext} numberOfLines={1}>
                  {nextUpText}
                </Text>
              ) : null}
            </View>
          </View>
          <View style={styles.navFooter}>
            <Text style={styles.navFooterText} numberOfLines={1}>
              {footerText}
            </Text>
            <Maximize2 size={16} color={scheme.onSurfaceVariant} />
          </View>
        </Pressable>
      ) : compassReady ? (
        /* Do 90 m do przystanku radar jest czytelniejszy niż mapa. */
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

  // ─── Widget nawigacji (zamiast radaru, gdy dalej niż 110 m) ───
  navWidget: {
    backgroundColor: scheme.surfaceContainerLowest,
    borderRadius: shape.large,
    padding: 10,
    gap: 10,
  },
  navWidgetPressed: {
    opacity: 0.85,
  },
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  navCopy: {
    flex: 1,
    minWidth: 0,
    gap: 8,
  },
  navHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  navArrowBadge: {
    width: 52,
    height: 52,
    borderRadius: shape.large,
    backgroundColor: scheme.primaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navArrowBadgeNarrow: {
    width: 44,
    height: 44,
    borderRadius: shape.medium,
  },
  navHeadText: {
    flex: 1,
    minWidth: 0,
  },
  navDistance: {
    fontSize: 26,
    lineHeight: 30,
    fontWeight: '800',
    color: scheme.onSurface,
    fontVariant: ['tabular-nums'],
    includeFontPadding: false,
  },
  navInstruction: {
    ...type.labelLarge,
    fontWeight: '600',
    color: scheme.onSurface,
    marginTop: 2,
  },
  navNext: {
    ...type.labelSmall,
    color: scheme.onSurfaceVariant,
  },
  navFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingHorizontal: 2,
  },
  navFooterText: {
    ...type.labelMedium,
    color: scheme.onSurfaceVariant,
    flex: 1,
    minWidth: 0,
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