import { getDb } from '../db';
import { getSmartDestinationsForLocation, recordTripSearch, SmartDestination } from './smartRanker';

export interface SavedPlace {
  id: string;
  name: string;
  icon: string;
  placeId: string;
  address: string;
  lat: number;
  lon: number;
  anchorStopId?: string;
  anchorStopName?: string;
  anchorStopLat?: number;
  anchorStopLon?: number;
}

export interface SavedRoute {
  id: string;
  fromTitle: string;
  toTitle: string;
  fromLat: number;
  fromLon: number;
  toLat: number;
  toLon: number;
  connection: any;
  createdAt: number;
}

export const FavoritesService = {
  // Saved Places
  listPlaces(): SavedPlace[] {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM saved_places ORDER BY created_at ASC').all() as any[];
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      icon: r.icon,
      placeId: r.place_id,
      address: r.address,
      lat: r.lat,
      lon: r.lon,
      anchorStopId: r.anchor_stop_id || undefined,
      anchorStopName: r.anchor_stop_name || undefined,
      anchorStopLat: r.anchor_stop_lat !== null && r.anchor_stop_lat !== undefined ? Number(r.anchor_stop_lat) : undefined,
      anchorStopLon: r.anchor_stop_lon !== null && r.anchor_stop_lon !== undefined ? Number(r.anchor_stop_lon) : undefined,
    }));
  },

  addPlace(place: {
    name: string;
    icon: string;
    address: string;
    lat: number;
    lon: number;
    placeId?: string;
    anchorStopId?: string;
    anchorStopName?: string;
    anchorStopLat?: number;
    anchorStopLon?: number;
  }): SavedPlace {
    const db = getDb();
    // place_id jest stabilnym kluczem z klienta: jeśli już istnieje, aktualizujemy
    // zamiast wstawiać duplikat. Inaczej usuwanie po place_id kaskadowałoby na
    // wiele wierszy, a updatePlace trafiałby w losowy.
    if (place.placeId) {
      const existing = db.prepare('SELECT id FROM saved_places WHERE place_id = ?').get(place.placeId) as
        | { id: string }
        | undefined;
      if (existing) {
        const updated = this.updatePlace(existing.id, place);
        if (updated) return updated;
      }
    }
    const id = `place-${Date.now()}`;
    const placeId = place.placeId || id;
    const now = Date.now();

    db.prepare(`
      INSERT INTO saved_places (id, name, icon, place_id, address, lat, lon, created_at, anchor_stop_id, anchor_stop_name, anchor_stop_lat, anchor_stop_lon)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      place.name,
      place.icon,
      placeId,
      place.address,
      place.lat,
      place.lon,
      now,
      place.anchorStopId || null,
      place.anchorStopName || null,
      place.anchorStopLat ?? null,
      place.anchorStopLon ?? null
    );

    return {
      id,
      name: place.name,
      icon: place.icon,
      placeId,
      address: place.address,
      lat: place.lat,
      lon: place.lon,
      anchorStopId: place.anchorStopId,
      anchorStopName: place.anchorStopName,
      anchorStopLat: place.anchorStopLat,
      anchorStopLon: place.anchorStopLon,
    };
  },

  updatePlace(
    id: string,
    place: {
      name?: string;
      icon?: string;
      address?: string;
      lat?: number;
      lon?: number;
      anchorStopId?: string | null;
      anchorStopName?: string | null;
      anchorStopLat?: number | null;
      anchorStopLon?: number | null;
    }
  ): SavedPlace | null {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM saved_places WHERE id = ? OR place_id = ?').get(id, id) as any;
    if (!existing) return null;

    const name = place.name !== undefined && place.name !== null ? String(place.name) : existing.name;
    const icon = place.icon !== undefined && place.icon !== null ? String(place.icon) : existing.icon;
    const address = place.address !== undefined && place.address !== null ? String(place.address) : existing.address;
    const lat = place.lat !== undefined && place.lat !== null && !isNaN(Number(place.lat)) ? Number(place.lat) : existing.lat;
    const lon = place.lon !== undefined && place.lon !== null && !isNaN(Number(place.lon)) ? Number(place.lon) : existing.lon;

    const anchorStopId = place.anchorStopId !== undefined ? place.anchorStopId : existing.anchor_stop_id;
    const anchorStopName = place.anchorStopName !== undefined ? place.anchorStopName : existing.anchor_stop_name;
    const anchorStopLat =
      place.anchorStopLat !== undefined
        ? (place.anchorStopLat !== null && !isNaN(Number(place.anchorStopLat)) ? Number(place.anchorStopLat) : null)
        : existing.anchor_stop_lat;
    const anchorStopLon =
      place.anchorStopLon !== undefined
        ? (place.anchorStopLon !== null && !isNaN(Number(place.anchorStopLon)) ? Number(place.anchorStopLon) : null)
        : existing.anchor_stop_lon;

    db.prepare(`
      UPDATE saved_places
      SET name = ?, icon = ?, address = ?, lat = ?, lon = ?,
          anchor_stop_id = ?, anchor_stop_name = ?, anchor_stop_lat = ?, anchor_stop_lon = ?
      WHERE id = ?
    `).run(
      name ?? '',
      icon ?? 'star',
      address ?? '',
      lat ?? 0,
      lon ?? 0,
      anchorStopId || null,
      anchorStopName || null,
      anchorStopLat ?? null,
      anchorStopLon ?? null,
      existing.id
    );

    return {
      id: existing.id,
      name,
      icon,
      placeId: existing.place_id,
      address,
      lat,
      lon,
      anchorStopId: anchorStopId || undefined,
      anchorStopName: anchorStopName || undefined,
      anchorStopLat: anchorStopLat !== null && anchorStopLat !== undefined ? Number(anchorStopLat) : undefined,
      anchorStopLon: anchorStopLon !== null && anchorStopLon !== undefined ? Number(anchorStopLon) : undefined,
    };
  },

  deletePlace(id: string): boolean {
    const db = getDb();
    // Najpierw dokładnie po id (unikalne). Dopiero gdy takiego nie ma,
    // próbujemy po place_id i tylko wtedy, gdy wskazuje jeden wiersz —
    // inaczej usunęlibyśmy kilka miejsc naraz.
    const byId = db.prepare('SELECT id FROM saved_places WHERE id = ?').get(id) as { id: string } | undefined;
    if (byId) {
      return db.prepare('DELETE FROM saved_places WHERE id = ?').run(id).changes > 0;
    }
    const match = db
      .prepare('SELECT COUNT(*) AS n FROM saved_places WHERE place_id = ?')
      .get(id) as { n: number };
    if (match.n === 1) {
      return db.prepare('DELETE FROM saved_places WHERE place_id = ?').run(id).changes > 0;
    }
    return false;
  },

  // Saved Routes
  listSavedRoutes(): SavedRoute[] {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM saved_routes ORDER BY created_at DESC').all() as any[];
    return rows.map((r) => ({
      id: r.id,
      fromTitle: r.from_title,
      toTitle: r.to_title,
      fromLat: r.from_lat,
      fromLon: r.from_lon,
      toLat: r.to_lat,
      toLon: r.to_lon,
      connection: JSON.parse(r.connection_json),
      createdAt: r.created_at,
    }));
  },

  saveRoute(connection: any): SavedRoute {
    const db = getDb();
    const id = connection.id || `route-${Date.now()}`;
    const now = Date.now();

    db.prepare(`
      INSERT OR REPLACE INTO saved_routes (
        id, from_title, to_title, from_lat, from_lon, to_lat, to_lon, connection_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      connection.fromTitle,
      connection.toTitle,
      connection.fromLat || 0,
      connection.fromLon || 0,
      connection.toLat || 0,
      connection.toLon || 0,
      JSON.stringify(connection),
      now
    );

    return {
      id,
      fromTitle: connection.fromTitle,
      toTitle: connection.toTitle,
      fromLat: connection.fromLat || 0,
      fromLon: connection.fromLon || 0,
      toLat: connection.toLat || 0,
      toLon: connection.toLon || 0,
      connection,
      createdAt: now,
    };
  },

  deleteSavedRoute(id: string): boolean {
    const db = getDb();
    const res = db.prepare('DELETE FROM saved_routes WHERE id = ?').run(id);
    return res.changes > 0;
  },

  isRouteSaved(id: string): boolean {
    const db = getDb();
    const row = db.prepare('SELECT id FROM saved_routes WHERE id = ?').get(id);
    return !!row;
  },

  // Smart Destinations & Trip Recording
  getSmartDestinations(lat: number, lon: number, limit = 5): SmartDestination[] {
    return getSmartDestinationsForLocation(lat, lon, limit);
  },

  recordTrip(originLat: number, originLon: number, originTitle: string, dest: any, durationMin = 15) {
    recordTripSearch(originLat, originLon, originTitle, dest, durationMin);
  },

  getRecentDestinations(limit = 6): any[] {
    const db = getDb();
    const rows = db
      .prepare(`
        SELECT DISTINCT dest_id, dest_title, dest_address, dest_lat, dest_lon
        FROM trip_history
        ORDER BY timestamp DESC
        LIMIT ?
      `)
      .all(limit) as any[];

    return rows.map((r) => ({
      id: r.dest_id,
      title: r.dest_title,
      address: `Ostatnio • ${r.dest_address.split('•')[0].trim()}`,
      kind: 'history',
      lat: r.dest_lat,
      lon: r.dest_lon,
    }));
  },
};
