import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const configure = require('../app.config.js');

test('produkcja i testy Play używają tego samego kodu AAB', () => {
  process.env.ANDROID_VERSION_CODE = '701050202';
  try {
    for (const version of ['v1.5.3', 'play-20261022-2300-test']) {
      process.env.APP_VERSION = version;
      const config = configure({});
      assert.equal(config.android.versionCode, 701050202);
      assert.equal(config.version, version);
    }
  } finally {
    delete process.env.ANDROID_VERSION_CODE;
    delete process.env.APP_VERSION;
  }
});

test('Play nie wraca do niższej numeracji przy braku kodu z CI', () => {
  process.env.APP_VERSION = 'play-20261022-2300-test';
  try {
    assert.throws(() => configure({}), /ANDROID_VERSION_CODE/);
  } finally {
    delete process.env.APP_VERSION;
  }
});

test('nieprawidłowe kody wersji zatrzymują build', () => {
  try {
    for (const code of ['', '0', '-1', '1.5', '1e9', '2100000001', 'NaN']) {
      process.env.ANDROID_VERSION_CODE = code;
      assert.throws(() => configure({}), /ANDROID_VERSION_CODE/);
    }
  } finally {
    delete process.env.ANDROID_VERSION_CODE;
  }
});
