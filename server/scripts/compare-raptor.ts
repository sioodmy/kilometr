import { gtfsStore } from '../src/gtfs/store';
import { planConnections } from '../src/routing/engine';
import { Connection } from '../src/routing/types';

interface TestRoute {
  name: string;
  from: { title: string; lat: number; lon: number };
  to: { title: string; lat: number; lon: number };
  timeStr: string; // HH:MM
  dayOffsetDays?: number; // 0 = dzisiaj, 1 = jutro itd.
}

function timeStringToSec(timeStr: string): number {
  const [h, m] = timeStr.split(':').map(Number);
  return h * 3600 + m * 60;
}

export async function runTests(routes: TestRoute[]) {
  await gtfsStore.load();

  for (const r of routes) {
    console.log(`\n=============================================================`);
    console.log(`TEST: ${r.name}`);
    console.log(`Skąd: ${r.from.title} (${r.from.lat}, ${r.from.lon})`);
    console.log(`Dokąd: ${r.to.title} (${r.to.lat}, ${r.to.lon})`);
    console.log(`Godzina: ${r.timeStr}, dzień offset: ${r.dayOffsetDays ?? 0}`);
    console.log(`=============================================================`);

    const depSec = timeStringToSec(r.timeStr) + (r.dayOffsetDays ?? 0) * 86400;

    const connections = await planConnections({
      fromTitle: r.from.title,
      fromLat: r.from.lat,
      fromLon: r.from.lon,
      toTitle: r.to.title,
      toLat: r.to.lat,
      toLon: r.to.lon,
      departureTimeSec: depSec,
      maxTransfers: 2,
    });

    if (connections.length === 0) {
      console.log('BRAK TRAS!');
      continue;
    }

    connections.slice(0, 4).forEach((c, idx) => {
      console.log(`\n--- Wariant #${idx + 1} (${c.durationMin} min, przesiadek: ${c.transfers}) ---`);
      console.log(`Odjazd: ${c.departAt} -> Przyjazd: ${c.arriveAt}`);
      for (const leg of c.legs) {
        if (leg.mode === 'walk') {
          console.log(`  🚶 Spacer: ${leg.fromStop} -> ${leg.toStop} (~${leg.walkM}m, ${leg.departAt}-${leg.arriveAt})`);
        } else {
          console.log(`  🚍 Linia ${leg.line} (${leg.mode}) w kierunku "${leg.direction}":`);
          console.log(`     ${leg.fromStop} (${leg.departAt}) -> ${leg.toStop} (${leg.arriveAt}) [przystanków: ${leg.stopsCount}]`);
        }
      }
    });
  }
}

// Jeśli odpalane bezpośrednio
if (require.main === module) {
  const sampleRoutes: TestRoute[] = [
    {
      name: 'Nowy Dwór (Rogowska) -> Plac Grunwaldzki',
      from: { title: 'Rogowska (P+R)', lat: 51.1192, lon: 16.9450 },
      to: { title: 'Plac Grunwaldzki', lat: 51.1118, lon: 17.0601 },
      timeStr: '07:45',
    },
    {
      name: 'Kozanów (Dokerska) -> Rynek / Galeria Dominikańska',
      from: { title: 'Kozanów (Dokerska)', lat: 51.1378, lon: 16.9744 },
      to: { title: 'Galeria Dominikańska', lat: 51.1084, lon: 17.0392 },
      timeStr: '08:15',
    },
    {
      name: 'Gaj (Dierżoniowska / Bardzka) -> Uniwersytet Wrocławski (Gmach Główny)',
      from: { title: 'Gaj - pętla', lat: 51.0805, lon: 17.0494 },
      to: { title: 'Uniwersytet Wrocławski', lat: 51.1142, lon: 17.0345 },
      timeStr: '08:00',
    },
    {
      name: 'Oporów -> Plac Bema',
      from: { title: 'Oporów', lat: 51.0827, lon: 16.9664 },
      to: { title: 'Plac Bema', lat: 51.1165, lon: 17.0421 },
      timeStr: '14:30',
    },
    {
      name: 'Krzyki -> ZOO / Hala Stulecia',
      from: { title: 'Krzyki', lat: 51.0747, lon: 17.0094 },
      to: { title: 'Hala Stulecia', lat: 51.1065, lon: 17.0768 },
      timeStr: '11:00',
    }
  ];

  runTests(sampleRoutes).catch(console.error);
}
