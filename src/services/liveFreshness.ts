const VEHICLE_MAX_AGE_MS = 90_000;

/** Sprawdza wiek pomiaru pojazdu, niezależnie od powodzenia ostatniego polla. */
export function vehicleIsFresh(at: number, now = Date.now()): boolean {
  return Number.isFinite(at) && at > 0 && at <= now && now - at <= VEHICLE_MAX_AGE_MS;
}
