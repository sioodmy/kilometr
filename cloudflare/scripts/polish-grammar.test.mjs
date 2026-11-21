import test from 'node:test';
import assert from 'node:assert/strict';
import { formatStreetLocative, classifyOsmLandmark } from './polish-grammar.mjs';

test('formatStreetLocative: declines feminine, masculine, neuter and plural Polish streets cleanly', () => {
  assert.equal(formatStreetLocative('Marszałkowska'), 'na ul. Marszałkowskiej');
  assert.equal(formatStreetLocative('ul. Ślężna'), 'na ul. Ślężnej');
  assert.equal(formatStreetLocative('Starowiślna'), 'na ul. Starowiślnej');
  assert.equal(formatStreetLocative('Górnicza'), 'na ul. Górniczej');
  assert.equal(formatStreetLocative('Woronicza'), 'na ul. Woronicza'); // nazwisko — bez odmiany!
  assert.equal(formatStreetLocative('Andersa'), 'na ul. Andersa');
  assert.equal(formatStreetLocative('Górna Wilda'), 'na ul. Górnej Wildzie');
  assert.equal(formatStreetLocative('Al. Jerozolimskie'), 'w Al. Jerozolimskich');
  assert.equal(formatStreetLocative('Al. Ujazdowskie'), 'w Al. Ujazdowskich');
  assert.equal(formatStreetLocative('al. Solidarności'), 'przy al. Solidarności');
  assert.equal(formatStreetLocative('pl. Teatralny'), 'na pl. Teatralnym');
  assert.equal(formatStreetLocative('pl. Bernardyński'), 'na pl. Bernardyńskim');
  assert.equal(formatStreetLocative('pl. Synagogi'), 'na pl. Synagogi'); // dopełniacz — nie "Synagogim"!
  assert.equal(formatStreetLocative('Rondo Mogilskie'), 'przy rondzie Mogilskim');
  assert.equal(formatStreetLocative('Most Poniatowskiego'), 'na moście Poniatowskiego');
  assert.equal(formatStreetLocative('Nowy Świat'), 'na Nowym Świecie');
});

test('formatStreetLocative: rejects garbage GTFS street names', () => {
  assert.equal(formatStreetLocative('parking'), null);
  assert.equal(formatStreetLocative('pętla'), null);
  assert.equal(formatStreetLocative('droga wzdłuż nasypu'), null);
  assert.equal(formatStreetLocative(''), null);
});

test('classifyOsmLandmark: declines known chains and rejects slop POIs', () => {
  const zabka = classifyOsmLandmark({ id: 1, tags: { shop: 'convenience', name: 'Żabka' } });
  assert.equal(zabka?.nearPhrase, 'obok Żabki');
  assert.equal(zabka?.canBeOpposite, false);

  const biedronka = classifyOsmLandmark({ id: 2, tags: { shop: 'supermarket', name: 'Biedronka' } });
  assert.equal(biedronka?.nearPhrase, 'obok Biedronki');
  assert.equal(biedronka?.oppositePhrase, 'naprzeciwko Biedronki');
  assert.equal(biedronka?.canBeOpposite, true);

  const orlen = classifyOsmLandmark({ id: 3, tags: { amenity: 'fuel', name: 'ORLEN' } });
  assert.equal(orlen?.nearPhrase, 'obok stacji Orlen');

  const bank = classifyOsmLandmark({ id: 4, tags: { amenity: 'bank', name: 'Millennium Bank' } });
  assert.equal(bank?.nearPhrase, 'obok oddziału banku Millennium');

  // Zakazany slop
  assert.equal(classifyOsmLandmark({ id: 10, tags: { leisure: 'park', name: 'Capital Park' } }), null);
  assert.equal(classifyOsmLandmark({ id: 11, tags: { leisure: 'park', name: 'Park kieszonkowy' } }), null);
  assert.equal(classifyOsmLandmark({ id: 12, tags: { amenity: 'cinema', name: 'Kino dla dzieci' } }), null);
  assert.equal(classifyOsmLandmark({ id: 13, tags: { shop: 'convenience', name: 'Sklep?' } }), null);
  assert.equal(classifyOsmLandmark({ id: 14, tags: { amenity: 'place_of_worship', name: 'Kościół domowy' } }), null);
});
