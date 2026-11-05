import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseTilePackHeader,
  TILE_PACK_ENTRY_BYTES,
  TILE_PACK_HEADER_BYTES,
  validateTilePackCatalog,
} from '../src/services/tilePack';

type Entry = [z: number, x: number, y: number, length: number];

function makePack(version: number, entries: Entry[] = [[14, 8967, 5477, 5]]): Uint8Array {
  const catalogBytes = entries.length * TILE_PACK_ENTRY_BYTES;
  const dataStart = TILE_PACK_HEADER_BYTES + catalogBytes;
  const bytes = new Uint8Array(dataStart + entries.reduce((sum, entry) => sum + entry[3], 0));
  bytes.set([0x4b, 0x4d, 0x54, 0x50], 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(4, version, true);
  view.setUint32(8, entries.length, true);
  view.setUint32(12, 14, true);
  let offset = dataStart;
  entries.forEach(([z, x, y, length], index) => {
    const base = TILE_PACK_HEADER_BYTES + index * TILE_PACK_ENTRY_BYTES;
    view.setUint32(base, offset, true);
    view.setUint32(base + 4, 0, true);
    view.setUint32(base + 8, length, true);
    view.setUint8(base + 12, z);
    view.setUint16(base + 13, x, true);
    view.setUint16(base + 15, y, true);
    view.setUint8(base + 17, 0);
    offset += length;
  });
  return bytes;
}

function parse(bytes: Uint8Array, fileSize = bytes.byteLength) {
  const header = parseTilePackHeader(bytes);
  if (!header) return null;
  const catalogBytes = header.tileCount * TILE_PACK_ENTRY_BYTES;
  const catalog = bytes.subarray(TILE_PACK_HEADER_BYTES, TILE_PACK_HEADER_BYTES + catalogBytes);
  return validateTilePackCatalog(header, catalog, fileSize) ? header : null;
}

test('przyjmuje KMTP v1 i v2', () => {
  for (const version of [1, 2]) {
    const pack = makePack(version, [
      [14, 8967, 5477, 5],
      [14, 8967, 5478, 7],
    ]);
    assert.equal(parse(pack)?.version, version);
    assert.equal(parse(pack)?.tileCount, 2);
  }
});

test('odrzuca zły magic i nieobsługiwaną wersję', () => {
  const html = new TextEncoder().encode('<html>not a tile pack</html>');
  assert.equal(parse(html), null);

  const pack = makePack(2);
  pack.set([0x4b, 0x4d, 0x54, 0x50], 0);
  new DataView(pack.buffer).setUint32(4, 3, true);
  assert.equal(parse(pack), null);
});

test('odrzuca obcięty nagłówek i obcięty katalog', () => {
  const pack = makePack(2);
  assert.equal(parseTilePackHeader(pack.subarray(0, TILE_PACK_HEADER_BYTES - 1)), null);
  assert.equal(parse(pack.subarray(0, TILE_PACK_HEADER_BYTES + TILE_PACK_ENTRY_BYTES - 1)), null);
});

test('odrzuca wpis wskazujący poza plik', () => {
  const pack = makePack(2);
  const view = new DataView(pack.buffer);
  view.setUint32(TILE_PACK_HEADER_BYTES + 8, pack.byteLength, true);
  assert.equal(parse(pack), null);
});

test('odrzuca zero kafli i zerową długość kafla', () => {
  const empty = makePack(2, []);
  assert.equal(parseTilePackHeader(empty), null);

  const zeroLength = makePack(2);
  new DataView(zeroLength.buffer).setUint32(TILE_PACK_HEADER_BYTES + 8, 0, true);
  assert.equal(parse(zeroLength), null);
});
