import { decodeSharedConnection } from './connection';

/** Obsługuje nowe linki, stare fragmenty i powrót z powiadomienia. */
export function sharedTripPath(path: string): string | null {
  try {
    const url = new URL(path, 'https://kilometr.app');
    const custom = url.protocol === 'kilometr:';
    if (!custom && (url.protocol !== 'https:' || url.hostname !== 'kilometr.app')) return null;
    const route = custom ? `/${url.hostname}${url.pathname}` : url.pathname;
    if (!['/', '/trip', '/trip/', '/shared'].includes(route)) return null;
    const fragment = new URLSearchParams(url.hash.slice(1));
    const trip = fragment.get('trip') ?? url.searchParams.get('trip');
    if (trip === null && !route.startsWith('/trip') && route !== '/shared') return null;
    return trip && decodeSharedConnection(trip) ? `/shared?trip=${trip}` : '/shared';
  } catch {
    return null;
  }
}
