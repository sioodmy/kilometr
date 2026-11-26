// Klient backendu Kilometr (api.kilometr.app) z wbudowanym circuit breakerem
// i pełnym fallbackiem offline. Gdy backend nie odpowiada, klient otwiera
// obwód z backoffem, aby telefon nie marnował baterii ani czasu na timeouty.

import type { Connection } from '../types/models';
import { KILOMETR_API } from './gtfsConfig';
import { withTimeout } from './net';
import { kvGet, kvSet } from './storage';
import type { RawVehicleRow } from './liveTracker';
import type { ZbKdVehicle } from './zbiorkom';

export type ViewportBbox = [number, number, number, number]; // [minLon, minLat, maxLon, maxLat]

interface BackendLineDelayProfile {
  line: string;
  mode: string;
  activeVehicles: number;
  avgDelaySec: number;
  medianDelaySec: number;
  p90DelaySec: number;
  delayedRatio: number;
  trend: 'rising' | 'falling' | 'stable';
  typicalDelaySec?: number;
  estimatedUntrackedDelaySec: number;
  estimateConfidence: number;
  recommendedTransferBufferSec: number;
}

export interface BackendDelayIntel {
  city: string;
  updatedAt: number;
  byLine: Map<string, BackendLineDelayProfile>;
}

export interface DelayHubSummary {
  id: string;
  name: string;
  lat: number;
  lon: number;
  avgDelaySec: number;
  p90DelaySec: number;
  maxDelaySec: number;
  vehicleCount: number;
  delayedCount: number;
  severity: 'normal' | 'moderate' | 'heavy' | 'severe';
  topLines: string[];
  typicalDelaySec?: number;
  deltaVsTypicalSec?: number;
}

export interface SharedLiveLegInput {
  id: string;
  mode: string;
  line?: string;
  tripId?: string;
  trainNumber?: string;
  direction?: string;
  fromStop?: string;
  toStop?: string;
  fromLat?: number;
  fromLon?: number;
  toLat?: number;
  toLon?: number;
  scheduledDepartureSec?: number;
  scheduledArrivalSec?: number;
}

export interface SharedLiveLegOutput {
  id: string;
  status: 'live' | 'estimated' | 'scheduled';
  delaySec: number;
  arrivalDelaySec?: number;
  confidence: number;
  source: string;
  lineAvgDelaySec?: number;
  hubAvgDelaySec?: number;
  typicalDelaySec?: number;
  recommendedTransferBufferSec: number;
  cancelled: boolean;
  detour: boolean;
  platform?: string;
  track?: string;
  vehicle?: {
    vehicleId: string;
    lat: number;
    lon: number;
    bearing?: number;
    currentStop?: string;
    nextStop?: string;
    model?: string;
    updatedAt: number;
  };
}

export interface BackendTrafficAnomaly {
  id: string;
  city: string;
  kind: 'tram_stall' | 'bus_congestion' | 'hub_anomaly';
  severity: 'minor' | 'major' | 'blocking';
  mode: 'tram' | 'bus' | 'mixed';
  locationName: string;
  lat: number;
  lon: number;
  lines: string[];
  stalledVehicles: number;
  affectedVehicles: number;
  avgDelaySec: number;
  maxDelaySec: number;
  typicalDelaySec?: number;
  deltaVsNormalSec?: number;
  detectedAtMs: number;
  updatedAtMs: number;
  durationSec: number;
}

interface RouteHourlyPoint {
  hour: number;
  avgDelaySec: number;
  p90DelaySec: number;
  sampleCount: number;
  isDepartureHour: boolean;
}

interface RouteHotspotInsight {
  name: string;
  avgDelaySec: number;
  typicalDelaySec?: number;
  deltaVsTypicalSec?: number;
  delayedCount: number;
}

interface RouteTransferRisk {
  stopName: string;
  fromLine: string;
  toLine: string;
  marginSec: number;
  feederP90DelaySec: number;
  risk: 'tight' | 'risky';
}

export interface RouteInsightsData {
  city: string;
  updatedAt: number;
  ready: boolean;
  riskLevel: 'low' | 'moderate' | 'high';
  dayType: 'weekday' | 'saturday' | 'sunday';
  focusHour: number;
  focusLine?: string;
  focusMode?: string;
  expectedDelaySec: number;
  p90DelaySec: number;
  lateProbability: number;
  sampleCount: number;
  hourlyProfile: RouteHourlyPoint[];
  hotspot?: RouteHotspotInsight;
  transferRisks: RouteTransferRisk[];
  activeAnomaly?: BackendTrafficAnomaly;
}

export interface BackendVehiclesBatch {
  city: string;
  updatedAt: number;
  boosted: boolean;
  totalInCity: number;
  urban: RawVehicleRow[];
  rails: Array<{ prefix: string; vehicles: ZbKdVehicle[] }>;
}

interface RawBackendVehicle {
  vehicle_id?: string;
  line?: string;
  mode?: string;
  lat?: number;
  lon?: number;
  bearing?: number;
  delay_sec?: number;
  timestamp_ms?: number;
  headsign?: string;
  brigade?: string;
  model?: string;
  agency?: string;
  current_stop?: string;
  next_stop?: string;
  upcoming_stops?: Array<{ name?: string; sched_sec?: number }>;
  is_rail?: boolean;
}

interface RawBackendVehiclesResponse {
  city?: string;
  updated_at?: number;
  boosted?: boolean;
  total_in_city?: number;
  vehicles?: RawBackendVehicle[];
  rail_vehicles?: RawBackendVehicle[];
}

const CIRCUIT_FAIL_THRESHOLD = 3;
const CIRCUIT_BASE_BACKOFF_MS = 60_000;
const CIRCUIT_MAX_BACKOFF_MS = 5 * 60_000;
const LINE_INTEL_TTL_MS = 45_000;
const LINE_INTEL_PERSIST_MAX_AGE_MS = 15 * 60_000;

let consecutiveFailures = 0;
let circuitOpenUntil = 0;

const lineIntelCache = new Map<string, BackendDelayIntel>();
const lineIntelInFlight = new Map<string, Promise<BackendDelayIntel | null>>();

export function resetKilometrApiCircuit(): void {
  consecutiveFailures = 0;
  circuitOpenUntil = 0;
  lineIntelCache.clear();
  lineIntelInFlight.clear();
}

export function isKilometrApiAvailable(now = Date.now()): boolean {
  if (!KILOMETR_API.baseUrl) return false;
  return now >= circuitOpenUntil;
}

/** Sam stan obwodu, niezależny od tego, czy domyślny host jest włączony. */
function circuitAllows(now = Date.now()): boolean {
  return now >= circuitOpenUntil;
}

function recordSuccess(): void {
  consecutiveFailures = 0;
  circuitOpenUntil = 0;
}

function recordFailure(now = Date.now()): void {
  consecutiveFailures += 1;
  if (consecutiveFailures >= CIRCUIT_FAIL_THRESHOLD) {
    const shift = Math.min(consecutiveFailures - CIRCUIT_FAIL_THRESHOLD, 3);
    const backoff = Math.min(CIRCUIT_BASE_BACKOFF_MS * (1 << shift), CIRCUIT_MAX_BACKOFF_MS);
    circuitOpenUntil = now + backoff;
  }
}

function railPrefixForAgency(agency?: string): string {
  const clean = (agency ?? '').trim().toUpperCase();
  if (!clean) return 'KD:';
  if (clean === 'KS') return 'KŚ:';
  return `${clean}:`;
}

function toRawRow(v: RawBackendVehicle): RawVehicleRow | null {
  if (
    !v.line ||
    !v.vehicle_id ||
    typeof v.lat !== 'number' ||
    typeof v.lon !== 'number' ||
    !Number.isFinite(v.lat) ||
    !Number.isFinite(v.lon)
  ) {
    return null;
  }
  return {
    name: v.line,
    type: v.mode === 'tram' ? 'tram' : 'bus',
    x: v.lat,
    y: v.lon,
    k: v.vehicle_id,
    bearing: typeof v.bearing === 'number' && Number.isFinite(v.bearing) ? v.bearing : undefined,
    delaySec:
      typeof v.delay_sec === 'number' && Number.isFinite(v.delay_sec) ? v.delay_sec : undefined,
    timestamp: typeof v.timestamp_ms === 'number' ? v.timestamp_ms : undefined,
    headsign: v.headsign,
    brigade: v.brigade,
    model: v.model,
    upcomingStops: Array.isArray(v.upcoming_stops)
      ? v.upcoming_stops.flatMap((s) =>
          s.name && typeof s.sched_sec === 'number'
            ? [{ name: s.name, schedSec: s.sched_sec }]
            : [],
        )
      : undefined,
  };
}

function toRailFeeds(
  railVehicles: RawBackendVehicle[],
): Array<{ prefix: string; vehicles: ZbKdVehicle[] }> {
  const byPrefix = new Map<string, ZbKdVehicle[]>();
  for (const v of railVehicles) {
    if (
      typeof v.lat !== 'number' ||
      typeof v.lon !== 'number' ||
      !Number.isFinite(v.lat) ||
      !Number.isFinite(v.lon)
    ) {
      continue;
    }
    const trainNumber = (v.brigade || v.line || '').trim().toUpperCase();
    if (!trainNumber) continue;
    const prefix = railPrefixForAgency(v.agency);
    const stops = Array.isArray(v.upcoming_stops)
      ? v.upcoming_stops.flatMap((s) =>
          s.name && typeof s.sched_sec === 'number'
            ? [{ name: s.name, schedSec: s.sched_sec }]
            : [],
        )
      : [];
    const list = byPrefix.get(prefix) ?? [];
    list.push({
      id: (v.vehicle_id || trainNumber).trim(),
      trainNumber,
      line: (v.line || '').trim().toUpperCase(),
      lat: v.lat,
      lon: v.lon,
      bearing: typeof v.bearing === 'number' && Number.isFinite(v.bearing) ? v.bearing : undefined,
      delaySec: typeof v.delay_sec === 'number' && Number.isFinite(v.delay_sec) ? v.delay_sec : 0,
      updatedAt: typeof v.timestamp_ms === 'number' ? v.timestamp_ms : Date.now(),
      currentStopName: v.current_stop ?? stops[0]?.name,
      nextStopName: v.next_stop ?? stops[1]?.name,
      stops,
      model: v.model,
    });
    byPrefix.set(prefix, list);
  }
  return Array.from(byPrefix.entries()).map(([prefix, vehicles]) => ({ prefix, vehicles }));
}

async function fetchJson<T>(
  path: string,
  timeoutMs: number,
  init?: RequestInit,
  baseUrl = KILOMETR_API.baseUrl,
): Promise<T | null> {
  if (!baseUrl || !circuitAllows()) return null;
  const externalSignal = init?.signal;
  const timeout = withTimeout(timeoutMs, externalSignal);
  try {
    const res = await fetch(`${baseUrl}${path}`, {
      ...init,
      signal: timeout.signal,
      headers: {
        Accept: 'application/json',
        ...(init?.headers ?? {}),
      },
    });
    if (!res.ok) {
      if (res.status >= 500 || res.status === 429) recordFailure();
      return null;
    }
    const parsed = (await res.json()) as T;
    recordSuccess();
    return parsed;
  } catch {
    if (!externalSignal?.aborted) recordFailure();
    return null;
  } finally {
    timeout.dispose();
  }
}

/**
 * Pobiera pojazdy z backendu Kilometr. Gdy podano `bbox`, pobiera wyłącznie
 * pojazdy z aktualnie widocznego wycinka mapy i aktywuje demand-driven boost.
 */
export async function fetchBackendVehicles(
  cityId: string,
  opts?: {
    bbox?: ViewportBbox | null;
    includeRail?: boolean;
    signal?: AbortSignal;
    baseUrl?: string;
  },
): Promise<BackendVehiclesBatch | null> {
  const params = new URLSearchParams();
  params.set('city', cityId);
  params.set('include_rail', opts?.includeRail === false ? '0' : '1');
  if (opts?.bbox) {
    params.set(
      'bbox',
      opts.bbox.map((n) => n.toFixed(5)).join(','),
    );
  }
  const raw = await fetchJson<RawBackendVehiclesResponse>(
    `/v1/vehicles?${params.toString()}`,
    KILOMETR_API.liveTimeoutMs,
    opts?.signal ? { signal: opts.signal } : undefined,
    opts?.baseUrl,
  );
  if (!raw || !Array.isArray(raw.vehicles)) return null;

  // Backend nie zebrał jeszcze żadnych danych dla tego miasta: pozwól klientowi użyć fallbacku.
  if ((raw.updated_at ?? 0) <= 0 && raw.vehicles.length === 0 && (raw.rail_vehicles?.length ?? 0) === 0) {
    return null;
  }

  const urban: RawVehicleRow[] = [];
  for (const v of raw.vehicles) {
    const row = toRawRow(v);
    if (row) urban.push(row);
  }
  const rails = Array.isArray(raw.rail_vehicles) ? toRailFeeds(raw.rail_vehicles) : [];

  return {
    city: raw.city ?? cityId,
    updatedAt: raw.updated_at ?? Date.now(),
    boosted: Boolean(raw.boosted),
    totalInCity: raw.total_in_city ?? urban.length,
    urban,
    rails,
  };
}

function lineIntelStorageKey(cityId: string): string {
  return `kilometr.cache.backend_lines.${cityId}.v1`;
}

/** Zwraca ostatnio pobrane profile opóźnień linii dla miasta (synchronicznie z pamięci). */
export function getCachedBackendDelayIntel(cityId: string): BackendDelayIntel | null {
  const hit = lineIntelCache.get(cityId);
  if (!hit) return null;
  if (Date.now() - hit.updatedAt > LINE_INTEL_PERSIST_MAX_AGE_MS) return null;
  return hit;
}

/** Pobiera profile opóźnień linii i estymacje dla pojazdów bez GPS (z cache i persist). */
export async function fetchBackendLineDelays(
  cityId: string,
  baseUrl?: string,
): Promise<BackendDelayIntel | null> {
  const cached = lineIntelCache.get(cityId);
  if (cached && Date.now() - cached.updatedAt < LINE_INTEL_TTL_MS) {
    return cached;
  }
  const running = lineIntelInFlight.get(cityId);
  if (running) return running;

  const task = (async () => {
    try {
      const raw = await fetchJson<{
        city?: string;
        updated_at?: number;
        lines?: Array<{
          line: string;
          mode: string;
          active_vehicles: number;
          avg_delay_sec: number;
          median_delay_sec: number;
          p90_delay_sec: number;
          delayed_ratio: number;
          trend: 'rising' | 'falling' | 'stable';
          typical_delay_sec?: number;
          estimated_untracked_delay_sec: number;
          estimate_confidence: number;
          recommended_transfer_buffer_sec: number;
        }>;
      }>(
        `/v1/delays/lines?city=${encodeURIComponent(cityId)}`,
        KILOMETR_API.analyticsTimeoutMs,
        undefined,
        baseUrl,
      );

      if (raw && Array.isArray(raw.lines)) {
        const byLine = new Map<string, BackendLineDelayProfile>();
        for (const item of raw.lines) {
          if (!item.line) continue;
          byLine.set(item.line.trim().toUpperCase(), {
            line: item.line.trim().toUpperCase(),
            mode: item.mode,
            activeVehicles: item.active_vehicles,
            avgDelaySec: item.avg_delay_sec,
            medianDelaySec: item.median_delay_sec,
            p90DelaySec: item.p90_delay_sec,
            delayedRatio: item.delayed_ratio,
            trend: item.trend,
            typicalDelaySec: item.typical_delay_sec,
            estimatedUntrackedDelaySec: item.estimated_untracked_delay_sec,
            estimateConfidence: item.estimate_confidence,
            recommendedTransferBufferSec: item.recommended_transfer_buffer_sec,
          });
        }
        const intel: BackendDelayIntel = {
          city: cityId,
          updatedAt: Date.now(),
          byLine,
        };
        lineIntelCache.set(cityId, intel);
        void kvSet(
          lineIntelStorageKey(cityId),
          JSON.stringify({ updatedAt: intel.updatedAt, entries: Array.from(byLine.values()) }),
        ).catch(() => {});
        return intel;
      }

      // Fallback do ostatniego zapisu z dysku (np. przejazd przez tunel).
      if (!cached) {
        try {
          const persisted = await kvGet(lineIntelStorageKey(cityId));
          if (persisted) {
            const parsed = JSON.parse(persisted) as {
              updatedAt?: number;
              entries?: BackendLineDelayProfile[];
            };
            if (
              typeof parsed.updatedAt === 'number' &&
              Date.now() - parsed.updatedAt <= LINE_INTEL_PERSIST_MAX_AGE_MS &&
              Array.isArray(parsed.entries)
            ) {
              const byLine = new Map<string, BackendLineDelayProfile>();
              for (const entry of parsed.entries) byLine.set(entry.line, entry);
              const restored: BackendDelayIntel = {
                city: cityId,
                updatedAt: parsed.updatedAt,
                byLine,
              };
              lineIntelCache.set(cityId, restored);
              return restored;
            }
          }
        } catch {
          // Brak lokalnego cache
        }
      }
      return cached ?? null;
    } finally {
      lineIntelInFlight.delete(cityId);
    }
  })();

  lineIntelInFlight.set(cityId, task);
  return task;
}

/** Pobiera podsumowania węzłów opóźnień (w tym normy historyczne) z backendu dla wzbogacenia korytarzy live. */
export async function fetchBackendDelayHubs(
  cityId: string,
  bbox?: ViewportBbox | null,
  signal?: AbortSignal,
  baseUrl?: string,
): Promise<DelayHubSummary[] | null> {
  const params = new URLSearchParams();
  params.set('city', cityId);
  if (bbox) params.set('bbox', bbox.map((n) => n.toFixed(5)).join(','));

  const raw = await fetchJson<{
    hubs?: Array<{
      id: string;
      name: string;
      lat: number;
      lon: number;
      avg_delay_sec: number;
      p90_delay_sec: number;
      max_delay_sec: number;
      vehicle_count: number;
      delayed_count: number;
      severity: 'normal' | 'moderate' | 'heavy' | 'severe';
      top_lines: string[];
      typical_delay_sec?: number;
      delta_vs_typical_sec?: number;
    }>;
  }>(
    `/v1/delays/heatmap?${params.toString()}`,
    KILOMETR_API.analyticsTimeoutMs,
    signal ? { signal } : undefined,
    baseUrl,
  );

  if (!raw || !Array.isArray(raw.hubs)) return null;

  return raw.hubs.map((h) => ({
    id: h.id,
    name: h.name,
    lat: h.lat,
    lon: h.lon,
    avgDelaySec: h.avg_delay_sec,
    p90DelaySec: h.p90_delay_sec,
    maxDelaySec: h.max_delay_sec,
    vehicleCount: h.vehicle_count,
    delayedCount: h.delayed_count,
    severity: h.severity,
    topLines: h.top_lines ?? [],
    typicalDelaySec: h.typical_delay_sec,
    deltaVsTypicalSec: h.delta_vs_typical_sec,
  }));
}

/** Batchowe pobranie opóźnień live i estymacji dla udostępnionego połączenia lub trasy. */
export async function fetchBackendSharedLive(
  cityId: string,
  legs: SharedLiveLegInput[],
  signal?: AbortSignal,
  baseUrl?: string,
): Promise<Map<string, SharedLiveLegOutput> | null> {
  if (legs.length === 0) return new Map();
  const payload = {
    city: cityId,
    legs: legs.map((l) => ({
      id: l.id,
      mode: l.mode,
      line: l.line,
      trip_id: l.tripId,
      train_number: l.trainNumber,
      direction: l.direction,
      from_stop: l.fromStop,
      to_stop: l.toStop,
      from_lat: l.fromLat,
      from_lon: l.fromLon,
      to_lat: l.toLat,
      to_lon: l.toLon,
      scheduled_departure_sec: l.scheduledDepartureSec,
      scheduled_arrival_sec: l.scheduledArrivalSec,
    })),
  };

  const raw = await fetchJson<{
    legs?: Array<{
      id: string;
      status: 'live' | 'estimated' | 'scheduled';
      delay_sec: number;
      arrival_delay_sec?: number;
      confidence: number;
      source: string;
      line_avg_delay_sec?: number;
      hub_avg_delay_sec?: number;
      typical_delay_sec?: number;
      recommended_transfer_buffer_sec: number;
      cancelled: boolean;
      detour: boolean;
      platform?: string;
      track?: string;
      vehicle?: {
        vehicle_id: string;
        lat: number;
        lon: number;
        bearing?: number;
        current_stop?: string;
        next_stop?: string;
        model?: string;
        updated_at: number;
      };
    }>;
  }>(
    '/v1/shared/live',
    KILOMETR_API.analyticsTimeoutMs,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal,
    },
    baseUrl,
  );

  if (!raw || !Array.isArray(raw.legs)) return null;
  const map = new Map<string, SharedLiveLegOutput>();
  for (const item of raw.legs) {
    map.set(item.id, {
      id: item.id,
      status: item.status,
      delaySec: item.delay_sec,
      arrivalDelaySec: item.arrival_delay_sec,
      confidence: item.confidence,
      source: item.source,
      lineAvgDelaySec: item.line_avg_delay_sec,
      hubAvgDelaySec: item.hub_avg_delay_sec,
      typicalDelaySec: item.typical_delay_sec,
      recommendedTransferBufferSec: item.recommended_transfer_buffer_sec,
      cancelled: item.cancelled,
      detour: item.detour,
      platform: item.platform,
      track: item.track,
      vehicle: item.vehicle
        ? {
            vehicleId: item.vehicle.vehicle_id,
            lat: item.vehicle.lat,
            lon: item.vehicle.lon,
            bearing: item.vehicle.bearing,
            currentStop: item.vehicle.current_stop,
            nextStop: item.vehicle.next_stop,
            model: item.vehicle.model,
            updatedAt: item.vehicle.updated_at,
          }
        : undefined,
    });
  }
  return map;
}

interface RawBackendAnomaly {
  id: string;
  city: string;
  kind: 'tram_stall' | 'bus_congestion' | 'hub_anomaly';
  severity: 'minor' | 'major' | 'blocking';
  mode: 'tram' | 'bus' | 'mixed';
  location_name: string;
  lat: number;
  lon: number;
  lines: string[];
  stalled_vehicles: number;
  affected_vehicles: number;
  avg_delay_sec: number;
  max_delay_sec: number;
  typical_delay_sec?: number;
  delta_vs_normal_sec?: number;
  detected_at_ms: number;
  updated_at_ms: number;
  duration_sec: number;
}

function mapAnomaly(raw: RawBackendAnomaly): BackendTrafficAnomaly {
  return {
    id: raw.id,
    city: raw.city,
    kind: raw.kind,
    severity: raw.severity,
    mode: raw.mode,
    locationName: raw.location_name,
    lat: raw.lat,
    lon: raw.lon,
    lines: raw.lines ?? [],
    stalledVehicles: raw.stalled_vehicles,
    affectedVehicles: raw.affected_vehicles,
    avgDelaySec: raw.avg_delay_sec,
    maxDelaySec: raw.max_delay_sec,
    typicalDelaySec: raw.typical_delay_sec,
    deltaVsNormalSec: raw.delta_vs_normal_sec,
    detectedAtMs: raw.detected_at_ms,
    updatedAtMs: raw.updated_at_ms,
    durationSec: raw.duration_sec,
  };
}

/** Pobiera automatycznie wykryte zatory komunikacyjne z backendu (GPS, bez AI). */
export async function fetchBackendAnomalies(
  cityId: string,
  signal?: AbortSignal,
  baseUrl?: string,
): Promise<BackendTrafficAnomaly[] | null> {
  const raw = await fetchJson<{ anomalies?: RawBackendAnomaly[] }>(
    `/v1/anomalies?city=${encodeURIComponent(cityId)}`,
    2500,
    signal ? { signal } : undefined,
    baseUrl,
  );
  if (!raw || !Array.isArray(raw.anomalies)) return null;
  return raw.anomalies.map(mapAnomaly);
}

/** Pobiera kartę prognozy punktualności i wykres godzinowy dla szczegółów połączenia. */
export async function fetchBackendRouteInsights(
  cityId: string,
  connection: Connection,
  signal?: AbortSignal,
  baseUrl?: string,
): Promise<RouteInsightsData | null> {
  const transitLegs = connection.legs.filter((l) => l.mode !== 'walk');
  if (transitLegs.length === 0) return null;

  const payload = {
    city: cityId,
    date: connection.serviceDate,
    departure_sec: connection.departureSec,
    legs: transitLegs.map((l) => ({
      id: l.id,
      mode: l.mode,
      line: l.line,
      trip_id: l.tripId,
      train_number: l.trainNumber,
      direction: l.direction,
      from_stop: l.fromStop,
      to_stop: l.toStop,
      from_lat: l.fromLat,
      from_lon: l.fromLon,
      to_lat: l.toLat,
      to_lon: l.toLon,
      scheduled_departure_sec: l.scheduledDepartureSec,
      scheduled_arrival_sec: l.scheduledArrivalSec,
    })),
  };

  const raw = await fetchJson<{
    city?: string;
    updated_at?: number;
    ready?: boolean;
    risk_level?: 'low' | 'moderate' | 'high';
    day_type?: 'weekday' | 'saturday' | 'sunday';
    focus_hour?: number;
    focus_line?: string;
    focus_mode?: string;
    expected_delay_sec?: number;
    p90_delay_sec?: number;
    late_probability?: number;
    sample_count?: number;
    hourly_profile?: Array<{
      hour: number;
      avg_delay_sec: number;
      p90_delay_sec: number;
      sample_count: number;
      is_departure_hour: boolean;
    }>;
    hotspot?: {
      name: string;
      avg_delay_sec: number;
      typical_delay_sec?: number;
      delta_vs_typical_sec?: number;
      delayed_count: number;
    };
    transfer_risks?: Array<{
      stop_name: string;
      from_line: string;
      to_line: string;
      margin_sec: number;
      feeder_p90_delay_sec: number;
      risk: 'tight' | 'risky';
    }>;
    active_anomaly?: RawBackendAnomaly;
  }>(
    '/v1/routes/insights',
    KILOMETR_API.analyticsTimeoutMs,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal,
    },
    baseUrl,
  );

  if (!raw || raw.ready !== true) return null;

  return {
    city: raw.city ?? cityId,
    updatedAt: raw.updated_at ?? Date.now(),
    ready: true,
    riskLevel: raw.risk_level ?? 'low',
    dayType: raw.day_type ?? 'weekday',
    focusHour: raw.focus_hour ?? 0,
    focusLine: raw.focus_line,
    focusMode: raw.focus_mode,
    expectedDelaySec: raw.expected_delay_sec ?? 0,
    p90DelaySec: raw.p90_delay_sec ?? 0,
    lateProbability: raw.late_probability ?? 0,
    sampleCount: raw.sample_count ?? 0,
    hourlyProfile: (raw.hourly_profile ?? []).map((p) => ({
      hour: p.hour,
      avgDelaySec: p.avg_delay_sec,
      p90DelaySec: p.p90_delay_sec,
      sampleCount: p.sample_count,
      isDepartureHour: p.is_departure_hour,
    })),
    hotspot: raw.hotspot
      ? {
          name: raw.hotspot.name,
          avgDelaySec: raw.hotspot.avg_delay_sec,
          typicalDelaySec: raw.hotspot.typical_delay_sec,
          deltaVsTypicalSec: raw.hotspot.delta_vs_typical_sec,
          delayedCount: raw.hotspot.delayed_count,
        }
      : undefined,
    transferRisks: (raw.transfer_risks ?? []).map((t) => ({
      stopName: t.stop_name,
      fromLine: t.from_line,
      toLine: t.to_line,
      marginSec: t.margin_sec,
      feederP90DelaySec: t.feeder_p90_delay_sec,
      risk: t.risk,
    })),
    activeAnomaly: raw.active_anomaly ? mapAnomaly(raw.active_anomaly) : undefined,
  };
}
