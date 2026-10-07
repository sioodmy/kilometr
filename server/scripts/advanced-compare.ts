import { gtfsStore } from '../src/gtfs/store';
import { planConnections } from '../src/routing/engine';

interface Query {
  name: string;
  fromName: string;
  fromLat: number;
  fromLon: number;
  toName: string;
  toLat: number;
  toLon: number;
  timeStr: string;
}

const advancedQueries: Query[] = [
  {
    name: 'Kozanów -> Gaj (Pętla)',
    fromName: 'Kozanów (Dokerska)',
    fromLat: 51.1378,
    fromLon: 16.9744,
    toName: 'GAJ - pętla',
    toLat: 51.0805,
    toLon: 17.0494,
    timeStr: '07:30',
  },
  {
    name: 'Tarnogaj -> Dworzec Nadodrze',
    fromName: 'Tarnogaj',
    fromLat: 51.0772,
    fromLon: 17.0652,
    toName: 'Dworzec Nadodrze',
    toLat: 51.1235,
    toLon: 17.0315,
    timeStr: '08:15',
  },
  {
    name: 'Kromera -> FAT (Grabiszyńska)',
    fromName: 'Kromera',
    fromLat: 51.1328,
    fromLon: 17.0681,
    toName: 'FAT',
    toLat: 51.0911,
    toLon: 16.9882,
    timeStr: '15:40',
  },
  {
    name: 'Oporów -> Biskupin',
    fromName: 'Oporów',
    fromLat: 51.0827,
    fromLon: 16.9664,
    toName: 'Biskupin',
    toLat: 51.1017,
    toLon: 17.1005,
    timeStr: '14:20',
  },
  {
    name: 'Księże Małe -> Nowy Dwór (Wrocław Nowy Dwór P+R)',
    fromName: 'Księże Małe',
    fromLat: 51.0811,
    fromLon: 17.0852,
    toName: 'Wrocław Nowy Dwór (P+R)',
    toLat: 51.1192,
    toLon: 16.9450,
    timeStr: '07:35',
  },
  {
    name: 'Stabłowice (Główna) -> Galeria Dominikańska',
    fromName: 'Stabłowice',
    fromLat: 51.1550,
    fromLon: 16.8900,
    toName: 'Galeria Dominikańska',
    toLat: 51.1084,
    toLon: 17.0392,
    timeStr: '08:00',
  },
  {
    name: 'Jagodno (Kajdasza) -> Plac Jana Pawła II',
    fromName: 'Kajdasza',
    fromLat: 51.0537,
    fromLon: 17.0570,
    toName: 'Pl. Jana Pawła II',
    toLat: 51.1115,
    toLon: 17.0208,
    timeStr: '08:00',
  }
];

function timeStringToSec(timeStr: string): number {
  const [h, m] = timeStr.split(':').map(Number);
  return h * 3600 + m * 60;
}

async function run() {
  await gtfsStore.load();

  for (const q of advancedQueries) {
    const depSec = timeStringToSec(q.timeStr);
    const conns = await planConnections({
      fromTitle: q.fromName,
      fromLat: q.fromLat,
      fromLon: q.fromLon,
      toTitle: q.toName,
      toLat: q.toLat,
      toLon: q.toLon,
      departureTimeSec: depSec,
      maxTransfers: 2,
    });

    console.log(`\n=============================================================`);
    console.log(`[ADV] ${q.name} | ${q.timeStr}`);
    console.log(`=============================================================`);

    conns.slice(0, 3).forEach((c, idx) => {
      console.log(`\n--- Wariant ${idx + 1} (${c.durationMin} min, przesiadek: ${c.transfers}) ---`);
      console.log(`Czas: ${c.departAt} -> ${c.arriveAt}`);
      for (const l of c.legs) {
        if (l.mode === 'walk') {
          console.log(`  🚶 Spacer: ${l.fromStop} -> ${l.toStop} (~${l.walkM}m, ${l.departAt}-${l.arriveAt})`);
        } else {
          console.log(`  🚊 [${l.line}] ${l.fromStop} (${l.departAt}) -> ${l.toStop} (${l.arriveAt}) [${l.stopsCount} przyst., kier. "${l.direction}"]`);
        }
      }
    });
  }
}

run().catch(console.error);
