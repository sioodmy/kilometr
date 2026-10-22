import assert from 'node:assert/strict';
import Module, { createRequire } from 'node:module';
import type { AppStateStatus } from 'react-native';

const require = createRequire(import.meta.url);
const values = new Map<string, string>();
const listeners: ((state: AppStateStatus) => void)[] = [];
let language = 'en';
let pushNotificationReads = 0;
const native = {
  AppState: {
    addEventListener: (event: string, listener: (state: AppStateStatus) => void) => {
      assert.equal(event, 'change');
      listeners.push(listener);
      return { remove() {} };
    },
  },
};
Object.defineProperty(native, 'PushNotificationIOS', {
  enumerable: true,
  get() {
    pushNotificationReads++;
    throw new Error('new NativeEventEmitter() requires a non-null argument.');
  },
});

const loader = Module as unknown as {
  _load: (request: string, parent: { filename?: string }, ...rest: unknown[]) => unknown;
};
const original = loader._load;
loader._load = function (request, parent, ...rest) {
  if (request === 'react-native') return native;
  if (request === 'expo-localization') return { getLocales: () => [{ languageCode: language }] };
  if (parent?.filename?.endsWith('/src/i18n/index.ts') && request === '../services/storage') {
    return {
      kvGet: async (key: string) => values.get(key) ?? null,
      kvSet: async (key: string, value: string) => { values.set(key, value); },
    };
  }
  return original.call(this, request, parent, ...rest);
};

async function main() {
  const locale: typeof import('../src/i18n') = require('../src/i18n');
  assert.equal(await locale.initLocale(), 'en');
  assert.equal(listeners.length, 1, 'Locale initialization installs the AppState listener');
  await locale.initLocale();
  assert.equal(listeners.length, 1, 'Repeated initialization keeps one listener');

  language = 'de';
  listeners[0]('background');
  assert.equal(locale.getLocaleSync(), 'en');
  listeners[0]('active');
  assert.equal(locale.getLocaleSync(), 'de', 'Returning to the app updates the system language');

  await locale.setLocaleSetting('uk');
  assert.equal(values.get('kilometr.locale.v1'), 'uk');
  language = 'pl';
  listeners[0]('active');
  assert.equal(locale.getLocaleSync(), 'uk', 'An explicit language survives a system language change');
  await locale.setLocaleSetting('system');
  assert.equal(locale.getLocaleSync(), 'pl');
  assert.equal(pushNotificationReads, 0, 'Startup never accesses PushNotificationIOS');
  console.log('PASS: iOS locale startup without PushNotificationIOS, resume updates and language override');
}

main().finally(() => { loader._load = original; }).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
