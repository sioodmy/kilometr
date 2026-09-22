import { Router } from 'express';
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

// Smart location-ranked destinations ("Częste z tej lokalizacji")
apiRouter.get('/destinations/smart', (req, res) => {
  const lat = Number(req.query.lat ?? 51.0997);
  const lon = Number(req.query.lon ?? 17.0364);
  const limit = req.query.limit ? Number(req.query.limit) : 5;

  const destinations = FavoritesService.getSmartDestinations(lat, lon, limit);
  res.json(destinations);
});

// Record a trip search into history
apiRouter.post('/history/trip', (req, res) => {
  const { originLat, originLon, originTitle, dest, durationMin } = req.body;
  if (!dest || !originLat || !originLon) {
    res.status(400).json({ error: 'Missing required trip fields' });
    return;
  }
  FavoritesService.recordTrip(
    Number(originLat),
    Number(originLon),
    originTitle || 'Twoja lokalizacja',
    dest,
    durationMin || 15
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
  const minTransferSec = req.query.minTransferSec !== undefined ? Number(req.query.minTransferSec) : undefined;
  const maxWalkM = req.query.maxWalkM !== undefined ? Number(req.query.maxWalkM) : undefined;
  const walkSpeedMps = req.query.walkSpeedMps !== undefined ? Number(req.query.walkSpeedMps) : undefined;

  if (!toLat || !toLon) {
    res.status(400).json({ error: 'Missing destination coordinates (toLat, toLon)' });
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
      minTransferSec: Number.isFinite(minTransferSec) ? minTransferSec : undefined,
      maxWalkM: Number.isFinite(maxWalkM) ? maxWalkM : undefined,
      walkSpeedMps: Number.isFinite(walkSpeedMps) ? walkSpeedMps : undefined,
    });

    // Cache connections in memory so /api/routes/:id can retrieve them
    for (const c of connections) {
      recentPlannedConnections.set(c.id, c);
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

  if (isNaN(lat) || isNaN(lon)) {
    res.status(400).json({ error: 'Valid lat and lon query parameters required' });
    return;
  }

  const info = await reverseGeocodeLocation(lat, lon);
  res.json(info);
});

// Nearest GTFS stops to a coordinate
apiRouter.get('/stops/nearest', async (req, res) => {
  const lat = Number(req.query.lat);
  const lon = Number(req.query.lon);
  const limit = req.query.limit ? Number(req.query.limit) : 5;
  const maxDistance = req.query.maxDistance ? Number(req.query.maxDistance) : 1000;

  if (isNaN(lat) || isNaN(lon)) {
    res.status(400).json({ error: 'Valid lat and lon query parameters required' });
    return;
  }

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
});

// Saved places CRUD
apiRouter.get('/places', (req, res) => {
  res.json(FavoritesService.listPlaces());
});

apiRouter.post('/places', (req, res) => {
  const { name, icon, address, lat, lon, placeId, anchorStopId, anchorStopName, anchorStopLat, anchorStopLon } = req.body;
  if (!name || lat === undefined || lon === undefined) {
    res.status(400).json({ error: 'Missing name or coordinates' });
    return;
  }
  const created = FavoritesService.addPlace({
    name,
    icon: icon || 'star',
    address: address || 'Wrocław',
    lat: Number(lat),
    lon: Number(lon),
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
