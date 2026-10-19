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
  const uses = (permission, tag = 'uses-permission') => `${tag}: name='${permission}'`;
  const foreground = `${uses(internet)}\nuses-permission: name='android.permission.ACCESS_COARSE_LOCATION'\nuses-permission: name='android.permission.ACCESS_FINE_LOCATION'`;
  assert.equal(check(foreground).status, 0);
  assert.equal(
    check(
      [
        internet,
        'android.permission.SCHEDULE_EXACT_ALARM',
        'android.permission.USE_FULL_SCREEN_INTENT',
        'android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK',
      ]
        .map((permission) => uses(permission))
        .join('\n'),
    ).status,
    0,
  );
  const componentPermissions = [
    'com.google.android.c2dm.permission.SEND',
    'android.permission.DUMP',
    'android.permission.BIND_JOB_SERVICE',
  ];
  assert.equal(
    check(
      [
        uses(internet),
        'permission: android.permission.CAMERA: prot=signature',
        ...componentPermissions.map((permission) => `service: permission='${permission}'`),
      ].join('\n'),
    ).status,
    0,
  );
  assert.equal(
    check(`${internet}\r\nandroid.permission.ACCESS_FINE_LOCATION\r\n`, '--permission-list').status,
    0,
  );
  for (const permission of [
    'android.permission.ACCESS_BACKGROUND_LOCATION',
    'android.permission.ACTIVITY_RECOGNITION',
    'com.google.android.gms.permission.ACTIVITY_RECOGNITION',
    'android.permission.READ_EXTERNAL_STORAGE',
    'android.permission.CAMERA',
    'com.sec.android.provider.badge.permission.WRITE',
    'com.google.android.finsky.permission.BIND_GET_INSTALL_REFERRER_SERVICE',
    ...componentPermissions,
  ]) {
    for (const tag of ['uses-permission', 'uses-permission-sdk-23']) {
      const result = check(`${uses(internet)}\n${uses(permission, tag)}`);
      assert.notEqual(result.status, 0, permission);
      assert(result.stderr.includes(permission), result.stderr);
    }
    const result = check(`${internet}\n${permission}`, '--permission-list');
    assert.notEqual(result.status, 0, permission);
    assert(result.stderr.includes(permission), result.stderr);
  }
  assert.notEqual(check('').status, 0);
  assert.notEqual(check('', '--permission-list').status, 0);
  assert.notEqual(check(Buffer.from(`\x00\x12${internet}\x00`)).status, 0);
  assert.notEqual(check(`permission: ${internet}: prot=normal`).status, 0);
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
