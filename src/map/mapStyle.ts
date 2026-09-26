// Styl mapy wektorowej (MapLibre style spec) w ciemnej palecie M3 aplikacji.
//
// Kafelki rastrowe odpadły: CARTO i Stadia wymagają klucza, a jasny OSM kłóci
// się z ciemnym interfejsem. Dlatego rysujemy wektorowe kafelki OSM
// (OpenFreeMap — bez klucza i bez limitu) i nadpisujemy każdą warstwę
// kolorami z `src/theme/tokens`. Dane to nadal OpenStreetMap (ODbL).
//
// Schemat źródła to OpenMapTiles (`planet`), więc filtry `class`/`subclass`
// są te same, których używa OpenFreeMap w swoich stylach.

import { colors, scheme } from '../theme/tokens';
import { MAP_GLYPHS_URL, MAP_SOURCE_URL } from '../config';

export const MAP_COLORS = {
  // Płaszczyzny
  land: '#101413',
  residential: '#151A19',
  park: '#16211D',
  wood: '#14201C',
  water: '#123039',
  waterLine: '#17414E',
  building: '#1E2523',
  buildingEdge: '#242C2A',
  // Drogi: obwódka zawsze ciemna, jaśnieje wraz z hierarchią
  casing: '#080C0B',
  motorway: '#4B5558',
  major: '#394244',
  minor: '#2A3234',
  footway: '#242C2A',
  rail: '#2E3639',
  boundary: '#3F4946',
  // Tekst
  roadLabel: '#9BA5A2',
  waterLabel: '#7FB6C8',
  placeCity: scheme.onSurface,
  placeTown: scheme.onSurfaceVariant,
  placeSmall: colors.faint,
  halo: '#101413',
  // Trasa
  routeCasing: '#080C0B',
  walk: scheme.onSurfaceVariant,
  stopMid: scheme.onSurface,
} as const;

const C = MAP_COLORS;

const isLine = ['match', ['geometry-type'], ['LineString', 'MultiLineString'], true, false];
const isArea = ['match', ['geometry-type'], ['MultiPolygon', 'Polygon'], true, false];

const ROAD_MOTORWAY = ['==', ['get', 'class'], 'motorway'];
const ROAD_MAJOR = ['match', ['get', 'class'], ['primary', 'secondary', 'tertiary', 'trunk'], true, false];
const ROAD_MINOR = ['match', ['get', 'class'], ['minor', 'service', 'track'], true, false];

const nameField = [
  'case',
  ['has', 'name:nonlatin'],
  ['concat', ['get', 'name:latin'], ' ', ['get', 'name:nonlatin']],
  ['coalesce', ['get', 'name_en'], ['get', 'name']],
];

/** Wspólne malowanie tekstu: kolor z motywu + ciemna obwódka dla czytelności. */
const labelPaint = (color: string, haloWidth = 1.1) => ({
  'text-color': color,
  'text-halo-color': C.halo,
  'text-halo-width': haloWidth,
  'text-halo-blur': 0.4,
});

const nameSymbol = (
  id: string,
  sourceLayer: string,
  filter: unknown,
  color: string,
  size: unknown,
  layout: Record<string, unknown> = {},
  haloWidth = 1.1,
) => ({
  id,
  type: 'symbol' as const,
  source: 'openmaptiles',
  'source-layer': sourceLayer,
  filter: filter as never,
  paint: labelPaint(color, haloWidth),
  layout: { 'text-field': nameField, 'text-size': size, ...layout },
});

/** Warstwy podkładu OSM (ciemne). */
function baseLayers() {
  return [
    { id: 'tlo', type: 'background' as const, paint: { 'background-color': C.land } },
    {
      id: 'dzielnice',
      type: 'fill' as const,
      source: 'openmaptiles',
      'source-layer': 'landuse',
      filter: ['all', isArea, ['==', ['get', 'class'], 'residential']] as never,
      paint: { 'fill-color': C.residential, 'fill-opacity': 0.75 },
    },
    {
      id: 'parki',
      type: 'fill' as const,
      source: 'openmaptiles',
      'source-layer': 'park',
      filter: isArea as never,
      paint: { 'fill-color': C.park },
    },
    {
      id: 'lasy',
      type: 'fill' as const,
      source: 'openmaptiles',
      'source-layer': 'landcover',
      filter: ['all', isArea, ['==', ['get', 'class'], 'wood']] as never,
      paint: { 'fill-color': C.wood, 'fill-opacity': 0.9 },
    },
    {
      id: 'rzeki',
      type: 'line' as const,
      source: 'openmaptiles',
      'source-layer': 'waterway',
      filter: isLine as never,
      paint: {
        'line-color': C.waterLine,
        'line-width': ['interpolate', ['exponential', 1.4], ['zoom'], 9, 0.6, 14, 1.8, 20, 9],
      },
      layout: { 'line-cap': 'round', 'line-join': 'round' },
    },
    {
      id: 'woda',
      type: 'fill' as const,
      source: 'openmaptiles',
      'source-layer': 'water',
      filter: ['all', isArea, ['!=', ['get', 'brunnel'], 'tunnel']] as never,
      paint: { 'fill-color': C.water },
    },
    {
      id: 'budynki',
      type: 'fill' as const,
      source: 'openmaptiles',
      'source-layer': 'building',
      filter: ['all', isArea, ['!=', ['get', 'hide_3d'], true]] as never,
      paint: {
        'fill-color': C.building,
        'fill-outline-color': C.buildingEdge,
        'fill-opacity': ['interpolate', ['linear'], ['zoom'], 13, 0, 15, 0.5, 18, 0.85],
      },
    },
    {
      id: 'drogi-obwodka-autostrada',
      type: 'line' as const,
      source: 'openmaptiles',
      'source-layer': 'transportation',
      filter: ['all', isLine, ROAD_MOTORWAY] as never,
      paint: {
        'line-color': C.casing,
        'line-width': ['interpolate', ['exponential', 1.4], ['zoom'], 6, 2.6, 12, 6.5, 20, 19],
      },
      layout: { 'line-cap': 'butt', 'line-join': 'round' },
    },
    {
      id: 'drogi-autostrada',
      type: 'line' as const,
      source: 'openmaptiles',
      'source-layer': 'transportation',
      filter: ['all', isLine, ROAD_MOTORWAY] as never,
      paint: {
        'line-color': C.motorway,
        'line-width': ['interpolate', ['exponential', 1.4], ['zoom'], 6, 1.2, 12, 3, 20, 15],
      },
      layout: { 'line-cap': 'round', 'line-join': 'round' },
    },
    {
      id: 'drogi-obwodka-glowna',
      type: 'line' as const,
      source: 'openmaptiles',
      'source-layer': 'transportation',
      filter: ['all', isLine, ROAD_MAJOR] as never,
      paint: {
        'line-color': C.casing,
        'line-width': ['interpolate', ['exponential', 1.3], ['zoom'], 10, 2.8, 16, 8, 20, 16],
      },
      layout: { 'line-cap': 'butt', 'line-join': 'round' },
    },
    {
      id: 'drogi-glowna',
      type: 'line' as const,
      source: 'openmaptiles',
      'source-layer': 'transportation',
      filter: ['all', isLine, ROAD_MAJOR] as never,
      paint: {
        'line-color': C.major,
        'line-width': ['interpolate', ['exponential', 1.3], ['zoom'], 10, 1.2, 16, 4.5, 20, 11],
      },
      layout: { 'line-cap': 'round', 'line-join': 'round' },
    },
    {
      id: 'drogi-drobne',
      type: 'line' as const,
      source: 'openmaptiles',
      'source-layer': 'transportation',
      filter: ['all', isLine, ROAD_MINOR] as never,
      paint: {
        'line-color': C.minor,
        'line-width': ['interpolate', ['exponential', 1.55], ['zoom'], 13, 1, 16, 2.6, 20, 9],
      },
      layout: { 'line-cap': 'round', 'line-join': 'round' },
    },
    {
      id: 'drogi-piesze',
      type: 'line' as const,
      source: 'openmaptiles',
      'source-layer': 'transportation',
      filter: ['all', isLine, ['==', ['get', 'class'], 'path']] as never,
      paint: {
        'line-color': C.footway,
        'line-width': ['interpolate', ['exponential', 1.2], ['zoom'], 14, 0.8, 18, 2.4, 20, 5],
        'line-dasharray': [2, 2],
      },
      layout: { 'line-cap': 'round', 'line-join': 'round' },
    },
    {
      id: 'szyny',
      type: 'line' as const,
      source: 'openmaptiles',
      'source-layer': 'transportation',
      filter: ['all', isLine, ['!', ['has', 'service']], ['==', ['get', 'class'], 'rail']] as never,
      paint: {
        'line-color': C.rail,
        'line-width': ['interpolate', ['exponential', 1.3], ['zoom'], 14, 1, 18, 2.6, 20, 5],
      },
      layout: { 'line-join': 'round' },
    },
    {
      id: 'granice',
      type: 'line' as const,
      source: 'openmaptiles',
      'source-layer': 'boundary',
      filter: ['all', ['<=', ['get', 'admin_level'], 4], ['!=', ['get', 'disputed'], 1]] as never,
      paint: {
        'line-color': C.boundary,
        'line-opacity': 0.65,
        'line-width': ['interpolate', ['linear'], ['zoom'], 4, 0.6, 10, 1.4],
        'line-dasharray': [3, 2],
      },
      layout: { 'line-cap': 'round', 'line-join': 'round' },
    },
    nameSymbol(
      'nazwa-rzeki',
      'waterway',
      isLine,
      C.waterLabel,
      ['interpolate', ['linear'], ['zoom'], 12, 10, 18, 13],
      { 'symbol-placement': 'line', 'text-font': ['Noto Sans Italic'] },
    ),
    nameSymbol(
      'nazwa-ulicy-glowna',
      'transportation_name',
      ['match', ['get', 'class'], ['primary', 'secondary', 'tertiary', 'trunk'], true, false],
      C.roadLabel,
      ['interpolate', ['linear'], ['zoom'], 13, 11, 18, 14],
      { 'symbol-placement': 'line', 'text-font': ['Noto Sans Regular'], 'text-max-width': 8, 'text-rotation-alignment': 'map' },
    ),
    nameSymbol(
      'nazwa-ulicy-drobna',
      'transportation_name',
      ['all', isLine, ['match', ['get', 'class'], ['minor', 'service'], true, false]],
      C.roadLabel,
      ['interpolate', ['linear'], ['zoom'], 15, 10, 18, 13],
      { 'symbol-placement': 'line', 'text-font': ['Noto Sans Regular'], 'text-max-width': 7, 'text-rotation-alignment': 'map' },
    ),
    nameSymbol(
      'miejsce-miasto',
      'place',
      ['==', ['get', 'class'], 'city'],
      C.placeCity,
      ['interpolate', ['exponential', 1.2], ['zoom'], 5, 12, 9, 16],
      { 'text-font': ['Noto Sans Bold'], 'text-max-width': 8 },
      1.5,
    ),
    nameSymbol(
      'miejsce-inne',
      'place',
      ['match', ['get', 'class'], ['town', 'village', 'suburb', 'neighbourhood'], true, false],
      C.placeTown,
      ['interpolate', ['linear'], ['zoom'], 9, 10, 14, 14],
      { 'text-font': ['Noto Sans Regular'], 'text-max-width': 8 },
      1.3,
    ),
    nameSymbol(
      'miejsce-kraj',
      'place',
      ['all', ['==', ['get', 'class'], 'country'], ['==', ['get', 'rank'], 1]],
      C.placeSmall,
      ['interpolate', ['linear'], ['zoom'], 3, 10, 7, 15],
      { 'text-font': ['Noto Sans Regular'], 'text-max-width': 6 },
    ),
  ];
}

export const ROUTE_SOURCE_ID = 'kilometr-trasa';

// `sel` na obiekcie linii: 2 = wybrana noga, 1 = przygaszona reszta,
// 0 = nic nie wybrane (wtedy wszystkie nogi rysujemy na pełnej szerokości).
const SEL = ['get', 'sel'];
const bySel = (selected: unknown, dimmed: unknown, normal: unknown) => [
  'match',
  SEL,
  2,
  selected,
  1,
  dimmed,
  normal,
];

/**
 * Warstwy trasy: obwódka, linia kursu, przerywany spacer, przystanki
 * pośrednie i niewidoczna warstwa chwytna pod palce. Wszystkie z jednego
 * źródła GeoJSON, więc zmiana geometrii to jedno setData.
 */
export function buildRouteLayers() {
  return [
    {
      id: 'trasa-obwodka',
      type: 'line' as const,
      source: ROUTE_SOURCE_ID,
      filter: ['==', ['geometry-type'], 'LineString'] as never,
      paint: {
        'line-color': C.routeCasing,
        'line-width': bySel(9, 7.5, 7.5),
        'line-opacity': bySel(0.95, 0.45, 0.9),
      },
      layout: { 'line-cap': 'round' as const, 'line-join': 'round' as const },
    },
    {
      id: 'trasa-spacer',
      type: 'line' as const,
      source: ROUTE_SOURCE_ID,
      filter: ['all', ['==', ['geometry-type'], 'LineString'], ['==', ['get', 'walk'], 1]] as never,
      paint: {
        'line-color': C.walk,
        'line-width': bySel(4.5, 4, 4),
        'line-opacity': bySel(0.9, 0.35, 0.85),
        'line-dasharray': [1, 3.2],
      },
      layout: { 'line-cap': 'round' as const, 'line-join': 'round' as const },
    },
    {
      id: 'trasa-kurs',
      type: 'line' as const,
      source: ROUTE_SOURCE_ID,
      filter: ['all', ['==', ['geometry-type'], 'LineString'], ['==', ['get', 'walk'], 0]] as never,
      paint: {
        'line-color': ['get', 'color'] as never,
        'line-width': bySel(6.5, 5.5, 5.5),
        'line-opacity': bySel(1, 0.4, 1),
      },
      layout: { 'line-cap': 'round' as const, 'line-join': 'round' as const },
    },
    {
      id: 'trasa-chwyt',
      type: 'line' as const,
      source: ROUTE_SOURCE_ID,
      filter: ['==', ['geometry-type'], 'LineString'] as never,
      paint: { 'line-color': '#000000', 'line-width': 26, 'line-opacity': 0.001 },
      layout: { 'line-cap': 'round' as const, 'line-join': 'round' as const },
    },
    {
      id: 'przystanki-posrednie',
      type: 'circle' as const,
      source: ROUTE_SOURCE_ID,
      filter: ['all', ['==', ['geometry-type'], 'Point'], ['==', ['get', 'role'], 'intermediate']] as never,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 13, 2.5, 16, 4, 19, 6],
        'circle-color': C.stopMid,
        'circle-stroke-color': C.land,
        'circle-stroke-width': 1.5,
        'circle-opacity': bySel(0.9, 0.35, 0.95),
      },
    },
  ];
}

const EMPTY = { type: 'FeatureCollection' as const, features: [] };

/**
 * Pełny styl mapy: podkład OSM + warstwy trasy. Trasa siedzi w tym samym
 * stylu, więc WebView nie musi nic doklejać po wczytaniu — wystarczy
 * `setData` na źródle GeoJSON.
 */
export function buildMapStyle() {
  return {
    version: 8,
    name: 'kilometr-ciemna',
    sources: {
      openmaptiles: { type: 'vector', url: MAP_SOURCE_URL, attribution: '' },
      [ROUTE_SOURCE_ID]: { type: 'geojson', data: EMPTY },
    },
    glyphs: MAP_GLYPHS_URL,
    layers: [...baseLayers(), ...buildRouteLayers()],
  };
}
