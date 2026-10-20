import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import configPlugins from 'expo/config-plugins.js';

const allowed = new Set([
  'android.permission.INTERNET',
  'android.permission.ACCESS_NETWORK_STATE',
  'android.permission.ACCESS_COARSE_LOCATION',
  'android.permission.ACCESS_FINE_LOCATION',
  'android.permission.POST_NOTIFICATIONS',
  'android.permission.SCHEDULE_EXACT_ALARM',
  'android.permission.USE_FULL_SCREEN_INTENT',
  'android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK',
  'android.permission.POST_PROMOTED_NOTIFICATIONS',
  'android.permission.FOREGROUND_SERVICE',
  'android.permission.FOREGROUND_SERVICE_SPECIAL_USE',
  'android.permission.FOREGROUND_SERVICE_LOCATION',
  'android.permission.VIBRATE',
  'android.permission.WAKE_LOCK',
  'android.permission.RECEIVE_BOOT_COMPLETED',
  'com.google.android.c2dm.permission.RECEIVE',
  'app.kilometr.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION',
  'app.kilometr.transfertest.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION',
]);

const [file, format] = process.argv.slice(2);
assert(file, 'Podaj plik z manifestem AAB, wynikiem aapt lub konfiguracją Expo.');
assert([undefined, '--expo-config', '--xml'].includes(format), `Nieznany format: ${format}`);
let permissions;
if (format === '--expo-config') {
  const config = JSON.parse(readFileSync(file, 'utf8'));
  const manifest = config._internal.modResults.android.manifest.manifest;
  permissions = ['uses-permission', 'uses-permission-sdk-23']
    .flatMap((key) => manifest[key] ?? [])
    .filter((entry) => entry.$['tools:node'] !== 'remove')
    .map((entry) => entry.$['android:name']);
} else if (format === '--xml') {
  const { manifest } = await configPlugins.AndroidConfig.Manifest.readAndroidManifestAsync(file);
  permissions = ['uses-permission', 'uses-permission-sdk-23']
    .flatMap((key) => manifest[key] ?? [])
    .filter((entry) => entry.$['tools:node'] !== 'remove')
    .map((entry) => entry.$['android:name']);
} else {
  permissions = [
    ...readFileSync(file, 'utf8').matchAll(/^uses-permission(?:-sdk-23)?: name='([^']+)'/gm),
  ].map((match) => match[1]);
}

assert(
  permissions.includes('android.permission.INTERNET'),
  'Brak INTERNET: nieprawidłowy lub pusty manifest.',
);
const unexpected = [...new Set(permissions)].filter((permission) => !allowed.has(permission));
assert.deepEqual(unexpected, [], `Zbędne uprawnienia Androida: ${unexpected.join(', ')}`);
console.log(`Uprawnienia Androida OK (${new Set(permissions).size}).`);
