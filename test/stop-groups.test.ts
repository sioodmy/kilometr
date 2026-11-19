import assert from 'node:assert/strict';
import test from 'node:test';
import { numberedStopBases } from '../src/gtfs/stopGroups';

const galeria = ['GALERIA DOMINIKAŃSKA 01', 'GALERIA DOMINIKAŃSKA 02', 'GALERIA DOMINIKAŃSKA 10'];

test('słupki tego samego przystanku dostają jedną nazwę bazową', () => {
  const bases = numberedStopBases(['GALERIA DOMINIKAŃSKA 01', 'GALERIA DOMINIKAŃSKA 02']);
  assert.equal(bases.get('GALERIA DOMINIKAŃSKA 01'), 'GALERIA DOMINIKAŃSKA');
  assert.equal(bases.get('GALERIA DOMINIKAŃSKA 02'), 'GALERIA DOMINIKAŃSKA');
});

test('numery posesji nie są grupowane', () => {
  const bases = numberedStopBases([
    'Bierutowska 65',
    'Bierutowska 75',
    'Kowalska 56',
    'Opatowicka nr 59',
    'Opatowicka nr 85',
  ]);
  assert.equal(bases.size, 0);
});

test('pojedynczy słupek bez innych wariantów zostaje bez zmian', () => {
  const bases = numberedStopBases(['GALERIA DOMINIKAŃSKA 01', 'KOWALSKA 56']);
  assert.equal(bases.size, 0);
});

test('numer z wiodącym zerem odróżnia słupek od adresu', () => {
  const bases = numberedStopBases([...galeria, 'KOWALSKA 10', 'KOWALSKA 11']);
  assert.equal(bases.get('GALERIA DOMINIKAŃSKA 10'), 'GALERIA DOMINIKAŃSKA');
  assert.equal(bases.size, 3);
});
