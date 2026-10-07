/**
 * Porównanie RAPTOR (nasz silnik) z jakdojade.pl.
 *
 * Uruchomienie:
 *   npx tsx scripts/compare-jakdojade.ts
 *
 * Dla każdej pary OD × (dzień, godzina) pobiera:
 *   - wynik API jakdojade (POST /api/jd/v3/routes)
 *   - wynik naszego planConnections()
 * i drukuje tabelę z różnicami (czas, przesiadki, linie).
 *
 * UWAGA: klient jakdojade podpisuje requesty HMAC-SHA512 kluczem z konta
 * testowego (login/hasło w /tmp/opencode/kd/creds.json) — sekrety NIE trafiają do repo.
 */
import { gtfsStore } from '../src/gtfs/store';
import { planConnections } from '../src/routing/engine';

// @ts-expect-error - prosty klient ESM spoza src
import * as kd from '/tmp/opencode/kd/kd.mjs';

export interface Case {
  name: string;
  fromQuery: string;   // zapytanie do wyszukiwarki jakdojade (nazwa przystanku)
  toQuery: string;
  dateTime: string;    // ISO, np. '2026-10-07T07:45:00+02:00'
  maxTransfers?: number;
}

interface Resolved { loc: any; label: string }

async function resolve(query: string): Promise<Resolved> {
  const r = await kd.searchLocation(query);
  if (r.status !== 200 || !r.json?.locations?.length) throw new Error(`brak lokalizacji: ${query} (${r.status})`);
  const locs = r.json.locations;
  // 1) STOP_GROUP o dokładnie tej nazwie (wielkie litery jak w GTFS), 2) dowolny STOP_GROUP, 3) reszta
  const exact = locs.find((l: any) => l.locationType === 'STOP_GROUP' && l.name === query.toUpperCase());
  const stopGroup = locs.find((l: any) => l.locationType === 'STOP_GROUP');
  const chosen = exact || stopGroup || locs[0];
  if (chosen !== exact && !exact) {
    console.warn(`  [resolve] "${query}" -> "${chosen.name}" (${chosen.subName || chosen.locationType}) — sprawdź czy to ten przystanek`);
  }
  return { loc: chosen, label: `${chosen.name}` };
}

function fmt(iso: string): string {
  // '2026-10-06T21:36:00.000+0200' -> '21:36'
  const m = /T(\d{2}:\d{2})/.exec(iso || '');
  return m ? m[1] : '?';
}

function parseJdRoute(r: any) {
  const parts = r.routeParts || [];
  const legs = parts.map((p: any) => {
    if (p.routePartType !== 'VEHICLE_TRANSPORT') {
      return { mode: 'walk', mins: Math.round((p.durationSeconds || 0) / 60), m: p.routePartDistanceMeters };
    }
    const rs = p.routeVehicle?.routeStops || [];
    const dyn = rs[0]?.lineStop?.lineStopDynamicId || '';
    const line = /lineName:"([^"]+)"/.exec(dyn)?.[1] || '?';
    const dir = rs[rs.length - 1]?.lineStop?.stopPoint?.stopName;
    return {
      mode: 'transit', line, from: rs[0]?.lineStop?.stopPoint?.stopName, to: dir,
      dep: fmt(p.startDeparture?.dateTime), arr: fmt(p.targetArrival?.dateTime),
      stops: rs.length,
    };
  });
  const transitLegs = legs.filter((l: any) => l.mode === 'transit');
  return {
    dep: fmt(parts[0]?.startDeparture?.dateTime),
    arr: fmt(parts[parts.length - 1]?.targetArrival?.dateTime),
    changes: Math.max(0, transitLegs.length - 1),
    lines: transitLegs.map((l: any) => l.line),
    legs,
  };
}

function hmToMin(s: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s || '');
  if (!m) return NaN;
  return Number(m[1]) * 60 + Number(m[2]);
}

function fmtOur(c: any) {
  const legs = c.legs.map((l: any) =>
    l.mode === 'walk'
      ? { mode: 'walk', mins: Math.max(0, hmToMin(l.arriveAt) - hmToMin(l.departAt)), m: l.walkM }
      : { mode: 'transit', line: l.line, from: l.fromStop, to: l.toStop, dep: l.departAt, arr: l.arriveAt, stops: l.stopsCount }
  );
  return { dep: c.departAt, arr: c.arriveAt, changes: c.transfers, lines: legs.filter((l: any) => l.mode === 'transit').map((l: any) => l.line), legs, durationMin: c.durationMin };
}

export async function runCompare(cases: Case[]) {
  await gtfsStore.load();

  const results: any[] = [];

  for (const c of cases) {
    console.log(`\n${'='.repeat(70)}`);
    console.log(`CASE: ${c.name}`);
    console.log(`Skąd: ${c.fromQuery} -> Dokąd: ${c.toQuery} @ ${c.dateTime}`);

    let fromR: Resolved, toR: Resolved;
    try {
      [fromR, toR] = [await resolve(c.fromQuery), await resolve(c.toQuery)];
    } catch (e: any) {
      console.log(`  BŁĄD resolve: ${e.message}`);
      results.push({ case: c, error: e.message });
      continue;
    }
    console.log(`  jd from=${fromR.label} to=${toR.label}`);

    // --- jakdojade ---
    const jdResp = await kd.queryRoutes(fromR.loc, toR.loc, c.dateTime);
    const jdRoutes = (jdResp.json?.routes || []).map(parseJdRoute);

    // --- nasz silnik (te same współrzędne co jd) ---
    const dt = new Date(c.dateTime);
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const dayOffset = Math.round((new Date(dt.getFullYear(), dt.getMonth(), dt.getDate()).getTime() - startOfDay.getTime()) / 86400000);
    const depSec = dt.getHours() * 3600 + dt.getMinutes() * 60 + Math.max(0, dayOffset) * 86400000 / 1000;

    const ours = await planConnections({
      fromTitle: fromR.label, fromLat: fromR.loc.coordinate.y_lat, fromLon: fromR.loc.coordinate.x_lon,
      toTitle: toR.label, toLat: toR.loc.coordinate.y_lat, toLon: toR.loc.coordinate.x_lon,
      departureTimeSec: depSec,
      maxTransfers: c.maxTransfers ?? 3,
    });
    const ourRoutes = ours.map(fmtOur);

    const t = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
    const rel = (d: number, ref: number) => { let x = d - ref; if (x > 12 * 60) x -= 24 * 60; if (x < -12 * 60) x += 24 * 60; return x; };
    const refT = t(c.dateTime.slice(11, 16));
    // Wspólne okno startu dla obu silników: [zapytanie, +120 min]. Nasz silnik
    // potrafi zwrócić kurs wsiadany wiele godzin później (brak górnego limitu
    // wsiadania), a jd limituje listę — bez okna metryka "najlepszy przyjazd"
    // porównywałaby kabły z innego świata.
    const WINDOW_MIN = 120;
    const inWindow = (dep: string) => { const r = rel(t(dep), refT); return r >= -5 && r <= WINDOW_MIN; };
    const jdInWin = jdRoutes.filter((r: any) => inWindow(r.dep));
    const ourInWin = ourRoutes.filter((r: any) => inWindow(r.dep));
    // "Pierwszy wariant" = pierwszy startujący w oknie (niekoniecznie routes[0]
    // naszego silnika, który bywa kursem z odległej godziny).
    const jdB = jdInWin[0] ?? null;
    const ourB = ourInWin[0] ?? null;
    const jdBestArr = jdInWin.length ? Math.min(...jdInWin.map((r: any) => rel(t(r.arr), refT))) : null;
    const ourBestArr = ourInWin.length ? Math.min(...ourInWin.map((r: any) => rel(t(r.arr), refT))) : null;

    if (!jdB && !ourB) { console.log('  BRAK tras w obu silnikach'); results.push({ case: c, jdB: null, ourB: null }); continue; }

    console.log('\n  jakdojade (najlepsza):');
    if (jdB) {
      console.log(`    ${jdB.dep} -> ${jdB.arr} | zmiany: ${jdB.changes} | linie: ${jdB.lines.join(', ')}`);
      jdB.legs.forEach((l: any) => console.log(l.mode === 'walk'
        ? `      🚶 ${l.mins} min (${l.m}m)`
        : `      🚌 ${l.line}: ${l.from} (${l.dep}) -> ${l.to} (${l.arr}) [${l.stops} st.]`));
    } else console.log('    (brak)');

    console.log('  RAPTOR (najlepsza):');
    if (ourB) {
      console.log(`    ${ourB.dep} -> ${ourB.arr} | zmiany: ${ourB.changes} | linie: ${ourB.lines.join(', ')} | ${ourB.durationMin} min`);
      ourB.legs.forEach((l: any) => console.log(l.mode === 'walk'
        ? `      🚶 ${l.mins} min (${l.m}m)`
        : `      🚌 ${l.line}: ${l.from} (${l.dep}) -> ${l.to} (${l.arr}) [${l.stops} st.]`));
    } else console.log('    (brak)');

    // diff: minuty do przyjazdu (im mniej tym lepiej)
    if (jdB && ourB) {
      const delta = rel(t(ourB.arr), refT) - rel(t(jdB.arr), refT);
      const dDep = rel(t(ourB.dep), refT) - rel(t(jdB.dep), refT);
      const dBest = jdBestArr !== null && ourBestArr !== null ? ourBestArr - jdBestArr : null;
      console.log(`  >> pierwszy wariant: przyjazd ${delta > 0 ? '+' : ''}${delta} min, wyjazd ${dDep > 0 ? '+' : ''}${dDep} min; zmiany ${ourB.changes} vs ${jdB.changes}`);
      if (dBest !== null) console.log(`  >> najlepszy przyjazd w ogóle: ${dBest > 0 ? '+' : ''}${dBest} min (jd ${jdInWin.length} w oknie / my ${ourInWin.length})`);
      results.push({ case: c, jdB, ourB, deltaArr: delta, deltaDep: dDep, deltaBest: dBest, jdN: jdInWin.length, ourN: ourInWin.length, jdBestArr, ourBestArr });
    } else if (ourB && !jdB) {
      console.log('  >> jd: BRAK w oknie, RAPTOR: ma połączenie → my lepsi');
      results.push({ case: c, jdB, ourB, deltaArr: null, deltaBest: -999 });
    } else if (jdB && !ourB) {
      console.log('  >> RAPTOR: BRAK w oknie, jd: ma połączenie → my gorsi');
      results.push({ case: c, jdB, ourB, deltaArr: null, deltaBest: 999 });
    } else {
      results.push({ case: c, jdB, ourB, deltaArr: null, deltaBest: jdBestArr !== null && ourBestArr !== null ? ourBestArr - jdBestArr : null });
    }
  }

  // podsumowanie
  console.log(`\n${'='.repeat(70)}\nPODSUMOWANIE (delta najlepszego przyjazdu: RAPTOR - jakdojade, min; ujemne = my lepsi)`);
  const rows = results.filter((r) => r.deltaBest !== null && r.deltaBest !== undefined);
  rows.sort((a, b) => a.deltaBest - b.deltaBest);
  for (const r of rows) {
    console.log(`  ${String(r.deltaBest).padStart(4)} | pierwszy ${String(r.deltaArr ?? '-').padStart(4)} | zmiany ${r.ourB?.changes ?? '-'}/${r.jdB?.changes ?? '-'} | ${r.case.name} @ ${r.case.dateTime}`);
  }
  const wins = rows.filter((r) => r.deltaBest < 0);
  const losses = rows.filter((r) => r.deltaBest > 0);
  console.log(`\n  RAPTOR lepszy: ${wins.length} | gorszy: ${losses.length} | remis: ${rows.length - wins.length - losses.length}`);
  return results;
}

if (require.main === module) {
  const fs = require('node:fs');
  let CASES: Case[] = [];
  if (process.env.CASES_FILE) {
    CASES = JSON.parse(fs.readFileSync(process.env.CASES_FILE, 'utf8'));
  } else {
    CASES = JSON.parse(process.env.CASES_JSON || '[]');
  }
  if (!CASES.length) {
    console.log('Podaj CASES_FILE=sciezka.json albo CASES_JSON=[{name,fromQuery,toQuery,dateTime}]');
    process.exit(1);
  }
  runCompare(CASES).catch((e) => { console.error(e); process.exit(1); });
}
