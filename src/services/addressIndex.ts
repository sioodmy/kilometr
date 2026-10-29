import {
  BinaryReader,
  BinaryWriter,
  CMD_ADDRESSES,
  invokeRustSync,
} from '../../modules/kilometr-raptor';
import type { Suggestion } from '../types/models';
import { getActiveCityIdSync } from './cityStore';
import { getGtfsDb } from './gtfsDatabase';

interface AddressRow {
  rowid: number;
  osm_id: string;
  street: string;
  house: string;
  locality: string;
  lat: number;
  lon: number;
}

type Database = Awaited<ReturnType<typeof getGtfsDb>>;
let readyDb: Database | null = null;
let readyCityId: string | null = null;
let addressCount = 0;
let loading: { db: Database; promise: Promise<boolean> } | null = null;
let generation = 0;

export function hasOfflineAddressIndex(): boolean {
  return readyDb !== null && readyCityId === getActiveCityIdSync() && addressCount > 0;
}

function accepted(writer: BinaryWriter): boolean {
  const result = invokeRustSync(CMD_ADDRESSES, writer.finish());
  return !!result && result.byteLength === 4 && new BinaryReader(result).u32() === 1;
}

/** Ładuje paczki do Rust raz po otwarciu bazy miasta, bez kopii katalogu w JS. */
export async function warmupAddressIndex(): Promise<boolean> {
  const cityId = getActiveCityIdSync();
  const db = await getGtfsDb();
  if (cityId !== getActiveCityIdSync()) return false;
  if (readyDb === db) return true;
  if (loading?.db === db) return loading.promise;
  const token = ++generation;
  readyDb = null;
  readyCityId = null;
  const current = () => token === generation && cityId === getActiveCityIdSync();
  const promise = (async () => {
    if (!accepted(new BinaryWriter().u8Val(0))) return false;
    let after = 0;
    let count = 0;
    while (current()) {
      const rows = await db.getAllAsync<AddressRow>(
        'SELECT rowid, osm_id, street, house, locality, lat, lon FROM addresses WHERE rowid > ? ORDER BY rowid LIMIT 2000',
        after,
      );
      if (!current() || db !== (await getGtfsDb()) || !current()) return false;
      if (!rows.length) break;
      const writer = new BinaryWriter(200_000).u8Val(1).u32(rows.length);
      for (const row of rows) {
        writer
          .str(row.osm_id)
          .str(row.street)
          .str(row.house)
          .str(row.locality)
          .f64(row.lat)
          .f64(row.lon);
      }
      if (!accepted(writer)) return false;
      after = rows[rows.length - 1].rowid;
      count += rows.length;
    }
    if (!current() || !accepted(new BinaryWriter().u8Val(2))) return false;
    readyDb = db;
    readyCityId = cityId;
    addressCount = count;
    return true;
  })();
  loading = { db, promise };
  try {
    return await promise;
  } finally {
    if (loading?.promise === promise) loading = null;
  }
}

/** Dokładne trafienia od razu; `fuzzy` włącza droższy fallback na literówki. */
export async function searchAddresses(
  query: string,
  userLat?: number,
  userLon?: number,
  limit = 16,
  fuzzy = false,
): Promise<Suggestion[]> {
  if (query.trim().length < 2 || limit <= 0) return [];
  const cityId = getActiveCityIdSync();
  if (!(await warmupAddressIndex()) || cityId !== getActiveCityIdSync()) return [];
  const writer = new BinaryWriter()
    .u8Val(3)
    .str(query)
    .u8Val(Number.isFinite(userLat) && Number.isFinite(userLon) ? 1 : 0)
    .f64(userLat ?? 0)
    .f64(userLon ?? 0)
    .u32(Math.min(50, limit))
    .u8Val(fuzzy ? 1 : 0);
  const result = invokeRustSync(CMD_ADDRESSES, writer.finish());
  if (!result || result.byteLength < 4) return [];
  const reader = new BinaryReader(result);
  const count = reader.u32();
  const suggestions: Suggestion[] = [];
  for (let i = 0; i < count; i++) {
    const id = reader.str();
    const title = reader.str();
    const locality = reader.str();
    suggestions.push({
      id: `osm-${id}`,
      title,
      address: locality,
      aliases: locality ? [`${title} ${locality}`] : undefined,
      kind: 'address',
      lat: reader.f64(),
      lon: reader.f64(),
    });
  }
  return suggestions;
}
