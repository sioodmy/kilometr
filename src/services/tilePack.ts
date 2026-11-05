// Nagłówek archiwum kafli KMTP (v1 raw, v2 gzip per kafel).
//
// Format: 32 B nagłówka (magic, wersja, liczba kafli, maxzoom + 16 B rezerwy),
// katalog 18 B na kafel (offset u64, długość u32, z u8, x u16, y u16, pad u8)
// i dane kafli. Funkcje tutaj są czyste, więc walidację pakietu testuje się
// bez telefonu. Sam odczyt pliku robi `offlineMap`.

export const TILE_PACK_HEADER_BYTES = 32;
export const TILE_PACK_ENTRY_BYTES = 18;
/** Sufit na katalog w RAM; obecne pakiety miast są dużo mniejsze. */
export const TILE_PACK_MAX_CATALOG_BYTES = 16 * 1024 * 1024;
/** Taki sam limit kafla jak w czytniku iOS. */
const TILE_PACK_MAX_TILE_BYTES = 32 * 1024 * 1024;

export interface TilePackHeader {
  /** 1 = kafle surowe, 2 = gzip per kafel. */
  version: 1 | 2;
  tileCount: number;
  maxZoom: number;
}

/** Nagłówek albo null, gdy to nie jest KMTP w obsługiwanej wersji. */
export function parseTilePackHeader(bytes: Uint8Array): TilePackHeader | null {
  if (bytes.byteLength < TILE_PACK_HEADER_BYTES) return null;
  if (String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) !== 'KMTP') return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint32(4, true);
  if (version !== 1 && version !== 2) return null;
  const tileCount = view.getUint32(8, true);
  if (tileCount === 0) return null;
  const maxZoom = view.getUint32(12, true);
  return { version, tileCount, maxZoom };
}

/**
 * Czy katalog mieści się w pliku i wskazuje istniejące dane kafli.
 * Sprawdza też, czy plik nie jest obcięty w środku danych.
 */
export function validateTilePackCatalog(
  header: TilePackHeader,
  catalog: Uint8Array,
  fileSize: number,
): boolean {
  const catalogBytes = header.tileCount * TILE_PACK_ENTRY_BYTES;
  const dataStart = TILE_PACK_HEADER_BYTES + catalogBytes;
  if (fileSize < dataStart || catalog.byteLength < catalogBytes) return false;
  const view = new DataView(catalog.buffer, catalog.byteOffset, catalog.byteLength);
  for (let i = 0; i < header.tileCount; i++) {
    const base = i * TILE_PACK_ENTRY_BYTES;
    // Offset jest u64 LE. Number mieści 2^53, więc górne 32 bity muszą być małe.
    const low = view.getUint32(base, true);
    const high = view.getUint32(base + 4, true);
    if (high > 0x1fffff) return false;
    const offset = high * 0x100000000 + low;
    const length = view.getUint32(base + 8, true);
    if (length === 0 || length > TILE_PACK_MAX_TILE_BYTES) return false;
    if (offset < dataStart || offset + length > fileSize) return false;
  }
  return true;
}
