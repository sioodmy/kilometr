import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const configure = require('../app.config.js');

function withEnv(env, fn) {
  const previous = {};
  for (const key of Object.keys(env)) {
    previous[key] = process.env[key];
    if (env[key] === undefined) delete process.env[key];
    else process.env[key] = env[key];
  }
  try {
    return fn();
  } finally {
    for (const key of Object.keys(env)) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

test('produkcja i testy Play używają tego samego kodu AAB', () => {
  withEnv({ ANDROID_VERSION_CODE: '701050202' }, () => {
    for (const version of ['v1.5.3', 'play-20261022-2300-test']) {
      process.env.APP_VERSION = version;
      const config = configure({});
      assert.equal(config.android.versionCode, 701050202);
      assert.equal(config.version, version);
    }
  });
});

test('Play nie wraca do niższej numeracji przy braku kodu z CI', () => {
  withEnv({ APP_VERSION: 'play-20261022-2300-test', ANDROID_VERSION_CODE: undefined }, () => {
    assert.throws(() => configure({}), /ANDROID_VERSION_CODE/);
  });
});

test('nieprawidłowe kody wersji zatrzymują build', () => {
  withEnv({ APP_VERSION: 'v1.0.0' }, () => {
    for (const code of ['', '0', '-1', '1.5', '1e9', '2100000001', 'NaN']) {
      process.env.ANDROID_VERSION_CODE = code;
      assert.throws(() => configure({}), /ANDROID_VERSION_CODE/);
    }
  });
});

test('prod przed 1.12.1 zostaje na starym wzorze (F-Droid / sideload)', () => {
  withEnv({ ANDROID_VERSION_CODE: undefined, BUILD_NUMBER: '1' }, () => {
    process.env.APP_VERSION = 'v1.5.4';
    assert.equal(configure({}).android.versionCode, 701050401);
    process.env.APP_VERSION = 'v1.12.0';
    assert.equal(configure({}).android.versionCode, 701120001);
  });
});

test('prod od 1.12.1 nie skacze o 10000 przy minorze', () => {
  withEnv({ ANDROID_VERSION_CODE: undefined, BUILD_NUMBER: '1' }, () => {
    process.env.APP_VERSION = 'v1.12.1';
    const patch = configure({}).android.versionCode;
    process.env.APP_VERSION = 'v1.13.0';
    const minor = configure({}).android.versionCode;
    process.env.APP_VERSION = 'v2.0.0';
    const major = configure({}).android.versionCode;
    assert.equal(patch, 701121211);
    assert.equal(minor, 701121301);
    assert.equal(major, 701220001);
    assert.equal(minor - patch, 90);
    assert.ok(major - minor < 100000);
  });
});
