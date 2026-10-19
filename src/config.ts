import Constants from 'expo-constants';
import { getCity } from './cities';
import { tr } from './i18n';

function extractHost(candidate?: string | null): string | null {
  if (!candidate) return null;
  const match = candidate.match(/(?:(?:exp|http|https):\/\/)?([^:/]+)/i);
  const host = match ? match[1] : candidate.split(':')[0];
  if (host && host !== 'localhost' && host !== '127.0.0.1' && host !== '::1') {
    return host;
  }
  return null;
}

function getApiUrl(): string {
  if (process.env.EXPO_PUBLIC_API_URL) {
    return process.env.EXPO_PUBLIC_API_URL;
  }

  // When running in Expo Go or dev build over Wi-Fi, extract workstation LAN IP from various properties
  const c = Constants as any;
  const candidates = [
    Constants.expoConfig?.hostUri,
    c.expoGoConfig?.debuggerHost,
    c.manifest?.debuggerHost,
    c.manifest2?.extra?.expoGo?.debuggerHost,
    c.experienceUrl,
    c.linkingUri,
  ];

  for (const cand of candidates) {
    const host = extractHost(cand);
    if (host) {
      return `http://${host}:3000`;
    }
  }

  // Over ADB USB with `adb reverse tcp:3000 tcp:3000`, 127.0.0.1 connects directly to workstation backend
  return 'http://127.0.0.1:3000';
}

export const API_URL = getApiUrl();

// ─── Mapa ────────────────────────────────────────────────────────────────────
// Wektorowe kafelki OSM (schemat OpenMapTiles) z OpenFreeMap: bez klucza API,
// bez limitu zapytań i bez znaków wodnych. Styl ciemny M3 budujemy sami
// (src/map/mapStyle.ts), więc mapa wygląda jak reszta aplikacji.
export const MAP_SOURCE_URL = process.env.EXPO_PUBLIC_MAP_SOURCE_URL ?? 'https://tiles.openfreemap.org/planet';
export const MAP_GLYPHS_URL =
  process.env.EXPO_PUBLIC_MAP_GLYPHS_URL ?? 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';

export const MAP_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>' +
  ' &middot; <a href="https://openmaptiles.org/" target="_blank">OpenMapTiles</a>' +
  ' &middot; <a href="https://openfreemap.org/" target="_blank">OpenFreeMap</a>';

// Geometria ulic (dokładny przebieg kursu). Domyślnie publiczny demo-serwer
// OSRM, nadpisywalny własnym, np. w sieci firmowej.
export const OSRM_BASE_URL = process.env.EXPO_PUBLIC_OSRM_URL ?? 'https://router.project-osrm.org';

// Demo OSRM ma wgrany wyłącznie profil samochodowy: /route/v1/foot odpowiada
// identyczną trasą co driving, tzn. spacer rysowałby się po jezdni. Piesze
// idą osobnym routerem, który rozumie chodniki, przejścia i place.
export const OSRM_FOOT_BASE_URL =
  process.env.EXPO_PUBLIC_OSRM_FOOT_URL ?? 'https://routing.openstreetmap.de/routed-foot';

// Neutralny placeholder zanim GPS zwróci pozycję (prawdziwe współrzędne
// centrum Wrocławia, nie mock danych). Nadpisywany przez LocationService.
// Trzyma tylko geometrię: nazwa i tytuł startu idą ze słownika, więc nie ma
// tu polskiego tekstu, który wypłynąłby do UI innego języka.
// Per-miasto odpowiednik: defaultLocationForCity() niżej.
export const DEFAULT_LOCATION = {
  lat: 51.1079,
  lon: 17.0385,
};

export interface LocationFallback {
  title: string;
  address: string;
  lat: number;
  lon: number;
}

/** Placeholder startowy dla miasta (środek + nazwa, nie mock danych). */
export function defaultLocationForCity(cityId?: string): LocationFallback {
  const city = getCity(cityId);
  // Tekst idzie do „Ostatnich miejsc” i jako zapasowy adres GPS, więc idzie
  // przez słownik (także dla Wrocławia, który jest miastem domyślnym).
  const s = tr();
  return {
    title: s.home.locationFallback,
    address: s.city.name(city.id),
    lat: city.center.lat,
    lon: city.center.lon,
  };
}
