import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const allowed = new Set([
  'android.permission.INTERNET',
  'android.permission.ACCESS_NETWORK_STATE',
  'android.permission.ACCESS_COARSE_LOCATION',
  'android.permission.ACCESS_FINE_LOCATION',
  'android.permission.POST_NOTIFICATIONS',
  'android.permission.POST_PROMOTED_NOTIFICATIONS',
  'android.permission.FOREGROUND_SERVICE',
  'android.permission.FOREGROUND_SERVICE_SPECIAL_USE',
  'android.permission.VIBRATE',
  'android.permission.WAKE_LOCK',
  'android.permission.RECEIVE_BOOT_COMPLETED',
  'com.google.android.c2dm.permission.RECEIVE',
  'my.siood.kilometr.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION',
]);

const [file, format] = process.argv.slice(2);
assert(file, 'Podaj plik z manifestem AAB, wynikiem aapt lub konfiguracją Expo.');
const contents = readFileSync(file);
let permissions;
if (format === '--expo-config') {
  const config = JSON.parse(contents.toString());
  const manifest = config._internal.modResults.android.manifest.manifest;
  permissions = manifest['uses-permission']
    .filter((entry) => entry.$['tools:node'] !== 'remove')
    .map((entry) => entry.$['android:name']);
} else {
  // Manifest AAB zawiera pełne nazwy uprawnień jako ciągi UTF-8 w protobuf.
  permissions =
    contents
      .toString()
      .match(
        /\b(?:[a-z][a-z0-9_]*\.)+(?:permission\.[A-Z][A-Z0-9_]*|[A-Z][A-Z0-9_]*_PERMISSION)\b/g,
      ) ?? [];
}

assert(
  permissions.includes('android.permission.INTERNET'),
  'Brak INTERNET: nieprawidłowy lub pusty manifest.',
);
const unexpected = [...new Set(permissions)].filter((permission) => !allowed.has(permission));
assert.deepEqual(unexpected, [], `Zbędne uprawnienia Androida: ${unexpected.join(', ')}`);
console.log(`Uprawnienia Androida OK (${new Set(permissions).size}).`);
