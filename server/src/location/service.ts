import { gtfsStore } from '../gtfs/store';
import { config } from '../config';

export interface LocationInfo {
  title: string;
  address: string;
  lat: number;
  lon: number;
  stopId?: string;
}

export async function reverseGeocodeLocation(lat: number, lon: number): Promise<LocationInfo> {
  await gtfsStore.load();

  // 1. Check if user is right next to an MPK stop (< 200m)
  const nearest = gtfsStore.findNearestStops(lat, lon, 200, 1);
  if (nearest.length > 0 && nearest[0].distanceM <= 150) {
    const s = nearest[0].stop;
    return {
      title: s.stop_name,
      address: `Przystanek MPK • ${s.stop_code ? `słup. ${s.stop_code}` : 'Wrocław'}`,
      lat: s.stop_lat,
      lon: s.stop_lon,
      stopId: s.stop_id,
    };
  }

  // 2. Try Nominatim reverse geocode
  try {
    const url = new URL(config.nominatim.reverseUrl);
    url.searchParams.set('lat', String(lat));
    url.searchParams.set('lon', String(lon));
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('accept-language', 'pl');

    const res = await fetch(url.toString(), {
      headers: {
        'User-Agent': config.nominatim.userAgent,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(4000),
    });

    if (res.ok) {
      const data = (await res.json()) as any;
      const road = data.address?.road;
      const houseNumber = data.address?.house_number;
      const suburb = data.address?.suburb || data.address?.neighbourhood || 'Wrocław';

      if (road) {
        const title = houseNumber ? `${road} ${houseNumber}` : road;
        return {
          title,
          address: `${suburb}, Wrocław`,
          lat,
          lon,
          stopId: nearest[0]?.stop.stop_id,
        };
      }
    }
  } catch (err) {
    console.warn('[Location Service] Reverse geocode warning:', err);
  }

  // Fallback to nearest stop or generic title
  if (nearest.length > 0) {
    return {
      title: nearest[0].stop.stop_name,
      address: 'Wrocław • Blisko przystanku',
      lat,
      lon,
      stopId: nearest[0].stop.stop_id,
    };
  }

  return {
    title: 'Twoja lokalizacja',
    address: 'Wrocław',
    lat,
    lon,
  };
}
