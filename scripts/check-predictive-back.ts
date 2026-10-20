import assert from 'node:assert/strict';
import Module, { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const modulePath = require.resolve('../modules/kilometr-predictive-back');
const calls: boolean[] = [];
let lookups = 0;
let os = 'android';
let version = 34;
let available = true;
const loader = Module as unknown as {
  _load: (request: string, parent: { filename?: string }, ...rest: unknown[]) => unknown;
};
const originalLoad = loader._load;
loader._load = function (request, parent, ...rest) {
  if (parent?.filename === modulePath) {
    if (request === 'react-native') return { Platform: { OS: os, Version: version } };
    if (request === 'expo')
      return {
        requireOptionalNativeModule: () => {
          lookups++;
          return available
            ? {
                setEnabled: async (value: boolean) => {
                  calls.push(value);
                },
              }
            : null;
        },
      };
  }
  return originalLoad.call(this, request, parent, ...rest);
};

function load(): typeof import('../modules/kilometr-predictive-back') {
  delete require.cache[modulePath];
  return require(modulePath);
}

try {
  const back = load();
  back.setPredictiveBackEnabled(false);
  assert.equal(calls.at(-1), false, 'Root screen must use normal back handling');
  back.setPredictiveBackEnabled(true);
  assert.equal(calls.at(-1), true);

  const closeFirst = back.suspendPredictiveBack();
  const closeSecond = back.suspendPredictiveBack();
  assert.equal(calls.at(-1), false, 'A sheet must prevent a preview of the previous screen');
  closeFirst();
  assert.equal(calls.at(-1), false, 'Closing one of two sheets must keep the remaining blocker');
  const countBeforeDuplicateCleanup = calls.length;
  closeFirst();
  assert.equal(calls.length, countBeforeDuplicateCleanup, 'Effect cleanup must be idempotent');
  closeSecond();
  assert.equal(calls.at(-1), true);

  const closeThird = back.suspendPredictiveBack();
  back.setPredictiveBackEnabled(false);
  closeThird();
  assert.equal(
    calls.at(-1),
    false,
    'Closing a sheet must not enable previews at root or with reduced motion',
  );
  const closeFourth = back.suspendPredictiveBack();
  back.setPredictiveBackEnabled(true);
  assert.equal(calls.at(-1), false, 'Navigation changes must respect a mounted sheet');
  closeFourth();
  assert.equal(calls.at(-1), true);

  for (const platform of [
    { os: 'ios', version: 26 },
    { os: 'android', version: 33 },
  ]) {
    os = platform.os;
    version = platform.version;
    const before = calls.length;
    const beforeLookups = lookups;
    const unsupported = load();
    unsupported.setPredictiveBackEnabled(true);
    unsupported.suspendPredictiveBack()();
    assert.equal(
      lookups,
      beforeLookups,
      'Unsupported platforms must never load the Android module',
    );
    assert.equal(calls.length, before);
  }

  os = 'android';
  version = 34;
  available = false;
  const expoGo = load();
  assert.doesNotThrow(() => {
    expoGo.setPredictiveBackEnabled(true);
    expoGo.suspendPredictiveBack()();
  }, 'Expo Go and builds without the native module retain ordinary navigation');
  console.log(
    'PASS: predictive back platform isolation, sheet blockers, cleanup and native fallback',
  );
} finally {
  loader._load = originalLoad;
  delete require.cache[modulePath];
}
