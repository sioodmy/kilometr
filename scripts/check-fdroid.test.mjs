import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const read = (path) => readFileSync(path, 'utf8');
const prepared = process.env.FDROID_BUILD === '1';

function resolveModules(mode) {
  const result = spawnSync(
    process.execPath,
    [
      'node_modules/expo-modules-autolinking/bin/expo-modules-autolinking.js',
      'resolve',
      '--platform',
      'android',
      '--json',
    ],
    {
      encoding: 'utf8',
      env: { ...process.env, FDROID_BUILD: mode, NO_COLOR: '1' },
    },
  );
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test('F-Droid buduje wszystkie moduły ze źródeł, pozostałe kanały tylko zmodyfikowane moduły', () => {
  assert.deepEqual(resolveModules('1').configuration.buildFromSource, ['.*']);
  for (const mode of [undefined, '0', 'true']) {
    assert.deepEqual(resolveModules(mode).configuration.buildFromSource, [
      'expo-notifications',
      'expo-application',
    ]);
  }
});

test('powiadomienia zachowują moduły JS i lokalny scheduler bez zależności Firebase', () => {
  const root = 'node_modules/expo-notifications';
  assert.doesNotMatch(read(`${root}/android/build.gradle`), /com\.google\.firebase/);
  assert.doesNotMatch(
    read(`${root}/android/src/main/AndroidManifest.xml`),
    /MESSAGING_EVENT|ExpoFirebaseMessagingService/,
  );
  const config = JSON.parse(read(`${root}/expo-module.config.json`));
  for (const module of config.android.modules) {
    const path = `${root}/android/src/main/java/${module.replaceAll('.', '/')}`;
    assert(existsSync(`${path}.kt`) || existsSync(`${path}.java`), module);
  }
  const sources = readdirSync(`${root}/android/src/main/java`, { recursive: true }).filter((path) =>
    /\.(kt|java)$/.test(path),
  );
  for (const source of sources) {
    assert.doesNotMatch(
      read(`${root}/android/src/main/java/${source}`),
      /^import com\.google\.(firebase|android\.gms)/m,
      source,
    );
  }
  assert.match(
    read(
      `${root}/android/src/main/java/expo/modules/notifications/notifications/scheduling/NotificationScheduler.kt`,
    ),
    /scheduleNotificationAsync/,
  );
});

test('Expo Application nie zawiera Install Referrer', () => {
  const root = 'node_modules/expo-application/android';
  assert.doesNotMatch(read(`${root}/build.gradle`), /com\.android\.installreferrer/);
  assert.doesNotMatch(
    read(`${root}/src/main/java/expo/modules/application/ApplicationModule.kt`),
    /InstallReferrerClient|InstallReferrerStateListener/,
  );
});

test('metadane sklepu mają poprawne długości, ikonę 512 px i prawdziwe zrzuty ekranu', () => {
  for (const locale of ['pl-PL', 'en-US']) {
    const root = `fastlane/metadata/android/${locale}`;
    assert.equal(read(`${root}/title.txt`).trim(), 'Kilometr');
    assert([...read(`${root}/short_description.txt`).trim()].length <= 80);
    assert([...read(`${root}/full_description.txt`).trim()].length <= 4000);
    for (const file of ['title.txt', 'short_description.txt', 'full_description.txt']) {
      assert.doesNotMatch(read(`${root}/${file}`), /\u2014/);
    }
    const icon = readFileSync(`${root}/images/icon.png`);
    assert.equal(icon.readUInt32BE(16), 512);
    assert.equal(icon.readUInt32BE(20), 512);
    for (const [index, source] of ['home', 'routes', 'trip'].entries()) {
      assert.deepEqual(
        readFileSync(`${root}/images/phoneScreenshots/${index + 1}.png`),
        readFileSync(`docs/screenshots/${source}.png`),
      );
    }
  }
});

test(
  'przygotowany projekt F-Droid nie używa GMS, podpisu i prekompilowanych modułów Expo',
  { skip: !prepared },
  () => {
    const gradle = read('android/app/build.gradle');
    assert.doesNotMatch(gradle, /^\s*signingConfig\s+/m);
    assert(!existsSync('android/app/debug.keystore'));
    const location = 'node_modules/expo-location/android';
    assert.doesNotMatch(read(`${location}/build.gradle`), /com\.google\.android\.gms/);
    assert.equal(
      read(`${location}/src/main/java/expo/modules/location/LocationModule.kt`),
      read('fdroid/location/LocationModule.kt'),
    );
    assert.doesNotMatch(read(`${location}/src/main/AndroidManifest.xml`), /LocationTaskService/);
    const resolved = resolveModules(process.env.FDROID_BUILD);
    assert.deepEqual(resolved.configuration.buildFromSource, ['.*']);
    for (const module of resolved.modules) {
      for (const project of module.projects) {
        assert(existsSync(join(project.sourceDir, 'build.gradle')), module.packageName);
      }
    }
  },
);
