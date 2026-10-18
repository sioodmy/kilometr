import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { kvGetStrict, kvSetStrict } from '../src/services/storage';

const requireModule = createRequire(import.meta.url);
const fs = requireModule('expo-file-system/legacy');
const sqlite = requireModule('expo-sqlite');
const files = new Map<string, string>();
let failWrite = false;
let readRows: () => Promise<{ key: string; value: string }[]>;
let closed = () => {};
const flag = '__kv_migrated_from_sqlite';
const migrationPath = new URL('../src/services/kvMigration.ts', import.meta.url);
const compiled = ts.transpileModule(readFileSync(migrationPath, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
});
const migration = { exports: {} as { migrateFromSqliteKv: () => Promise<void> } };
runInNewContext(compiled.outputText, {
  module: migration,
  exports: migration.exports,
  require: createRequire(migrationPath),
  console,
  setTimeout,
  clearTimeout,
});
const { migrateFromSqliteKv } = migration.exports;

Object.assign(fs, {
  getInfoAsync: async (path: string) => ({
    exists: path.endsWith('/ExpoSQLiteStorage') || files.has(path),
  }),
  readAsStringAsync: async (path: string) => files.get(path),
  writeAsStringAsync: async (path: string, value: string) => {
    if (failWrite) throw new Error('disk full');
    files.set(path, value);
  },
  moveAsync: async ({ from, to }: { from: string; to: string }) => {
    files.set(to, files.get(from)!);
    files.delete(from);
  },
});
Object.assign(sqlite, {
  openDatabaseAsync: async () => ({
    getAllAsync: () => readRows(),
    closeAsync: async () => closed(),
  }),
});

async function main() {
  let resume!: (rows: { key: string; value: string }[]) => void;
  const delayedRows = new Promise<{ key: string; value: string }[]>((resolve) => {
    resume = resolve;
  });
  const dbClosed = new Promise<void>((resolve) => {
    closed = resolve;
  });
  readRows = () => delayedRows;
  await migrateFromSqliteKv();
  assert.equal(await kvGetStrict(flag), null);
  resume([{ key: 'late', value: 'old' }]);
  await dbClosed;
  assert.equal(await kvGetStrict('late'), null);

  readRows = async () => {
    throw new Error('database unavailable');
  };
  await migrateFromSqliteKv();
  assert.equal(await kvGetStrict(flag), null);

  readRows = async () => [
    { key: 'places', value: 'legacy' },
    { key: 'existing', value: 'old' },
  ];
  failWrite = true;
  await migrateFromSqliteKv();
  assert.equal(await kvGetStrict(flag), null);
  assert.equal(await kvGetStrict('places'), null);

  failWrite = false;
  await kvSetStrict('existing', 'current');
  await migrateFromSqliteKv();
  assert.equal(await kvGetStrict(flag), '1');
  assert.equal(await kvGetStrict('places'), 'legacy');
  assert.equal(await kvGetStrict('existing'), 'current');
  readRows = async () => {
    assert.fail('completed migration must not run again');
  };
  await migrateFromSqliteKv();
  console.log(
    'PASS: migration timeout, read/write failure retries, preserved data, completion marker',
  );
}

const watchdog = setTimeout(() => {
  console.error('Migration test did not finish');
  process.exit(1);
}, 10000);
void main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => clearTimeout(watchdog));
