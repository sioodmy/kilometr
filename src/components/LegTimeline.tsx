import { memo, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
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
import Animated, {
  Easing,
  LinearTransition,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { elev, scheme, shape, type } from '../theme/tokens';
import type { Leg, LegStop } from '../types/models';
import { getLineColors, LineBadge } from './LineBadge';
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
} from '../services/vehiclePosition';
import { useStrings, type Strings } from '../i18n';
import { motion } from '../theme/motion';
import { isFareBoundary, parseFareBoundary } from '../gtfs/fareBoundary';
import { secondsToTimeString, timeStringToSeconds } from '../gtfs/geo';
import { scheduledLegTimes } from '../services/routing/connectionTimes';
import { reliabilityNotice } from './reliabilityNotice';
import { useStopHint } from '../services/stopHints';
import { getActiveCityIdSync } from '../services/cityStore';

const legTransition = LinearTransition.duration(motion.enter.duration).easing(motion.enter.easing);

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

function formatPlatformLabel(code?: string | null, mode?: Leg['mode'], stopName?: string | null): string | null {
  let trimmed = (code || '').trim();
  if (!trimmed && stopName) {
    const m = stopName.trim().match(/\s(\d{2})$/);
    if (m) {
      trimmed = m[1];
    }
  }
  if (!trimmed) return null;

  if (/^(peron|słupek|słup|stanowisko)\b/i.test(trimmed)) {
    return trimmed;
  }

  // Węzły GZM: np. 2469011-00103 -> Stanowisko 3
  const gzmMatch = trimmed.match(/-(\d{3})(\d{2})([a-z]?)$/i);
  if (gzmMatch) {
    return `Stanowisko ${parseInt(gzmMatch[2], 10)}`;
  }

  // Zespoły / Kraków: np. 103-05 -> Słupek 05 (lub Peron 1/2 dla tramwaju)
  const krkMatch = trimmed.match(/^\d{1,4}-(\d{2})$/);
  if (krkMatch) {
    const poleNum = krkMatch[1];
    const n = parseInt(poleNum, 10);
    if (mode === 'tram' && (n === 1 || n === 2)) {
      return `Peron ${n}`;
    }
    return `Słupek ${poleNum}`;
  }

  // Pociąg / metro
  if (mode === 'train' || mode === 'subway') {
    return `Peron ${trimmed}`;
  }

  // 1-2 cyfry (np. Warszawa '01', Poznań '71', '42')
  if (/^\d{1,2}$/.test(trimmed)) {
    const n = parseInt(trimmed, 10);
    if (n >= 41 && n <= 49) {
      return `PST Słupek ${trimmed}`;
    }
    if (trimmed.startsWith('0') || n >= 10) {
      return `Słupek ${trimmed}`;
    }
    return `Peron ${trimmed}`;
  }

  // 5-cyfrowy kod słupka (np. Wrocław 20820)
  if (/^\d{5}$/.test(trimmed)) {
    return `Słupek ${trimmed}`;
  }

  return `Peron ${trimmed}`;
}

// ─── Modułowy cache: brak flickeru przy zwijaniu/rozwijaniu ───────────────────
// Limit wpisów, żeby przeglądanie setek kursów w jednej sesji nie zjadało
// pamięci. Map w JS zachowuje kolejność wstawień, więc evictFirst() usuwa
// najstarszy wpis - bez dodatkowej kolejki.
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
  index,
  vehicleMode,
  emphasis,
  accent,
  connectorAccent,
  vehicleGap,
  vehicleLabel,
}: {
  stop: LegStop;
  isFirst: boolean;
  isLast: boolean;
  index: number;
  vehicleMode: Leg['mode'];
  /** Przystanek startowy albo końcowy odcinka - wyróżniony wagą. */
  emphasis: boolean;
  accent: string;
  connectorAccent: boolean;
  vehicleGap: number | null;
  vehicleLabel: string;
}) {
  const t = useStrings();
  const boundary = parseFareBoundary(stop.name);
  // Przystanek pojazd już minął: wyszarzony, tak samo jak dotychczas przejechane.
  const passed = vehicleGap != null && index <= vehicleGap;
  const markerHere = vehicleGap === index && !isLast;
  const lineCenter = boundary ? 20 : 10.5;
  const incomingPassed = vehicleGap != null && index <= vehicleGap;
  const outgoingPassed = vehicleGap != null && index < vehicleGap;
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
            boundary ? s.boundaryMark : s.dot,
            passed
              ? { backgroundColor: scheme.outline, borderColor: scheme.outline }
              : { backgroundColor: accent, borderColor: accent },
          ]}
        />
        {markerHere && (
          <View
            accessible
            accessibilityRole="image"
            accessibilityLabel={vehicleLabel}
            style={s.vehicleMarker}
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
        <View style={s.stopBody}>
          <Text
            style={[s.stopName, emphasis && s.stopNameStrong, passed ? s.stopNamePassed : null]}
            numberOfLines={1}
          >
            {stop.name}
          </Text>
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
}: {
  leg: Leg;
  accent: string;
  userLocation: CurrentLocation | null;
  allowLive: boolean;
  stops: LegStop[];
  vehicle: TrackedVehicle | null;
  loading: boolean;
}) {
  const t = useStrings();
  const segment = useMemo(() => findUserSegment(stops, leg), [stops, leg]);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(timer);
  }, []);

  const livePosition = useMemo(
    () => (allowLive ? locateLiveStopPosition(stops, leg, vehicle, userLocation, now) : null),
    [stops, leg, vehicle, userLocation, now, allowLive],
  );
  const vehicleGap = livePosition?.gap ?? null;

  if (loading) {
    return (
      <View style={s.stopsWrap}>
        {[0, 1, 2].map((i) => (
          <View key={i} style={s.stopRow}>
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
        return (
          <StopRow
            key={`${stop.stopId}-${stop.seq}`}
            stop={stop}
            isFirst={i === segment.start}
            isLast={i === segment.end}
            index={i}
            vehicleMode={leg.mode}
            emphasis={i === segment.start || i === segment.end}
            accent={accent}
            connectorAccent={connectorAccent}
            vehicleGap={vehicleGap}
            vehicleLabel={t.leg.vehicleBetween(
              genericModeGen(t, leg.mode),
              stop.name,
              stops[i + 1]?.name ?? stop.name,
            )}
          />
        );
      })}
    </View>
  );
}

// ─── Karta jednego przejazdu (klik = rozwiń) ──────────────────────────────────
// Rozwijanie animowaną wysokością (a nie montowaniem): lista montuje się raz
// przy pierwszym otwarciu i zostaje, a kontener płynnie rośnie/maleje.
// Dzięki temu zero skoku layoutu i zero flickeru.
function TransitLegCard({
  leg,
  expanded,
  onToggle,
  userLocation,
  allowLive,
}: {
  leg: Leg;
  expanded: boolean;
  onToggle: () => void;
  userLocation: CurrentLocation | null;
  allowLive: boolean;
}) {
  // `t`, nie `s`: modułowy StyleSheet nazywa się już `s`.
  const t = useStrings();
  const { bg: accent } = getLineColors(leg.line, leg.mode);
  const scheduledDeparture = scheduledLegTimes(leg, timeStringToSeconds(leg.departAt)).departure;
  const delayMin =
    leg.live || leg.delayConfidence === 'estimated' ? Math.round((leg.delaySec ?? 0) / 60) : 0;
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
  const chevron = useSharedValue(0);
  const [hasOpened, setHasOpened] = useState(expanded);

  // Mierzymy szerokość badge linii, by wyśrodkować ikonę sensors pod nim
  // i wyrównać kółko rozwijanej listy z początkiem tekstu statusu live.
  const [badgeWidth, setBadgeWidth] = useState(56);
  const [stopsListHeight, setStopsListHeight] = useState(0);
  const stopsHeightAnim = useSharedValue(0);
  const sensorSize = 19;
  const sensorCenterOffset = Math.max(0, badgeWidth / 2 - sensorSize / 2);
  const stopsIndent = sensorCenterOffset + sensorSize + 8 - 11;

  const activeCityId = useMemo(() => getActiveCityIdSync(), []);
  const resolvedHint = useStopHint(activeCityId, leg.platformCode, leg.fromStopId, leg.fromStop);
  const stopHint = leg.stopHint ?? resolvedHint;
  const departurePlatform = useMemo(
    () => formatPlatformLabel(leg.platformCode, leg.mode, leg.fromStop),
    [leg.platformCode, leg.mode, leg.fromStop],
  );

  const cacheKey = leg.tripId || leg.id;
  const [stops, setStops] = useState<LegStop[]>(
    () => stopsCache.get(cacheKey) ?? buildFallbackStops(leg),
  );
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
      const match = liveTracker
        .snapshot(leg.line)
        .find(
          (candidate) =>
            candidate.matchedTripId === leg.tripId &&
            now - candidate.updatedAt >= 0 &&
            now - candidate.updatedAt <= 120_000,
        );
      setVehicle(match ?? null);
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

  const liveNearLabel = useMemo(() => {
    if (!nearestStop) return null;
    const modeName = genericModeNom(t, leg.mode);
    return t.leg.nearStop(modeName, nearestStop.name);
  }, [nearestStop, t, leg.mode]);

  const pingKey = vehicle?.updatedAt ?? (leg.live ? lastOk : undefined);

  useEffect(() => {
    if (expanded) setHasOpened(true);
    chevron.value = withTiming(expanded ? 1 : 0, motion.state);
  }, [chevron, expanded]);

  const chevronStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${chevron.value * 180}deg` }],
  }));

  // Pionowa animacja wysokości listy przystanków (bez ukosnego rozwijania).
  useEffect(() => {
    if (stopsListHeight > 0) {
      stopsHeightAnim.value = withTiming(expanded ? stopsListHeight : 0, {
        duration: 220,
        easing: Easing.out(Easing.quad),
      });
    }
  }, [expanded, stopsListHeight, stopsHeightAnim]);

  const stopsAnimStyle = useAnimatedStyle(() => ({
    height: stopsHeightAnim.value,
    opacity: stopsHeightAnim.value > 0 ? 1 : 0,
  }));

  return (
    <Animated.View layout={legTransition}>
      <Pressable
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={[
          t.leg.expandA11y(leg.line ?? '', leg.direction ?? '', expanded),
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
            {departurePlatform ? (
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
              {!/^(słupek|peron|stanowisko)\b/i.test(stopHint) && departurePlatform ? (
                <Text style={s.hintPlatformBold}>{departurePlatform} • </Text>
              ) : null}
              {stopHint}
            </Text>
          </View>
        ) : null}

        {/* 3. Poziomy separator */}
        <View style={s.cardSeparator} />

        {/* 4. Środek: linia, kierunek, sensors live + na czas, rozwijana lista, podsumowanie */}
        <View style={s.cardMiddleSection}>
          <View style={s.cardTop}>
            <View
              style={s.badgeWrap}
              onLayout={(e) => setBadgeWidth(e.nativeEvent.layout.width)}
            >
              <LineBadge mode={leg.mode} line={leg.line} />
            </View>
            <Text style={s.dir} numberOfLines={1}>
              {leg.direction}
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
                    {nearestStop
                      ? `Obecna lokacja: ${nearestStop.name}`
                      : leg.liveNextStop
                        ? `Obecna lokacja: ${leg.liveNextStop}`
                        : liveNearLabel || 'Śledzenie na żywo'}
                  </Text>
                ) : null}

                {delayMin !== 0 && scheduledDeparture != null ? (
                  <Text
                    style={[
                      s.delayLabel,
                      { color: delayMin > 0 ? scheme.error : scheme.warning },
                    ]}
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
              </View>
            </View>
          ) : null}

          {/* Pionowa animacja rozwijania listy przystanków */}
          <View
            style={s.stopsMeasure}
            pointerEvents="none"
            onLayout={(e) => setStopsListHeight(e.nativeEvent.layout.height)}
          >
            <LegStopsList
              leg={leg}
              accent={accent}
              userLocation={userLocation}
              allowLive={allowLive}
              stops={stops}
              vehicle={vehicle}
              loading={loading}
            />
          </View>
          {(expanded || hasOpened) && (
            <Animated.View
              style={[
                stopsAnimStyle,
                { marginLeft: stopsIndent, overflow: 'hidden' },
              ]}
              accessibilityElementsHidden={!expanded}
              importantForAccessibility={expanded ? 'auto' : 'no-hide-descendants'}
            >
              <LegStopsList
                leg={leg}
                accent={accent}
                userLocation={userLocation}
                allowLive={allowLive}
                stops={stops}
                vehicle={vehicle}
                loading={loading}
              />
            </Animated.View>
          )}

          {/* Etykieta podsumowania przystanków - bliżej separatora, dalej od sekcji live/na czas */}
          <View style={s.stopsSummaryWrap}>
            <Text style={s.stopsSummaryLabel}>
              {t.leg.stopsSummary(stopsCount, stopsCount * 2, expanded)}
            </Text>
          </View>
        </View>

        {/* 5. Poziomy separator */}
        <View style={s.cardSeparator} />

        {/* 6. Przystanek docelowy (bez prefixu "do:") + godzina przyjazdu po prawej */}
        <View style={s.cardEndRow}>
          <Text style={s.cardStopName}>{leg.toStop}</Text>
          <Text style={s.cardTime}>{leg.arriveAt}</Text>
        </View>
      </Pressable>
    </Animated.View>
  );
}

/** Vertical timeline bez railu po lewej stronie, wyśrodkowane dojścia pieszo. */
export function LegTimeline({ legs, observeOnly = false }: { legs: Leg[]; observeOnly?: boolean }) {
  const t = useStrings();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const walkMps = useWalkSpeedMps();
  const { location } = useCurrentLocation(!observeOnly);

  return (
    <View style={s.list}>
      {legs.map((leg, i) => {
        if (leg.mode === 'walk') {
          const walkMin = walkMinutesFor(leg.walkM ?? 200, walkMps);
          const isSameStop =
            normalizeName(leg.fromStop) === normalizeName(leg.toStop) ||
            leg.fromStop.trim().toLowerCase() === leg.toStop.trim().toLowerCase();

          return (
            <Animated.View key={leg.id} layout={legTransition} style={s.walkCentered}>
              <View style={s.walkConnectorLine} />
              <View style={s.walkPill}>
                <Footprints size={15} color={scheme.primary} />
                <Text style={s.walkPillTitle}>
                  {formatWalkTime(walkMin)}
                  {leg.walkM ? ` · ${Math.round(leg.walkM)} m` : ''}
                </Text>
              </View>
              {isSameStop ? (
                <Text style={s.walkSub} numberOfLines={1}>
                  {leg.fromStop}
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
              )}
              <View style={s.walkConnectorLine} />
            </Animated.View>
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
          <Animated.View key={leg.id} layout={legTransition} style={s.cardContainer}>
            <TransitLegCard
              leg={leg}
              expanded={expandedId === leg.id}
              userLocation={observeOnly ? null : location}
              allowLive={!observeOnly || leg.live}
              onToggle={() => setExpandedId((prev) => (prev === leg.id ? null : leg.id))}
            />
            {uncertainTransfer && <Text style={s.uncertainText}>{t.routeDetails.uncertainTransfer}</Text>}
            {nextLegIsTransit && (
              <View style={s.walkCentered}>
                <View style={s.walkConnectorLine} />
                <View style={s.walkPill}>
                  <Footprints size={15} color={scheme.primary} />
                  <Text style={s.walkPillTitle}>
                    {transferGap > 0 && transferGap < 3600
                      ? `Przesiadka · ~${Math.round(transferGap / 60)} min`
                      : 'Przesiadka'}
                  </Text>
                </View>
                <Text style={s.walkSub} numberOfLines={1}>
                  {leg.toStop}
                </Text>
                <View style={s.walkConnectorLine} />
              </View>
            )}
          </Animated.View>
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
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  cardEndRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
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
    backgroundColor: 'rgba(92, 219, 190, 0.08)',
    borderRadius: shape.small,
    paddingHorizontal: 9,
    paddingVertical: 5,
    gap: 6,
    marginTop: 4,
    marginBottom: 3,
    borderWidth: 1,
    borderColor: 'rgba(92, 219, 190, 0.18)',
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
  stopsSummaryWrap: {
    marginTop: 10,
    marginBottom: 2,
  },
  stopsSummaryLabel: {
    ...type.bodySmall,
    color: scheme.onSurfaceVariant,
    fontSize: 12.5,
  },
  stopTitleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
    flexWrap: 'wrap',
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
  stopsWrap: {
    marginTop: 8,
    gap: 0,
  },
  stopsMeasure: {
    position: 'absolute',
    opacity: 0,
    left: -9999,
    top: 0,
    width: '100%',
  },
  stopRow: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'stretch',
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
    width: 13,
    height: 13,
    borderRadius: 99,
    borderWidth: 2,
    marginTop: 4,
    zIndex: 1,
  },
  vehicleMarker: {
    position: 'absolute',
    top: 17,
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
  stopBody: {
    flex: 1,
    justifyContent: 'center',
    minHeight: 30,
    paddingBottom: 6,
  },
  stopName: {
    ...type.bodyMedium,
    color: scheme.onSurface,
  },
  stopNameStrong: {
    fontWeight: '700',
  },
  stopNamePassed: {
    color: scheme.outline,
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
