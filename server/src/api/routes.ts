import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import { config } from '../config';
import { searchSuggestions } from '../search/service';
import { buildTripStops, planConnections } from '../routing/engine';
import { vehicleTracker } from '../realtime/tracker';
import { reverseGeocodeLocation } from '../location/service';
import { FavoritesService } from '../favorites/service';
import { gtfsStore } from '../gtfs/store';

export const apiRouter = Router();

// In-memory cache for recent planned journeys so /api/routes/:id is instant
const recentPlannedConnections = new Map<string, any>();

// Health check
apiRouter.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    gtfsLoaded: gtfsStore.isLoaded,
    stopsCount: gtfsStore.stops.size,
    routesCount: gtfsStore.routes.size,
    vehiclesLive: vehicleTracker.getVehicles().length,
  });
});

/**
 * Archiwum GTFS, które backend już ma na dysku. Telefon sięga tu dopiero
 * wtedy, gdy Open Data Wrocław jest nieosiągalne (captive portal, sieć
 * blokująca host, brak DNS) — dzięki temu pierwszy import ma drugi
 * szansę zamiast kończyć się komunikatem o błędzie.
 */
apiRouter.get('/gtfs/archive', (req, res) => {
  const zipPath = path.join(config.dataDir, config.gtfs.cacheFile);
  let size: number;
  try {
    size = fs.statSync(zipPath).size;
  } catch {
    res.status(503).json({ error: 'GTFS archive not available on server' });
    return;
  }
  if (size <= 0) {
    res.status(503).json({ error: 'GTFS archive is empty on server' });
    return;
  }
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Length', String(size));
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.sendFile(zipPath);
});

// Smart location-ranked destinations ("Częste z tej lokalizacji")
apiRouter.get('/destinations/smart', (req, res) => {
  const lat = req.query.lat !== undefined ? Number(req.query.lat) : 51.0997;
  const lon = req.query.lon !== undefined ? Number(req.query.lon) : 17.0364;
  const limit = req.query.limit !== undefined ? Number(req.query.limit) : 5;

  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(limit)) {
    res.status(400).json({ error: 'Valid lat, lon and limit query parameters required' });
    return;
  }

  const destinations = FavoritesService.getSmartDestinations(lat, lon, limit);
  res.json(destinations);
});

// Record a trip search into history
apiRouter.post('/history/trip', (req, res) => {
  const { originLat, originLon, originTitle, dest, durationMin } = req.body;
  const lat = Number(originLat);
  const lon = Number(originLon);
  if (!dest || !dest.id || !Number.isFinite(lat) || !Number.isFinite(lon)) {
    res.status(400).json({ error: 'Missing required trip fields (dest.id, originLat, originLon)' });
    return;
  }
  FavoritesService.recordTrip(
    lat,
    lon,
    originTitle || 'Twoja lokalizacja',
    dest,
    Number.isFinite(Number(durationMin)) ? Number(durationMin) : 15
  );
  res.json({ success: true });
});

// Recent destination queries
apiRouter.get('/history', (req, res) => {
  res.json(FavoritesService.getRecentDestinations());
});

// Search suggestions (GTFS stops + Nominatim OSM)
apiRouter.get('/search', async (req, res) => {
  const q = String(req.query.q ?? '');
  const lat = req.query.lat ? Number(req.query.lat) : undefined;
  const lon = req.query.lon ? Number(req.query.lon) : undefined;

  try {
    const results = await searchSuggestions(q, lat, lon);
    res.json(results);
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Search error' });
  }
});

// Transit routing: RAPTOR engine + live delays
apiRouter.get('/routes', async (req, res) => {
  const fromTitle = String(req.query.fromTitle ?? 'Moja lokalizacja');
  const fromLat = Number(req.query.fromLat ?? 51.0997);
  const fromLon = Number(req.query.fromLon ?? 17.0364);
  const toTitle = String(req.query.toTitle ?? 'Cel');
  const toLat = Number(req.query.toLat ?? 0);
  const toLon = Number(req.query.toLon ?? 0);
  const toId = req.query.toId ? String(req.query.toId) : undefined;
  const departureTimeSec = req.query.departureTimeSec ? Number(req.query.departureTimeSec) : undefined;
  const maxTransfers = req.query.maxTransfers !== undefined ? Number(req.query.maxTransfers) : undefined;
  const modesRaw = req.query.modes ? String(req.query.modes) : undefined;
  const modes = modesRaw === 'tram' || modesRaw === 'bus' ? modesRaw : undefined;
  const minTransferSec = req.query.minTransferSec !== undefined ? Number(req.query.minTransferSec) : undefined;
  const maxWalkM = req.query.maxWalkM !== undefined ? Number(req.query.maxWalkM) : undefined;
  const walkSpeedMps = req.query.walkSpeedMps !== undefined ? Number(req.query.walkSpeedMps) : undefined;
  const anchorStopId = req.query.anchorStopId ? String(req.query.anchorStopId) : undefined;
  const anchorStopLat = req.query.anchorStopLat !== undefined ? Number(req.query.anchorStopLat) : undefined;
  const anchorStopLon = req.query.anchorStopLon !== undefined ? Number(req.query.anchorStopLon) : undefined;

  if (!toLat || !toLon) {
    res.status(400).json({ error: 'Missing destination coordinates (toLat, toLon)' });
    return;
  }
  if (!Number.isFinite(fromLat) || !Number.isFinite(fromLon) || !Number.isFinite(toLat) || !Number.isFinite(toLon)) {
    res.status(400).json({ error: 'Coordinates must be valid numbers' });
    return;
  }
  if (departureTimeSec !== undefined && (!Number.isFinite(departureTimeSec) || departureTimeSec < 0)) {
    res.status(400).json({ error: 'departureTimeSec must be a non-negative number' });
    return;
  }

  try {
    const connections = await planConnections({
      fromTitle,
      fromLat,
      fromLon,
      toTitle,
      toLat,
      toLon,
      toId,
      departureTimeSec,
      maxTransfers: Number.isFinite(maxTransfers) ? maxTransfers : undefined,
      modes,
      minTransferSec: Number.isFinite(minTransferSec) ? minTransferSec : undefined,
      maxWalkM: Number.isFinite(maxWalkM) ? maxWalkM : undefined,
      walkSpeedMps: Number.isFinite(walkSpeedMps) ? walkSpeedMps : undefined,
      anchorStopId,
      anchorStopLat: anchorStopLat !== undefined && Number.isFinite(anchorStopLat) ? anchorStopLat : undefined,
      anchorStopLon: anchorStopLon !== undefined && Number.isFinite(anchorStopLon) ? anchorStopLon : undefined,
    });

    // Cache connections in memory so /api/routes/:id can retrieve them
    for (const c of connections) {
      recentPlannedConnections.set(c.id, c);
    }
    // Limit cache: długo działający serwer nie może rosnąć bez końca.
    while (recentPlannedConnections.size > 500) {
      const oldest = recentPlannedConnections.keys().next();
      if (oldest.done) break;
      recentPlannedConnections.delete(oldest.value);
    }

    // Automatically record trip search into smart history
    if (connections.length > 0) {
      FavoritesService.recordTrip(
        fromLat,
        fromLon,
        fromTitle,
        { id: toId || `dest-${toLat}-${toLon}`, title: toTitle, lat: toLat, lon: toLon },
        connections[0].durationMin
      );
    }

    res.json(connections);
  } catch (err: any) {
    console.error('[API /routes error]', err);
    res.status(500).json({ error: err?.message || 'Routing calculation error' });
  }
});

// Saved routes CRUD (MUSZĄ być przed /routes/:id — inaczej "saved" wpada w :id)
apiRouter.get('/routes/saved', (req, res) => {
  res.json(FavoritesService.listSavedRoutes());
});

apiRouter.post('/routes/saved', (req, res) => {
  const connection = req.body;
  if (!connection || !connection.id) {
    res.status(400).json({ error: 'Valid connection object required' });
    return;
  }
  const saved = FavoritesService.saveRoute(connection);
  res.json(saved);
});

apiRouter.delete('/routes/saved/:id', (req, res) => {
  const ok = FavoritesService.deleteSavedRoute(req.params.id);
  res.json({ success: ok });
});

apiRouter.get('/routes/saved/:id/status', (req, res) => {
  const isSaved = FavoritesService.isRouteSaved(req.params.id);
  res.json({ isSaved });
});

// Get connection by ID
apiRouter.get('/routes/:id', (req, res) => {
  const id = req.params.id;
  const found = recentPlannedConnections.get(id);
  if (found) {
    res.json(found);
    return;
  }
  // Check if saved
  const saved = FavoritesService.listSavedRoutes().find((r) => r.id === id);
  if (saved) {
    res.json(saved.connection);
    return;
  }
  res.status(404).json({ error: 'Connection not found' });
});

// Live vehicle positions
apiRouter.get('/vehicles', (req, res) => {
  const line = req.query.line ? String(req.query.line) : undefined;
  const vehicles = vehicleTracker.getVehicles(line);
  res.json(vehicles);
});

// Pełna sekwencja przystanków kursu (cała linia) dla rozwijanej listy kropek.
// Używane gdy Connection.legs[].intermediateStops jest puste (starszy cache).
apiRouter.get('/trips/:tripId/stops', async (req, res) => {
  try {
    await gtfsStore.load();
    const stops = buildTripStops(req.params.tripId);
    if (!stops.length) {
      res.status(404).json({ error: 'Trip not found' });
      return;
    }
    res.json({ tripId: req.params.tripId, stops });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Trip stops error' });
  }
});

// Reverse geocoding / snap to MPK stop
apiRouter.get('/location/reverse', async (req, res) => {
  const lat = Number(req.query.lat);
  const lon = Number(req.query.lon);

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    res.status(400).json({ error: 'Valid lat and lon query parameters required' });
    return;
  }

  try {
    const info = await reverseGeocodeLocation(lat, lon);
    res.json(info);
  } catch (err: any) {
    console.error('[API /location/reverse error]', err);
    res.status(500).json({ error: err?.message || 'Reverse geocode error' });
  }
});

// Nearest GTFS stops to a coordinate
apiRouter.get('/stops/nearest', async (req, res) => {
  const lat = Number(req.query.lat);
  const lon = Number(req.query.lon);
  const limit = req.query.limit ? Number(req.query.limit) : 5;
  const maxDistance = req.query.maxDistance ? Number(req.query.maxDistance) : 1000;

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    res.status(400).json({ error: 'Valid lat and lon query parameters required' });
    return;
  }

  try {
    await gtfsStore.load();
    const nearest = gtfsStore.findNearestStops(lat, lon, maxDistance, limit);
    res.json(
      nearest.map((n) => ({
        id: n.stop.stop_id,
        name: n.stop.stop_name,
        code: n.stop.stop_code,
        lat: n.stop.stop_lat,
        lon: n.stop.stop_lon,
        distanceM: Math.round(n.distanceM),
      }))
    );
  } catch (err: any) {
    console.error('[API /stops/nearest error]', err);
    res.status(500).json({ error: err?.message || 'Nearest stops error' });
  }
});

// Saved places CRUD
apiRouter.get('/places', (req, res) => {
  res.json(FavoritesService.listPlaces());
});

apiRouter.post('/places', (req, res) => {
  const { name, icon, address, lat, lon, placeId, anchorStopId, anchorStopName, anchorStopLat, anchorStopLon } = req.body;
  const latN = Number(lat);
  const lonN = Number(lon);
  if (!name || lat === undefined || lon === undefined || !Number.isFinite(latN) || !Number.isFinite(lonN)) {
    res.status(400).json({ error: 'Missing name or valid coordinates' });
    return;
  }
  const created = FavoritesService.addPlace({
    name,
    icon: icon || 'star',
    address: address || 'Wrocław',
    lat: latN,
    lon: lonN,
    placeId,
    anchorStopId,
    anchorStopName,
    anchorStopLat: anchorStopLat !== undefined ? Number(anchorStopLat) : undefined,
    anchorStopLon: anchorStopLon !== undefined ? Number(anchorStopLon) : undefined,
  });
  res.json(created);
});

apiRouter.put('/places/:id', (req, res) => {
  try {
    const updated = FavoritesService.updatePlace(req.params.id, req.body);
    if (!updated) {
      res.status(404).json({ error: 'Place not found' });
      return;
    }
    res.json(updated);
  } catch (err: any) {
    console.error('[API PUT /places/:id error]', err);
    res.status(500).json({ error: err?.message || 'Failed to update place' });
  }
});

apiRouter.delete('/places/:id', (req, res) => {
  const ok = FavoritesService.deletePlace(req.params.id);
  res.json({ success: ok });
});
