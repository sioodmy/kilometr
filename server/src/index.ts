import express from 'express';
import cors from 'cors';
import { config } from './config';
import { apiRouter } from './api/routes';
import { getDb } from './db';
import { gtfsStore } from './gtfs/store';
import { vehicleTracker } from './realtime/tracker';
import { ensurePoiIndex } from './search/poiIndex';

const app = express();

app.use(cors());
app.use(express.json());

// Log incoming API requests
app.use((req, res, next) => {
  console.log(`[API] ${req.method} ${req.url}`);
  next();
});

// Mount API router
app.use('/api', apiRouter);

// Initialize DB and background workers
async function bootstrap() {
  console.log('[Server] Initializing Kilometr backend server...');

  // Initialize SQLite database & seed
  getDb();
  console.log('[Server] SQLite database ready.');

  // Start HTTP server
  const server = app.listen(config.port, config.host, () => {
    console.log(`[Server] Kilometr backend listening on http://${config.host}:${config.port}`);
  });

  // Load GTFS timetable asynchronously in background
  try {
    await gtfsStore.load();
    console.log('[Server] Wrocław GTFS timetable successfully loaded and indexed.');

    // Start live vehicle position tracker
    vehicleTracker.start();

    // Local POI index (Overpass) refreshes itself in background when stale
    ensurePoiIndex();
  } catch (err) {
    console.error('[Server] Failed to initialize GTFS data:', err);
  }

  // Graceful shutdown
  const shutdown = () => {
    console.log('[Server] Shutting down...');
    vehicleTracker.stop();
    server.close(() => process.exit(0));
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

bootstrap().catch((err) => {
  console.error('[Server] Fatal startup error:', err);
  process.exit(1);
});
