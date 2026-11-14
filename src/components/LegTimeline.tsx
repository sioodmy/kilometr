import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  ArrowRight,
  BusFront,
  ChevronDown,
  Footprints,
  MapPin,
  Ticket,
  TrainFront,
  TramFront,
} from './icons';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { elev, scheme, shape, type } from '../theme/tokens';
import type { Leg, LegStop } from '../types/models';
import { getLineColors, LineBadge } from './LineBadge';
import { RailAmenities } from './RailAmenities';
import { LiveSensors } from './LiveDot';
import { RoutingService } from '../services';
import { formatWalkTime, useWalkSpeedMps, walkMinutesFor } from '../services/settings';
import { liveTracker, type TrackedVehicle } from '../services/liveTracker';
import { useCurrentLocation, type CurrentLocation } from '../services/currentLocation';

import {
  buildFallbackStops,
  findNearestStopOnRoute,
  findUserSegment,
  locateLiveStopPosition,
  normalizeName,
  nowSecOfDay,
  positionToRank,
  type LiveStopPosition,
} from '../services/vehiclePosition';
import { ensureTrainTrack, type TrainTrack } from '../services/trainTrack';
import { useStrings, type Strings } from '../i18n';
import { pl } from '../i18n/pl';
import { motion } from '../theme/motion';
import { isFareBoundary, parseFareBoundary } from '../gtfs/fareBoundary';
import { secondsToTimeString, timeStringToSeconds } from '../gtfs/geo';
import { legDurationMin, scheduledLegTimes } from '../services/routing/connectionTimes';
import { reliabilityNotice } from './reliabilityNotice';
import { isIntercityTrain, isTrainLeg, railDirectionLabel } from '../services/railIdentity';
import { useStopHint } from '../services/stopHints';
import { getActiveCityIdSync } from '../services/cityStore';
import { suggestCityForCoords } from '../cities';
import { isFallbackOrigin } from '../config';

// Środek transportu w dopełniaczu („tramwajem między A a B”). Osobna gałąź na
// pociągi, metro, trolejbusy i koleje linowe: bez nich czytnik ekranu czytałby „autobusem”.
function genericModeNom(t: Strings, mode: Leg['mode']): string {
  if (mode === 'tram') return t.leg.modeTram;
  if (mode === 'train') return t.leg.modeTrain;
  if (mode === 'subway') return t.leg.modeSubway;
  if (mode === 'trolleybus') return t.leg.modeTrolley;
  if (mode === 'cable') return t.leg.modeCable;
  if (mode === 'bus') return t.leg.modeBus;
  return t.leg.modeVehicle;
}

function genericModeGen(t: Strings, mode: Leg['mode']): string {
  if (mode === 'tram') return t.routes.vehicleTramGen;
  if (mode === 'train') return t.routes.vehicleTrainGen;
  if (mode === 'subway') return t.routes.vehicleSubwayGen;
  if (mode === 'trolleybus') return t.routes.vehicleTrolleyGen;
  if (mode === 'cable') return t.routes.vehicleCableGen;
  return t.routes.vehicleBusGen;
}

import { formatPlatformLabel } from '../services/platformLabel';

// ─── Modułowy cache: brak flickeru przy zwijaniu/rozwijaniu ───────────────────
// Limit wpisów, żeby przeglądanie setek kursów w jednej sesji nie zjadało
// pamięci. Map w JS zachowuje kolejność wstawień, więc evictFirst() usuwa
// najstarszy wpis, bez dodatkowej kolejki.
const STOPS_CACHE_MAX = 80;
const stopsCache = new Map<string, LegStop[]>();
const stopsPromise = new Map<string, Promise<LegStop[]>>();

function cacheStops(key: string, stops: LegStop[]) {
  stopsCache.set(key, stops);
  while (stopsCache.size > STOPS_CACHE_MAX) {
    const oldest = stopsCache.keys().next();
    if (oldest.done) break;
    stopsCache.delete(oldest.value);
  }
}

function VehicleGlyph({ mode }: { mode: Leg['mode'] }) {
  const Icon =
    mode === 'tram' ? TramFront : mode === 'train' || mode === 'subway' ? TrainFront : BusFront;
  return <Icon size={14} color={scheme.onPrimary} />;
}

// ─── Wiersz przystanku (memo = brak re-renderów listy) ─────
// Rail rysuje linię przez całą wysokość wiersza i zachodzi 1 px na sąsiednie
// wiersze, więc między kropkami i na granicy stref nie ma żadnych szwów.
// Osobne segmenty nad i pod kropką zapobiegają pomarańczowym szwom na minionym odcinku.
const StopRow = memo(function StopRow({
  stop,
  isFirst,
  isLast,
  vehicleMode,
  emphasis,
  accent,
  connectorAccent,
  passed,
  markerPlacement,
  incomingPassed,
  outgoingPassed,
  vehicleLabel,
  showStationArrivals,
  delayShiftSec,
}: {
  stop: LegStop;
  isFirst: boolean;
  isLast: boolean;
  vehicleMode: Leg['mode'];
  /** Przystanek startowy albo końcowy odcinka: wyróżniony wagą i pierścieniem. */
  emphasis: boolean;
  accent: string;
  connectorAccent: boolean;
  passed: boolean;
  markerPlacement: 'at_stop' | 'between' | null;
  incomingPassed: boolean;
  outgoingPassed: boolean;
  vehicleLabel: string;
  showStationArrivals: boolean;
  delayShiftSec: number;
}) {
  const t = useStrings();
  const boundary = parseFareBoundary(stop.name);
  const lineCenter = boundary ? 20 : 16;

  const arrClock =
    stop.arriveSec != null ? secondsToTimeString(stop.arriveSec + delayShiftSec) : null;
  const depClock =
    stop.departSec != null ? secondsToTimeString(stop.departSec + delayShiftSec) : null;
  const dwellMin =
    stop.arriveSec != null && stop.departSec != null
      ? Math.floor((stop.departSec - stop.arriveSec) / 60)
      : 0;
  const stationPlatform =
    !isFirst && !isLast && (stop.platform || stop.track)
      ? formatPlatformLabel(t, stop.platform, vehicleMode, stop.name, stop.track)
      : null;
  const subMeta = [
    stationPlatform,
    !isFirst && !isLast && dwellMin >= 2 ? t.leg.dwellMin(dwellMin) : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const showDualRailTimes =
    !boundary && (showStationArrivals || (!isFirst && !isLast && dwellMin >= 2));

  return (
    <View style={s.stopRow}>
      <View style={s.stopRail}>
        {!isFirst && (
          <View
            style={[
              s.stopRailLine,
              { top: -1, height: lineCenter + 2 },
              {
                backgroundColor: incomingPassed
                  ? scheme.outline
                  : connectorAccent
                    ? accent
                    : scheme.outlineVariant,
              },
            ]}
          />
        )}
        {!isLast && (
          <View
            style={[
              s.stopRailLine,
              { top: lineCenter, bottom: -1 },
              {
                backgroundColor: outgoingPassed
                  ? scheme.outline
                  : connectorAccent
                    ? accent
                    : scheme.outlineVariant,
              },
            ]}
          />
        )}
        <View
          style={[
            boundary ? s.boundaryMark : emphasis ? s.endpointDot : s.dot,
            boundary
              ? passed
                ? { backgroundColor: scheme.outline }
                : { backgroundColor: accent }
              : emphasis
                ? passed
                  ? { borderColor: scheme.outline, backgroundColor: scheme.surfaceContainer }
                  : { borderColor: accent, backgroundColor: scheme.surfaceContainer }
                : passed
                  ? { backgroundColor: scheme.outline }
                  : { backgroundColor: accent },
          ]}
        />
        {markerPlacement != null && (
          <View
            accessible
            accessibilityRole="image"
            accessibilityLabel={vehicleLabel}
            style={[s.vehicleMarker, markerPlacement === 'at_stop' && { top: lineCenter - 12 }]}
          >
            <VehicleGlyph mode={vehicleMode} />
          </View>
        )}
      </View>
      {boundary ? (
        <View style={s.boundaryBody}>
          <Ticket size={16} color={scheme.onSurfaceVariant} style={s.boundaryIcon} />
          <View style={s.boundaryText}>
            <Text style={s.boundaryTitle}>{t.leg.fareBoundary}</Text>
            <Text style={s.boundaryDetail}>
              {t.leg.fareBoundaryDetail(boundary.areas, boundary.point)}
            </Text>
          </View>
        </View>
      ) : (
        <View style={s.stopRowMain}>
          <View style={s.stopBody}>
            <Text
              style={[s.stopName, emphasis && s.stopNameStrong, passed ? s.stopNamePassed : null]}
              numberOfLines={2}
            >
              {stop.name}
            </Text>
            {subMeta ? (
              <Text style={[s.stopMeta, passed && s.stopNamePassed]} numberOfLines={1}>
                {subMeta}
              </Text>
            ) : null}
          </View>
          {showDualRailTimes ? (
            <View style={s.stopTimesCol}>
              {isFirst ? (
                <>
                  {arrClock && depClock && arrClock !== depClock ? (
                    <Text style={[s.stopTimeSecondary, passed && s.stopNamePassed]}>
                      {t.leg.arrTime(arrClock)}
                    </Text>
                  ) : null}
                  {depClock ?? arrClock ? (
                    <Text
                      style={[
                        s.stopTimePrimary,
                        s.stopTimeStrong,
                        passed && s.stopNamePassed,
                      ]}
                    >
                      {t.leg.depTime((depClock ?? arrClock)!)}
                    </Text>
                  ) : null}
                </>
              ) : isLast ? (
                (arrClock ?? depClock) ? (
                  <Text
                    style={[
                      s.stopTimePrimary,
                      s.stopTimeStrong,
                      passed && s.stopNamePassed,
                    ]}
                  >
                    {t.leg.arrTime((arrClock ?? depClock)!)}
                  </Text>
                ) : null
              ) : (
                <>
                  {arrClock ?? depClock ? (
                    <Text style={[s.stopTimePrimary, passed && s.stopNamePassed]}>
                      {t.leg.arrTime((arrClock ?? depClock)!)}
                    </Text>
                  ) : null}
                  {depClock && arrClock && depClock !== arrClock ? (
                    <Text style={[s.stopTimeSecondary, passed && s.stopNamePassed]}>
                      {t.leg.depTime(depClock)}
                    </Text>
                  ) : null}
                </>
              )}
            </View>
          ) : (isLast ? (arrClock ?? depClock) : (depClock ?? arrClock)) ? (
            <Text
              style={[
                s.stopTimeSingle,
                emphasis && s.stopTimeStrong,
                passed && s.stopNamePassed,
              ]}
            >
              {isLast ? (arrClock ?? depClock) : (depClock ?? arrClock)}
            </Text>
          ) : null}
        </View>
      )}
    </View>
  );
});

// ─── Rozwijana lista kropek dla jednego lega ──────────────────────────────────
function LegStopsList({
  leg,
  accent,
  userLocation,
  allowLive,
  stops,
  vehicle,
  loading,
  active,
  track,
}: {
  leg: Leg;
  accent: string;
  userLocation: CurrentLocation | null;
  allowLive: boolean;
  stops: LegStop[];
  vehicle: TrackedVehicle | null;
  loading: boolean;
  active: boolean;
  track: TrainTrack | null;
}) {
  const t = useStrings();
  const segment = useMemo(() => findUserSegment(stops, leg), [stops, leg]);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(timer);
  }, [active]);

  const lastLegIdRef = useRef(leg.id);
  const rankRef = useRef<number>(-1);
  // Skąd wziął się ranking: estymata zegarowa nie blokuje świeżego live.
  // Bez tego po wznowieniu z tła marker utykał na końcu trasy.
  const rankSourceRef = useRef<LiveStopPosition['source']>('vehicle');
  if (lastLegIdRef.current !== leg.id) {
    lastLegIdRef.current = leg.id;
    rankRef.current = -1;
    rankSourceRef.current = 'vehicle';
  }

  const livePosition = useMemo(() => {
    if (!active || !allowLive) return null;
    const pos = locateLiveStopPosition(
      stops,
      leg,
      vehicle,
      userLocation,
      now,
      rankRef.current,
      rankSourceRef.current,
      track,
    );
    if (pos) {
      // Pomiar live zastępuje ranking, estymata tylko go przesuwa do przodu.
      rankRef.current =
        pos.source === 'estimate'
          ? Math.max(rankRef.current, positionToRank(pos))
          : positionToRank(pos);
      rankSourceRef.current = pos.source;
    }
    return pos;
  }, [active, stops, leg, vehicle, userLocation, now, allowLive, track]);

  const showStationArrivals = isIntercityTrain(leg) || isTrainLeg(leg);
  const delayShiftSec =
    leg.live || leg.delayConfidence === 'estimated' ? (leg.delaySec ?? 0) : 0;
  const rowHeight = showStationArrivals ? 52 : 36;

  if (loading) {
    return (
      <View style={s.stopsWrap}>
        {[0, 1, 2].map((i) => (
          <View key={i} style={[s.stopRow, { minHeight: rowHeight }]}>
            <View style={s.stopRail}>
              <View style={[s.dot, s.skeletonDot]} />
            </View>
            <View style={[s.skeletonLine, { width: `${72 - i * 12}%` }]} />
          </View>
        ))}
      </View>
    );
  }

  return (
    <View style={s.stopsWrap}>
      {stops.slice(segment.start, segment.end + 1).map((stop, offset) => {
        const i = segment.start + offset;
        const connectorAccent = i + 1 <= segment.end;
        const passed = livePosition != null && i <= livePosition.passedStopIndex;
        const markerPlacement =
          livePosition?.marker && livePosition.marker.index === i
            ? livePosition.marker.placement
            : null;
        const incomingPassed =
          livePosition != null &&
          (i <= livePosition.passedStopIndex || livePosition.atStopIndex === i);
        const outgoingPassed =
          livePosition != null &&
          (i + 1 <= livePosition.passedStopIndex || livePosition.atStopIndex === i + 1);

        return (
          <StopRow
            key={`${stop.stopId}-${stop.seq}`}
            stop={stop}
            isFirst={i === segment.start}
            isLast={i === segment.end}
            vehicleMode={leg.mode}
            emphasis={i === segment.start || i === segment.end}
            accent={accent}
            connectorAccent={connectorAccent}
            passed={passed}
            markerPlacement={markerPlacement}
            incomingPassed={incomingPassed}
            outgoingPassed={outgoingPassed}
            showStationArrivals={showStationArrivals}
            delayShiftSec={delayShiftSec}
            vehicleLabel={
              markerPlacement === 'at_stop'
                ? t.leg.nearStop(genericModeNom(t, leg.mode), stop.name)
                : t.leg.vehicleBetween(
                    genericModeGen(t, leg.mode),
                    stop.name,
                    stops[i + 1]?.name ?? stop.name,
                  )
            }
          />
        );
      })}
    </View>
  );
}

const LiveDataAge = memo(function LiveDataAge({ timestamp }: { timestamp: number }) {
  const t = useStrings();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        setNow(Date.now());
      }
    });
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, []);

  const ageSec = Math.max(0, Math.floor((now - timestamp) / 1000));

  return (
    <Text style={s.liveAgeLabel} numberOfLines={1}>
      {t.routeDetails.liveDataAge(ageSec)}
    </Text>
  );
});

// ─── Karta jednego przejazdu (klik = rozwiń) ──────────────────────────────────
// Rozwijanie animowaną wysokością (a nie montowaniem): lista montuje się raz
// przy pierwszym otwarciu i zostaje, a kontener płynnie rośnie/maleje.
// Dzięki temu zero skoku layoutu i zero flickeru.
const TransitLegCard = memo(function TransitLegCard({
  leg,
  expanded,
  onToggle,
  userLocation,
  allowLive,
}: {
  leg: Leg;
  expanded: boolean;
  onToggle: (id: string) => void;
  userLocation: CurrentLocation | null;
  allowLive: boolean;
}) {
  // `t`, nie `s`: modułowy StyleSheet nazywa się już `s`.
  const t = useStrings();
  const { bg: accent } = getLineColors(leg.line, leg.mode);
  const scheduled = scheduledLegTimes(leg, timeStringToSeconds(leg.departAt));
  const scheduledDeparture = scheduled.departure;
  const delayMin =
    leg.live || leg.delayConfidence === 'estimated' ? Math.round((leg.delaySec ?? 0) / 60) : 0;
  // Osobno przyjazd: opoznienie rosnie w trasie, a stacja docelowa ma wlasna
  // prognoze z feedu PKP.
  const arrivalDelayMin =
    leg.live || leg.delayConfidence === 'estimated'
      ? Math.round((leg.arrivalDelaySec ?? leg.delaySec ?? 0) / 60)
      : 0;
  const notice = reliabilityNotice([leg], t);
  const stopsCount = useMemo(() => {
    const stops = leg.intermediateStops;
    if (!stops || stops.length < 2) return leg.stopsCount;
    const segment = findUserSegment(stops, leg);
    const segmentStops = stops.slice(segment.start, segment.end + 1);
    const physicalStops = segmentStops.filter((stop) => !isFareBoundary(stop.name));
    if (physicalStops.length === segmentStops.length) return leg.stopsCount;
    return Math.max(0, physicalStops.length - 1);
  }, [leg]);
  const durationMin = useMemo(
    () => legDurationMin({ ...leg, stopsCount }),
    [leg.departAt, leg.arriveAt, leg.scheduledDepartureSec, leg.scheduledArrivalSec, stopsCount],
  );
  const chevron = useSharedValue(0);
  const [hasOpened, setHasOpened] = useState(expanded);

  // Mierzymy szerokość badge linii, by wyśrodkować ikonę sensors pod nim
  // i wyrównać kółko rozwijanej listy z początkiem tekstu statusu live.
  const [badgeWidth, setBadgeWidth] = useState(56);
  const sensorSize = 19;
  const sensorCenterOffset = Math.max(0, badgeWidth / 2 - sensorSize / 2);
  const stopsIndent = sensorCenterOffset + sensorSize + 8 - 11;

  const isTrain = isTrainLeg(leg);
  const legCityId = useMemo(() => {
    if (isTrain) return null;
    if (leg.fromLat != null && leg.fromLon != null) {
      const detected = suggestCityForCoords(leg.fromLat, leg.fromLon);
      if (detected) return detected.id;
    }
    return getActiveCityIdSync();
  }, [isTrain, leg.fromLat, leg.fromLon]);
  const resolvedHint = useStopHint(
    isTrain ? '' : (legCityId ?? ''),
    leg.platformCode,
    leg.fromStopId,
    leg.fromStop,
    leg.mode,
  );
  const stopHint = isTrain ? null : (leg.stopHint ?? resolvedHint);
  const departurePlatform = useMemo(
    () => formatPlatformLabel(t, leg.platformCode, leg.mode, leg.fromStop, leg.trackCode),
    [t, leg.platformCode, leg.mode, leg.fromStop, leg.trackCode],
  );
  // Wskazówki w bazie są tylko po polsku, więc prefiks słupka też musi być polski.
  // Inaczej angielski UI dokleja "Pole 10001" do polskiego zdania.
  const hintPlatform = useMemo(
    () => formatPlatformLabel(pl, leg.platformCode, leg.mode, leg.fromStop, leg.trackCode),
    [leg.platformCode, leg.mode, leg.fromStop, leg.trackCode],
  );

  const cacheKey = leg.tripId || leg.id;
  const [stops, setStops] = useState<LegStop[]>(
    () => stopsCache.get(cacheKey) ?? buildFallbackStops(leg),
  );
  const showStationArrivals = isIntercityTrain(leg) || isTrain;
  const estimatedInitialHeight =
    Math.max(1, (leg.stopsCount ?? stops.length) || 2) * (showStationArrivals ? 52 : 36);
  const measuredHeight = useSharedValue(estimatedInitialHeight);
  const stopsHeightAnim = useSharedValue(expanded ? estimatedInitialHeight : 0);
  const [loading, setLoading] = useState(
    () =>
      !stopsCache.has(cacheKey) &&
      !!leg.tripId &&
      !(leg.intermediateStops && leg.intermediateStops.length >= 2),
  );
  const [vehicle, setVehicle] = useState<TrackedVehicle | null>(null);
  const [lastOk, setLastOk] = useState(() => liveTracker.getLastOk());

  // Lazy load pełnej sekwencji kursu, raz, wynik w cache modułowym.
  useEffect(() => {
    let mounted = true;
    const cached = stopsCache.get(cacheKey);
    if (cached) {
      setStops(cached);
      setLoading(false);
      return;
    }
    if (!leg.tripId) {
      setStops(buildFallbackStops(leg));
      setLoading(false);
      return;
    }
    setLoading(!(leg.intermediateStops && leg.intermediateStops.length >= 2));
    let promise = stopsPromise.get(leg.tripId);
    if (!promise) {
      promise = RoutingService.getTripStops(leg.tripId)
        .then((fetched) => {
          stopsPromise.delete(leg.tripId!);
          return fetched;
        })
        .catch((err) => {
          stopsPromise.delete(leg.tripId!);
          throw err;
        });
      stopsPromise.set(leg.tripId, promise);
    }
    promise.then(
      (fetched) => {
        if (!mounted) return;
        if (fetched.length >= 2) cacheStops(cacheKey, fetched);
        setStops(fetched.length >= 2 ? fetched : buildFallbackStops(leg));
        setLoading(false);
      },
      (err) => {
        console.warn('[TransitLegCard] trip stops failed:', err);
        if (!mounted) return;
        setStops(buildFallbackStops(leg));
        setLoading(false);
      },
    );
    return () => {
      mounted = false;
    };
  }, [cacheKey, leg]);

  // Oś toru do markera między stacjami: bez niej pozycję prowadzi szacunek
  // z rozkładu (trainTrack.ts). Cache w serwisie trzyma jedną geometrię
  // na kurs, więc kolejne ticki live nie ruszają stanu.
  const [track, setTrack] = useState<TrainTrack | null>(null);
  useEffect(() => {
    if (!hasOpened || !isTrain) return;
    let mounted = true;
    void ensureTrainTrack(leg, stops, findUserSegment(stops, leg)).then(
      (t) => {
        if (mounted) setTrack((prev) => (prev === t ? prev : t));
      },
      () => {},
    );
    return () => {
      mounted = false;
    };
  }, [hasOpened, isTrain, leg, stops]);

  // Śledzenie pojazdu live dopasowanego do tego kursu
  useEffect(() => {
    const updateVehicle = () => {
      const now = Date.now();
      setLastOk(liveTracker.getLastOk());
      if (
        !allowLive ||
        !leg.tripId ||
        (leg.mode !== 'tram' &&
          leg.mode !== 'bus' &&
          leg.mode !== 'subway' &&
          leg.mode !== 'trolleybus' &&
          leg.mode !== 'train')
      ) {
        setVehicle(null);
        return;
      }
      let match = liveTracker
        .snapshot(leg.line)
        .find(
          (candidate) =>
            candidate.matchedTripId === leg.tripId &&
            now - candidate.updatedAt >= 0 &&
            now - candidate.updatedAt <= 120_000,
        );
      if (!match && leg.tripId) {
        match = liveTracker
          .snapshot()
          .find(
            (candidate) =>
              candidate.matchedTripId === leg.tripId &&
              now - candidate.updatedAt >= 0 &&
              now - candidate.updatedAt <= 120_000,
          );
      }
      setVehicle((prev) => {
        if (match) return match;
        if (prev && now - prev.updatedAt >= 0 && now - prev.updatedAt <= 120_000) {
          return prev;
        }
        return null;
      });
    };

    updateVehicle();
    const unsub = liveTracker.subscribe(updateVehicle);
    const timer = setInterval(updateVehicle, 5000);
    return () => {
      unsub();
      clearInterval(timer);
    };
  }, [allowLive, leg.line, leg.mode, leg.tripId]);

  const nearestStop = useMemo(() => {
    if (!allowLive || (!vehicle && !leg.live)) return null;
    return findNearestStopOnRoute(stops, vehicle);
  }, [stops, vehicle, allowLive, leg.live]);

  // Pojazd stoi na pętli przed wyjazdem (początek lub koniec kursu). Pociągi
  // pomijamy: ich "obecna lokacja" to stacja, nie pętla.
  const waitingAtTerminus = useMemo(() => {
    if (!nearestStop || leg.mode === 'train') return false;
    if (stops.length < 2) return false;
    const idx = stops.findIndex((stop) => stop.stopId === nearestStop.stopId);
    if (idx !== 0 && idx !== stops.length - 1) return false;
    const departSec = timeStringToSeconds(leg.departAt);
    const minutesToDeparture = (departSec - nowSecOfDay() + 86400) % 86400;
    return minutesToDeparture > 0 && minutesToDeparture <= 20;
  }, [nearestStop, stops, leg.mode, leg.departAt]);

  const liveNearLabel = useMemo(() => {
    if (!nearestStop) return null;
    const modeName = genericModeNom(t, leg.mode);
    return t.leg.nearStop(modeName, nearestStop.name);
  }, [nearestStop, t, leg.mode]);

  const pingKey = vehicle?.updatedAt ?? (leg.live ? lastOk : undefined);
  const liveTimestamp = vehicle?.updatedAt ?? (leg.live && lastOk > 0 ? lastOk : undefined);

  useEffect(() => {
    if (expanded) setHasOpened(true);
    chevron.value = withTiming(expanded ? 1 : 0, motion.state);
    const targetHeight = Math.max(estimatedInitialHeight, measuredHeight.value);
    stopsHeightAnim.value = withTiming(expanded ? targetHeight : 0, motion.state);
  }, [expanded, chevron, stopsHeightAnim, measuredHeight, estimatedInitialHeight]);

  const chevronStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${chevron.value * 180}deg` }],
  }));

  const stopsAnimStyle = useAnimatedStyle(() => {
    const height = stopsHeightAnim.value;
    const maxH = Math.max(1, measuredHeight.value);
    const opacity = Math.min(1, Math.max(0, height / Math.min(48, maxH)));
    return {
      height,
      opacity,
    };
  });

  return (
    <View>
      <Pressable
        onPress={() => onToggle(leg.id)}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={[
          leg.mode === 'train'
            ? t.leg.expandStationsA11y(leg.line ?? '', leg.direction ?? '', expanded)
            : t.leg.expandA11y(leg.line ?? '', leg.direction ?? '', expanded),
          notice,
        ]
          .filter(Boolean)
          .join('. ')}
        style={({ pressed }) => [s.card, pressed && { opacity: 0.96 }]}
      >
        {/* 1. Przystanek początkowy (bez prefixu "z") + godzina odjazdu po prawej */}
        <View style={s.cardStartRow}>
          <View style={s.stopTitleWrap}>
            <Text style={s.cardStopName}>{leg.fromStop}</Text>
            {departurePlatform && !stopHint ? (
              <View style={s.platformBadge}>
                <Text style={s.platformBadgeText}>{departurePlatform}</Text>
              </View>
            ) : null}
          </View>
          <Text style={s.cardTime}>{leg.departAt}</Text>
        </View>

        {/* 2. Stop-hint: M3 tonal callout container z mikro-ikoną */}
        {stopHint ? (
          <View style={s.stopHintContainer}>
            <MapPin size={13} color={scheme.primary} style={s.stopHintIcon} />
            <Text style={s.cardStopHint}>
              {!/^(słupek|peron|stanowisko|tor)\b/i.test(stopHint) && hintPlatform ? (
                <Text style={s.hintPlatformBold}>{hintPlatform} • </Text>
              ) : null}
              {stopHint}
            </Text>
          </View>
        ) : null}

        {/* 3. Poziomy separator */}
        <View style={s.cardSeparator} />

        {/* 4. Środek: linia, kierunek, sensors live + na czas, rozwijana lista, podsumowanie */}
        <View style={s.cardMiddleSection}>
          {isTrain ? (
            <RailAmenities
              tripId={leg.tripId}
              agency={leg.railAgency}
              trainNumber={leg.trainNumber}
              line={leg.line}
              trainName={leg.trainName}
            />
          ) : null}
          <View style={s.cardTop}>
            <View style={s.badgeWrap} onLayout={(e) => setBadgeWidth(e.nativeEvent.layout.width)}>
              <LineBadge leg={leg} />
            </View>
            <Text style={s.dir} numberOfLines={1}>
              {leg.mode === 'train' ? railDirectionLabel(leg) || leg.direction : leg.direction}
            </Text>
            <Animated.View style={chevronStyle}>
              <ChevronDown size={18} color={scheme.onSurfaceVariant} />
            </Animated.View>
          </View>

          {leg.live || notice || (delayMin !== 0 && scheduledDeparture != null) ? (
            <View style={s.liveStatusBlock}>
              <View style={[s.liveSensorsCol, { marginLeft: sensorCenterOffset }]}>
                {leg.live ? (
                  <LiveSensors color={scheme.success} size={15} pingKey={pingKey} />
                ) : null}
              </View>
              <View style={s.liveTextCol}>
                {leg.live ? (
                  <Text style={s.liveLocationLabel} numberOfLines={1}>
                    {waitingAtTerminus
                      ? t.leg.waitingAtTerminus
                      : nearestStop
                        ? t.leg.currentLocation(nearestStop.name)
                        : leg.liveNextStop
                          ? t.leg.currentLocation(leg.liveNextStop)
                          : liveNearLabel || t.leg.liveTracking}
                  </Text>
                ) : null}

                {delayMin !== 0 && scheduledDeparture != null ? (
                  <Text
                    style={[s.delayLabel, { color: delayMin > 0 ? scheme.error : scheme.warning }]}
                    numberOfLines={1}
                  >
                    {t.routeDetails.scheduledTime(secondsToTimeString(scheduledDeparture))}
                    {' · '}
                    {leg.delayConfidence === 'estimated'
                      ? t.routeDetails.estimatedDelay(delayMin)
                      : delayMin > 0
                        ? t.routeDetails.late(delayMin)
                        : t.routeDetails.early(-delayMin)}
                  </Text>
                ) : leg.live ? (
                  <Text style={[s.delayLabel, { color: scheme.success }]} numberOfLines={1}>
                    {notice || t.routeDetails.onTime}
                  </Text>
                ) : notice ? (
                  <Text style={s.meta}>{notice}</Text>
                ) : null}

                {leg.live && liveTimestamp ? <LiveDataAge timestamp={liveTimestamp} /> : null}
              </View>
            </View>
          ) : null}

          {/* Pionowa animacja rozwijania listy przystanków */}
          {(expanded || hasOpened) && (
            <Animated.View
              pointerEvents={expanded ? 'auto' : 'none'}
              style={[stopsAnimStyle, { marginLeft: stopsIndent, overflow: 'hidden' }]}
              accessibilityElementsHidden={!expanded}
              importantForAccessibility={expanded ? 'auto' : 'no-hide-descendants'}
            >
              <View
                style={s.stopsContent}
                onLayout={(e) => {
                  const h = Math.round(e.nativeEvent.layout.height);
                  if (h > 0 && Math.abs(h - measuredHeight.value) > 1) {
                    measuredHeight.value = h;
                    if (expanded) {
                      stopsHeightAnim.value = withTiming(h, motion.state);
                    }
                  }
                }}
              >
                <LegStopsList
                  leg={leg}
                  accent={accent}
                  userLocation={userLocation}
                  allowLive={allowLive}
                  stops={stops}
                  vehicle={vehicle}
                  loading={loading}
                  active={expanded}
                  track={track}
                />
              </View>
            </Animated.View>
          )}

          {/* Podsumowanie + pill rozwijania: kolej = stacje, reszta = przystanki. */}
          <View style={s.stopsSummaryWrap}>
            <View style={s.stopsSummaryText}>
              <Text style={s.stopsSummaryLabel}>
                {stopsCount <= 0
                  ? t.leg.directRide(durationMin)
                  : isTrain
                    ? t.leg.stationsCountShort(stopsCount)
                    : t.leg.stopsCountShort(stopsCount)}
              </Text>
              {stopsCount > 0 ? (
                <Text style={s.stopsSummaryMeta}>~{t.common.durMin(durationMin)}</Text>
              ) : null}
            </View>
            {stopsCount > 0 ? (
              <View style={[s.expandPill, expanded && s.expandPillOpen]}>
                <Text style={[s.expandPillText, expanded && s.expandPillTextOpen]}>
                  {t.leg.expandPill(expanded)}
                </Text>
              </View>
            ) : null}
          </View>
        </View>

        {/* 5. Poziomy separator */}
        <View style={s.cardSeparator} />

        {/* 6. Przystanek docelowy (bez prefixu "do:") + godzina przyjazdu po prawej */}
        <View style={s.cardEndRow}>
          <Text style={s.cardStopName}>{leg.toStop}</Text>
          <View style={s.arrivalTimes}>
            <Text style={s.cardTime}>{leg.arriveAt}</Text>
            {arrivalDelayMin !== 0 && arrivalDelayMin !== delayMin && (
              <Text
                style={[
                  s.delayLabel,
                  { color: arrivalDelayMin > 0 ? scheme.error : scheme.warning },
                ]}
                numberOfLines={1}
              >
                {leg.delayConfidence === 'estimated'
                  ? t.routeDetails.estimatedDelay(arrivalDelayMin)
                  : arrivalDelayMin > 0
                    ? t.routeDetails.late(arrivalDelayMin)
                    : t.routeDetails.early(-arrivalDelayMin)}
              </Text>
            )}
          </View>
        </View>
      </Pressable>
    </View>
  );
});

const DAY = 86400;

/** Czy teraz wypada odcinek pieszy: tylko wtedy GPS ma chodzić na High/1 Hz. */
function isWalkingNow(legs: Leg[], nowSec: number): boolean {
  for (const leg of legs) {
    if (leg.mode !== 'walk') continue;
    const depart = leg.scheduledDepartureSec ?? timeStringToSeconds(leg.departAt);
    let arrive = leg.scheduledArrivalSec ?? timeStringToSeconds(leg.arriveAt);
    if (arrive < depart) arrive += DAY;
    const current = depart >= DAY && nowSec < 43200 ? nowSec + DAY : nowSec;
    if (current >= depart - 120 && current <= arrive + 120) return true;
  }
  return false;
}

/** Vertical timeline bez railu po lewej stronie, wyśrodkowane dojścia pieszo. */
export function LegTimeline({ legs, observeOnly = false }: { legs: Leg[]; observeOnly?: boolean }) {
  const t = useStrings();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [walking, setWalking] = useState(() => isWalkingNow(legs, nowSecOfDay()));
  const walkMps = useWalkSpeedMps();
  const { location } = useCurrentLocation(!observeOnly, !observeOnly && walking);

  useEffect(() => {
    const update = () => setWalking(isWalkingNow(legs, nowSecOfDay()));
    update();
    const timer = setInterval(update, 15000);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') update();
    });
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [legs]);

  const toggleLeg = useCallback(
    (id: string) => setExpandedId((prev) => (prev === id ? null : id)),
    [],
  );

  const displayLegs = useMemo(
    () =>
      legs.length > 1
        ? legs.filter(
            (leg) =>
              !(
                leg.mode === 'walk' &&
                (leg.walkM ?? 0) <= 0 &&
                (leg.departAt === leg.arriveAt || leg.fromStop === leg.toStop)
              ),
          )
        : legs,
    [legs],
  );

  return (
    <View style={s.list}>
      {displayLegs.map((leg, i) => {
        if (leg.mode === 'walk') {
          const walkMin = walkMinutesFor(leg.walkM ?? 200, walkMps);
          const isSameStop =
            normalizeName(leg.fromStop) === normalizeName(leg.toStop) ||
            leg.fromStop.trim().toLowerCase() === leg.toStop.trim().toLowerCase();
          const prevLeg = displayLegs[i - 1];
          const nextLeg = displayLegs[i + 1];
          const isTransferWalk =
            prevLeg != null &&
            prevLeg.mode !== 'walk' &&
            nextLeg != null &&
            nextLeg.mode !== 'walk';

          return (
            <View key={leg.id} style={s.walkCentered}>
              <View style={s.walkConnectorLine} />
              <View style={s.walkPill}>
                <Footprints size={15} color={scheme.primary} />
                <Text style={s.walkPillTitle}>
                  {formatWalkTime(walkMin)}
                  {leg.walkM ? ` · ${Math.round(leg.walkM)} m` : ''}
                </Text>
              </View>
              {!isTransferWalk ? (
                isSameStop ? (
                  <Text style={s.walkSub} numberOfLines={1}>
                    {leg.fromStop}
                  </Text>
                ) : isFallbackOrigin(leg.fromStop) ? (
                  <Text style={s.walkSub} numberOfLines={1}>
                    {t.connection.walkTo(leg.toStop)}
                  </Text>
                ) : (
                  <View style={s.walkSubRow}>
                    <Text style={s.walkSub} numberOfLines={1}>
                      {leg.fromStop}
                    </Text>
                    <ArrowRight size={11} color={scheme.onSurfaceVariant} />
                    <Text style={s.walkSub} numberOfLines={1}>
                      {leg.toStop}
                    </Text>
                  </View>
                )
              ) : null}
              <View style={s.walkConnectorLine} />
            </View>
          );
        }
        const nextVehicle = legs.slice(i + 1).find((next) => next.mode !== 'walk');
        let transferGap = nextVehicle
          ? timeStringToSeconds(nextVehicle.departAt) - timeStringToSeconds(leg.arriveAt)
          : Infinity;
        if (transferGap < -43200) transferGap += 86400;
        const uncertainTransfer =
          (leg.delayConfidence === 'estimated' || leg.delayConfidence === 'untracked') &&
          transferGap < 360;
        const hasNextLeg = i < legs.length - 1;
        const nextLegIsTransit = hasNextLeg && legs[i + 1].mode !== 'walk';
        return (
          <View key={leg.id} style={s.cardContainer}>
            <TransitLegCard
              leg={leg}
              expanded={expandedId === leg.id}
              userLocation={observeOnly || expandedId !== leg.id ? null : location}
              allowLive={!observeOnly || leg.live}
              onToggle={toggleLeg}
            />
            {uncertainTransfer && (
              <Text style={s.uncertainText}>{t.routeDetails.uncertainTransfer}</Text>
            )}
            {nextLegIsTransit && (
              <View style={s.walkCentered}>
                <View style={s.walkConnectorLine} />
                <View style={s.walkPill}>
                  <Footprints size={15} color={scheme.primary} />
                  <Text style={s.walkPillTitle}>
                    {transferGap > 0 && transferGap < 3600
                      ? t.leg.transferMinutes(Math.round(transferGap / 60))
                      : t.leg.transfer}
                  </Text>
                </View>
                <View style={s.walkConnectorLine} />
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  list: {
    gap: 6,
    paddingHorizontal: 10,
  },
  cardContainer: {
    width: '100%',
    marginBottom: 4,
  },
  card: {
    width: '100%',
    backgroundColor: scheme.surfaceContainerHigh,
    borderRadius: 20,
    padding: 16,
    gap: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
    ...elev.level1,
  },
  cardStartRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  cardEndRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  arrivalTimes: {
    alignItems: 'flex-end',
    gap: 2,
    flexShrink: 1,
  },
  cardStopName: {
    fontSize: 22,
    lineHeight: 28,
    color: scheme.onSurface,
    fontWeight: '800',
    letterSpacing: -0.3,
    flexShrink: 1,
  },
  cardTime: {
    fontSize: 24,
    lineHeight: 28,
    color: scheme.onSurface,
    fontWeight: '800',
    letterSpacing: -0.5,
    fontVariant: ['tabular-nums'],
  },
  stopHintContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: scheme.surfaceContainerHigh,
    borderRadius: shape.small,
    paddingHorizontal: 9,
    paddingVertical: 5,
    gap: 6,
    marginTop: 4,
    marginBottom: 3,
    borderWidth: 1,
    borderColor: scheme.outlineVariant,
    alignSelf: 'flex-start',
  },
  stopHintIcon: {
    marginTop: 2,
  },
  cardStopHint: {
    ...type.bodySmall,
    color: scheme.onSurfaceVariant,
    fontSize: 12.5,
    lineHeight: 17,
    flexShrink: 1,
  },
  hintPlatformBold: {
    fontWeight: '700',
    color: scheme.onSurface,
  },
  cardSeparator: {
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.16)',
    width: '100%',
    marginVertical: 6,
  },
  cardMiddleSection: {
    gap: 6,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  badgeWrap: {
    alignItems: 'center',
  },
  dir: {
    flex: 1,
    ...type.labelLarge,
    color: scheme.onSurface,
  },
  liveStatusBlock: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginTop: 2,
  },
  liveSensorsCol: {
    width: 19,
    height: 19,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  liveTextCol: {
    flex: 1,
    gap: 3,
    justifyContent: 'center',
  },
  liveLocationLabel: {
    ...type.bodySmall,
    color: scheme.onSurface,
    fontWeight: '500',
    fontSize: 13,
    lineHeight: 18,
  },
  delayLabel: {
    ...type.bodySmall,
    fontWeight: '600',
    fontSize: 13,
    lineHeight: 18,
  },
  liveAgeLabel: {
    ...type.bodySmall,
    color: scheme.success,
    fontWeight: '500',
    fontSize: 12.5,
    lineHeight: 17,
    fontVariant: ['tabular-nums'],
  },
  stopsSummaryWrap: {
    marginTop: 10,
    marginBottom: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  stopsSummaryText: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    columnGap: 8,
    rowGap: 2,
  },
  stopsSummaryLabel: {
    ...type.bodySmall,
    color: scheme.onSurfaceVariant,
    fontSize: 12.5,
    fontWeight: '600',
  },
  stopsSummaryMeta: {
    ...type.bodySmall,
    color: scheme.outline,
    fontSize: 12,
    fontVariant: ['tabular-nums'],
  },
  expandPill: {
    minHeight: 28,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: shape.full,
    backgroundColor: scheme.secondaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  expandPillOpen: {
    backgroundColor: scheme.primaryContainer,
  },
  expandPillText: {
    ...type.labelSmall,
    color: scheme.onSecondaryContainer,
    fontWeight: '700',
  },
  expandPillTextOpen: {
    color: scheme.onPrimaryContainer,
  },
  stopTitleWrap: {
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: 4,
    flex: 1,
  },
  platformBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: shape.small,
    backgroundColor: scheme.secondaryContainer,
  },
  platformBadgeText: {
    ...type.labelSmall,
    color: scheme.onSecondaryContainer,
    fontWeight: '700',
    fontSize: 11,
    lineHeight: 14,
  },
  meta: {
    ...type.bodySmall,
    color: scheme.onSurfaceVariant,
  },
  walkCentered: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
    gap: 5,
    width: '100%',
  },
  walkConnectorLine: {
    width: 2,
    height: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.20)',
    borderRadius: 1,
  },
  walkPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: scheme.surfaceContainerHighest,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    ...elev.level1,
  },
  walkPillTitle: {
    ...type.labelMedium,
    color: scheme.onSurface,
    fontWeight: '700',
    fontSize: 13,
    letterSpacing: 0.1,
  },
  walkSubRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  walkSub: {
    ...type.bodySmall,
    color: scheme.onSurfaceVariant,
    fontSize: 12,
    fontWeight: '500',
    textAlign: 'center',
  },
  uncertainText: {
    ...type.bodySmall,
    color: scheme.onSurfaceVariant,
    marginTop: 4,
    textAlign: 'center',
  },
  stopsContent: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
  stopsWrap: {
    marginTop: 8,
    gap: 0,
  },
  stopRow: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'stretch',
    minHeight: 36,
  },
  stopRail: {
    width: 22,
    alignItems: 'center',
    position: 'relative',
  },
  stopRailLine: {
    position: 'absolute',
    left: 9.5,
    width: 3,
  },
  boundaryMark: {
    width: 19,
    height: 2,
    marginTop: 19,
    zIndex: 1,
  },
  boundaryBody: {
    flex: 1,
    flexDirection: 'row',
    gap: 8,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: scheme.outlineVariant,
    marginBottom: 6,
  },
  boundaryIcon: {
    marginTop: 2,
  },
  boundaryText: {
    flex: 1,
    gap: 2,
  },
  boundaryTitle: {
    ...type.labelMedium,
    color: scheme.onSurfaceVariant,
  },
  boundaryDetail: {
    ...type.bodySmall,
    color: scheme.onSurfaceVariant,
  },
  dot: {
    width: 11,
    height: 11,
    borderRadius: 99,
    marginTop: 10,
    zIndex: 1,
  },
  endpointDot: {
    width: 13,
    height: 13,
    borderRadius: 99,
    borderWidth: 2.5,
    marginTop: 9,
    zIndex: 1,
  },
  vehicleMarker: {
    position: 'absolute',
    top: 20,
    left: -1,
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: scheme.surface,
    backgroundColor: scheme.primary,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 3,
  },
  stopRowMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    minHeight: 36,
    paddingBottom: 10,
  },
  stopBody: {
    flex: 1,
    justifyContent: 'center',
    gap: 2,
    paddingTop: 2,
  },
  stopName: {
    ...type.bodyMedium,
    color: scheme.onSurface,
    lineHeight: 20,
  },
  stopNameStrong: {
    fontWeight: '700',
  },
  stopNamePassed: {
    color: scheme.outline,
  },
  stopMeta: {
    ...type.labelSmall,
    color: scheme.onSurfaceVariant,
    fontSize: 11,
    lineHeight: 14,
  },
  stopTimesCol: {
    alignItems: 'flex-end',
    gap: 1,
    paddingTop: 2,
    minWidth: 72,
  },
  stopTimePrimary: {
    ...type.labelMedium,
    color: scheme.onSurface,
    fontVariant: ['tabular-nums'],
    fontSize: 13,
    lineHeight: 17,
  },
  stopTimeSecondary: {
    ...type.labelSmall,
    color: scheme.onSurfaceVariant,
    fontVariant: ['tabular-nums'],
    fontSize: 11,
    lineHeight: 14,
  },
  stopTimeSingle: {
    ...type.labelMedium,
    color: scheme.onSurfaceVariant,
    fontVariant: ['tabular-nums'],
    fontSize: 13,
    lineHeight: 17,
    paddingTop: 2,
  },
  stopTimeStrong: {
    color: scheme.onSurface,
    fontWeight: '700',
  },
  skeletonDot: {
    borderColor: scheme.outlineVariant,
    backgroundColor: scheme.surfaceContainerHighest,
  },
  skeletonLine: {
    height: 12,
    borderRadius: 6,
    backgroundColor: scheme.surfaceContainerHighest,
    marginTop: 6,
  },
});
