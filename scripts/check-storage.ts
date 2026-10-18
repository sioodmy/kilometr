import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { kvGet, kvGetStrict, kvRemove, kvSet } from '../src/services/storage';

const fs = createRequire(import.meta.url)('expo-file-system/legacy');
const files = new Map<string, string>();
const path = (key: string) => `${fs.documentDirectory}.kv/${encodeURIComponent(key)}`;
let pauseRead: (() => Promise<void>) | undefined;
let failWrite = false;

Object.assign(fs, {
  getInfoAsync: async (name: string) => ({ exists: files.has(name) }),
  readAsStringAsync: async (name: string) => {
    const value = files.get(name);
    await pauseRead?.();
    assert.notEqual(value, undefined);
    return value;
  },
  writeAsStringAsync: async (name: string, value: string) => {
    if (failWrite) throw new Error('write failed');
    await Promise.resolve();
    files.set(name, value);
  },
  moveAsync: async ({ from, to }: { from: string; to: string }) => {
    assert.ok(files.has(from), 'temporary file exists');
    files.set(to, files.get(from)!);
    files.delete(from);
  },
  deleteAsync: async (name: string) => {
    files.delete(name);
  },
});

async function main() {
  await Promise.all([kvSet('writes', 'first'), kvSet('writes', 'last')]);
  assert.equal(files.get(path('writes')), 'last');
  assert.equal(await kvGet('writes'), 'last');

  await Promise.all([kvSet('remove', 'value'), kvRemove('remove')]);
  assert.equal(await kvGet('remove'), null);
  assert.equal(files.has(path('remove')), false);

  files.set(path('read-write'), 'old');
  let started!: () => void;
  let resume!: () => void;
  const reading = new Promise<void>((resolve) => {
    started = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    resume = resolve;
  });
  pauseRead = async () => {
    started();
    await gate;
  };
  const read = kvGetStrict('read-write');
  await reading;
  const write = kvSet('read-write', 'new');
  resume();
  await Promise.all([read, write]);
  pauseRead = undefined;
  assert.equal(await kvGet('read-write'), 'new');
  assert.equal(files.get(path('read-write')), 'new');

  failWrite = true;
  await kvSet('retry', 'lost');
  failWrite = false;
  await kvSet('retry', 'saved');
  assert.equal(await kvGet('retry'), 'saved');

  const writeThenRead = kvSet('read-after-write', 'saved');
  assert.equal(await kvGet('read-after-write'), 'saved');
  await writeThenRead;
  console.log('PASS: concurrent writes, removal, stale reads, retry, read after write');
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
