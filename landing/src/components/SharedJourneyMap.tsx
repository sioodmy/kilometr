import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import type { GeoJSONSource, StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import {
  BusFront,
  CableCar,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Footprints,
  LocateFixed,
  MapPinned,
  Maximize2,
  Minus,
  Plus,
  RefreshCw,
  ShieldCheck,
  TrainFront,
  TramFront,
  X,
} from 'lucide-react';
import type { SharedConnection, SharedLeg } from '../../../src/sharing/connection';
import { formatShareTime } from '../../../src/sharing/connection';
import type { RoutePoint } from '../../../src/sharing/geometry';
import type { StaticStop } from '../../../src/sharing/timetable';
import { scheduledVehiclePosition, sharedLegStops } from '../../../src/sharing/progress';
import { mapLineColor, resolveLineBadgeIdentity } from '../../../src/services/lineIdentity';
import { inferRailAgencyFromLine } from '../../../src/services/railIdentity';
import { getWebShareStrings } from '../../../src/i18n/webShare';
import { useWebLocale } from '../i18n';
import type { SharedWebLegLive } from '../sharedLive';
import { RailCarrierMark } from './kilometrUi';

const OPENFREEMAP_SOURCE = 'https://tiles.openfreemap.org/planet';
const OPENFREEMAP_GLYPHS = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';

const MAP_COLORS = {
  land: '#101413',
  residential: '#151A19',
  park: '#16211D',
  wood: '#14201C',
  water: '#123039',
  waterLine: '#17414E',
  building: '#1E2523',
  buildingEdge: '#242C2A',
  casing: '#080C0B',
  motorway: '#4B5558',
  major: '#394244',
  minor: '#2A3234',
  footway: '#242C2A',
  rail: '#2E3639',
  boundary: '#3F4946',
  roadLabel: '#9BA5A2',
  waterLabel: '#7FB6C8',
  placeCity: '#E0E3E1',
  placeTown: '#BFC9C5',
  walk: '#BFC9C5',
  stopMid: '#E0E3E1',
  halo: '#101413',
} as const;

function buildKilometrDarkMapStyle(): StyleSpecification {
  const nameExpr: maplibregl.ExpressionSpecification = [
    'coalesce',
    ['get', 'name:pl'],
    ['get', 'name:latin'],
    ['get', 'name'],
  ];
  return {
    version: 8,
    glyphs: OPENFREEMAP_GLYPHS,
    sources: {
      openmaptiles: {
        type: 'vector',
        url: OPENFREEMAP_SOURCE,
      },
      route: {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      },
      stops: {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      },
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': MAP_COLORS.land } },
      {
        id: 'landuse-residential',
        type: 'fill',
        source: 'openmaptiles',
        'source-layer': 'landuse',
        filter: ['in', ['get', 'class'], ['literal', ['residential', 'suburb', 'neighbourhood']]],
        paint: { 'fill-color': MAP_COLORS.residential },
      },
      {
        id: 'park',
        type: 'fill',
        source: 'openmaptiles',
        'source-layer': 'park',
        paint: { 'fill-color': MAP_COLORS.park },
      },
      {
        id: 'landcover-wood',
        type: 'fill',
        source: 'openmaptiles',
        'source-layer': 'landcover',
        filter: ['in', ['get', 'class'], ['literal', ['wood', 'grass']]],
        paint: { 'fill-color': MAP_COLORS.wood, 'fill-opacity': 0.72 },
      },
      {
        id: 'water',
        type: 'fill',
        source: 'openmaptiles',
        'source-layer': 'water',
        paint: { 'fill-color': MAP_COLORS.water },
      },
      {
        id: 'waterway',
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'waterway',
        paint: { 'line-color': MAP_COLORS.waterLine, 'line-width': 1.4 },
      },
      {
        id: 'building',
        type: 'fill',
        source: 'openmaptiles',
        'source-layer': 'building',
        minzoom: 13,
        paint: {
          'fill-color': MAP_COLORS.building,
          'fill-outline-color': MAP_COLORS.buildingEdge,
          'fill-opacity': ['interpolate', ['linear'], ['zoom'], 13, 0, 14, 0.85],
        },
      },
      {
        id: 'rail',
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'transportation',
        filter: ['==', ['get', 'class'], 'rail'],
        paint: { 'line-color': MAP_COLORS.rail, 'line-width': 1.2, 'line-dasharray': [3, 2] },
      },
      {
        id: 'road-footway',
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'transportation',
        minzoom: 14,
        filter: ['in', ['get', 'class'], ['literal', ['path', 'track', 'pedestrian']]],
        paint: { 'line-color': MAP_COLORS.footway, 'line-width': 1 },
      },
      {
        id: 'road-minor',
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'transportation',
        minzoom: 12,
        filter: ['in', ['get', 'class'], ['literal', ['minor', 'service']]],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': MAP_COLORS.minor,
          'line-width': ['interpolate', ['exponential', 1.4], ['zoom'], 12, 0.7, 16, 4.5],
        },
      },
      {
        id: 'road-major-casing',
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'transportation',
        filter: ['in', ['get', 'class'], ['literal', ['primary', 'secondary', 'tertiary', 'trunk']]],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': MAP_COLORS.casing,
          'line-width': ['interpolate', ['exponential', 1.4], ['zoom'], 10, 2.2, 16, 9],
        },
      },
      {
        id: 'road-major',
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'transportation',
        filter: ['in', ['get', 'class'], ['literal', ['primary', 'secondary', 'tertiary', 'trunk']]],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': MAP_COLORS.major,
          'line-width': ['interpolate', ['exponential', 1.4], ['zoom'], 10, 1.2, 16, 6.5],
        },
      },
      {
        id: 'road-motorway',
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'transportation',
        filter: ['==', ['get', 'class'], 'motorway'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': MAP_COLORS.motorway,
          'line-width': ['interpolate', ['exponential', 1.4], ['zoom'], 8, 1.2, 16, 8],
        },
      },
      {
        id: 'road-labels',
        type: 'symbol',
        source: 'openmaptiles',
        'source-layer': 'transportation_name',
        minzoom: 13,
        layout: {
          'symbol-placement': 'line',
          'text-field': nameExpr,
          'text-font': ['Noto Sans Regular'],
          'text-size': 11,
        },
        paint: {
          'text-color': MAP_COLORS.roadLabel,
          'text-halo-color': MAP_COLORS.halo,
          'text-halo-width': 1.2,
        },
      },
      {
        id: 'place-labels',
        type: 'symbol',
        source: 'openmaptiles',
        'source-layer': 'place',
        filter: ['in', ['get', 'class'], ['literal', ['city', 'town', 'suburb', 'neighbourhood']]],
        layout: {
          'text-field': nameExpr,
          'text-font': ['Noto Sans Bold'],
          'text-size': ['match', ['get', 'class'], 'city', 14, 'town', 12, 10.5],
        },
        paint: {
          'text-color': ['match', ['get', 'class'], 'city', MAP_COLORS.placeCity, MAP_COLORS.placeTown],
          'text-halo-color': MAP_COLORS.halo,
          'text-halo-width': 1.4,
        },
      },
      {
        id: 'km-route-casing',
        type: 'line',
        source: 'route',
        filter: ['==', ['get', 'walk'], false],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': MAP_COLORS.casing,
          'line-width': ['case', ['get', 'selected'], 11, 8.5],
          'line-opacity': ['case', ['get', 'dimmed'], 0.32, 0.92],
        },
      },
      {
        id: 'km-route-transit',
        type: 'line',
        source: 'route',
        filter: ['==', ['get', 'walk'], false],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ['get', 'color'],
          'line-width': ['case', ['get', 'selected'], 6.5, 4.8],
          'line-opacity': ['case', ['get', 'dimmed'], 0.36, 1],
        },
      },
      {
        id: 'km-route-walk',
        type: 'line',
        source: 'route',
        filter: ['==', ['get', 'walk'], true],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': MAP_COLORS.walk,
          'line-width': ['case', ['get', 'selected'], 4.5, 3.2],
          'line-dasharray': [1.6, 1.8],
          'line-opacity': ['case', ['get', 'dimmed'], 0.32, 0.88],
        },
      },
      {
        id: 'km-stops-mid',
        type: 'circle',
        source: 'stops',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 2.5, 15, 4.5],
          'circle-color': MAP_COLORS.stopMid,
          'circle-stroke-color': MAP_COLORS.casing,
          'circle-stroke-width': 1.8,
          'circle-opacity': ['case', ['get', 'dimmed'], 0.25, 0.92],
        },
      },
    ],
  };
}

interface MapStageItem {
  index: number;
  leg: SharedLeg;
  coords: [number, number][]; // [lon, lat]
  stops: StaticStop[];
  color: string;
  badgeBg: string;
  badgeFg: string;
  railAgency?: string;
  departAt: string;
  arriveAt: string;
  approx: boolean;
}

function isValidCoord(lat?: number, lon?: number): boolean {
  return (
    typeof lat === 'number' &&
    typeof lon === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    (lat !== 0 || lon !== 0)
  );
}

function buildStages(
  journey: SharedConnection,
  stopsByLeg: StaticStop[][],
  pathsByLeg: (RoutePoint[] | null)[],
  legTimes: { departure: number; arrival: number }[],
): MapStageItem[] {
  return journey.legs.map((leg, index) => {
    const legStops = stopsByLeg[index] ?? [];
    const path = pathsByLeg[index];
    let coords: [number, number][] = [];
    let approx = false;

    if (path && path.length >= 2) {
      coords = path.map(([lat, lon]) => [lon, lat]);
    } else {
      const stopCoords = legStops
        .filter((st) => isValidCoord(st.lat, st.lon))
        .map((st): [number, number] => [st.lon!, st.lat!]);
      if (stopCoords.length >= 2) {
        coords = stopCoords;
        approx = leg.mode !== 'walk';
      } else if (isValidCoord(leg.fromLat, leg.fromLon) && isValidCoord(leg.toLat, leg.toLon)) {
        coords = [
          [leg.fromLon!, leg.fromLat!],
          [leg.toLon!, leg.toLat!],
        ];
        approx = leg.mode !== 'walk';
      }
    }

    const railAgency = leg.mode === 'train' ? inferRailAgencyFromLine(leg.line, journey.city) : undefined;
    const identity = resolveLineBadgeIdentity({
      mode: leg.mode,
      line: leg.line,
      compact: true,
      cityId: journey.city,
      railAgencyOverride: railAgency,
    });
    const times = legTimes[index];

    return {
      index,
      leg,
      coords,
      stops: legStops,
      color: leg.mode === 'walk' ? MAP_COLORS.walk : mapLineColor(identity.bg),
      badgeBg: identity.bg,
      badgeFg: identity.fg,
      railAgency: identity.railAgency,
      departAt: formatShareTime(times?.departure ?? leg.departure),
      arriveAt: formatShareTime(times?.arrival ?? leg.arrival),
      approx,
    };
  });
}

function computeEstimatedVehicleCoord(
  stages: MapStageItem[],
  elapsedSec: number,
  liveLegs: (SharedWebLegLive | null)[],
): { coord: [number, number]; color: string; line: string } | null {
  for (const st of stages) {
    if (st.leg.mode === 'walk') continue;
    const live = liveLegs[st.index];
    const delaySec =
      live && (live.status === 'live' || live.status === 'estimated') ? live.delaySec : 0;
    const stops = sharedLegStops(st.leg, st.stops);
    const pos = scheduledVehiclePosition(stops, elapsedSec - delaySec);
    if (!pos) continue;

    // Interpolacja między współrzędnymi dwóch kolejnych przystanków (albo końców odcinka)
    const a = stops[pos.index];
    const b = stops[Math.min(stops.length - 1, pos.index + 1)];
    const aLat = a?.lat ?? (pos.index === 0 ? st.leg.fromLat : undefined);
    const aLon = a?.lon ?? (pos.index === 0 ? st.leg.fromLon : undefined);
    const bLat = b?.lat ?? (pos.index + 1 === stops.length - 1 ? st.leg.toLat : undefined);
    const bLon = b?.lon ?? (pos.index + 1 === stops.length - 1 ? st.leg.toLon : undefined);
    if (isValidCoord(aLat, aLon) && isValidCoord(bLat, bLon)) {
      const lat = aLat! + (bLat! - aLat!) * pos.fraction;
      const lon = aLon! + (bLon! - aLon!) * pos.fraction;
      return { coord: [lon, lat], color: st.color, line: st.leg.line || '' };
    }
    if (st.coords.length >= 2) {
      const total = Math.max(1, stops.length - 1);
      const frac = Math.max(0, Math.min(1, (pos.index + pos.fraction) / total));
      const idx = Math.min(st.coords.length - 1, Math.round(frac * (st.coords.length - 1)));
      return { coord: st.coords[idx], color: st.color, line: st.leg.line || '' };
    }
  }
  return null;
}

function StageModeIcon({
  mode,
  railAgency,
  color,
}: {
  mode: SharedLeg['mode'];
  railAgency?: string;
  color: string;
}) {
  if (railAgency) {
    return <RailCarrierMark agency={railAgency} color={color} size={12} />;
  }
  const Icon =
    mode === 'walk'
      ? Footprints
      : mode === 'tram'
        ? TramFront
        : mode === 'train' || mode === 'subway'
          ? TrainFront
          : mode === 'cable'
            ? CableCar
            : BusFront;
  return <Icon size={12} aria-hidden="true" />;
}

function createPinElement(kind: 'start' | 'end' | 'transfer'): HTMLDivElement {
  const el = document.createElement('div');
  if (kind === 'transfer') {
    el.className = 'km-map-stop-pin';
    const dot = document.createElement('i');
    el.appendChild(dot);
    return el;
  }
  el.className = `km-map-pin km-map-pin-${kind}`;
  const outer = document.createElement('i');
  const inner = document.createElement('b');
  el.appendChild(outer);
  el.appendChild(inner);
  return el;
}

function createVehicleElement(color: string): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'km-map-veh';
  el.style.color = color;
  const halo = document.createElement('span');
  halo.className = 'km-map-veh-halo';
  const body = document.createElement('span');
  body.className = 'km-map-veh-body';
  el.appendChild(halo);
  el.appendChild(body);
  return el;
}

function MapCanvas({
  stages,
  selectedIndex,
  vehiclePos,
  isFullscreen,
  onSelectIndex,
  onError,
  mapInstanceRef,
}: {
  stages: MapStageItem[];
  selectedIndex: number | null;
  vehiclePos: { coord: [number, number]; color: string; line: string } | null;
  isFullscreen: boolean;
  onSelectIndex: (index: number | null) => void;
  onError: () => void;
  mapInstanceRef: React.MutableRefObject<maplibregl.Map | null>;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const vehicleMarkerRef = useRef<maplibregl.Marker | null>(null);
  const readyRef = useRef(false);
  const onSelectRef = useRef(onSelectIndex);
  onSelectRef.current = onSelectIndex;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const fitBounds = useCallback(
    (map: maplibregl.Map, targetIdx: number | null, animate = true) => {
      const targetStages =
        targetIdx != null && stages[targetIdx]?.coords.length >= 2
          ? [stages[targetIdx]]
          : stages.filter((st) => st.coords.length >= 2);
      const pts = targetStages.flatMap((st) => st.coords);
      if (pts.length === 0) return;
      if (pts.length === 1) {
        map.easeTo({ center: pts[0], zoom: 14, duration: animate ? 320 : 0 });
        return;
      }
      const bounds = new maplibregl.LngLatBounds(pts[0], pts[0]);
      for (const p of pts) bounds.extend(p);
      map.fitBounds(bounds, {
        padding: isFullscreen
          ? { top: 48, right: 56, bottom: 48, left: 48 }
          : { top: 42, right: 40, bottom: 42, left: 40 },
        maxZoom: isFullscreen ? 16.5 : 15.5,
        duration: animate ? 360 : 0,
      });
    },
    [isFullscreen, stages],
  );

  const syncLayers = useCallback(
    (map: maplibregl.Map) => {
      const routeSource = map.getSource('route') as GeoJSONSource | undefined;
      const stopsSource = map.getSource('stops') as GeoJSONSource | undefined;
      if (!routeSource || !stopsSource) return;

      const routeFeatures: GeoJSON.Feature<GeoJSON.LineString>[] = [];
      const stopFeatures: GeoJSON.Feature<GeoJSON.Point>[] = [];

      for (const st of stages) {
        if (st.coords.length >= 2) {
          routeFeatures.push({
            type: 'Feature',
            properties: {
              legIndex: st.index,
              color: st.color,
              walk: st.leg.mode === 'walk',
              selected: selectedIndex === st.index,
              dimmed: selectedIndex !== null && selectedIndex !== st.index,
            },
            geometry: {
              type: 'LineString',
              coordinates: st.coords,
            },
          });
        }
        if (st.stops.length > 2) {
          for (let i = 1; i < st.stops.length - 1; i++) {
            const stop = st.stops[i];
            if (!isValidCoord(stop.lat, stop.lon)) continue;
            stopFeatures.push({
              type: 'Feature',
              properties: {
                dimmed: selectedIndex !== null && selectedIndex !== st.index,
              },
              geometry: {
                type: 'Point',
                coordinates: [stop.lon!, stop.lat!],
              },
            });
          }
        }
      }

      routeSource.setData({ type: 'FeatureCollection', features: routeFeatures });
      stopsSource.setData({ type: 'FeatureCollection', features: stopFeatures });

      for (const marker of markersRef.current) marker.remove();
      markersRef.current = [];

      const validStages = stages.filter((st) => st.coords.length >= 2);
      const firstCoord = validStages[0]?.coords[0];
      const lastStage = validStages.at(-1);
      const lastCoord = lastStage?.coords[lastStage.coords.length - 1];

      for (let i = 0; i < validStages.length; i++) {
        const st = validStages[i];
        if (i > 0) {
          const transferPt = st.coords[0];
          const el = createPinElement('transfer');
          const m = new maplibregl.Marker({ element: el, anchor: 'center' })
            .setLngLat(transferPt)
            .addTo(map);
          markersRef.current.push(m);
        }
      }
      if (firstCoord) {
        markersRef.current.push(
          new maplibregl.Marker({ element: createPinElement('start'), anchor: 'center' })
            .setLngLat(firstCoord)
            .addTo(map),
        );
      }
      if (lastCoord) {
        markersRef.current.push(
          new maplibregl.Marker({ element: createPinElement('end'), anchor: 'center' })
            .setLngLat(lastCoord)
            .addTo(map),
        );
      }
    },
    [selectedIndex, stages],
  );

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;

    const firstPts = stages.flatMap((st) => st.coords);
    const initialCenter: [number, number] = firstPts[0] ?? [17.0385, 51.1079];

    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container: node,
        style: buildKilometrDarkMapStyle(),
        center: initialCenter,
        zoom: 12.5,
        attributionControl: { compact: true },
        dragRotate: false,
        pitchWithRotate: false,
      });
    } catch {
      onErrorRef.current();
      return;
    }

    mapInstanceRef.current = map;
    readyRef.current = false;

    const handleLoad = () => {
      readyRef.current = true;
      syncLayers(map);
      fitBounds(map, selectedIndex, false);
    };

    map.on('load', handleLoad);
    map.on('error', () => {
      if (!readyRef.current) onErrorRef.current();
    });

    const clickLeg = (e: maplibregl.MapLayerMouseEvent) => {
      const idx = e.features?.[0]?.properties?.legIndex;
      if (typeof idx === 'number') {
        onSelectRef.current(idx);
      }
    };
    map.on('click', 'km-route-transit', clickLeg);
    map.on('click', 'km-route-walk', clickLeg);
    map.on('mouseenter', 'km-route-transit', () => {
      map.getCanvas().style.cursor = 'pointer';
    });
    map.on('mouseleave', 'km-route-transit', () => {
      map.getCanvas().style.cursor = '';
    });

    const resizeObserver =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => {
            map.resize();
          })
        : null;
    resizeObserver?.observe(node);

    return () => {
      resizeObserver?.disconnect();
      for (const marker of markersRef.current) marker.remove();
      markersRef.current = [];
      vehicleMarkerRef.current?.remove();
      vehicleMarkerRef.current = null;
      readyRef.current = false;
      mapInstanceRef.current = null;
      map.remove();
    };
    // Celowo montujemy instancję MapLibre raz dla danego kontenera (fullscreen vs inline).
  }, [isFullscreen]);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !readyRef.current) return;
    syncLayers(map);
    fitBounds(map, selectedIndex, true);
  }, [fitBounds, selectedIndex, stages, syncLayers, mapInstanceRef]);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !readyRef.current) return;
    if (!vehiclePos) {
      vehicleMarkerRef.current?.remove();
      vehicleMarkerRef.current = null;
      return;
    }
    if (!vehicleMarkerRef.current) {
      vehicleMarkerRef.current = new maplibregl.Marker({
        element: createVehicleElement(vehiclePos.color),
        anchor: 'center',
      })
        .setLngLat(vehiclePos.coord)
        .addTo(map);
    } else {
      vehicleMarkerRef.current.getElement().style.color = vehiclePos.color;
      vehicleMarkerRef.current.setLngLat(vehiclePos.coord);
    }
  }, [vehiclePos, mapInstanceRef]);

  return <div ref={containerRef} className="km-map-canvas" />;
}

export default function SharedJourneyMap({
  journey,
  stopsByLeg,
  pathsByLeg,
  legTimes,
  liveLegs,
  elapsedSec,
  ended,
  loading,
  onRetry,
}: {
  journey: SharedConnection;
  stopsByLeg: StaticStop[][];
  pathsByLeg: (RoutePoint[] | null)[];
  legTimes: { departure: number; arrival: number }[];
  liveLegs: (SharedWebLegLive | null)[];
  elapsedSec: number;
  ended: boolean;
  loading: boolean;
  onRetry: () => void;
}) {
  const locale = useWebLocale();
  const s = getWebShareStrings(locale);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [mapFailed, setMapFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const mapRef = useRef<maplibregl.Map | null>(null);

  const stages = useMemo(
    () => buildStages(journey, stopsByLeg, pathsByLeg, legTimes),
    [journey, legTimes, pathsByLeg, stopsByLeg],
  );
  const hasAnyGeometry = useMemo(() => stages.some((st) => st.coords.length >= 2), [stages]);
  const hasApprox = useMemo(() => stages.some((st) => st.approx), [stages]);
  const vehiclePos = useMemo(
    () => (ended ? null : computeEstimatedVehicleCoord(stages, elapsedSec, liveLegs)),
    [elapsedSec, ended, liveLegs, stages],
  );

  const activeStage = selectedIndex != null ? (stages[selectedIndex] ?? null) : null;
  const effectiveDeparture = legTimes[0]?.departure ?? journey.departure;
  const effectiveArrival = legTimes[legTimes.length - 1]?.arrival ?? journey.arrival;
  const durationMin = Math.max(0, effectiveArrival - effectiveDeparture);
  const transfers = Math.max(0, journey.legs.filter((l) => l.mode !== 'walk').length - 1);

  const summarySub = activeStage
    ? s.stageCounter(activeStage.index + 1, stages.length)
    : `${formatShareTime(effectiveDeparture)} \u2192 ${formatShareTime(effectiveArrival)} \u2022 ${s.duration(durationMin)}${transfers > 0 ? ` \u2022 ${s.transfers(transfers)}` : ''}`;

  useEffect(() => {
    if (!expanded) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setExpanded(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [expanded]);

  const handleToggleStage = useCallback((idx: number | null) => {
    setSelectedIndex((curr) => (curr === idx ? null : idx));
  }, []);

  const handleStep = useCallback(
    (delta: -1 | 1) => {
      if (stages.length === 0) return;
      setSelectedIndex((curr) => {
        if (curr === null) return delta > 0 ? 0 : stages.length - 1;
        const next = curr + delta;
        return next < 0 || next >= stages.length ? null : next;
      });
    },
    [stages.length],
  );

  const fitAll = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    const targetStages =
      selectedIndex != null && stages[selectedIndex]?.coords.length >= 2
        ? [stages[selectedIndex]]
        : stages.filter((st) => st.coords.length >= 2);
    const pts = targetStages.flatMap((st) => st.coords);
    if (pts.length < 2) return;
    const bounds = new maplibregl.LngLatBounds(pts[0], pts[0]);
    for (const p of pts) bounds.extend(p);
    map.fitBounds(bounds, {
      padding: expanded ? 56 : 42,
      maxZoom: expanded ? 16.5 : 15.5,
      duration: 360,
    });
  }, [expanded, selectedIndex, stages]);

  const renderStageFooter = () => {
    if (!activeStage) return null;
    return (
      <div className="km-map-stage-footer">
        <button
          type="button"
          className="km-map-step-btn"
          onClick={() => handleStep(-1)}
          aria-label={s.previousStage}
        >
          <ChevronLeft size={19} aria-hidden="true" />
        </button>
        <div className="km-map-stage-copy">
          <strong>
            {activeStage.leg.from} {'\u2192'} {activeStage.leg.to}
          </strong>
          <span>
            {activeStage.departAt} {'\u2192'} {activeStage.arriveAt}
            {activeStage.leg.mode === 'walk' && activeStage.leg.walk != null
              ? ` \u2022 ${s.walkDistance(activeStage.leg.walk)}`
              : activeStage.leg.stops > 0
                ? ` \u2022 ${s.intermediateStops(Math.max(1, activeStage.leg.stops - 1))}`
                : ''}
          </span>
        </div>
        <button
          type="button"
          className="km-map-step-btn"
          onClick={() => handleStep(1)}
          aria-label={s.nextStage}
        >
          <ChevronRight size={19} aria-hidden="true" />
        </button>
      </div>
    );
  };

  const renderStageRail = () => {
    if (stages.length <= 1) return null;
    return (
      <div className="km-map-stage-rail" role="group" aria-label={s.map}>
        <button
          type="button"
          className={`km-map-stage-pill${selectedIndex === null ? ' is-active' : ''}`}
          aria-pressed={selectedIndex === null}
          onClick={() => handleToggleStage(null)}
        >
          <span>{s.showWholeRoute}</span>
        </button>
        {stages.map((st) => {
          const isSelected = selectedIndex === st.index;
          const isWalk = st.leg.mode === 'walk';
          return (
            <button
              key={st.index}
              type="button"
              className={`km-map-stage-pill${isSelected ? ' is-active' : ''}`}
              aria-pressed={isSelected}
              onClick={() => handleToggleStage(st.index)}
            >
              <span className="km-map-stage-num">{st.index + 1}.</span>
              {isWalk ? (
                <>
                  <Footprints size={13} aria-hidden="true" />
                  <span>
                    {st.leg.walk != null ? `${st.leg.walk} m` : s.walk}
                  </span>
                </>
              ) : (
                <>
                  <span
                    className="km-inline-badge"
                    style={{ backgroundColor: st.badgeBg, color: st.badgeFg }}
                  >
                    <StageModeIcon mode={st.leg.mode} railAgency={st.railAgency} color={st.badgeFg} />
                    <span>{st.leg.line || s.modes[st.leg.mode]}</span>
                  </span>
                  <span className="km-map-stage-stop">{st.leg.to}</span>
                </>
              )}
            </button>
          );
        })}
      </div>
    );
  };

  const renderMapViewport = (isFs: boolean) => {
    if (!hasAnyGeometry) {
      return (
        <div className="km-map-empty">
          {loading ? (
            <span className="km-spinner" aria-hidden="true" />
          ) : null}
          <p>{loading ? s.geometryLoading : s.mapUnavailable}</p>
          {!loading && (
            <button type="button" className="km-tonal-btn" onClick={onRetry}>
              <RefreshCw size={15} aria-hidden="true" />
              <span>{s.retryMap}</span>
            </button>
          )}
        </div>
      );
    }

    return (
      <div className={isFs ? 'km-map-viewport is-fullscreen' : 'km-map-viewport'}>
        {!mapFailed && (
          <MapCanvas
            key={`${attempt}-${isFs ? 'fs' : 'card'}`}
            stages={stages}
            selectedIndex={selectedIndex}
            vehiclePos={vehiclePos}
            isFullscreen={isFs}
            onSelectIndex={handleToggleStage}
            onError={() => setMapFailed(true)}
            mapInstanceRef={mapRef}
          />
        )}

        {(activeStage || vehiclePos) && !mapFailed && (
          <div className="km-map-top-overlay" aria-hidden="true">
            {activeStage ? (
              <span className="km-map-badge">
                {s.stageCounter(activeStage.index + 1, stages.length)}
              </span>
            ) : (
              <span />
            )}
            {vehiclePos && (
              <span className="km-map-badge km-map-badge-live">
                <span className="km-live-pulse" />
                <span>{vehiclePos.line ? s.vehicleLineLive(vehiclePos.line) : s.inProgress}</span>
              </span>
            )}
          </div>
        )}

        {!mapFailed && (
          <div className={isFs ? 'km-map-controls is-rail' : 'km-map-controls'}>
            {isFs && (
              <>
                <button
                  type="button"
                  className="km-map-fab"
                  onClick={() => mapRef.current?.zoomIn({ duration: 220 })}
                  aria-label={s.zoomIn}
                >
                  <Plus size={19} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="km-map-fab"
                  onClick={() => mapRef.current?.zoomOut({ duration: 220 })}
                  aria-label={s.zoomOut}
                >
                  <Minus size={19} aria-hidden="true" />
                </button>
              </>
            )}
            <button
              type="button"
              className="km-map-fab"
              onClick={fitAll}
              aria-label={s.fitMap}
            >
              <LocateFixed size={18} aria-hidden="true" />
            </button>
          </div>
        )}

        {mapFailed && (
          <div className="km-map-error-overlay" role="alert">
            <p>{s.mapError}</p>
            <button
              type="button"
              className="km-tonal-btn"
              onClick={() => {
                setMapFailed(false);
                setAttempt((n) => n + 1);
              }}
            >
              <RefreshCw size={15} aria-hidden="true" />
              <span>{s.retryMap}</span>
            </button>
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      <section className="km-card km-map-card" aria-label={s.map}>
        <div className="km-map-header">
          <div className="km-map-title-group">
            <span className="km-map-icon-badge" aria-hidden="true">
              <MapPinned size={19} />
            </span>
            <div className="km-map-title-copy">
              <h2>{s.map}</h2>
              <p>{summarySub}</p>
            </div>
          </div>

          {hasAnyGeometry && (
            <button
              type="button"
              className="km-expand-pill"
              onClick={() => setExpanded(true)}
              aria-label={s.expandMap}
            >
              <Maximize2 size={15} aria-hidden="true" />
              <span>{s.fullscreenMap}</span>
            </button>
          )}
        </div>

        <div className="km-map-frame">
          {!expanded ? renderMapViewport(false) : <div className="km-map-viewport" />}
          {renderStageFooter()}
        </div>

        {renderStageRail()}

        <div className="km-map-footer">
          {ended || vehiclePos ? (
            <ShieldCheck size={14} aria-hidden="true" className="km-map-footer-icon is-primary" />
          ) : (
            <Clock3 size={14} aria-hidden="true" className="km-map-footer-icon" />
          )}
          <p>
            {vehiclePos ? s.vehicleOnly : s.noVehicle}
            {hasApprox ? ` \u00b7 ${s.approximateGeometry}` : ''}
          </p>
        </div>
      </section>

      {expanded && (
        <div className="km-map-modal" role="dialog" aria-modal="true" aria-label={s.map}>
          <div className="km-map-modal-header">
            <div className="km-map-title-group">
              <span className="km-map-icon-badge" aria-hidden="true">
                <MapPinned size={19} />
              </span>
              <div className="km-map-title-copy">
                <h2>{s.map}</h2>
                <p>{summarySub}</p>
              </div>
            </div>
            <button
              type="button"
              className="km-icon-btn"
              onClick={() => setExpanded(false)}
              aria-label={s.closeMap}
            >
              <X size={20} aria-hidden="true" />
            </button>
          </div>
          {renderMapViewport(true)}
          <div className="km-map-modal-bottom">
            {renderStageFooter()}
            {stages.length > 1 && <div className="km-map-modal-rail">{renderStageRail()}</div>}
          </div>
        </div>
      )}
    </>
  );
}
