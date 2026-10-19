import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

test('kontrola manifestu Androida', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'kilometr-permissions-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'manifest');
  const check = (contents, format) => {
    writeFileSync(file, contents);
    return spawnSync(
      process.execPath,
      ['scripts/check-android-permissions.mjs', file, ...(format ? [format] : [])],
      { encoding: 'utf8' },
    );
  };
  const internet = 'android.permission.INTERNET';
  const foreground = `${internet}\nuses-permission: name='android.permission.ACCESS_COARSE_LOCATION'\nuses-permission: name='android.permission.ACCESS_FINE_LOCATION'`;
  assert.equal(check(foreground).status, 0);
  assert.equal(check(`${internet}\nandroid.permission.SCHEDULE_EXACT_ALARM\nandroid.permission.USE_FULL_SCREEN_INTENT\nandroid.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK`).status, 0);
  for (const permission of [
    'android.permission.ACCESS_BACKGROUND_LOCATION',
    'android.permission.ACTIVITY_RECOGNITION',
    'com.google.android.gms.permission.ACTIVITY_RECOGNITION',
    'android.permission.READ_EXTERNAL_STORAGE',
    'android.permission.CAMERA',
    'com.sec.android.provider.badge.permission.WRITE',
    'com.google.android.finsky.permission.BIND_GET_INSTALL_REFERRER_SERVICE',
  ]) {
    const result = check(Buffer.from(`\x00\x12${internet}\x00\x12${permission}\x00`));
    assert.notEqual(result.status, 0, permission);
    assert(result.stderr.includes(permission), result.stderr);
  }
  assert.notEqual(check('').status, 0);
  const entry = (name, remove = false) => ({
    $: { 'android:name': name, ...(remove ? { 'tools:node': 'remove' } : {}) },
  });
  const config = (permissions) =>
    JSON.stringify({
      _internal: {
        modResults: { android: { manifest: { manifest: { 'uses-permission': permissions } } } },
      },
    });
  assert.equal(
    check(
      config([entry(internet), entry('android.permission.ACTIVITY_RECOGNITION', true)]),
      '--expo-config',
    ).status,
    0,
  );
  assert.notEqual(
    check(
      config([entry(internet), entry('android.permission.ACTIVITY_RECOGNITION')]),
      '--expo-config',
    ).status,
    0,
  );
});
