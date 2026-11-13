import assert from 'node:assert/strict';
import { test } from 'node:test';

import { AMENITY_ORDER, VAGONWEB_AGENCY, encodeAmenities } from './build-polska.mjs';

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
