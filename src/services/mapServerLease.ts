import { startMapServer, stopMapServer } from '../../modules/kilometr-maps';
import { getCity, type CityId } from '../cities';
import { getActiveCityIdSync } from './cityStore';
import { hasOfflineMap } from './offlineMap';
import type { MapRoute } from '../map/types';

export interface MapServerLease {
  base: string | null;
  release: () => void;
}

let leases = 0;
let baseUrl: string | null = null;
let startPromise: Promise<string | null> | null = null;
let stopPromise: Promise<void> | null = null;

/**
 * Serwer kafli ma sens tylko dla miasta, które ma pobrany pakiet. Bez tego
 * warunku mapa miasta bez pakietu dostałaby `base` serwera (z kaflami innego
 * miasta), każdy kafel 404owałby i nie było fallbacku na CDN: pusta mapa
 * przy pełnym łączu.
 */
export async function acquireMapServer(): Promise<MapServerLease> {
  if (!(await hasOfflineMap(getActiveCityIdSync()))) {
    return { base: null, release: () => undefined };
  }
  leases += 1;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    leases = Math.max(0, leases - 1);
    if (leases === 0) {
      baseUrl = null;
      stopPromise = stopMapServer().finally(() => {
        stopPromise = null;
      });
    }
  };

  try {
    if (stopPromise) await stopPromise;
    if (!baseUrl) {
      if (!startPromise) {
        const pending = startMapServer();
        startPromise = pending;
        void pending.finally(() => {
          if (startPromise === pending) startPromise = null;
        });
      }
      baseUrl = await startPromise;
    }
    if (!baseUrl) {
      release();
      return { base: null, release: () => undefined };
    }
    return { base: baseUrl, release };
  } catch {
    release();
    return { base: null, release: () => undefined };
  }
}

/**
 * Czy trasa mieści się w pakiecie kafli miasta. Pakiet obejmuje tylko
 * obwiednię miasta: trasa międzyregionalna (np. Wrocław -> Warszawa)
 * wychodzi poza kafle, a serwer offline nie ma fallbacku na CDN - mapa
 * byłaby ciemna pustynią z kreską. Takie trasy idą na kafelki online.
 */
function routeFitsOfflinePack(route: MapRoute | null, cityId?: CityId): boolean {
  if (!route) return true;
  try {
    const bbox = getCity(cityId ?? getActiveCityIdSync()).tileBbox;
    // Margines ~0.05° (5 km): kafle na skraju pakietu muszą złapać koronę.
    const margin = 0.05;
    for (const leg of route.legs) {
      for (const stop of leg.stops ?? []) {
        if (
          !Number.isFinite(stop.lat) ||
          !Number.isFinite(stop.lon) ||
          stop.lat < bbox.minLat - margin ||
          stop.lat > bbox.maxLat + margin ||
          stop.lon < bbox.minLon - margin ||
          stop.lon > bbox.maxLon + margin
        ) {
          return false;
        }
      }
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Lease z uwzględnieniem trasy: krótkie trasy w mieście dostają serwer
 * offline (pakiet), międzyregionalne idą na CDN. Jeden punkt decyzji dla
 * karty mapy i mapy pełnoekranowej.
 */
export async function acquireMapServerForRoute(
  route: MapRoute | null,
): Promise<MapServerLease> {
  if (!routeFitsOfflinePack(route)) {
    return { base: null, release: () => undefined };
  }
  return acquireMapServer();
}
