import test from 'node:test';
import assert from 'node:assert/strict';
import { matchSuggestions, rankWithFrecency } from '../src/services/searchFrecency';
import type { Suggestion } from '../src/types/models';

const savedHome: Suggestion = {
  id: 'saved:home',
  title: 'Dom',
  address: 'ul. Kwiatowa 12, Wrocław',
  kind: 'place',
  savedIcon: 'home',
  lat: 51.11,
  lon: 17.03,
};

const savedMyHome: Suggestion = {
  id: 'saved:my-home',
  title: 'Mój dom',
  address: 'ul. Polna 4, Wrocław',
  kind: 'place',
  savedIcon: 'home',
  lat: 51.12,
  lon: 17.04,
};

const stopDomKultury: Suggestion = {
  id: 'stop-1',
  title: 'DOM KULTURY',
  address: '',
  kind: 'stop',
  lat: 51.109,
  lon: 17.031,
  weight: 800,
};

const stopDomaniewska: Suggestion = {
  id: 'stop-2',
  title: 'DOMANIEWSKA',
  address: '',
  kind: 'stop',
  lat: 51.108,
  lon: 17.032,
  weight: 600,
};

test('rankWithFrecency: zapisane miejsce "Dom" wygrywa przy zapytaniu "dom" i "do"', () => {
  const exactRanked = rankWithFrecency([stopDomKultury, stopDomaniewska, savedHome], [], 'dom');
  assert.equal(exactRanked[0]?.id, 'saved:home');

  const prefixRanked = rankWithFrecency([stopDomKultury, stopDomaniewska, savedHome], [], 'do');
  assert.equal(prefixRanked[0]?.id, 'saved:home');
});

test('matchSuggestions + rankWithFrecency: zapisane miejsce z "dom" w nazwie dopasowuje się powyżej progu 65', () => {
  const scores = matchSuggestions('dom', [savedMyHome]);
  assert.ok(scores[0] >= 65, `oczekiwano wyniku >= 65, otrzymano ${scores[0]}`);

  const ranked = rankWithFrecency([stopDomaniewska, savedMyHome], [], 'dom');
  assert.ok(
    ranked.some((item) => item.id === 'saved:my-home'),
    'zapisane miejsce powinno znaleźć się w wynikach',
  );
});
