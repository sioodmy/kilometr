import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MIN_PUBLISHED_VERSION_CODE,
  PLAY_ATTEMPT_SLOTS,
  PLAY_SEQ_BASE,
  computePlayVersionCode,
} from './resolve-play-version.mjs';

test('pierwszy run po v1.12.0 rośnie monotonicznie ponad 701051402', () => {
  const firstFromApk = computePlayVersionCode({
    apkRunNumber: 143,
    aabRunNumber: 68,
    runAttempt: 1,
  });
  assert.equal(firstFromApk.counter, PLAY_SEQ_BASE);
  assert.equal(firstFromApk.versionCode, 701051411);
  assert.ok(firstFromApk.versionCode > MIN_PUBLISHED_VERSION_CODE);

  const nextManualAab = computePlayVersionCode({
    apkRunNumber: 143,
    aabRunNumber: 69,
    runAttempt: 1,
  });
  assert.equal(nextManualAab.counter, PLAY_SEQ_BASE + 1);
  assert.equal(nextManualAab.versionCode, 701051421);
  assert.ok(nextManualAab.versionCode > firstFromApk.versionCode);
});

test('ponowienie próby zwiększa versionCode w ramach slotów bez kolizji z kolejnym runem', () => {
  const retry = computePlayVersionCode({
    apkRunNumber: 143,
    aabRunNumber: 68,
    runAttempt: PLAY_ATTEMPT_SLOTS,
  });
  const nextRun = computePlayVersionCode({
    apkRunNumber: 144,
    aabRunNumber: 68,
    runAttempt: 1,
  });
  assert.ok(retry.versionCode < nextRun.versionCode);
});

test('odrzuca licznik poniżej bazy lub przekroczoną liczbę prób', () => {
  assert.throws(() =>
    computePlayVersionCode({ apkRunNumber: 142, aabRunNumber: 68, runAttempt: 1 }),
  );
  assert.throws(() =>
    computePlayVersionCode({
      apkRunNumber: 143,
      aabRunNumber: 68,
      runAttempt: PLAY_ATTEMPT_SLOTS + 1,
    }),
  );
});
