// Pre-warm generowanych danych backendu: rozkład GTFS (pobieranie ~12 MB
// przy pierwszym uruchomieniu) + plik SQLite z migracjami i seedami.
// Idempotentny — przy istniejących danych kończy się natychmiast.
// Uruchamiany automatycznie przez hooki `predev`/`prestart` oraz ręcznie:
// `npm run setup --prefix server`.
import { ensureGtfsData } from '../src/gtfs/downloader';
import { getDb } from '../src/db';

async function main(): Promise<void> {
  console.log('[Setup] Sprawdzanie danych backendu...');
  const dir = await ensureGtfsData();
  console.log('[Setup] GTFS gotowy:', dir);
  getDb();
  console.log('[Setup] SQLite gotowy. Wszystko aktualne.');
}

main().catch((err) => {
  console.error('[Setup] Błąd:', err);
  process.exit(1);
});
