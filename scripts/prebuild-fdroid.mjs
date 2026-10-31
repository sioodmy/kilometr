import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

process.chdir(fileURLToPath(new URL('..', import.meta.url)));
const version = process.env.APP_VERSION;
assert(/^v\d+\.\d+\.\d+$/.test(version ?? ''), 'Podaj APP_VERSION w formacie vX.Y.Z.');
assert.equal(
  process.env.ANDROID_VERSION_CODE,
  undefined,
  'F-Droid używa numeracji APK, bez licznika Play.',
);
assert.equal(process.env.BUILD_NUMBER ?? '1', '1', 'F-Droid wymaga BUILD_NUMBER=1.');

const locationRoot = 'node_modules/expo-location';
const locationPackage = JSON.parse(readFileSync(`${locationRoot}/package.json`, 'utf8'));
assert.equal(
  locationPackage.version,
  '57.0.22',
  'Sprawdź adapter lokalizacji po aktualizacji Expo.',
);

const locationGradle = `${locationRoot}/android/build.gradle`;
const gradle = readFileSync(locationGradle, 'utf8');
writeFileSync(
  locationGradle,
  gradle.replace(/^\s*api 'com\.google\.android\.gms:play-services-location:[^']+'\s*$/m, ''),
);
const locationSources = `${locationRoot}/android/src/main/java/expo/modules/location`;
rmSync(locationSources, { recursive: true, force: true });
cpSync('fdroid/location', locationSources, { recursive: true });
writeFileSync(
  `${locationRoot}/android/src/main/AndroidManifest.xml`,
  `<manifest xmlns:android="http://schemas.android.com/apk/res/android">
  <uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
  <uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
</manifest>
`,
);

const result = spawnSync(
  process.execPath,
  ['node_modules/expo/bin/cli', 'prebuild', '--platform', 'android', '--no-install'],
  {
    stdio: 'inherit',
    env: { ...process.env, FDROID_BUILD: '1', BUILD_NUMBER: '1', EXPO_NO_TELEMETRY: '1' },
  },
);
assert.equal(result.status, 0, `Expo prebuild: ${result.error?.message ?? result.status}`);
rmSync('android/app/debug.keystore', { force: true });
rmSync('node_modules/hermes-compiler/hermesc/win64-bin', { recursive: true, force: true });
console.log('F-Droid: moduły Expo ze źródeł, GPS systemowy, APK bez podpisu.');
