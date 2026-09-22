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
import type { Leg, LegStop, VehiclePosition } from '../types/models';
import { getLineColors, LineBadge } from './LineBadge';
import { LiveDot } from './LiveDot';
import { RoutingService } from '../services';
import { formatWalkTime } from '../services/settings';

// ─── Modułowy cache: brak flickeru przy zwijaniu/rozwijaniu ────────────────────
const stopsCache = new Map<string, LegStop[]>();
const stopsPromise = new Map<string, Promise<LegStop[]>>();

function normalizeName(s: string): string {
  return (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ł/g, 'l')
    .trim();
}

function parseHMtoSec(hm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(hm || '');
  if (!m) return null;
  return Number(m[1]) * 3600 + Number(m[2]) * 60;
}

function nowSec(): number {
  const d = new Date();
  return d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();
}

/**
 * Awaryjna lista gdy backend nie zwrócił sekwencji i nie da się jej dociągnąć.
 * Uczciwa: tylko znane końce odcinka (zero wymyślonych przystanków po drodze).
 */
export function buildFallbackStops(leg: Leg): LegStop[] {
  if (leg.intermediateStops && leg.intermediateStops.length >= 2) {
    return leg.intermediateStops;
  }
  const depSec = parseHMtoSec(leg.departAt);
  const arrSec = parseHMtoSec(leg.arriveAt);
  const mk = (
    first: boolean,
  ): LegStop => ({
    stopId: first
      ? leg.fromStopId || `fallback-${leg.id}-from`
      : leg.toStopId || `fallback-${leg.id}-to`,
    name: first ? leg.fromStop : leg.toStop,
    lat: first ? leg.fromLat : leg.toLat,
    lon: first ? leg.fromLon : leg.toLon,
    seq: first ? 1 : 2,
    arriveSec: first ? depSec ?? undefined : arrSec ?? undefined,
    departSec: first ? depSec ?? undefined : arrSec ?? undefined,
  });
  return [mk(true), mk(false)];
}

/** Nasz odcinek (wsiadanie→wysiadanie) jako indeksy w pełnej liście kursu. */
export function findUserSegment(stops: LegStop[], leg: Leg): { start: number; end: number } {
  if (stops.length === 0) return { start: 0, end: 0 };
  let start = -1;
  let end = -1;
  if (leg.fromStopId) start = stops.findIndex((s) => s.stopId === leg.fromStopId);
  if (leg.toStopId) end = stops.findIndex((s) => s.stopId === leg.toStopId);
  if (start < 0) {
    const n = normalizeName(leg.fromStop);
    start = stops.findIndex((s) => normalizeName(s.name) === n);
  }
  if (end < 0) {
    const n = normalizeName(leg.toStop);
    // ostatni match — nazwy przystanków potrafią się powtarzać na linii
    for (let i = stops.length - 1; i >= 0; i--) {
      if (normalizeName(stops[i].name) === n) {
        end = i;
        break;
      }
    }
  }
  // Fallback: syntetyczna lista = w całości nasz odcinek
  if (start < 0) start = 0;
  if (end < 0) end = stops.length - 1;
  if (end < start) end = start;
  return { start, end };
}

export interface VehicleGap {
  /** indeks przerwy między stops[gap] a stops[gap+1]; -1 = przed odjazdem, -2 = po przyjeździe */
  gap: number;
  isLive: boolean;
  label: string;
}

/** Gdzie jest pojazd: GPS (current/next stop lub coords) albo estymacja czasowa. */
export function locateVehicle(stops: LegStop[], leg: Leg, vehicle: VehiclePosition | null): VehicleGap {
  const n = stops.length;
  if (n < 2) return { gap: -1, isLive: false, label: 'Brak danych o trasie' };

  if (vehicle) {
    const cur = vehicle.currentStopName ? normalizeName(vehicle.currentStopName) : '';
    const nxt = vehicle.nextStopName ? normalizeName(vehicle.nextStopName) : '';
    let curIdx = cur ? stops.findIndex((s) => normalizeName(s.name).includes(cur) || cur.includes(normalizeName(s.name))) : -1;
    let nxtIdx = nxt ? stops.findIndex((s) => normalizeName(s.name).includes(nxt) || nxt.includes(normalizeName(s.name))) : -1;
    if (curIdx >= 0 && nxtIdx === curIdx + 1) {
      return {
        gap: curIdx,
        isLive: true,
        label: `Pojazd: ${stops[curIdx].name} → ${stops[nxtIdx].name} • live`,
      };
    }
    if (nxtIdx > 0) {
      return {
        gap: Math.min(n - 2, Math.max(0, nxtIdx - 1)),
        isLive: true,
        label: `Pojazd: przed ${stops[nxtIdx].name} • live`,
      };
    }
    if (curIdx >= 0) {
      return {
        gap: Math.min(n - 2, curIdx),
        isLive: true,
        label: `Pojazd: ${stops[curIdx].name} • live`,
      };
    }
    // GPS coords: najbliższy przystanek, pojazd jedzie "do przodu" trasy
    if (vehicle.lat != null && vehicle.lon != null) {
      let best = 0;
      let bestD = Infinity;
      for (let i = 0; i < n; i++) {
        const s = stops[i];
        if (s.lat == null || s.lon == null) continue;
        const d = (s.lat - vehicle.lat) ** 2 + (s.lon - vehicle.lon) ** 2;
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      if (bestD < Infinity) {
        const gap = Math.min(n - 2, Math.max(0, best >= n - 1 ? n - 2 : best));
        return { gap, isLive: true, label: `Pojazd: okolice ${stops[best].name} • live` };
      }
    }
  }

  // Estymacja czasowa: postęp kursu względem "teraz"
  const depSec = parseHMtoSec(leg.departAt);
  const arrSec = parseHMtoSec(leg.arriveAt);
  if (depSec == null || arrSec == null || arrSec <= depSec) {
    return { gap: 0, isLive: false, label: `Pozycja szacowana: ${stops[0].name} → ${stops[n - 1].name}` };
  }
  const t = nowSec();
  if (t < depSec) return { gap: -1, isLive: false, label: `Przed odjazdem (${leg.departAt}) • pozycja szacowana` };
  if (t > arrSec) return { gap: -2, isLive: false, label: 'Kurs zakończony • pozycja szacowana' };
  const progress = (t - depSec) / (arrSec - depSec);
  const floatIdx = progress * (n - 1);
  const gap = Math.min(n - 2, Math.max(0, Math.floor(floatIdx)));
  return {
    gap,
    isLive: false,
    label: `Pojazd (szac.): ${stops[gap].name} → ${stops[gap + 1].name}`,
  };
}

// ─── Wiersz przystanku (memo = brak re-renderów listy przy ticku pojazdu) ─────
// Rail ma KRESKĘ CIĄGŁĄ: kropka + łącznik flex:1 rozciągany na wysokość wiersza.
// Dzięki temu linia jest rzeczywiście połączona przez wszystkie kropki.
const StopRow = memo(function StopRow({
  stop,
  isLast,
  inSegment,
  accent,
  connectorAccent,
  vehicleHere,
}: {
  stop: LegStop;
  isLast: boolean;
  inSegment: boolean;
  accent: string;
  connectorAccent: boolean;
  vehicleHere: boolean;
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
        {vehicleHere && (
          <View style={s.vehicleOnRail}>
            <LiveDot color={scheme.primary} size={9} />
          </View>
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
  const [vehicle, setVehicle] = useState<VehiclePosition | null>(null);
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
      promise = RoutingService.getTripStops(leg.tripId).catch(() => [] as LegStop[]);
      stopsPromise.set(leg.tripId, promise);
    }
    promise.then((fetched) => {
      if (!mounted.current) return;
      const resolved = fetched.length >= 2 ? fetched : buildFallbackStops(leg);
      stopsCache.set(cacheKey, resolved);
      setStops(resolved);
      setLoading(false);
    });
  }, [cacheKey, leg]);

  // Polling TYLKO konkretnego pojazdu tego kursu (match po tripId).
  // Celowo BEZ fallbacku do pierwszego pojazdu linii — pokazujemy lokalizację
  // tramwaju/busa, którym faktycznie jedziemy, a nie jakiegokolwiek.
  // Bez tripId (mock) nie da się zidentyfikować pojazdu → sama estymacja.
  useEffect(() => {
    if (!leg.line || !leg.tripId) return;
    let cancelled = false;
    const line = leg.line;
    const tripId = leg.tripId;
    const lastSig = { current: '' };

    const fetchOnce = async () => {
      try {
        const list = await RoutingService.getVehicles(line);
        if (cancelled || !mounted.current) return;
        const match = list.find((v) => v.matchedTripId === tripId) ?? null;
        const sig = match
          ? `${match.vehicleId}|${match.lat.toFixed(5)}|${match.lon.toFixed(5)}|${match.currentStopName}|${match.nextStopName}`
          : 'none';
        if (sig !== lastSig.current) {
          lastSig.current = sig;
          setVehicle(match);
        }
      } catch {
        // offline — zostaje estymacja czasowa
      }
    };

    fetchOnce();
    const timer = setInterval(fetchOnce, 10000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [leg.line, leg.tripId]);

  const segment = useMemo(() => findUserSegment(stops, leg), [stops, leg]);
  const gap = useMemo(() => locateVehicle(stops, leg, vehicle), [stops, leg, vehicle]);

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
      {gap.isLive && (
        <View style={[s.vehicleBanner, s.vehicleBannerLive]}>
          <LiveDot color={scheme.primary} size={7} />
          <Text style={s.vehicleText} numberOfLines={2}>
            {gap.label}
          </Text>
        </View>
      )}
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
            vehicleHere={gap.isLive && gap.gap === i}
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
        accessibilityLabel={`${leg.line} kierunek ${leg.direction}. ${expanded ? 'Zwiń' : 'Rozwiń'} listę przystanków.`}
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
          {leg.fromStop} <Text style={s.hour}>{leg.departAt}</Text>
        </Text>
        <Text style={s.meta}>
          {leg.stopsCount} przystanki • ~{leg.stopsCount * 2} min • {expanded ? 'zwiń' : 'rozwiń przystanki'}
        </Text>
        <Text style={s.stopBig}>
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

  return (
    <View style={s.list}>
      {legs.map((leg, i) => {
        const last = i === legs.length - 1;
        if (leg.mode === 'walk') {
          const walkMin = Math.max(1, Math.round((leg.walkM ?? 200) / 80));
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
  hour: { color: scheme.onSurfaceVariant, fontWeight: '400' },
  meta: { ...type.bodySmall, color: scheme.onSurfaceVariant },
  walkText: { ...type.titleSmall, color: scheme.onSurface },
  walkSubRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 1 },
  walkSub: { ...type.bodySmall, color: scheme.onSurfaceVariant, flexShrink: 1 },
  // Rozwinięta lista kropek — wysokość animowana layout-animation przez rodzica,
  // tutaj zwykły kontener bez własnych animacji wejścia/wyjścia
  stopsWrap: { marginTop: 8, gap: 0 },
  stopsCollapsed: { height: 0, opacity: 0, overflow: 'hidden', marginTop: 0 },
  vehicleBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: shape.small,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 8,
  },
  vehicleBannerLive: { backgroundColor: scheme.secondaryContainer },
  vehicleText: { flex: 1, ...type.labelMedium, color: scheme.onSurfaceVariant },
  stopRow: { flexDirection: 'row', gap: 10, alignItems: 'stretch' },
  stopRail: { width: 22, alignItems: 'center', position: 'relative' },
  dot: { width: 13, height: 13, borderRadius: 99, borderWidth: 2, marginTop: 4, zIndex: 1 },
  connector: { width: 3, flex: 1, minHeight: 12, borderRadius: 99, marginTop: -1 },
  vehicleOnRail: {
    position: 'absolute',
    top: 19,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
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
