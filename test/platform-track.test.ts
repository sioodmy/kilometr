import test from 'node:test';
import assert from 'node:assert/strict';
import { formatPlatformLabel } from '../src/services/platformLabel';
import { pl } from '../src/i18n/pl';
import { en } from '../src/i18n/en';
import { de } from '../src/i18n/de';
import { uk } from '../src/i18n/uk';

test('formatPlatformLabel formats platform and track correctly for trains in Polish', () => {
  // Obie wartości: peron i tor
  assert.equal(formatPlatformLabel(pl, '1', 'train', undefined, '2'), 'Peron 1, Tor 2');

  // Tylko peron
  assert.equal(formatPlatformLabel(pl, '3', 'train', undefined, undefined), 'Peron 3');

  // Tylko tor
  assert.equal(formatPlatformLabel(pl, undefined, 'train', undefined, '4'), 'Tor 4');

  // Gotowy prefiks w kodzie peronu + tor
  assert.equal(formatPlatformLabel(pl, 'Peron 2', 'train', undefined, '105'), 'Peron 2, Tor 105');

  // Gotowy prefiks w kodzie peronu zawierający już tor
  assert.equal(formatPlatformLabel(pl, 'Peron 1 tor 2', 'train', undefined, '2'), 'Peron 1 tor 2');
});

test('formatPlatformLabel formats platform and track across EN, DE, UK locales', () => {
  // EN
  assert.equal(formatPlatformLabel(en, '1', 'train', undefined, '2'), 'Platform 1, track 2');
  assert.equal(formatPlatformLabel(en, undefined, 'train', undefined, '2'), 'Track 2');

  // DE
  assert.equal(formatPlatformLabel(de, '1', 'train', undefined, '2'), 'Bahnsteig 1, Gleis 2');
  assert.equal(formatPlatformLabel(de, undefined, 'train', undefined, '2'), 'Gleis 2');

  // UK
  assert.equal(formatPlatformLabel(uk, '1', 'train', undefined, '2'), 'Платформа 1, колія 2');
  assert.equal(formatPlatformLabel(uk, undefined, 'train', undefined, '2'), 'Колія 2');
});

test('formatPlatformLabel preserves bus and tram behavior and avoids false PST labels', () => {
  assert.equal(formatPlatformLabel(pl, '01', 'bus', undefined, undefined), 'Słupek 01');
  assert.equal(
    formatPlatformLabel(pl, '2469011-00103', 'bus', undefined, undefined),
    'Stanowisko 3',
  );

  // Warszawski słupek 41 NIE może dostawać poznańskiej etykiety "PST"
  assert.equal(formatPlatformLabel(pl, '41', 'bus', 'Centrum', undefined), 'Słupek 41');
  assert.equal(formatPlatformLabel(pl, '41', 'tram', 'Centrum', undefined), 'Słupek 41');

  // Prawdziwa stacja Poznańskiego Szybkiego Tramwaju (PST) dostaje etykietę PST
  assert.equal(formatPlatformLabel(pl, '41', 'tram', 'Most Teatralny', undefined), 'PST Słupek 41');
  assert.equal(formatPlatformLabel(pl, '45', 'tram', 'Rondo Kaponiera', undefined), 'PST Słupek 45');
  // Ale autobus na Poznaniu Głównym ze słupkiem 41 NIE jest trasą PST
  assert.equal(formatPlatformLabel(pl, '41', 'bus', 'Poznań Główny', undefined), 'Słupek 41');
});

test('notification platform and track strings', () => {
  // PL
  assert.equal(pl.notification.platformPeronTrack('1', '2'), 'peron 1, tor 2');
  assert.equal(pl.notification.platformTrack('2'), 'tor 2');

  // EN
  assert.equal(en.notification.platformPeronTrack('1', '2'), 'platform 1, track 2');
  assert.equal(en.notification.platformTrack('2'), 'track 2');

  // DE
  assert.equal(de.notification.platformPeronTrack('1', '2'), 'Bahnsteig 1, Gleis 2');
  assert.equal(de.notification.platformTrack('2'), 'Gleis 2');

  // UK
  assert.equal(uk.notification.platformPeronTrack('1', '2'), 'платформа 1, колія 2');
  assert.equal(uk.notification.platformTrack('2'), 'колія 2');
});
