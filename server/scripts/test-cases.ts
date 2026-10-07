import { gtfsStore } from '../src/gtfs/store';
import { planConnections } from '../src/routing/engine';

async function testCases() {
  await gtfsStore.load();

  // Test Case A: Dwupunktowy węzeł przesiadkowy - czy Jakdojade każe się przesiadać z tramwaju na autobus na 2 przystanki?
  // Skąd: Gaj (Krynicka) -> Ołbina / Nowowiejska
  // Skąd: Klecina -> Plac Grunwaldzki
  // Skąd: Nowy Dwór -> Dworzec Nadodrze
  // Skąd: Jagodno -> Rynek
  // Skąd: Kozanów -> Plac Legionów

  const cases = [
    {
      name: 'Klecina (Wałbrzyska) -> Plac Grunwaldzki',
      from: { title: 'Wałbrzyska', lat: 51.0650, lon: 16.9950 },
      to: { title: 'Plac Grunwaldzki', lat: 51.1118, lon: 17.0601 },
      timeStr: '08:00'
    },
    {
      name: 'Nowy Dwór (Centrum Handlowe) -> Dworzec Nadodrze',
      from: { title: 'Nowy Dwór (stacja kolejowa)', lat: 51.1160, lon: 16.9480 },
      to: { title: 'Dworzec Nadodrze', lat: 51.1235, lon: 17.0315 },
      timeStr: '08:30'
    },
    {
      name: 'Biskupin -> Rynek (Świdnicka)',
      from: { title: 'Biskupin', lat: 51.1017, lon: 17.1005 },
      to: { title: 'Rynek', lat: 51.1095, lon: 17.0315 },
      timeStr: '16:00'
    },
    {
      name: 'Sępolno -> Sky Tower',
      from: { title: 'Sępolno', lat: 51.1150, lon: 17.0980 },
      to: { title: 'Sky Tower (Wielka)', lat: 51.0940, lon: 17.0200 },
      timeStr: '08:00'
    }
  ];

  for (const c of cases) {
    const [h, m] = c.timeStr.split(':').map(Number);
    const depSec = h * 3600 + m * 60;
    const conns = await planConnections({
      fromTitle: c.from.title,
      fromLat: c.from.lat,
      fromLon: c.from.lon,
      toTitle: c.to.title,
      toLat: c.to.lat,
      toLon: c.to.lon,
      departureTimeSec: depSec,
      maxTransfers: 2,
    });

    console.log(`\n======================================================`);
    console.log(`CASE: ${c.name} [${c.timeStr}]`);
    console.log(`======================================================`);
    conns.slice(0, 3).forEach((conn, i) => {
      console.log(`\nOpis #${i+1}: ${conn.departAt} -> ${conn.arriveAt} (${conn.durationMin}m, przesiadki: ${conn.transfers})`);
      conn.legs.forEach(l => {
        if (l.mode === 'walk') {
          console.log(`   🚶 Spacer: ${l.fromStop} -> ${l.toStop} (${l.walkM}m, ${l.departAt}-${l.arriveAt})`);
        } else {
          console.log(`   🚍 [${l.line}] ${l.fromStop} (${l.departAt}) -> ${l.toStop} (${l.arriveAt}) [${l.stopsCount} st., kierunek: ${l.direction}]`);
        }
      });
    });
  }
}

testCases().catch(console.error);
