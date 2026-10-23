import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const internet = 'android.permission.INTERNET';
const receiverPermission = 'app.kilometr.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION';
const entry = (name, remove = false) => ({
  $: { 'android:name': name, ...(remove ? { 'tools:node': 'remove' } : {}) },
});

function checker(t) {
  const dir = mkdtempSync(join(tmpdir(), 'kilometr-permissions-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'manifest');
  return (contents, format) => {
    writeFileSync(file, contents);
    return spawnSync(
      process.execPath,
      ['scripts/check-android-permissions.mjs', file, ...(format ? [format] : [])],
      { encoding: 'utf8' },
    );
  };
}

const formats = {
  aapt: {
    flag: undefined,
    render: (permissions) =>
      permissions.map((name) => `uses-permission: name='${name}'`).join('\n'),
  },
  xml: {
    flag: '--xml',
    render: (
      permissions,
    ) => `<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="app.kilometr">
      <permission android:name="${receiverPermission}" android:protectionLevel="signature" />
      ${permissions.map((name) => `<uses-permission android:name="${name}" />`).join('\n')}
      <application>
        <receiver android:name="PushReceiver" android:permission="com.google.android.c2dm.permission.SEND" />
        <receiver android:name="ProfileInstallReceiver" android:permission="android.permission.DUMP" />
        <service android:name="JobService" android:permission="android.permission.BIND_JOB_SERVICE" />
      </application>
    </manifest>`,
  },
  expo: {
    flag: '--expo-config',
    render: (permissions) =>
      JSON.stringify({
        _internal: {
          modResults: {
            android: {
              manifest: {
                manifest: {
                  'uses-permission': [
                    ...permissions.map((name) => entry(name)),
                    entry('android.permission.CAMERA', true),
                  ],
                },
              },
            },
          },
        },
      }),
  },
};

for (const [format, { flag, render }] of Object.entries(formats)) {
  test(`${format}: akceptuje potrzebne uprawnienia i ignoruje zabezpieczenia komponentów`, (t) => {
    const check = checker(t);
    const result = check(
      render([
        internet,
        receiverPermission,
        'android.permission.ACCESS_COARSE_LOCATION',
        'android.permission.ACCESS_FINE_LOCATION',
        'android.permission.FOREGROUND_SERVICE_LOCATION',
        'android.permission.SCHEDULE_EXACT_ALARM',
        'android.permission.USE_FULL_SCREEN_INTENT',
        'android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK',
      ]),
      flag,
    );
    assert.equal(result.status, 0, result.stderr);
  });

  test(`${format}: odrzuca każde zbędne żądane uprawnienie`, (t) => {
    const check = checker(t);
    for (const permission of [
      'android.permission.ACCESS_BACKGROUND_LOCATION',
      'android.permission.ACTIVITY_RECOGNITION',
      'com.google.android.gms.permission.ACTIVITY_RECOGNITION',
      'android.permission.READ_EXTERNAL_STORAGE',
      'android.permission.CAMERA',
      'com.sec.android.provider.badge.permission.WRITE',
      'com.google.android.finsky.permission.BIND_GET_INSTALL_REFERRER_SERVICE',
      'com.google.android.c2dm.permission.SEND',
      'com.google.android.c2dm.permission.RECEIVE',
      'android.permission.DUMP',
      'android.permission.BIND_JOB_SERVICE',
      'kilometr.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION',
    ]) {
      const result = check(render([internet, permission]), flag);
      assert.notEqual(result.status, 0, permission);
      assert(result.stderr.includes(permission), result.stderr);
    }
  });

  test(`${format}: odrzuca pusty lub nieprawidłowy manifest`, (t) => {
    const check = checker(t);
    assert.notEqual(check(render([]), flag).status, 0);
    assert.notEqual(check('', flag).status, 0);
    assert.notEqual(check(Buffer.from(`\x00\x12${internet}\x00`), flag).status, 0);
  });
}

test('XML: kontroluje również uses-permission-sdk-23', (t) => {
  const check = checker(t);
  const xml = formats.xml
    .render([internet])
    .replace(
      '</manifest>',
      '<uses-permission-sdk-23 android:name="android.permission.CAMERA" /></manifest>',
    );
  const result = check(xml, '--xml');
  assert.notEqual(result.status, 0);
  assert(result.stderr.includes('android.permission.CAMERA'), result.stderr);
});

test('aapt: deklaracja uprawnienia nie jest żądaniem uprawnienia', (t) => {
  const check = checker(t);
  assert.equal(
    check(`${formats.aapt.render([internet])}\npermission: android.permission.DUMP`).status,
    0,
  );
});
