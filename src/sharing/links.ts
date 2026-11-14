import { decodeSharedConnection, extractShareTripToken } from './connection';

/** Obsługuje krótkie linki /t#<token>, #t=<token> oraz powrót z powiadomienia. */
export function sharedTripPath(path: string): string | null {
  try {
    const url = new URL(path, 'https://kilometr.app');
    const custom = url.protocol === 'kilometr:';
    if (!custom && (url.protocol !== 'https:' || url.hostname !== 'kilometr.app')) return null;
    const route = custom ? `/${url.hostname}${url.pathname}` : url.pathname;
    if (!['/', '/t', '/t/', '/shared'].includes(route)) return null;
    const isShortRoute = route === '/t' || route === '/t/';
    const hashParsed = extractShareTripToken(url.hash);
    const hasExplicitHashKey = url.hash.startsWith('#t=') || url.hash.startsWith('#trip=');
    const trip =
      (isShortRoute || route === '/shared' || hasExplicitHashKey ? hashParsed.trip : null) ??
      url.searchParams.get('trip') ??
      url.searchParams.get('t');
    if (trip === null && !isShortRoute && route !== '/shared') return null;
    return trip && decodeSharedConnection(trip) ? `/shared?trip=${trip}` : '/shared';
  } catch {
    return null;
  }
}
