import { ArrowLeft } from 'lucide-react';
import { BENCHMARK } from '../data';

// ─────────────────────────────────────────────────────────────────────────────
// Podstrona raportu z benchmarku (widok `#raport`). Wszystkie liczby
// z realnych przebiegów harnessa (r4_*.txt, 72 trasy): 46 wygranych,
// 24 remisy, 2 straty poza silnikiem (pociąg KD + dryf rozkładu).
// Celowo jednostronna narracja dla inwestora — ale na prawdziwych danych:
// każda liczba ma pokrycie w outputach, a „porażki" dostają dowody zamiast
// być chowane (wiarygodność sprzedaje lepiej niż same zera).
//
// Donut: SVG z pathLength=100 (63.9 / 33.3 / 2.8), segmenty rosną po wjeździe
// w kadr (CSS vars + scroll-driven keyframes, fallback: pełne od razu).
// ─────────────────────────────────────────────────────────────────────────────

const S = BENCHMARK.sample;

function Delta({ value, suffix = '' }: { value: number; suffix?: string }) {
  const cls = value < 0 ? 'pill-win' : value > 0 ? 'pill-loss' : 'pill-tie';
  const sign = value > 0 ? '+' : '';
  return (
    <span className={`pill ${cls}`}>
      {sign}
      {value}
      {suffix}
    </span>
  );
}

function Stats() {
  const tiles = [
    { n: String(S.n), label: 'tras w teście' },
    { n: String(S.wins), label: 'wygranych z jakdojade' },
    { n: `${S.notWorsePct}%`, label: 'tras nie gorzej' },
    { n: `${S.maxWinMin} min`, label: 'największa przewaga' },
  ];
  return (
    <div className="rp-stats">
      {tiles.map((t) => (
        <div className="rp-stat" key={t.label}>
          <b>{t.n}</b>
          <span>{t.label}</span>
        </div>
      ))}
    </div>
  );
}

function Donut() {
  const segs = [
    { label: 'Wygrane', value: S.wins, total: S.n, cls: 'donut-win' },
    { label: 'Remisy', value: S.ties, total: S.n, cls: 'donut-tie' },
    { label: 'Straty', value: S.losses, total: S.n, cls: 'donut-loss' },
  ];
  let acc = 25;
  return (
    <div className="rp-donut-card">
      <div className="rp-donut-wrap" role="img" aria-label={`Bilans: ${S.wins} wygranych, ${S.ties} remisów, ${S.losses} straty`}>
        <svg viewBox="0 0 120 120" className="rp-donut">
          <circle cx="60" cy="60" r="48" className="donut-track" pathLength={100} />
          {segs.map((s) => {
            const len = (s.value / s.total) * 100;
            const off = acc;
            acc -= len;
            return (
              <circle
                key={s.label}
                cx="60"
                cy="60"
                r="48"
                pathLength={100}
                className={`donut-seg ${s.cls}`}
                style={{ ['--seg' as string]: len.toFixed(2), ['--off' as string]: off.toFixed(2) }}
                strokeDasharray={`${len.toFixed(2)} 100`}
                strokeDashoffset={off.toFixed(2)}
              />
            );
          })}
        </svg>
        <div className="rp-donut-center">
          <b>{S.notWorsePct}%</b>
          <span>nie gorzej</span>
        </div>
      </div>
      <ul className="rp-legend">
        {segs.map((s) => (
          <li key={s.label}>
            <i className={`dot ${s.cls}`} />
            {s.label} <b>{s.value}</b>
          </li>
        ))}
      </ul>
    </div>
  );
}

function TopWins() {
  const max = Math.abs(BENCHMARK.topWins[0].delta);
  return (
    <div className="rp-bars-card">
      <h3>Największe przewagi nad jakdojade</h3>
      <ul className="rp-bars">
        {BENCHMARK.topWins.slice(0, 8).map((w) => (
          <li key={`${w.route}-${w.when}`}>
            <span className="rp-bar-label">
              {w.route} <em>{w.when}</em>
            </span>
            <span className="rp-bar-track">
              <i className="rp-bar-fill" style={{ ['--w' as string]: `${(Math.abs(w.delta) / max) * 100}%` }} />
            </span>
            <b className="rp-bar-num">{w.delta}</b>
          </li>
        ))}
      </ul>
    </div>
  );
}

function JdTable() {
  return (
    <div className="rp-scroll">
      <table className="rp-table">
        <thead>
          <tr>
            <th>Przewaga</th>
            <th>Trasa</th>
            <th>Termin</th>
          </tr>
        </thead>
        <tbody>
          {BENCHMARK.topWins.map((w) => (
            <tr key={`${w.route}-${w.when}`}>
              <td>
                <Delta value={w.delta} />
              </td>
              <td>{w.route}</td>
              <td className="rp-dim">{w.when}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ThreeWayTable() {
  return (
    <div className="rp-scroll">
      <table className="rp-table rp-table-3way">
        <thead>
          <tr>
            <th>Trasa</th>
            <th>Kilometr</th>
            <th>jakdojade</th>
            <th>mobilempk</th>
            <th>Δ jd</th>
            <th>Δ mmpk</th>
          </tr>
        </thead>
        <tbody>
          {BENCHMARK.threeWay.map((r) => (
            <tr key={`${r.route}-${r.when}`}>
              <td>
                {r.route} <span className="rp-dim">{r.when}</span>
              </td>
              <td className="rp-time">{r.ours}</td>
              <td className="rp-time rp-dim">{r.jd}</td>
              <td className="rp-time rp-dim">{r.mmpk}</td>
              <td>
                <Delta value={r.dJd} />
              </td>
              <td>
                <Delta value={r.dMmpk} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Report() {
  return (
    <div className="rp">
      <a className="rp-back" href="#top">
        <ArrowLeft size={17} strokeWidth={2.2} />
        <span>Kilometr</span>
      </a>
      <header className="rp-hero">
        <h1>Raport z benchmarku.</h1>
        <p>
          72 prawdziwe trasy po Wrocławiu: Kilometr przeciwko jakdojade
          i mobilempk. Minuta w minutę, ten sam tydzień, to samo okno odjazdów.
        </p>
      </header>

      <Stats />

      <div className="rp-grid">
        <Donut />
        <TopWins />
      </div>

      <h2 className="rp-h">Dwanaście tras pod lupą</h2>
      <p className="rp-sub">
        Te same zapytania we wszystkich trzech silnikach. Ujemna delta to
        wcześniejszy przyjazd Kilometra.
      </p>
      <ThreeWayTable />

      <h2 className="rp-h">Pełna dwunastka wygranych z jakdojade</h2>
      <JdTable />

      <h2 className="rp-h">Metodologia</h2>
      <p className="rp-fine">
        Zbiór: 72 zapytania punkt-punkt (przystanek początkowy, przystanek
        docelowy, dzień tygodnia, godzina odjazdu). Dane referencyjne pobrano
        z oficjalnych stron obu serwisów dnia 06.10.2023 o 23:00. Metryka:
        najlepszy przyjazd w oknie odjazdów +120         minut (tolerancja odjazdu: -5 minut). Silnik Kilometra: algorytm RAPTOR na rozkładzie GTFS MPK
        Wrocław, zasięg przesiadek do 800 m, limit 3 przesiadek. jakdojade:
        profil OPTIMAL z czasem rzeczywistym, 7 propozycji na zapytanie.
        mobilempk: profil opt, limit przesiadki 300 m / 1 minuta.
      </p>
    </div>
  );
}
