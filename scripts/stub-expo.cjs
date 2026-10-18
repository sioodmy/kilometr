/**
 * atrapy natywnych modułów Expo dla skryptów sprawdzających.
 *
 * Logika aplikacji (tracker live, powiadomienia) jest czysta, ale import idzie
 * przez `storage` i `dataManager` aż do `expo-file-system` i `expo-sqlite`,
 * których nie da się załadować w Node. Ten plik podmienia je na atrapy,
 * zanim cokolwiek się zaimportuje.
 *
 * Użycie: `tsx --require ./scripts/stub-expo.cjs scripts/check-*.ts`
 * Uruchamiać TYLKO w skryptach sprawdzających, nigdy w aplikacji.
 */

globalThis.__DEV__ = false;

const Module = require('node:module');

const fsStub = {
  documentDirectory: '/tmp/kilometr-check/',
  cacheDirectory: '/tmp/kilometr-check/cache/',
  makeDirectoryAsync: async () => undefined,
  getInfoAsync: async () => ({ exists: false }),
  readAsStringAsync: async () => '',
  writeAsStringAsync: async () => undefined,
  moveAsync: async () => undefined,
  deleteAsync: async () => undefined,
};

const stubs = {
  'expo-file-system': fsStub,
  'expo-file-system/legacy': fsStub,
  'expo-localization': { getLocales: () => [{ languageCode: 'pl' }] },
  'expo-constants': { default: { executionEnvironment: 'standalone', expoConfig: {} } },
  'expo-sqlite': { openDatabaseAsync: async () => ({}) },
  'expo-sqlite/kv-store': {},
};

const originalLoad = Module._load;
Module._load = function patched(request, ...rest) {
  if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request];
  return originalLoad.call(this, request, ...rest);
};
