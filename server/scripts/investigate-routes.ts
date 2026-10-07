import { gtfsStore } from '../src/gtfs/store';
import { planConnections } from '../src/routing/engine';

interface Query {
  id: string;
  name: string;
  fromName: string;
  fromLat: number;
  fromLon: number;
  toName: string;
  toLat: number;
  toLon: number;
  timeStr: string;
  dayOffset: number; // 0 = wtorek 06.10, 1 = środa itd.
}

const queries: Query[] = [
  {
    id: 'q1',
    name: 'Biskupin -> Nowy Dwór (Krośnieńska / Nowodworska)',
    fromName: 'Biskupin',
    fromLat: 51.1017,
    fromLon: 17.1005,
    toName: 'Nowy Dwór (Rogowska)',
    toLat: 51.1192,
    toLon: 16.9450,
    timeStr: '08:10',
    dayOffset: 0,
  },
  {
    id: 'q2',
    name: 'Królewiecka (Maślice) -> Plac Grunwaldzki',
    fromName: 'Królewiecka',
    fromLat: 51.1500,
    fromLon: 16.9400,
    toName: 'Plac Grunwaldzki',
    toLat: 51.1118,
    toLon: 17.0601,
    timeStr: '07:50',
    dayOffset: 0,
  },
  {
    id: 'q3',
    name: 'Klecina (Partynicka) -> Rynek (Świdnicka / Plac Solny)',
    fromName: 'Partynicka',
    fromLat: 51.0690,
    fromLon: 17.0010,
    toName: 'Rynek',
    toLat: 51.1095,
    toLon: 17.0315,
    timeStr: '08:20',
    dayOffset: 0,
  },
  {
    id: 'q4',
    name: 'Ołtaszyn (Zwycięska) -> Dworzec Główny',
    fromName: 'Zwycięska',
    fromLat: 51.0610,
    fromLon: 17.0250,
    toName: 'Dworzec Główny',
    toLat: 51.0990,
    toLon: 17.0360,
    timeStr: '07:40',
    dayOffset: 0,
  },
  {
    id: 'q5',
    name: 'Psie Pole (Kiełczowska) -> Politechnika (C-13 / Plac Grunwaldzki)',
    fromName: 'Kiełczowska (Rynek)',
    fromLat: 51.1510,
    fromLon: 17.1190,
    toName: 'Most Grunwaldzki / Kampus PWr',
    toLat: 51.1090,
    toLon: 17.0540,
    timeStr: '08:05',
    dayOffset: 0,
  },
  {
    id: 'q6',
    name: 'Kozanów (Dokerska) -> Dworzec Nadodrze',
    fromName: 'Dokerska',
    fromLat: 51.1378,
    fromLon: 16.9744,
    toName: 'Dworzec Nadodrze',
    toLat: 51.1235,
    toLon: 17.0315,
    timeStr: '15:15',
    dayOffset: 0,
  },
  {
    id: 'q7',
    name: 'Muchobór Wielki (Stanisławowska) -> Plac Dominikański',
    fromName: 'Stanisławowska',
    fromLat: 51.1050,
    fromLon: 16.9350,
    toName: 'Galeria Dominikańska',
    toLat: 51.1084,
    toLon: 17.0392,
    timeStr: '16:45',
    dayOffset: 0,
  },
  {
    id: 'q8',
    name: 'Gaj (Świeradowska) -> Hala Targowa / Ostrów Tumski',
    fromName: 'Gaj (Świeradowska)',
    fromLat: 51.0820,
    fromLon: 17.0450,
    toName: 'Hala Targowa',
    toLat: 51.1120,
    toLon: 17.0400,
    timeStr: '12:00',
    dayOffset: 0,
  },
  {
    id: 'q9',
    name: 'Poświętne (Kamieńskiego) -> Arkady / Powstańców Śląskich',
    fromName: 'Kamieńskiego',
    fromLat: 51.1450,
    fromLon: 17.0350,
    toName: 'Arkady (Capitol)',
    toLat: 51.1008,
    toLon: 17.0298,
    timeStr: '09:10',
    dayOffset: 0,
  }
];

function timeStringToSec(timeStr: string): number {
  const [h, m] = timeStr.split(':').map(Number);
  return h * 3600 + m * 60;
}

async function main() {
  await gtfsStore.load();

  for (const q of queries) {
    const depSec = timeStringToSec(q.timeStr) + q.dayOffset * 86400;
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

    console.log(`\n======================================================`);
    console.log(`[${q.id}] ${q.name} | ${q.timeStr}`);
    console.log(`======================================================`);

    if (!conns.length) {
      console.log('Brak połączeń');
      continue;
    }

    conns.slice(0, 3).forEach((c, idx) => {
      console.log(`-> Wariant ${idx + 1}: ${c.departAt} -> ${c.arriveAt} (${c.durationMin} min), przesiadek: ${c.transfers}`);
      for (const l of c.legs) {
        if (l.mode === 'walk') {
          console.log(`   🚶 Spacer: ${l.fromStop} -> ${l.toStop} (${l.walkM}m, ${l.departAt}-${l.arriveAt})`);
        } else {
          console.log(`   🚊 [${l.line}] ${l.fromStop} (${l.departAt}) -> ${l.toStop} (${l.arriveAt}) [${l.stopsCount} przyst., kier. ${l.direction}]`);
        }
      }
    });
  }
}

main().catch(console.error);
