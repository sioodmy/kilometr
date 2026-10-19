export interface RawLocationFix {
  lat: number;
  lon: number;
  accuracy: number | null;
  speed: number | null;
  heading: number | null;
  timestamp: number;
}

export interface FilteredLocationFix {
  lat: number;
  lon: number;
  accuracy: number | null;
  speed: number | null;
  heading: number | null;
  timestamp: number;
}

export interface LocationFilterState {
  current: FilteredLocationFix | null;
  varM2: number;
  pendingJump: RawLocationFix | null;
  anchorLat?: number;
  anchorLon?: number;
  fixCount?: number;
}

export function createLocationFilterState(): LocationFilterState {
  return {
    current: null,
    varM2: 196,
    pendingJump: null,
    anchorLat: undefined,
    anchorLon: undefined,
    fixCount: 0,
  };
}

function distanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = (lat2 - lat1) * 111320;
  const dLon = (lon2 - lon1) * 111320 * Math.cos(toRad((lat1 + lat2) * 0.5));
  return Math.hypot(dLat, dLon);
}

function bearingDegrees(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = lat2 - lat1;
  const dLon = (lon2 - lon1) * Math.cos(toRad((lat1 + lat2) * 0.5));
  return ((Math.atan2(dLon, dLat) * 180) / Math.PI + 360) % 360;
}

function normalizeHeading(heading: number | null, speed: number | null): number | null {
  if (heading == null || !Number.isFinite(heading) || heading < 0) return null;
  // Poniżej 0.8 m/s kurs z GPS to losowy dryf.
  if (speed != null && speed < 0.8) return null;
  return ((heading % 360) + 360) % 360;
}

/**
 * Filtr Kalmana 2D z bramką anty-multipath i strefą martwą w postoju.
 * Odrzuca pojedyncze odbicia sygnału od zabudowy i wygasza pływanie pozycji na światłach.
 */
export function filterLocationFix(
  state: LocationFilterState,
  raw: RawLocationFix,
): FilteredLocationFix | null {
  if (!Number.isFinite(raw.lat) || !Number.isFinite(raw.lon)) {
    return state.current;
  }

  const acc =
    raw.accuracy != null && Number.isFinite(raw.accuracy) && raw.accuracy > 0
      ? Math.max(3, raw.accuracy)
      : 14;
  const speed =
    raw.speed != null && Number.isFinite(raw.speed) && raw.speed >= 0 ? raw.speed : null;
  const heading = normalizeHeading(raw.heading, speed);

  const resetToRaw = (): FilteredLocationFix => {
    const fix: FilteredLocationFix = {
      lat: raw.lat,
      lon: raw.lon,
      accuracy: Math.round(acc * 10) / 10,
      speed,
      heading,
      timestamp: raw.timestamp,
    };
    state.current = fix;
    state.varM2 = acc * acc;
    state.pendingJump = null;
    state.anchorLat = raw.lat;
    state.anchorLon = raw.lon;
    state.fixCount = (state.fixCount ?? 0) + 1;
    return fix;
  };

  if (!state.current) {
    return resetToRaw();
  }

  const prev = state.current;
  const rawDtMs = raw.timestamp - prev.timestamp;
  const prevAcc = prev.accuracy ?? 15;

  // Pierwszy dokładny fix GPS po grubym odczycie sieciowym (np. z getLastKnownPositionAsync)
  // albo powrót po dłuższej przerwie powinien od razu przestawić filtr.
  if (
    (prevAcc >= 35 && acc <= 20) ||
    acc < prevAcc * 0.5 ||
    (rawDtMs > 30_000 && acc <= 45)
  ) {
    return resetToRaw();
  }

  const dtSec = Math.max(0.2, Math.min(60, rawDtMs / 1000));
  const distM = distanceMeters(prev.lat, prev.lon, raw.lat, raw.lon);

  // Nagły spadek dokładności (np. przełączenie na stację bazową) nie powinien nadpisać świeżego fixu GPS.
  if (acc > 55 && prevAcc <= 25 && dtSec < 15) {
    return prev;
  }

  // Pojedyncze odbicie sygnału w kanionie ulicznym: skok z nienaturalną prędkością wymaga potwierdzenia kolejnym pomiarem.
  const impliedSpeed = distM / dtSec;
  const maxPlausibleSpeed =
    speed != null && speed > 4.5 ? Math.max(22, speed * 2.2) : 6.5;
  const jumpThresholdM = Math.max(18, acc * 1.3);
  const seededStaleFix = (state.fixCount ?? 1) <= 1 && rawDtMs > 3000;

  if (!seededStaleFix && dtSec < 10 && distM > jumpThresholdM && impliedSpeed > maxPlausibleSpeed) {
    const pending = state.pendingJump;
    if (!pending) {
      state.pendingJump = raw;
      return prev;
    }
    const confirmDistM = distanceMeters(pending.lat, pending.lon, raw.lat, raw.lon);
    if (confirmDistM <= Math.max(24, acc * 1.2)) {
      return resetToRaw();
    }
    state.pendingJump = raw;
    return prev;
  }

  state.pendingJump = null;
  state.fixCount = (state.fixCount ?? 1) + 1;

  const qMps = speed != null ? Math.max(0.5, Math.min(8, speed)) : 1.6;
  const predVar = state.varM2 + qMps * dtSec * (qMps * dtSec);
  const measVar = acc * acc;
  let k = predVar / (predVar + measVar);

  // W postoju tłumimy szum wokół punktu zakotwiczenia, ale gdy pieszy wyjdzie poza promień
  // postoju (nawet przy speed === null na Androidzie), odblokowujemy normalne śledzenie.
  const anchorLat = state.anchorLat ?? prev.lat;
  const anchorLon = state.anchorLon ?? prev.lon;
  const anchorDistM = distanceMeters(anchorLat, anchorLon, raw.lat, raw.lon);
  const stationaryRadiusM = Math.max(4.5, Math.min(11, acc * 0.55));
  const isStationary = (speed == null || speed < 0.65) && anchorDistM < stationaryRadiusM;

  if (isStationary) {
    k = Math.min(k, 0.1);
  }

  const nextLat = prev.lat + k * (raw.lat - prev.lat);
  const nextLon = prev.lon + k * (raw.lon - prev.lon);
  state.varM2 = Math.max(4, (1 - k) * predVar);

  if (!isStationary) {
    state.anchorLat = nextLat;
    state.anchorLon = nextLon;
  }

  const stepDistM = distanceMeters(prev.lat, prev.lon, nextLat, nextLon);
  const derivedHeading =
    !isStationary && stepDistM >= 2.0 && acc <= 22
      ? bearingDegrees(prev.lat, prev.lon, nextLat, nextLon)
      : null;

  const nextFix: FilteredLocationFix = {
    lat: nextLat,
    lon: nextLon,
    accuracy: Math.round(Math.sqrt(state.varM2) * 10) / 10,
    speed,
    heading: heading ?? derivedHeading ?? prev.heading,
    timestamp: raw.timestamp,
  };
  state.current = nextFix;
  return nextFix;
}
