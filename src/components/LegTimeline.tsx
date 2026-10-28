import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  ArrowRight,
  BusFront,
  ChevronDown,
  Footprints,
  Ticket,
  TrainFront,
  TramFront,
} from 'lucide-react-native';
import Animated, {
  LinearTransition,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { elev, scheme, shape, type } from '../theme/tokens';
import type { Leg, LegStop } from '../types/models';
import { getLineColors, LineBadge } from './LineBadge';
import { LiveDot } from './LiveDot';
import { RoutingService } from '../services';
import { formatWalkTime, useWalkSpeedMps, walkMinutesFor } from '../services/settings';
import { liveTracker, type TrackedVehicle } from '../services/liveTracker';
import { useCurrentLocation, type CurrentLocation } from '../services/currentLocation';

import {
  buildFallbackStops,
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

const legTransition = LinearTransition.duration(motion.enter.duration).easing(motion.enter.easing);

// Środek transportu w dopełniaczu („tramwajem między A a B"). Osobna gałąź na
// pociągi, metro, trolejbusy i koleje linowe: bez nich czytnik ekranu czytałby „autobusem".
function genericModeGen(t: Strings, mode: Leg['mode']): string {
  if (mode === 'tram') return t.routes.vehicleTramGen;
  if (mode === 'train') return t.routes.vehicleTrainGen;
  if (mode === 'subway') return t.routes.vehicleSubwayGen;
  if (mode === 'trolleybus') return t.routes.vehicleTrolleyGen;
  if (mode === 'cable') return t.routes.vehicleCableGen;
  return t.routes.vehicleBusGen;
}

// ─── Modułowy cache: brak flickeru przy zwijaniu/rozwijaniu ────────────────────
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
  return <Icon size={14} color={scheme.onPrimary} strokeWidth={2.4} />;
}

// ─── Wiersz przystanku (memo = brak re-renderów listy) ─────
// Rail rysuje linię przez całą wysokość wiersza i zachodzi 1 px na sąsiednie
// wiersze, więc między kropkami i na granicy stref nie ma żadnych szwów.
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
  // Linia biegnie przez cały wiersz i zachodzi 1 px na sąsiednie wiersze.
  // Osobny łącznik pod kropką zostawiał cienką szwę między wierszami.
  const lineCenter = boundary ? 20 : 10.5;
  const showLine = !(isFirst && isLast);
  const lineTop = isFirst ? lineCenter : -1;
  const lineStyle = isLast
    ? { top: lineTop, height: lineCenter + 1 - lineTop }
    : { top: lineTop, bottom: -1 };
  return (
    <View style={s.stopRow}>
      <View style={s.stopRail}>
        {showLine && (
          <View
            style={[
              s.stopRailLine,
              lineStyle,
              {
                backgroundColor:
                  vehicleGap != null && index < vehicleGap
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
            style={[
              s.stopName,
              emphasis && s.stopNameStrong,
              passed ? s.stopNamePassed : null,
            ]}
            numberOfLines={1}
          >
            {stop.name}
          </Text>
        </View>
      )}
    </View>
  );
});

// ─── Rozwijana lista kropek dla jednego lega ───────────────────────────────────
function LegStopsList({
  leg,
  accent,
  userLocation,
  allowLive,
}: {
  leg: Leg;
  accent: string;
  userLocation: CurrentLocation | null;
  allowLive: boolean;
}) {
  const t = useStrings();
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
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Lazy load pełnej sekwencji kursu, raz, wynik w cache modułowym. Odcinek
  // z planu (`intermediateStops`) to tylko wsiadanie-wysiadanie: pokazujemy
  // go od razu, ale do pozycji pojazdu między przystankami potrzebny jest
  // cały kurs z czasami.
  useEffect(() => {
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
      // Odrzucenie NIE jest zapamiętywane. Wcześniej `.catch(() => [])` trafiał
      // do `stopsPromise` razem z sukcesem, więc jedna chwilowa awaria (zamknięta
      // baza, odjęty slot importu) zostawiała ten kurs z dwoma przystankami
      // do końca życia procesu - użytkownik dostawał „trasa niepełna” bez
      // możliwości naprawienia.
      promise = RoutingService.getTripStops(leg.tripId)
        .then((stops) => {
          stopsPromise.delete(leg.tripId!);
          return stops;
        })
        .catch((err) => {
          stopsPromise.delete(leg.tripId!);
          throw err;
        });
      stopsPromise.set(leg.tripId, promise);
    }
    promise.then(
      (fetched) => {
        if (!mounted.current) return;
        // Do cache trafiają TYLKO przystanki z bazy. Wersja z `buildFallbackStops`
        // to dwa przystanki z etykiety - zapisana w cache na stałe psuła
        // wyświetlanie przy następnym otwarciu tego samego odcinka.
        if (fetched.length >= 2) cacheStops(cacheKey, fetched);
        setStops(fetched.length >= 2 ? fetched : buildFallbackStops(leg));
        setLoading(false);
      },
      (err) => {
        console.warn('[LegTimeline] trip stops failed:', err);
        if (!mounted.current) return;
        setStops(buildFallbackStops(leg));
        setLoading(false);
      },
    );
  }, [cacheKey, leg]);

  const segment = useMemo(() => findUserSegment(stops, leg), [stops, leg]);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const refreshVehicle = () => {
      const now = Date.now();
      setNow(now);
      if (!allowLive || !leg.tripId || (leg.mode !== 'tram' && leg.mode !== 'bus' && leg.mode !== 'subway')) {
        setVehicle(null);
        return;
      }
      const match = liveTracker
        .snapshot(leg.line)
        .find(
          (candidate) =>
            candidate.type === leg.mode &&
            candidate.matchedTripId === leg.tripId &&
            now - candidate.updatedAt >= 0 &&
            now - candidate.updatedAt <= 120_000,
        );
      setVehicle(match ?? null);
    };
    refreshVehicle();
    const timer = setInterval(refreshVehicle, 5000);
    return () => clearInterval(timer);
  }, [leg.line, leg.mode, leg.tripId, allowLive]);

  const livePosition = useMemo(
    () => allowLive ? locateLiveStopPosition(stops, leg, vehicle, userLocation, now) : null,
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
  const delayMin = leg.live || leg.delayConfidence === 'estimated' ? Math.round((leg.delaySec ?? 0) / 60) : 0;
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

  useEffect(() => {
    if (expanded) setHasOpened(true);
    chevron.value = withTiming(expanded ? 1 : 0, motion.state);
  }, [chevron, expanded]);

  const chevronStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${chevron.value * 180}deg` }],
  }));

  return (
    <Animated.View layout={legTransition}>
      <Pressable
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={[t.leg.expandA11y(leg.line ?? '', leg.direction ?? '', expanded), notice].filter(Boolean).join('. ')}
        style={({ pressed }) => [s.card, pressed && { opacity: 0.96 }]}
      >
        <View style={s.cardTop}>
          <LineBadge mode={leg.mode} line={leg.line} />
          <Text style={s.dir} numberOfLines={1}>
            {leg.direction}
          </Text>
          {leg.live ? <LiveDot color={scheme.success} size={8} /> : null}
          <Animated.View style={chevronStyle}>
            <ChevronDown size={18} color={scheme.onSurfaceVariant} />
          </Animated.View>
        </View>
        <Text style={s.stopBig}>
          <Text style={s.stopPrefix}>{t.leg.fromPrefix}</Text>
          {leg.fromStop} <Text style={s.hour}>{leg.departAt}</Text>
        </Text>
        {delayMin !== 0 && scheduledDeparture != null && (
          <Text style={[s.meta, { color: delayMin > 0 ? scheme.error : scheme.warning }]}>
            {t.routeDetails.scheduledTime(secondsToTimeString(scheduledDeparture))}
            {' · '}
            {leg.delayConfidence === 'estimated' ? t.routeDetails.estimatedDelay(delayMin) : delayMin > 0 ? t.routeDetails.late(delayMin) : t.routeDetails.early(-delayMin)}
          </Text>
        )}
        {notice && (delayMin === 0 || scheduledDeparture == null) && <Text style={s.meta}>{notice}</Text>}
        <Text style={s.meta}>{t.leg.stopsSummary(stopsCount, stopsCount * 2, expanded)}</Text>
        <Text style={s.stopBig}>
          <Text style={s.stopPrefix}>{t.leg.toPrefix}</Text>
          {leg.toStop} <Text style={s.hour}>{leg.arriveAt}</Text>
        </Text>
        {(expanded || hasOpened) && (
          <Animated.View
            layout={legTransition}
            style={expanded ? s.stopsWrap : s.stopsCollapsed}
            accessibilityElementsHidden={!expanded}
            importantForAccessibility={expanded ? 'auto' : 'no-hide-descendants'}
          >
            <LegStopsList leg={leg} accent={accent} userLocation={userLocation} allowLive={allowLive} />
          </Animated.View>
        )}
      </Pressable>
    </Animated.View>
  );
}

/** Jakdojade-style vertical timeline. Boxy tram/bus są klikalne (akordeon). */
export function LegTimeline({ legs, observeOnly = false }: { legs: Leg[]; observeOnly?: boolean }) {
  const t = useStrings();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const walkMps = useWalkSpeedMps();
  const { location } = useCurrentLocation(!observeOnly);

  return (
    <View style={s.list}>
      {legs.map((leg, i) => {
        const last = i === legs.length - 1;
        if (leg.mode === 'walk') {
          const walkMin = walkMinutesFor(leg.walkM ?? 200, walkMps);
          const isSameStop =
            normalizeName(leg.fromStop) === normalizeName(leg.toStop) ||
            leg.fromStop.trim().toLowerCase() === leg.toStop.trim().toLowerCase();

          return (
            <Animated.View key={leg.id} layout={legTransition} style={s.row}>
              <View style={s.rail}>
                <View style={s.walkLine} />
                <View style={[s.node, s.walkNode]}>
                  <Footprints size={13} color={scheme.onSurfaceVariant} />
                </View>
                {!last && <View style={s.walkLine} />}
              </View>
              <View style={s.body}>
                <Text style={s.walkText}>{formatWalkTime(walkMin)}</Text>
                {isSameStop ? (
                  <Text style={s.walkSub} numberOfLines={1}>
                    {leg.fromStop}
                  </Text>
                ) : (
                  <View style={s.walkSubRow}>
                    <Text style={s.walkSub} numberOfLines={1}>
                      {leg.fromStop}
                    </Text>
                    <ArrowRight size={12} color={scheme.onSurfaceVariant} strokeWidth={2} />
                    <Text style={s.walkSub} numberOfLines={1}>
                      {leg.toStop}
                    </Text>
                  </View>
                )}
              </View>
            </Animated.View>
          );
        }
        const { bg: accent } = getLineColors(leg.line, leg.mode);
        const nextVehicle = legs.slice(i + 1).find(next => next.mode !== 'walk');
        let transferGap = nextVehicle ? timeStringToSeconds(nextVehicle.departAt) - timeStringToSeconds(leg.arriveAt) : Infinity;
        if (transferGap < -43200) transferGap += 86400;
        const uncertainTransfer = (leg.delayConfidence === 'estimated' || leg.delayConfidence === 'untracked') && transferGap < 360;
        return (
          <Animated.View key={leg.id} layout={legTransition} style={s.row}>
            <View style={s.rail}>
              {!last && <View style={[s.spine, { backgroundColor: accent }]} />}
              <View style={[s.node, { borderColor: accent }]}>
                <View style={[s.innerDot, { backgroundColor: accent }]} />
              </View>
            </View>
            <View style={s.cardWrap}>
              <TransitLegCard
                leg={leg}
                expanded={expandedId === leg.id}
                userLocation={observeOnly ? null : location}
                allowLive={!observeOnly || leg.live}
                onToggle={() => setExpandedId((prev) => (prev === leg.id ? null : leg.id))}
              />
              {uncertainTransfer && <Text style={s.meta}>{t.routeDetails.uncertainTransfer}</Text>}
            </View>
          </Animated.View>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  list: { gap: 2 },
  row: { flexDirection: 'row', gap: 12 },
  rail: { width: 34, alignItems: 'center', position: 'relative', paddingVertical: 4 },
  spine: { position: 'absolute', top: 0, bottom: -6, width: 4, borderRadius: 99, opacity: 0.85 },
  walkLine: { width: 2, height: 18, backgroundColor: scheme.outlineVariant },
  node: {
    width: 26,
    height: 26,
    borderRadius: 99,
    backgroundColor: scheme.surface,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  walkNode: { borderWidth: 1, borderColor: scheme.outlineVariant },
  innerDot: { width: 8, height: 8, borderRadius: 99 },
  body: { flex: 1, paddingVertical: 8, gap: 2 },
  cardWrap: { flex: 1, marginBottom: 10 },
  // M3 filled card: tonal surface, bez obramowań - kolor linii niosą
  // badge linii oraz kropki/linia na railu po lewej, więc pasek jest zbędny
  card: {
    flex: 1,
    backgroundColor: scheme.surfaceContainer,
    borderRadius: shape.large,
    padding: 14,
    gap: 8,
    ...elev.level1,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dir: { flex: 1, ...type.labelLarge, color: scheme.onSurface },
  stopBig: { ...type.titleSmall, color: scheme.onSurface },
  stopPrefix: { fontWeight: '400', color: scheme.onSurfaceVariant },
  hour: { color: scheme.onSurfaceVariant, fontWeight: '400' },
  meta: { ...type.bodySmall, color: scheme.onSurfaceVariant },
  walkText: { ...type.titleSmall, color: scheme.onSurface },
  walkSubRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
    marginTop: 1,
  },
  walkSub: { ...type.bodySmall, color: scheme.onSurfaceVariant, flexShrink: 1 },
  // Rozwinięta lista kropek - wysokość animowana layout-animation przez rodzica,
  // tutaj zwykły kontener bez własnych animacji wejścia/wyjścia
  stopsWrap: { marginTop: 8, gap: 0 },
  stopsCollapsed: { height: 0, opacity: 0, overflow: 'hidden', marginTop: 0 },
  stopRow: { flexDirection: 'row', gap: 10, alignItems: 'stretch' },
  stopRail: { width: 22, alignItems: 'center', position: 'relative' },
  stopRailLine: { position: 'absolute', left: 9.5, width: 3 },
  boundaryMark: { width: 19, height: 2, marginTop: 19, zIndex: 1 },
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
  boundaryIcon: { marginTop: 2 },
  boundaryText: { flex: 1, gap: 2 },
  boundaryTitle: { ...type.labelMedium, color: scheme.onSurfaceVariant },
  boundaryDetail: { ...type.bodySmall, color: scheme.onSurfaceVariant },
  dot: { width: 13, height: 13, borderRadius: 99, borderWidth: 2, marginTop: 4, zIndex: 1 },
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
  stopBody: { flex: 1, justifyContent: 'center', minHeight: 30, paddingBottom: 6 },
  stopName: { ...type.bodyMedium, color: scheme.onSurface },
  stopNameStrong: { fontWeight: '700' },
  stopNamePassed: { color: scheme.outline },
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
