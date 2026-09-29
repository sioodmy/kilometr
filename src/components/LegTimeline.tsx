import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ArrowRight, ChevronDown, Footprints } from 'lucide-react-native';
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
import {
  buildFallbackStops,
  findUserSegment,
  locateVehicle,
  normalizeName,
} from '../services/vehiclePosition';
import { useStrings } from '../i18n';

// Logika pozycji pojazdu mieszka w serwisie, bo korzysta z niej również
// silnik powiadomień (nie chcemy, żeby serwis importował komponent).
export { buildFallbackStops, findUserSegment, locateVehicle } from '../services/vehiclePosition';
export type { VehicleGap } from '../services/vehiclePosition';

// ─── Modułowy cache: brak flickeru przy zwijaniu/rozwijaniu ────────────────────
// Limit wpisów, żeby przeglądanie setek kursów w jednej sesji nie zjadało
// pamięci. Map w JS zachowuje kolejność wstawień, więc evictFirst() usuwa
// najstarszy wpis — bez dodatkowej kolejki.
const STOPS_CACHE_MAX = 80;
const stopsCache = new Map<string, LegStop[]>();
const stopsPromise = new Map<string, Promise<LegStop[]>>();

function cacheStops(key: string, stops: LegStop[]) {
  stopsCache.set(key, stops);
  if (stopsCache.size <= STOPS_CACHE_MAX) return;
  const oldest = stopsCache.keys().next();
}

// ─── Wiersz przystanku (memo = brak re-renderów listy) ─────
// Rail ma KRESKĘ CIĄGŁĄ: kropka + łącznik flex:1 rozciągany na wysokość wiersza.
// Dzięki temu linia jest rzeczywiście połączona przez wszystkie kropki.
const StopRow = memo(function StopRow({
  stop,
  isLast,
  inSegment,
  accent,
  connectorAccent,
}: {
  stop: LegStop;
  isLast: boolean;
  inSegment: boolean;
  accent: string;
  connectorAccent: boolean;
}) {
  return (
    <View style={s.stopRow}>
      <View style={s.stopRail}>
        <View
          style={[
            s.dot,
            inSegment
              ? { backgroundColor: accent, borderColor: accent }
              : { backgroundColor: scheme.surface, borderColor: scheme.outlineVariant },
          ]}
        />
        {!isLast && (
          <View style={[s.connector, { backgroundColor: connectorAccent ? accent : scheme.outlineVariant }]} />
        )}
      </View>
      <View style={s.stopBody}>
        <Text style={[s.stopName, !inSegment && s.stopNameDim]} numberOfLines={1}>
          {stop.name}
        </Text>
      </View>
    </View>
  );
});

// ─── Rozwijana lista kropek dla jednego lega ───────────────────────────────────
function LegStopsList({ leg, accent }: { leg: Leg; accent: string }) {
  const cacheKey = leg.tripId || leg.id;
  const [stops, setStops] = useState<LegStop[]>(() => stopsCache.get(cacheKey) ?? buildFallbackStops(leg));
  const [loading, setLoading] = useState(() => !stopsCache.has(cacheKey) && !!leg.tripId);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Lazy load pełnej sekwencji kursu — raz, wynik w cache modułowym
  useEffect(() => {
    if (leg.intermediateStops && leg.intermediateStops.length >= 2) {
      stopsCache.set(cacheKey, leg.intermediateStops);
      setStops(leg.intermediateStops);
      setLoading(false);
      return;
    }
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
    setLoading(true);
    let promise = stopsPromise.get(leg.tripId);
    if (!promise) {
      // Odrzucenie NIE jest zapamiętywane. Wcześniej `.catch(() => [])` trafiał
      // do `stopsPromise` razem z sukcesem, więc jedna chwilowa awaria (zamknięta
      // baza, odjęty slot importu) zostawiała ten kurs z dwoma przystankami
      // do końca życia procesu — użytkownik dostawał „trasa niepełna” bez
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
        // to dwa przystanki z etykiety — zapisana w cache na stałe psuła
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
      {stops.map((stop, i) => {
        const inSegment = i >= segment.start && i <= segment.end;
        const connectorAccent = i >= segment.start && i + 1 <= segment.end;
        return (
          <StopRow
            key={`${stop.stopId}-${stop.seq}`}
            stop={stop}
            isLast={i === stops.length - 1}
            inSegment={inSegment}
            accent={accent}
            connectorAccent={connectorAccent}
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
}: {
  leg: Leg;
  expanded: boolean;
  onToggle: () => void;
}) {
  // `t`, nie `s`: modułowy StyleSheet nazywa się już `s`.
  const t = useStrings();
  const { bg: accent } = getLineColors(leg.line, leg.mode);
  const chevron = useSharedValue(0);
  const [hasOpened, setHasOpened] = useState(false);

  useEffect(() => {
    if (expanded) setHasOpened(true);
    chevron.value = withTiming(expanded ? 1 : 0, { duration: 220 });
  }, [chevron, expanded]);

  const chevronStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${chevron.value * 180}deg` }],
  }));

  return (
    <Animated.View layout={LinearTransition.duration(280)}>
      <Pressable
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={t.leg.expandA11y(leg.line ?? '', leg.direction ?? '', expanded)}
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
        <Text style={s.meta}>
          {t.leg.stopsSummary(leg.stopsCount, leg.stopsCount * 2, expanded)}
        </Text>
        <Text style={s.stopBig}>
          <Text style={s.stopPrefix}>{t.leg.toPrefix}</Text>
          {leg.toStop} <Text style={s.hour}>{leg.arriveAt}</Text>
        </Text>
        {hasOpened && (
          <Animated.View
            layout={LinearTransition.duration(280)}
            style={expanded ? s.stopsWrap : s.stopsCollapsed}
          >
            <LegStopsList leg={leg} accent={accent} />
          </Animated.View>
        )}
      </Pressable>
    </Animated.View>
  );
}

/** Jakdojade-style vertical timeline. Boxy tram/bus są klikalne (akordeon). */
export function LegTimeline({ legs }: { legs: Leg[] }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const walkMps = useWalkSpeedMps();

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
            <Animated.View key={leg.id} layout={LinearTransition.duration(280)} style={s.row}>
              <View style={s.rail}>
                <View style={s.walkLine} />
                <View style={[s.node, s.walkNode]}>
                  <Footprints size={13} color={scheme.onSurfaceVariant} />
                </View>
                {!last && <View style={s.walkLine} />}
              </View>
              <View style={s.body}>
                <Text style={s.walkText}>
                  {formatWalkTime(walkMin)}
                </Text>
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
        return (
          <Animated.View key={leg.id} layout={LinearTransition.duration(280)} style={s.row}>
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
                onToggle={() => setExpandedId((prev) => (prev === leg.id ? null : leg.id))}
              />
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
  // M3 filled card: tonal surface, bez obramowań — kolor linii niosą
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
  walkSubRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 1 },
  walkSub: { ...type.bodySmall, color: scheme.onSurfaceVariant, flexShrink: 1 },
  // Rozwinięta lista kropek — wysokość animowana layout-animation przez rodzica,
  // tutaj zwykły kontener bez własnych animacji wejścia/wyjścia
  stopsWrap: { marginTop: 8, gap: 0 },
  stopsCollapsed: { height: 0, opacity: 0, overflow: 'hidden', marginTop: 0 },
  stopRow: { flexDirection: 'row', gap: 10, alignItems: 'stretch' },
  stopRail: { width: 22, alignItems: 'center', position: 'relative' },
  dot: { width: 13, height: 13, borderRadius: 99, borderWidth: 2, marginTop: 4, zIndex: 1 },
  connector: { width: 3, flex: 1, minHeight: 12, borderRadius: 99, marginTop: -1 },
  stopBody: { flex: 1, justifyContent: 'center', minHeight: 30, paddingBottom: 6 },
  stopName: { ...type.bodyMedium, color: scheme.onSurface },
  stopNameDim: { color: scheme.onSurfaceVariant },
  skeletonDot: { borderColor: scheme.outlineVariant, backgroundColor: scheme.surfaceContainerHighest },
  skeletonLine: {
    height: 12,
    borderRadius: 6,
    backgroundColor: scheme.surfaceContainerHighest,
    marginTop: 6,
  },
});
