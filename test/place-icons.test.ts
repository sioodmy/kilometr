import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildQuickIcons,
  filterPlaceIcons,
  PLACE_ICON_CATALOG,
  placeIconTone,
  suggestPlaceIcon,
} from '../src/services/placeIcons';
import { pl } from '../src/i18n/pl';

test('suggestPlaceIcon: dopasowanie z kategorii i nazwy lokalizacji', () => {
  assert.deepEqual(
    suggestPlaceIcon({
      location: {
        title: 'Dworzec Główny',
        address: 'Stacja kolejowa • Stare Miasto',
        kind: 'stop',
        category: 'train',
      },
    }),
    { icon: 'train', source: 'location' },
  );

  assert.deepEqual(
    suggestPlaceIcon({
      location: {
        title: 'Budynek C-13 Politechniki Wrocławskiej',
        address: 'Uczelnia • Plac Grunwaldzki',
        kind: 'place',
        category: 'school',
      },
    }),
    { icon: 'university', source: 'location' },
  );

  assert.deepEqual(
    suggestPlaceIcon({
      location: {
        title: 'Apteka Słoneczna',
        address: 'Apteka • Krzyki',
        kind: 'place',
        category: 'medical',
      },
    }),
    { icon: 'pharmacy', source: 'location' },
  );

  assert.deepEqual(
    suggestPlaceIcon({
      location: {
        title: 'Biedronka',
        address: 'Supermarket • Legnicka 48',
        kind: 'place',
        category: 'shop',
      },
    }),
    { icon: 'cart', source: 'location' },
  );

  assert.deepEqual(
    suggestPlaceIcon({
      location: {
        title: 'Park Szczytnicki',
        address: 'Park • Śródmieście',
        kind: 'place',
        category: 'sport',
      },
    }),
    { icon: 'park', source: 'location' },
  );

  assert.deepEqual(
    suggestPlaceIcon({
      location: {
        title: 'Port Lotniczy Wrocław',
        address: 'Graniczna 190',
        kind: 'place',
      },
    }),
    { icon: 'plane', source: 'location' },
  );

  assert.deepEqual(
    suggestPlaceIcon({
      location: {
        title: 'Pl. Grunwaldzki',
        address: 'Przystanek',
        kind: 'stop',
      },
    }),
    { icon: 'bus', source: 'location' },
  );
});

test('suggestPlaceIcon: zwykły adres nie zgaduje fałszywej ikony', () => {
  assert.equal(
    suggestPlaceIcon({
      location: {
        title: 'ul. Powstańców Śląskich 12',
        address: 'Krzyki, Wrocław',
        kind: 'address',
      },
    }),
    null,
  );

  // Słowo "Barbara" nie powinno dopasować krótkiego słowa kluczowego "bar".
  assert.equal(
    suggestPlaceIcon({
      location: {
        title: 'ul. Barbary 7',
        address: 'Wrocław',
        kind: 'address',
      },
    }),
    null,
  );
});

test('suggestPlaceIcon: wpisana nazwa nadpisuje lokalizację i wspiera języki', () => {
  assert.deepEqual(
    suggestPlaceIcon({
      name: 'Dom',
      location: { title: 'ul. Kwiatowa 5', address: 'Wrocław', kind: 'address' },
    }),
    { icon: 'home', source: 'name' },
  );

  assert.deepEqual(
    suggestPlaceIcon({
      name: 'Siłka po pracy',
      location: { title: 'ul. Legnicka 48', address: 'Wrocław', kind: 'address' },
    }),
    { icon: 'gym', source: 'name' },
  );

  assert.deepEqual(
    suggestPlaceIcon({
      name: 'Kawa przy dworcu',
      location: { title: 'ul. Piłsudskiego 10', address: 'Wrocław', kind: 'address' },
    }),
    { icon: 'coffee', source: 'name' },
  );

  assert.deepEqual(
    suggestPlaceIcon({
      name: 'Mama',
      location: { title: 'ul. Krótka 1', address: 'Wrocław', kind: 'address' },
    }),
    { icon: 'heart', source: 'name' },
  );

  assert.deepEqual(
    suggestPlaceIcon({
      name: 'Дім',
      location: { title: 'ul. Krótka 1', address: 'Wrocław', kind: 'address' },
    }),
    { icon: 'home', source: 'name' },
  );
});

test('filterPlaceIcons: obsługuje brak polskich znaków i kategorie', () => {
  const gyms = filterPlaceIcons('silownia', 'all', pl.places.iconName);
  assert.ok(gyms.some((i) => i.key === 'gym'));

  const schools = filterPlaceIcons('szkola', 'all', pl.places.iconName);
  assert.ok(schools.some((i) => i.key === 'school'));

  const churchInHealth = filterPlaceIcons('kosciol', 'health', pl.places.iconName);
  assert.equal(churchInHealth.length, 0);

  const all = filterPlaceIcons('', 'all', pl.places.iconName);
  assert.equal(all.length, PLACE_ICON_CATALOG.length);
});

test('buildQuickIcons i placeIconTone: bez duplikatów, wybrane i sugerowane na przedzie', () => {
  const quick = buildQuickIcons('pharmacy', 'train');
  assert.equal(quick[0], 'train');
  assert.equal(quick[1], 'pharmacy');
  assert.equal(new Set(quick).size, quick.length);
  assert.ok(quick.length <= 10);

  assert.equal(placeIconTone('home').bg, 'primaryContainer');
  assert.equal(placeIconTone('university').bg, 'tertiaryContainer');
  assert.equal(placeIconTone('coffee').bg, 'secondaryContainer');
});
