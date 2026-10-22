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

const locationStub = {
  Accuracy: { Lowest: 1, Low: 2, Balanced: 3, High: 4, Highest: 5 },
  getForegroundPermissionsAsync: async () => ({ status: 'denied', granted: false }),
  requestForegroundPermissionsAsync: async () => ({ status: 'denied', granted: false }),
  hasServicesEnabledAsync: async () => false,
  getLastKnownPositionAsync: async () => null,
  watchPositionAsync: async () => ({ remove: () => undefined }),
};

const appStateListeners = new Set();
const rnStub = {
  Platform: { OS: 'android', select: (o) => (o.android !== undefined ? o.android : o.default) },
  AppState: {
    currentState: 'active',
    addEventListener: (_type, handler) => {
      appStateListeners.add(handler);
      return { remove: () => appStateListeners.delete(handler) };
    },
    emit(state) {
      this.currentState = state;
      for (const listener of appStateListeners) listener(state);
    },
  },
  StyleSheet: { create: (o) => o },
};

const stubs = {
  'expo-file-system': fsStub,
  'expo-file-system/legacy': fsStub,
  'expo-localization': { getLocales: () => [{ languageCode: 'pl' }] },
  'expo-constants': { default: { executionEnvironment: 'standalone', expoConfig: {} } },
  'expo-sqlite': {
    openDatabaseAsync: async () => ({
      execAsync: async () => undefined,
      getAllAsync: async () => [],
      getFirstAsync: async () => null,
      runAsync: async () => ({ lastInsertRowId: 1, changes: 1 }),
    }),
  },
  'expo-sqlite/kv-store': {},
  // api.ts ciągnie expo-location na starcie, a to ładuje cały pakiet `expo`
  // (Expo.fx, expo-asset) i wymaga globali react-native. W testach logiki
  // GPS nie jest wołany, więc atrapa wystarcza.
  'expo-location': locationStub,
  // setActiveCityId (check-lublin) sięga po tripMonitor i widgetSnapshot:
  // bez tych atrap testy logują złapany błąd transformu react-native,
  // a logika „stop kursu po zmianie miasta” nie ma jak dojść do końca.
  'react-native': rnStub,
  expo: {
    requireOptionalNativeModule: () => null,
    requireNativeModule: () => ({}),
  },
};

const originalLoad = Module._load;
Module._load = function patched(request, ...rest) {
  if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request];
  return originalLoad.call(this, request, ...rest);
};
