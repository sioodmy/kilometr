import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  AMENITY_ORDER,
  STATION_AMENITY_ORDER,
  VAGONWEB_AGENCY,
  encodeAmenities,
  encodeStationAmenities,
} from './build-polska.mjs';
import {
  STATION_AMENITY_ORDER as BUILDER_STATION_ORDER,
  classifyStationElement,
  collectStationAmenities,
} from './build-station-amenities.mjs';

test('kolejność bitów udogodnień jest stała (zgodna z aplikacją i scraperem)', () => {
  assert.equal(AMENITY_ORDER.length, 11);
  assert.equal(AMENITY_ORDER[0], 'klimatyzacja');
  assert.equal(AMENITY_ORDER[AMENITY_ORDER.length - 1], 'strefa_ciszy');
});

test('encodeAmenities: maska bitowa wg kolejności', () => {
  assert.equal(encodeAmenities([]), 0);
  assert.equal(encodeAmenities(['klimatyzacja']), 1);
  assert.equal(encodeAmenities(['gniazdka_230V']), 2);
  assert.equal(encodeAmenities(['klimatyzacja', 'gniazdka_230V']), 3);
  assert.equal(encodeAmenities(['strefa_ciszy']), 1 << 10);
});

test('encodeAmenities: nieznane klucze są ignorowane', () => {
  assert.equal(encodeAmenities(['monitoring', 'wifi', 'inne_info']), 1 << 3);
});

test('mapa przewoźników vagonweb -> agency feedu PLK', () => {
  assert.equal(VAGONWEB_AGENCY.PKPIC, 'IC');
  assert.equal(VAGONWEB_AGENCY.PREG, 'PR');
  assert.equal(VAGONWEB_AGENCY.KM, undefined, 'KM jest 1:1, nie trzymamy jej w mapie');
});

test('kolejność bitów udogodnień dworca jest stała i zsynchronizowana z build-station-amenities', () => {
  assert.deepEqual(STATION_AMENITY_ORDER, BUILDER_STATION_ORDER);
  assert.equal(STATION_AMENITY_ORDER[0], 'toilets');
  assert.equal(encodeStationAmenities(['toilets', 'shop']), (1 << 0) | (1 << 2));
  assert.equal(encodeStationAmenities(['unknown_key', 'luggage']), 1 << 7);
});

test('classifyStationElement rozpoznaje toalety, gastronomię, sklepy i skrytki OSM', () => {
  assert.deepEqual(classifyStationElement({ amenity: 'toilets' }), ['toilets']);
  assert.deepEqual(classifyStationElement({ shop: 'convenience', name: 'Żabka' }), ['shop']);
  assert.deepEqual(classifyStationElement({ shop: 'supermarket', name: 'Biedronka' }), ['shop']);
  assert.deepEqual(classifyStationElement({ amenity: 'fast_food', name: 'KFC' }), ['gastronomy']);
  assert.deepEqual(classifyStationElement({ amenity: 'cafe', name: 'Starbucks' }), ['cafe']);
  assert.deepEqual(classifyStationElement({ shop: 'bakery' }), ['bakery']);
  assert.deepEqual(classifyStationElement({ amenity: 'pharmacy' }), ['pharmacy']);
  assert.deepEqual(classifyStationElement({ amenity: 'atm' }), ['atm']);
  assert.deepEqual(classifyStationElement({ amenity: 'luggage_locker' }), ['luggage']);
  assert.deepEqual(
    classifyStationElement({ building: 'train_station', toilets: 'yes', luggage_storage: 'yes' }, true),
    ['toilets', 'luggage'],
  );
});

test('collectStationAmenities bierze POI w promieniu 50 m od stacji lub budynku dworca', () => {
  const stations = [
    { stopId: '60103', name: 'Wrocław Główny', lat: 51.097918, lon: 17.037434 },
  ];
  const elements = [
    // Budynek dworca ~70 m na północ od punktu peronowego
    {
      type: 'way',
      id: 1,
      tags: { building: 'train_station', name: 'Wrocław Główny' },
      geometry: [
        { lat: 51.09845, lon: 17.0365 },
        { lat: 51.09845, lon: 17.0385 },
        { lat: 51.0991, lon: 17.0385 },
        { lat: 51.0991, lon: 17.0365 },
        { lat: 51.09845, lon: 17.0365 },
      ],
    },
    // Żabka wewnątrz budynku dworca (~90 m od pinu GTFS, ale 0 m od budynku)
    { type: 'node', id: 2, lat: 51.0987, lon: 17.0375, tags: { shop: 'convenience', name: 'Żabka' } },
    // Toaleta ~30 m od punktu GTFS (wewnątrz 50 m)
    { type: 'node', id: 3, lat: 51.0981, lon: 17.037434, tags: { amenity: 'toilets' } },
    // Restauracja 350 m dalej (poza promieniem)
    { type: 'node', id: 4, lat: 51.1015, lon: 17.0375, tags: { amenity: 'restaurant' } },
  ];
  const out = collectStationAmenities(stations, elements, 50);
  assert.deepEqual(out['60103'], ['toilets', 'shop']);
});
