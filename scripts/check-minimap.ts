// Render miniapki do SVG na hoście i sprawdzenie kadrowania: skala,
// obrót kompasem i to, że strzałka manewru nie wypada poza kwadrat.
// Zero React Native — powtarzamy dokładnie matematykę z NavMiniMap.tsx.

const FOOT = 'https://routing.openstreetmap.de/routed-foot';
const CAR = 'https://router.project-osrm.org';

type Coord = [number, number];

async function fetchRoute(base: string, profile: string, pts: Coord[]): Promise<Coord[]> {
  const p = pts.map(([la, lo]) => `${lo.toFixed(6)},${la.toFixed(6)}`).join(';');
  const r = await fetch(`${base}/route/v1/${profile}/${p}?overview=full&geometries=geojson`);
  const b = (await r.json()) as { routes: { geometry: { coordinates: [number, number][] } }[] };
  return b.routes[0].geometry.coordinates.map(([lo, la]) => [la, lo] as Coord);
}

function toRad(d: number) {
  return (d * Math.PI) / 180;
}
function toMeters(origin: Coord, p: Coord) {
  const kx = Math.cos(toRad(origin[0])) * 111320;
  return { x: (p[1] - origin[1]) * kx, y: -(p[0] - origin[0]) * 111320 };
}

/** Dokładnie jak w NavMiniMap. */
function layout(path: Coord[], user: Coord, headingDeg: number | null, size: number) {
  const c = size / 2;
  const pts = path.map((p) => toMeters(user, p));
  const maxExtent = Math.max(30, ...pts.map((p) => Math.max(Math.abs(p.x), Math.abs(p.y))));
  const scale = (c - 14) / maxExtent;
  const rot = headingDeg == null ? 0 : -headingDeg;
  const cos = Math.cos(toRad(rot));
  const sin = Math.sin(toRad(rot));
  const project = (p: { x: number; y: number }) => {
    const rx = p.x * cos - p.y * sin;
    const ry = p.x * sin + p.y * cos;
    return { x: c + rx * scale, y: c + ry * scale };
  };
  return { pts, project, scale, maxExtent, c };
}

let failures = 0;
function check(label: string, cond: boolean, detail = '') {
  if (cond) console.log(`  PASS ${label}${detail ? `: ${detail}` : ''}`);
  else {
    console.log(`  FAIL ${label}${detail ? `: ${detail}` : ''}`);
    failures++;
  }
}

(async () => {
  console.log('=== Miniapka: kadrowanie i obrot ===');

  const user: Coord = [51.1035, 17.0425];
  const path = await fetchRoute(FOOT, 'foot', [
    user,
    [51.1052, 17.0381],
    [51.1078, 17.0392],
  ]);
  const size = 124;
  console.log(`  sciezka: ${path.length} pkt`);

  // 1. Bez kompasu (północ w górze): nic nie wychodzi poza kwadrat.
  for (const h of [null, 0, 45, 90, 180, 270, 359]) {
    const { project, maxExtent, scale } = layout(path, user, h, size);
    const screen = pts(path, project);
    const outside = screen.filter((p) => p.x < 0 || p.y < 0 || p.x > size || p.y > size);
    check(
      `obrót ${h === null ? 'brak' : h + '°'}: wszystko w kadrze`,
      outside.length === 0,
      `skala ${scale.toFixed(3)}, kadr ±${maxExtent.toFixed(0)} m, poza: ${outside.length}`,
    );
  }

  // 2. Użytkownik zawsze w centrum.
  {
    const { project, c } = layout(path, user, 137, size);
    const me = project(toMeters(user, user));
    check('użytkownik w centrum', Math.abs(me.x - c) < 0.01 && Math.abs(me.y - c) < 0.01);
  }

  // 3. Kadrowanie nie zależy od tego, ile trasy jest blisko: krótki kawałek
  //    nie może rozciągać się do megapiksela, długi nie wychodzić poza kadr.
  {
    const short = path.slice(0, 3);
    const { maxExtent } = layout(short, user, 0, size);
    check('krótki kawałek nie rozpycha skali', maxExtent < 400, `kadr ±${maxExtent.toFixed(0)} m`);

    const long = await fetchRoute(CAR, 'driving', [
      [51.1035, 17.0425],
      [51.1250, 17.0560],
    ]);
    const { maxExtent: farExtent } = layout(long, user, 0, size);
    check('daleki końiec daje szeroki kadr', farExtent > 1500, `kadr ±${farExtent.toFixed(0)} m`);
  }

  // 4. Obrót kompasem: góra mapy pokazuje kierunek, w który PATRZYSZ.
//    Stoisz na wschód (kurs 90°) → punkt na północ ląduje po lewej,
//    bo północ jest wtedy na Twojej lewej ręce.
  {
    const north: Coord = [user[0] + 0.001, user[1]];
    const headingOf = (h: number) => layout([user, north], user, h, size).project(toMeters(user, north));
    const mid = size / 2;
    const h0 = headingOf(0);
    const h90 = headingOf(90);
    const h180 = headingOf(180);
    const h270 = headingOf(270);
    check('kurs 0° (północ): północ na górze', h0.y < mid - 5, `y=${h0.y.toFixed(0)}`);
    check('kurs 90° (wschód): północ po lewej', h90.x < mid - 5, `x=${h90.x.toFixed(0)}`);
    check('kurs 180° (południe): północ na dole', h180.y > mid + 5, `y=${h180.y.toFixed(0)}`);
    check('kurs 270° (zachód): północ po prawej', h270.x > mid + 5, `x=${h270.x.toFixed(0)}`);
  }

  // 4b. Punkt DOKŁADNIE przed Tobą (w Twoim kierunku) musi być na górze
  //     niezależnie od kursu. To jest sedno „kalibracji kompasem”.
  {
    for (const h of [0, 37, 90, 180, 275, 359]) {
      const rad = toRad(h);
      // Przesuwamy się o ~100 m w azymucie = kursie.
      const kx = Math.cos(toRad(user[0])) * 111320;
      const ahead: Coord = [user[0] + (100 * Math.cos(rad)) / 111320, user[1] + (100 * Math.sin(rad)) / kx];
      const p = layout([user, ahead], user, h, size).project(toMeters(user, ahead));
      check(`kurs ${h}°: punkt przed Tobą na górze`, p.y < size / 2 - 5, `y=${p.y.toFixed(0)}`);
    }
  }

  // 5. Strzałka manewru zawsze wewnątrz.
  {
    for (const target of [path[2], path[path.length - 1], user]) {
      const { project, c } = layout(path, user, 64, size);
      const t = project(toMeters(user, target));
      const ok = t.x >= 0 && t.x <= size && t.y >= 0 && t.y <= size;
      check('cel manewru w kadrze', ok, `(${t.x.toFixed(0)}, ${t.y.toFixed(0)})`);
    }
  }

  function pts(path2: Coord[], project: (p: { x: number; y: number }) => { x: number; y: number }) {
    return path2.map((p) => project(toMeters(user, p)));
  }

  console.log(`\n${failures === 0 ? 'OK: kadrowanie miniapki poprawne' : `BLEDY: ${failures}`}`);
  process.exit(failures === 0 ? 0 : 1);
})();