// Styl mapy wektorowej (MapLibre style spec) w ciemnej palecie M3 aplikacji.
//
// Kafelki rastrowe odpadły: CARTO i Stadia wymagają klucza, a jasny OSM kłóci
// się z ciemnym interfejsem. Dlatego rysujemy wektorowe kafelki OSM
// (OpenFreeMap, bez klucza i bez limitu) i nadpisujemy każdą warstwę
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
  halo: '#101413',
  // Trasa
  routeCasing: '#080C0B',
} as const;

/**
 * Kolory zależne od motywu. Czytamy je w funkcjach budujących styl, a nie
 * raz przy imporcie: na Androidzie 12+ paleta pochodzi z tapety i jest
 * podmieniana po zaimportowaniu modułu (`src/theme/dynamic.ts`).
 */
const motif = () => ({
  placeCity: scheme.onSurface,
  placeTown: scheme.onSurfaceVariant,
  placeSmall: colors.faint,
  walk: scheme.onSurfaceVariant,
  stopMid: scheme.onSurface,
  // POI celowo ciszej niż nazwy ulic, ale nadal czytelnie na ciemnym tle
  // (kontrast tekstu w mapie ma sens tylko wtedy, gdy da się go przeczytać).
  poi: scheme.outline,
});

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
  minzoom?: number,
) => ({
  id,
  type: 'symbol' as const,
  source: 'openmaptiles',
  'source-layer': sourceLayer,
  ...(minzoom !== undefined ? { minzoom } : {}),
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
        'line-width': ['interpolate', ['exponential', 1.4], ['zoom'], 6, 0.35, 9, 0.6, 14, 1.8, 20, 9],
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
        'line-opacity': ['interpolate', ['linear'], ['zoom'], 4, 0.35, 8, 0.85, 10, 1],
        'line-width': ['interpolate', ['exponential', 1.4], ['zoom'], 4, 0.7, 7, 1.5, 10, 3.2, 12, 6.5, 20, 19],
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
        'line-opacity': ['interpolate', ['linear'], ['zoom'], 4, 0.45, 8, 0.85, 10, 1],
        'line-width': ['interpolate', ['exponential', 1.4], ['zoom'], 4, 0.4, 7, 0.85, 10, 1.8, 12, 3, 20, 15],
      },
      layout: { 'line-cap': 'round', 'line-join': 'round' },
    },
    {
      id: 'drogi-obwodka-glowna',
      type: 'line' as const,
      source: 'openmaptiles',
      'source-layer': 'transportation',
      minzoom: 7,
      filter: ['all', isLine, ROAD_MAJOR] as never,
      paint: {
        'line-color': C.casing,
        'line-width': ['interpolate', ['exponential', 1.3], ['zoom'], 7, 0.6, 10, 2.2, 16, 8, 20, 16],
      },
      layout: { 'line-cap': 'butt', 'line-join': 'round' },
    },
    {
      id: 'drogi-glowna',
      type: 'line' as const,
      source: 'openmaptiles',
      'source-layer': 'transportation',
      minzoom: 7,
      filter: ['all', isLine, ROAD_MAJOR] as never,
      paint: {
        'line-color': C.major,
        'line-width': ['interpolate', ['exponential', 1.3], ['zoom'], 7, 0.35, 10, 1.1, 16, 4.5, 20, 11],
      },
      layout: { 'line-cap': 'round', 'line-join': 'round' },
    },
    {
      id: 'drogi-drobne',
      type: 'line' as const,
      source: 'openmaptiles',
      'source-layer': 'transportation',
      minzoom: 12,
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
      minzoom: 13,
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
      minzoom: 8,
      filter: ['all', isLine, ['!', ['has', 'service']], ['==', ['get', 'class'], 'rail']] as never,
      paint: {
        'line-color': C.rail,
        'line-opacity': ['interpolate', ['linear'], ['zoom'], 8, 0.45, 12, 0.85, 15, 1],
        'line-width': ['interpolate', ['exponential', 1.3], ['zoom'], 8, 0.5, 12, 0.9, 14, 1.2, 18, 2.6, 20, 5],
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
      1.1,
      11,
    ),
    nameSymbol(
      'nazwa-ulicy-glowna',
      'transportation_name',
      ['match', ['get', 'class'], ['primary', 'secondary', 'tertiary', 'trunk'], true, false],
      C.roadLabel,
      ['interpolate', ['linear'], ['zoom'], 13, 11, 18, 14],
      { 'symbol-placement': 'line', 'text-font': ['Noto Sans Regular'], 'text-max-width': 8, 'text-rotation-alignment': 'map' },
      1.1,
      12,
    ),
    nameSymbol(
      'nazwa-ulicy-drobna',
      'transportation_name',
      ['all', isLine, ['match', ['get', 'class'], ['minor', 'service'], true, false]],
      C.roadLabel,
      ['interpolate', ['linear'], ['zoom'], 15, 10, 18, 13],
      { 'symbol-placement': 'line', 'text-font': ['Noto Sans Regular'], 'text-max-width': 7, 'text-rotation-alignment': 'map' },
      1.1,
      14,
    ),
    nameSymbol(
      'miejsce-miasto',
      'place',
      ['==', ['get', 'class'], 'city'],
      motif().placeCity,
      ['interpolate', ['exponential', 1.2], ['zoom'], 4, 10.5, 6, 11.5, 9, 15.5],
      { 'text-font': ['Noto Sans Bold'], 'text-max-width': 8, 'text-padding': 4 },
      1.5,
      4,
    ),
    nameSymbol(
      'miejsce-inne',
      'place',
      ['match', ['get', 'class'], ['town', 'village', 'suburb', 'neighbourhood'], true, false],
      motif().placeTown,
      ['interpolate', ['linear'], ['zoom'], 9, 10, 14, 14],
      { 'text-font': ['Noto Sans Regular'], 'text-max-width': 8, 'text-padding': 4 },
      1.3,
      8.5,
    ),
    nameSymbol(
      'miejsce-kraj',
      'place',
      ['all', ['==', ['get', 'class'], 'country'], ['==', ['get', 'rank'], 1]],
      motif().placeSmall,
      ['interpolate', ['linear'], ['zoom'], 3, 10, 7, 15],
      { 'text-font': ['Noto Sans Regular'], 'text-max-width': 6 },
    ),
  ];
}

/**
 * Ikona POI: kolorowa tarcza z białym glifem kategorii, jak w Apple Maps.
 * Obrazki rysuje runtime WebView (canvas), więc działają też offline i nie
 * wymagają sprite'u z sieci. Kształty są w siatce 24x24.
 */
export const POI_ICON_SPECS = [
  {
    name: 'poi-food',
    color: '#C97A32',
    glyph: 'M7 4v5M5 4v3.5a2 2 0 0 0 4 0V4M7 9v11M16.5 4c-1.8 2.3-1.8 5.4 0 7.6V20',
  },
  {
    name: 'poi-shop',
    color: '#4C8FD6',
    glyph: 'M5 8h14l1 12H4L5 8zM9 8V6a3 3 0 0 1 6 0v2',
  },
  {
    name: 'poi-medical',
    color: '#D75B52',
    glyph: 'M10 4.5h4v5.5h5.5v4H14V19.5h-4V14H4.5v-4H10V4.5z',
    fill: true,
  },
  {
    name: 'poi-education',
    color: '#7B6FD0',
    glyph:
      'M12 6.5C10.4 5 8.3 4.4 5 4.4v13.2c3.3 0 5.4.6 7 2.1 1.6-1.5 3.7-2.1 7-2.1V4.4c-3.3 0-5.4.6-7 2.1zM12 6.5v13.2',
  },
  {
    name: 'poi-culture',
    color: '#BE79B4',
    glyph:
      'M12 4.2l2.4 4.8 5.3.8-3.8 3.7.9 5.3-4.8-2.5-4.8 2.5.9-5.3-3.8-3.7 5.3-.8L12 4.2z',
    fill: true,
  },
  {
    name: 'poi-nature',
    color: '#3B8A60',
    glyph: 'M12 4l5 6h-3l4 5h-4v4h-4v-4H6l4-5H7l5-6z',
    fill: true,
  },
  {
    name: 'poi-sport',
    color: '#2E8F89',
    glyph:
      'M12 5a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM5.4 9.6c4.2 2 9 2 13.2 0M5.4 14.4c4.2-2 9-2 13.2 0',
  },
  {
    name: 'poi-hotel',
    color: '#A97F5E',
    glyph: 'M4 18V7M4 13h16v5M8 13v-3h5a3 3 0 0 1 3 3M7 18v1.5M20 18v1.5',
  },
  {
    name: 'poi-fuel',
    color: '#7C8784',
    glyph: 'M6 20V5h8v15M5 20h10M9 8h3v4H9zM14 9h3l2 2v6a1.5 1.5 0 0 0 3 0v-8l-2-2',
  },
  {
    name: 'poi-transit',
    color: '#5C86E0',
    glyph:
      'M8 4h8a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3zM5 11h14M9 8h.1M15 8h.1M8 20l1.5-3M16 20l-1.5-3',
  },
  {
    name: 'poi-worship',
    color: '#94784A',
    glyph: 'M12 3v6M9 6h6M12 9l-6 6v5h12v-5l-6-6zM10 20v-4h4v4',
  },
  {
    name: 'poi-civic',
    color: '#6A8FA8',
    glyph: 'M3 9l9-5 9 5M4.5 9h15M6.5 19h11M8 9v10M12 9v10M16 9v10M5 21h14',
  },
  {
    name: 'poi-default',
    color: '#7C8784',
    glyph: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
    fill: true,
  },
] as const;

/** Kategoria OSM -> nazwa obrazka ikony. */
const poiIconImage = [
  'match',
  ['get', 'class'],
  ['fast_food', 'cafe', 'restaurant', 'bar', 'beer', 'ice_cream'],
  'poi-food',
  ['shop', 'grocery', 'clothing_store', 'alcohol_shop', 'music', 'laundry'],
  'poi-shop',
  ['hospital', 'pharmacy', 'clinic', 'doctors', 'dentist', 'veterinary'],
  'poi-medical',
  ['school', 'college', 'library'],
  'poi-education',
  [
    'museum',
    'attraction',
    'art_gallery',
    'viewpoint',
    'castle',
    'zoo',
    'cinema',
    'theatre',
    'monument',
    'memorial',
    'theme_park',
    'water_park',
    'aquarium',
  ],
  'poi-culture',
  ['park', 'garden', 'playground', 'dog_park', 'campsite', 'cemetery'],
  'poi-nature',
  ['stadium', 'sports_centre', 'swimming', 'fitness_centre', 'golf', 'beach'],
  'poi-sport',
  ['lodging'],
  'poi-hotel',
  ['fuel'],
  'poi-fuel',
  ['airport', 'harbor', 'car', 'parking'],
  'poi-transit',
  ['place_of_worship'],
  'poi-worship',
  [
    'town_hall',
    'post',
    'bank',
    'atm',
    'police',
    'fire_station',
    'courthouse',
    'embassy',
    'government',
  ],
  'poi-civic',
  'poi-default',
] as never;

/**
 * Warstwy POI (miejsca punktowe z OSM): kolorowa ikona kategorii plus etykieta.
 * Ikony pokazują się od z14, etykiety dopiero od z16 (najważniejsze POI
 * wcześniej), więc przy oddalaniu mapa pokazuje orientacyjne punkty, a nie
 * ścianę tekstu. Kolizje i sortowanie po randze (1 = najważniejszy) sprawiają,
 * że gęste obszary same się rozrzedzają. Warstwy wchodzą do stylu PRZED
 * warstwami trasy, więc trasa i przystanki zawsze rysują się na nich.
 */
function buildPoiLayers() {
  // Klasy transportowe pomijamy: przystanki trasy opisuje sama aplikacja,
  // ich dublowanie tylko gęści mapę. Biura to szum bez wartości dla podróży.
  const notTransit = [
    '!',
    ['match', ['get', 'class'], ['bus', 'rail', 'railway', 'subway', 'station', 'entrance', 'aerialway', 'office'], true, false],
  ] as never;
  const isPoint = ['==', ['geometry-type'], 'Point'] as never;
  const rankSort = ['coalesce', ['get', 'rank'], 99];
  // Najważniejsze POI mają nazwę już od z14, reszta dopiero od z16.
  const nameAtZoom = [
    'step',
    ['zoom'],
    ['case', ['<=', ['get', 'rank'], 2], nameField, ''],
    16,
    nameField,
  ] as never;
  const layout = {
    'icon-image': poiIconImage,
    'icon-size': ['interpolate', ['linear'], ['zoom'], 14, 0.62, 17, 0.8, 20, 0.95],
    'icon-padding': 3,
    'icon-allow-overlap': false,
    'text-field': nameAtZoom,
    'text-font': ['Noto Sans Regular'],
    'text-size': ['interpolate', ['linear'], ['zoom'], 15, 9.5, 19, 11.5],
    'text-max-width': 7,
    'text-padding': 2,
    'text-variable-anchor': ['right', 'left', 'top', 'bottom'],
    'text-radial-offset': 1.25,
    'text-justify': 'auto',
    'text-optional': true,
    'symbol-sort-key': rankSort,
  };
  const paint = labelPaint(motif().poi, 1.2);
  return [
    {
      id: 'poi-istotne',
      type: 'symbol' as const,
      source: 'openmaptiles',
      'source-layer': 'poi',
      minzoom: 14,
      filter: ['all', isPoint, ['<=', ['get', 'rank'], 4], notTransit] as never,
      paint,
      layout,
    },
    {
      id: 'poi-drobiazgi',
      type: 'symbol' as const,
      source: 'openmaptiles',
      'source-layer': 'poi',
      minzoom: 16,
      filter: [
        'all',
        isPoint,
        ['<=', ['get', 'rank'], 9],
        ['>', ['get', 'rank'], 4],
        notTransit,
      ] as never,
      paint,
      layout: {
        ...layout,
        'text-field': ['step', ['zoom'], '', 17, nameField] as never,
      },
    },
  ];
}

export const ROUTE_SOURCE_ID = 'kilometr-trasa';

// `sel` na obiekcie linii: 2 = wybrana noga/etap, 1 = przygaszona reszta,
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
 * pośrednie, etykiety stacji i niewidoczna warstwa chwytna pod palce.
 * Wszystkie z jednego źródła GeoJSON, więc zmiana geometrii to jedno setData.
 */
function buildRouteLayers() {
  return [
    {
      id: 'trasa-obwodka',
      type: 'line' as const,
      source: ROUTE_SOURCE_ID,
      filter: ['==', ['geometry-type'], 'LineString'] as never,
      paint: {
        'line-color': C.routeCasing,
        'line-width': [
          'interpolate',
          ['linear'],
          ['zoom'],
          4,
          bySel(7.5, 5.5, 6.2),
          8,
          bySel(8.5, 6.5, 7.2),
          12,
          bySel(9.5, 7.5, 7.8),
        ] as never,
        'line-opacity': bySel(0.95, 0.4, 0.9),
      },
      layout: { 'line-cap': 'round' as const, 'line-join': 'round' as const },
    },
    {
      id: 'trasa-spacer',
      type: 'line' as const,
      source: ROUTE_SOURCE_ID,
      filter: ['all', ['==', ['geometry-type'], 'LineString'], ['==', ['get', 'walk'], 1]] as never,
      paint: {
        'line-color': ['coalesce', ['get', 'color'], motif().walk] as never,
        'line-width': [
          'interpolate',
          ['linear'],
          ['zoom'],
          4,
          bySel(3.2, 2.2, 2.6),
          10,
          bySel(4.5, 3.6, 4),
        ] as never,
        'line-opacity': bySel(0.9, 0.3, 0.85),
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
        'line-width': [
          'interpolate',
          ['linear'],
          ['zoom'],
          4,
          bySel(5, 3.2, 3.8),
          8,
          bySel(5.8, 4, 4.6),
          12,
          bySel(6.8, 5, 5.5),
        ] as never,
        'line-opacity': bySel(1, 0.35, 1),
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
        'circle-radius': [
          'interpolate',
          ['linear'],
          ['zoom'],
          5,
          ['case', ['==', ['get', 'sel'], 2], 2.2, ['==', ['get', 'rail'], 1], 1.7, 0],
          8,
          ['case', ['==', ['get', 'sel'], 2], 2.8, ['==', ['get', 'rail'], 1], 2.3, 0],
          10.5,
          ['case', ['==', ['get', 'sel'], 2], 3.2, 2.1],
          13,
          ['case', ['==', ['get', 'sel'], 2], 3.6, 2.6],
          16,
          4.5,
          19,
          6.5,
        ] as never,
        'circle-color': ['coalesce', ['get', 'color'], motif().stopMid] as never,
        'circle-stroke-color': C.land,
        'circle-stroke-width': [
          'interpolate',
          ['linear'],
          ['zoom'],
          5,
          ['case', ['==', ['get', 'sel'], 2], 1.2, ['==', ['get', 'rail'], 1], 0.9, 0],
          10,
          ['case', ['==', ['get', 'sel'], 2], 1.4, ['==', ['get', 'rail'], 1], 1.2, 0],
          11,
          1.5,
        ] as never,
        'circle-opacity': bySel(0.95, 0.25, 0.92),
        'circle-stroke-opacity': bySel(0.95, 0.25, 0.92),
      },
    },
    {
      id: 'przystanki-etykiety',
      type: 'symbol' as const,
      source: ROUTE_SOURCE_ID,
      filter: [
        'all',
        ['==', ['geometry-type'], 'Point'],
        ['has', 'name'],
        [
          'any',
          ['==', ['get', 'role'], 'endpoint'],
          ['==', ['get', 'rail'], 1],
          ['==', ['get', 'sel'], 2],
        ],
      ] as never,
      layout: {
        'symbol-sort-key': [
          'case',
          ['==', ['get', 'role'], 'endpoint'],
          1,
          ['==', ['get', 'sel'], 2],
          2,
          10,
        ] as never,
        'text-field': ['get', 'name'] as never,
        'text-font': ['Noto Sans Bold'],
        'text-size': [
          'interpolate',
          ['linear'],
          ['zoom'],
          4.5,
          ['case', ['==', ['get', 'role'], 'endpoint'], 10.5, 0],
          6.5,
          ['case', ['==', ['get', 'role'], 'endpoint'], 11, ['==', ['get', 'sel'], 2], 10, 9.5],
          10,
          ['case', ['==', ['get', 'role'], 'endpoint'], 11.5, 10.5],
          14,
          12,
        ] as never,
        'text-variable-anchor': ['left', 'right', 'top', 'bottom'],
        'text-radial-offset': 0.85,
        'text-max-width': 9,
        'text-padding': 6,
        'text-optional': true,
      },
      paint: {
        'text-color': [
          'case',
          ['==', ['get', 'role'], 'endpoint'],
          bySel('#F4F8F6', 'rgba(244, 248, 246, 0.35)', '#F4F8F6'),
          bySel('#E1EAE6', 'rgba(225, 234, 230, 0.22)', '#D2DDD8'),
        ] as never,
        'text-halo-color': C.halo,
        'text-halo-width': 1.8,
        'text-halo-blur': 0.4,
      },
    },
  ];
}

const EMPTY = { type: 'FeatureCollection' as const, features: [] };

/**
 * Pełny styl mapy: podkład OSM + warstwy trasy. Trasa siedzi w tym samym
 * stylu, więc WebView nie musi nic doklejać po wczytaniu, wystarczy
 * `setData` na źródle GeoJSON.
 *
 * `base` (opcjonalnie) przestawia kafle i glify na lokalny serwer mapy:
 * `base` to np. `http://127.0.0.1:45999`. Schemat kafli jest ten sam co
 * online (OpenMapTiles), więc warstwy poniżej nie wymagają żadnych zmian.
 * `opts.poi` dokłada etykiety POI między podkład a trasę (używa jej dopiero
 * pełnoekranowa mapa szczegółów połączenia).
 */
export function buildMapStyle(base?: string | null, opts: { poi?: boolean } = {}) {
  const tiles = base
    ? { type: 'vector' as const, tiles: [`${base}/tiles/{z}/{x}/{y}.pbf`], minzoom: 0, maxzoom: 14 }
    : { type: 'vector' as const, url: MAP_SOURCE_URL };
  return {
    version: 8,
    name: 'kilometr-ciemna',
    sources: {
      openmaptiles: { ...tiles, attribution: '' },
      [ROUTE_SOURCE_ID]: { type: 'geojson', data: EMPTY },
    },
    glyphs: base ? `${base}/assets/fonts/{fontstack}/{range}.pbf` : MAP_GLYPHS_URL,
    layers: [
      ...baseLayers(),
      ...(opts.poi ? buildPoiLayers() : []),
      ...buildRouteLayers(),
    ],
  };
}
