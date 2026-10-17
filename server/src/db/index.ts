import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config';
import { CREATE_TABLES_SQL, INITIAL_SAVED_PLACES, SEED_TRIPS } from './schema';

let dbInstance: DatabaseSync | null = null;

export function getDb(): DatabaseSync {
  if (!dbInstance) {
    if (!fs.existsSync(config.dataDir)) {
      fs.mkdirSync(config.dataDir, { recursive: true });
    }
    const dbPath = path.join(config.dataDir, 'kilometr.db');
    dbInstance = new DatabaseSync(dbPath);
    dbInstance.exec(CREATE_TABLES_SQL);

    // Migrations for existing tables
    try {
      dbInstance.exec(`
        ALTER TABLE saved_places ADD COLUMN anchor_stop_id TEXT;
        ALTER TABLE saved_places ADD COLUMN anchor_stop_name TEXT;
        ALTER TABLE saved_places ADD COLUMN anchor_stop_lat REAL;
        ALTER TABLE saved_places ADD COLUMN anchor_stop_lon REAL;
      `);
    } catch {
      // columns already exist
    }

    // Seed saved places if table is empty
    const countRow = dbInstance.prepare('SELECT COUNT(*) as count FROM saved_places').get() as { count: number };
    if (countRow && countRow.count === 0) {
      const insertPlace = dbInstance.prepare(`
        INSERT INTO saved_places (id, name, icon, place_id, address, lat, lon, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const now = Date.now();
      for (const p of INITIAL_SAVED_PLACES) {
        insertPlace.run(p.id, p.name, p.icon, p.place_id, p.address, p.lat, p.lon, now);
      }
    }

    // Seed initial trip history if table is empty
    const tripCountRow = dbInstance.prepare('SELECT COUNT(*) as count FROM trip_history').get() as { count: number };
    if (tripCountRow && tripCountRow.count === 0) {
      const insertTrip = dbInstance.prepare(`
        INSERT INTO trip_history (id, origin_title, origin_lat, origin_lon, dest_id, dest_title, dest_address, dest_lat, dest_lon, duration_min, timestamp)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const now = Date.now();
      for (const t of SEED_TRIPS) {
        const time = now - t.offsetHours * 3600 * 1000;
        insertTrip.run(
          t.id,
          t.origin_title,
          t.origin_lat,
          t.origin_lon,
          t.dest_id,
          t.dest_title,
          t.dest_address,
          t.dest_lat,
          t.dest_lon,
          t.duration_min,
          time
        );
      }
    }
  }
  return dbInstance;
}
