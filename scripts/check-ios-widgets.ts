import assert from 'node:assert/strict';
import Module, { createRequire } from 'node:module';
import { pl } from '../src/i18n/pl';
import { de } from '../src/i18n/de';
import { setLocaleInternal } from '../src/i18n/locale';

const require = createRequire(import.meta.url);
const files = new Map<string, string>();
const shared: string[] = [];
let androidReloads = 0;
let platform = 'ios';
const file = '/documents/kilometr-widget.json';
const loader = Module as unknown as {
  _load: (request: string, ...rest: unknown[]) => unknown;
};
const original = loader._load;
loader._load = function (request, ...rest) {
  if (request === 'react-native')
    return {
      Platform: {
        get OS() {
          return platform;
        },
      },
    };
  if (request === 'expo')
    return {
      requireOptionalNativeModule: () => ({
        syncSnapshot: async (json: string) => {
          shared.push(json);
          return true;
        },
        reload: async () => {
          androidReloads++;
          return true;
        },
      }),
    };
  if (request === 'expo-file-system/legacy')
    return {
      documentDirectory: '/documents/',
      readAsStringAsync: async (path: string) => {
        const value = files.get(path);
        if (value === undefined) throw new Error('missing');
        return value;
      },
      writeAsStringAsync: async (path: string, value: string) => {
        files.set(path, value);
      },
      moveAsync: async ({ from, to }: { from: string; to: string }) => {
        files.set(to, files.get(from)!);
        files.delete(from);
      },
    };
  return original.call(this, request, ...rest);
};

async function main() {
  const {
    mergeWidgetSnapshot,
    buildRoutesLink,
  }: typeof import('../src/services/widgetSnapshot') = require('../src/services/widgetSnapshot');
  const {
    reloadWidgets,
  }: typeof import('../modules/kilometr-widgets') = require('../modules/kilometr-widgets');
  const quick = [
    { id: 'home', title: 'Dom', icon: 'home', deepLink: 'kilometr://routes?toId=home' },
  ];
  files.set(
    file,
    JSON.stringify({
      v: 2,
      updatedAt: 123,
      origin: 'A',
      places: [],
      quick,
      pinned: null,
      next: [{ dest: 'removed' }],
    }),
  );
  await Promise.all([
    mergeWidgetSnapshot({
      places: [
        { id: 'work', name: 'Praca', icon: 'work', deepLink: 'kilometr://routes?toId=work' },
      ],
    }),
    mergeWidgetSnapshot({ origin: 'B' }),
  ]);
  const snapshot = JSON.parse(files.get(file)!);
  assert.equal(snapshot.origin, 'B');
  assert.equal(snapshot.places[0].id, 'work', 'Parallel merges preserve separate sections');
  assert.deepEqual(snapshot.quick, quick);
  assert.equal(snapshot.updatedAt, 123, 'Places do not pretend departures were refreshed');
  assert.equal('next' in snapshot, false, 'Legacy data for the removed widget is discarded');
  assert.equal('nextTitle' in snapshot.labels, false);
  assert.equal(snapshot.labels.journeyTitle, pl.widgets.journeyTitle);
  assert.equal(
    shared.at(-1),
    files.get(file),
    'iOS receives the exact atomically written snapshot',
  );
  assert.equal(androidReloads, 0, 'iOS never calls the Android reload method');

  setLocaleInternal('de', 'de');
  await mergeWidgetSnapshot({});
  const translated = JSON.parse(shared.at(-1)!);
  assert.equal(translated.locale, 'de');
  assert.equal(translated.labels.journeyTitle, de.widgets.journeyTitle);
  assert.equal(translated.labels.arrival, de.ios.arrival);

  files.set(file, '{');
  await mergeWidgetSnapshot({ origin: 'Recovered' });
  assert.deepEqual(
    JSON.parse(shared.at(-1)!).places,
    [],
    'Corrupt snapshots recover to empty data',
  );
  const link = new URL(
    buildRoutesLink({ toId: 'home', toLat: 51.1, toLon: 17, open: 'tracked-trip' }),
  );
  assert.equal(link.searchParams.get('open'), 'tracked-trip');
  platform = 'android';
  await reloadWidgets('{}');
  assert.equal(androidReloads, 1, 'Android still uses its existing reload API');
  console.log(
    'PASS: iOS shared snapshot, concurrent merges, locale, legacy widget removal, recovery and Android API',
  );
}

main()
  .finally(() => {
    loader._load = original;
    setLocaleInternal('system', 'pl');
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
