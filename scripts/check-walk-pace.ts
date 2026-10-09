import { createWalkEpisodeMachine, type WalkSampleOut } from '../src/services/walkEpisode';

const LAT = 51.1079;
// Jeden stopień szerokości to ok. 111,195 m (kosinus dotyczy długości, nie szerokości).
const MPD = 111_195;
const failures: string[] = [];
const eq = (name: string, got: unknown, want: unknown) => {
  const pass = got === want;
  if (!pass) failures.push(name);
  console.log(pass ? 'ok   ' + name : 'FAIL ' + name + ' got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want));
};
const round = (n: number | undefined) => (n == null ? null : Math.round(n * 100) / 100);
/** Blisko, z tolerancją 1% (GPS nie daje idealnych metrów). */
const near = (name: string, got: number | undefined, want: number) => {
  const pass = got != null && Math.abs(got - want) <= want * 0.01;
  if (!pass) failures.push(name);
  console.log(pass ? 'ok   ' + name : 'FAIL ' + name + ' got=' + JSON.stringify(round(got)) + ' want~=' + want);
};

/** Spacer z jednym, ciągłym stanem: pozycja przechodzi między krokami. */
class Walker {
  lat = LAT;
  clock = 1_700_000_000_000;
  readonly m = createWalkEpisodeMachine(this.clock);
  readonly samples: WalkSampleOut[] = [];

  begin(dest: string) {
    this.m.begin(dest, LAT, 17.03);
  }
  /** Idziemy w linii prostej na północ. */
  walk(seconds: number, speedMps: number, opts: { vehicle?: boolean; osSpeed?: number | null; mocked?: boolean; accuracyM?: number } = {}) {
    for (let i = 0; i < Math.floor(seconds / 3); i++) {
      this.lat += (speedMps * 3) / MPD;
      this.clock += 3000;
      this.push(this.m.feed({
        lat: this.lat, lon: 17.03, ts: this.clock,
        accuracyM: opts.accuracyM ?? 5,
        speedMps: opts.osSpeed === undefined ? speedMps : opts.osSpeed,
        mocked: opts.mocked === true,
      }, opts.vehicle === true));
    }
  }
  /** Stoimy, ewentualnie z dryfem GPS o +/- driftM. */
  stand(seconds: number, driftM = 0) {
    for (let i = 0; i < Math.floor(seconds / 3); i++) {
      this.lat += (i % 2 === 0 ? driftM : -driftM) / MPD;
      this.clock += 3000;
      this.push(this.m.feed({ lat: this.lat, lon: 17.03, ts: this.clock, accuracyM: 5, speedMps: 0, mocked: false }, false));
    }
  }
  /** Jednorazowy fix, np. skok albo mock. */
  fix(lat: number, opts: { mocked?: boolean; accuracyM?: number; speedMps?: number | null } = {}) {
    this.clock += 3000;
    this.lat = lat;
    this.push(this.m.feed({ lat: this.lat, lon: 17.03, ts: this.clock, accuracyM: opts.accuracyM ?? 5, speedMps: opts.speedMps ?? null, mocked: opts.mocked === true }, false));
  }
  /** Zmiana zdania co do przystanku (przesiadka). */
  retarget(dest: string) {
    this.push(this.m.begin(dest, LAT, 17.03));
  }
  end() {
    const s = this.m.end();
    return s;
  }
  private push(s: WalkSampleOut | null) {
    if (s) this.samples.push(s);
  }
}

// 1. Czyste dojście
{
  const w = new Walker();
  w.begin('HALDENA');
  w.walk(300, 1.4);
  const s = w.end();
  eq('czyste dojście zapisane', s !== null, true);
  near('tempo czystego dojścia', s?.speedMps, 1.4);
  near('dystans czystego dojścia', s?.distanceM, 420);
  eq('czas czystego dojścia', s?.durationSec, 300);
}

// 2. Światła zostają w próbce
{
  const w = new Walker();
  w.begin('HALDENA');
  w.walk(180, 1.4);
  w.stand(40);
  w.walk(90, 1.4);
  const s = w.end();
  eq('światła nie rozcinają dojścia', s !== null, true);
  near('postoj wchodzi w tempo efektywne', s?.speedMps, 1.4 * (270 / 310));
  eq('jeden kawałek po światłach', w.samples.length, 0);
}

// 3. Sklep: 15 minut postoju nie psuje tempa okolicy
{
  const w = new Walker();
  w.begin('HALDENA');
  w.walk(400, 1.4);
  w.stand(900);
  eq('sklep rozcinia epizod dokładnie raz', w.samples.length, 1);
  near('próbka przed sklepem ma czyste tempo', w.samples[0]?.speedMps, 1.4);
  near('próbka przed sklepem to 560 m', w.samples[0]?.distanceM, 560);
  w.walk(180, 1.4);
  const s = w.end();
  eq('dojście po sklepie zapisane osobno', s !== null, true);
  near('dojście po sklepie ma czyste tempo', s?.speedMps, 1.4);
  eq('oba kawałki mają ten sam cel', w.samples[0]?.dest === s?.dest, true);
  eq('razem trzy kawałki po sklepie', w.samples.length, 1);
}

// 4. Rezygnacja z kursu w trakcie dojścia
{
  const w = new Walker();
  w.begin('HALDENA');
  w.walk(25, 1.4);
  eq('krótki kawałek odpada', w.end(), null);
}
{
  const w = new Walker();
  w.begin('HALDENA');
  w.walk(180, 1.4);
  eq('prawdziwy spacer bez dojścia zapisuje się', w.end() !== null, true);
}

// 5. Kliknięte śledzenie i zostawione w domu
{
  const w = new Walker();
  w.begin('HALDENA');
  w.stand(600);
  eq('stanie w miejscu nie zapisuje się', w.end(), null);
}

// 6. Dryf GPS stojąc nie udaje spaceru
{
  const w = new Walker();
  w.begin('HALDENA');
  w.stand(300, 2);
  eq('dryf GPS stojąc nie zapisuje się', w.end(), null);
}

// 7. Tramwaj nie wchodzi do statystyki (dwa niezależne filtry)
{
  const w = new Walker();
  w.begin('HALDENA');
  w.walk(200, 8, { vehicle: false, osSpeed: 12 });
  eq('prędkość systemowa odcina pojazd', w.end(), null);
}
{
  const w = new Walker();
  w.begin('HALDENA');
  w.walk(200, 1.4, { vehicle: true });
  eq('koprocesor ruchu odcina pojazd', w.end(), null);
}

// 8. Skok fixu, mock, słaba dokładność
{
  const w = new Walker();
  w.begin('HALDENA');
  w.walk(150, 1.4);
  w.fix(w.lat + 5000 / MPD);
  near('skok fixu nie dopisuje metrów', w.end()?.speedMps, 210 / 153);
}
{
  const w = new Walker();
  w.begin('HALDENA');
  w.walk(200, 1.4, { mocked: true });
  eq('sam mock nie zapisuje się', w.end(), null);
}
{
  const w = new Walker();
  w.begin('HALDENA');
  w.walk(200, 1.4, { accuracyM: 60 });
  eq('fix o niskiej dokładności nie zapisuje się', w.end(), null);
}

// 9. Przesiadka: nowy cel, stare dojście zamknięte
{
  const w = new Walker();
  w.begin('HALDENA');
  w.walk(200, 1.4);
  w.retarget('SWOBODNA');
  near('zmiana przystanku zamyka dojście', w.samples[0]?.speedMps, 1.4);
  eq('zamknięta próbka ma stary cel', w.samples[0]?.dest, 'HALDENA');
  w.walk(200, 1.4);
  const s = w.end();
  eq('drugie dojście ma nowy cel', s?.dest, 'SWOBODNA');
  near('drugie dojście zapisane', s?.speedMps, 1.4);
}

// 10. Powtórne ticki nie zamykają dojścia
{
  const w = new Walker();
  w.begin('HALDENA');
  w.m.begin('HALDENA', LAT, 17.03);
  w.m.begin('HALDENA', LAT, 17.03);
  w.walk(200, 1.4);
  eq('powtórne ticki nie zamykają dojścia', w.end() !== null, true);
}

// 11. Obchód dłuższy niż limit ucina się w kawałki
{
  const w = new Walker();
  w.begin('HALDENA');
  w.walk(1300, 1.4);
  const s = w.end();
  const all = [...w.samples, ...(s ? [s] : [])];
  eq('obchód 21 min zapisuje się w kawałkach', all.length >= 2, true);
  eq('żaden kawałek nie przekracza limitu', all.every((x) => x.durationSec <= 910), true);
  eq('każdy kawałek ma czyste tempo', all.every((x) => round(x.speedMps) === 1.4), true);
}

// 12. Zygzak przed przystankiem przechodzi (to wciąż dojście, nie dryf)
{
  const w = new Walker();
  w.begin('HALDENA');
  for (let i = 0; i < 120; i++) {
    w.lat += (1.4 * 3) / MPD;
    w.clock += 3000;
    const lon = 17.03 + ((i % 2 === 0 ? 0.6 : -0.6) / (MPD * 0.628));
    w.m.feed({ lat: w.lat, lon, ts: w.clock, accuracyM: 5, speedMps: 1.4, mocked: false }, false);
  }
  eq('chód ze wahaniem GPS przed przystankiem przechodzi', w.end() !== null, true);
}

// 13. Teleport w tył (zepsuty fix) nie udaje długiego spaceru
{
  const w = new Walker();
  w.begin('HALDENA');
  w.walk(300, 1.4);
  w.fix(LAT);
  eq('teleport w tył nie zapisuje się jako dojście', w.end(), null);
}

console.log('\n' + (failures.length === 0 ? 'WSZYSTKO OK, zero porażek' : 'PORAŻKI: ' + failures.join(', ')));
