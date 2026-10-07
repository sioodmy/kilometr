import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, BusFront, Crown } from 'lucide-react';
import { TramMark } from './TramMark';
import { BENCHMARK } from '../data';

// ─────────────────────────────────────────────────────────────────────────────
// Sekcja „Najlepsze rozwiązanie na rynku": pojedynek na realnej trasie
// Kozanów → Rynek (sob 03:40, nocny powrót). Oba warianty z outputu harnessa
// (r3_4.txt): my 253 bezpośrednio 03:54 → 04:10, jakdojade dopiero 245
// o 04:20 → 04:46. Delta −36 min, 0 vs 0 przesiadek — ta sama noc, ten sam
// kierunek, inny silnik.
//
// Karta jakdojade odwzorowuje ich listę wyników 1:1 (ciemny motyw jd:
// tło #191919, radius 12 px, godzina 32 px/800, jasny badge linii).
// Logo to ich własny znak z jakdojade.pl (public/jakdojade-logo.png).
//
// Wykres w stylu keynote: duża liczba −36 + dwa słupki czasu podróży
// (16 vs 26 min) animowane skalowaniem po wjeździe w kadr. Licznik kręci
// się przez rAF (transform/opacity tylko w CSS, fallback przy
// prefers-reduced-motion).
// ─────────────────────────────────────────────────────────────────────────────

const DUEL = BENCHMARK.duel;
const OURS_MIN = DUEL.ours.durationMin; // 16
const JD_MIN = DUEL.jd.durationMin; // 26

/** Licznik od 0 do `target` po wejściu w kadr (rAF, raz). */
function useCountUp(target: number, durationMs = 1100): { ref: React.RefObject<HTMLSpanElement | null>; value: number } {
  const ref = useRef<HTMLSpanElement | null>(null);
  const [value, setValue] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setValue(target);
      return;
    }
    let raf = 0;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        const t0 = performance.now();
        const tick = (t: number) => {
          const p = Math.min(1, (t - t0) / durationMs);
          const eased = 1 - Math.pow(1 - p, 3);
          setValue(Math.round(target * eased));
          if (p < 1) raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      },
      { threshold: 0.4 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [target, durationMs]);
  return { ref, value };
}

function OursCard() {
  return (
    <article className="duel-card duel-ours" aria-label="Połączenie Kilometr">
      <div className="duel-brand">
        <TramMark size={26} />
        <span>Kilometr</span>
        <span className="duel-crown" role="img" aria-label="Wygrana Kilometra: 36 minut wcześniej">
          <Crown size={18} strokeWidth={2.4} />
        </span>
      </div>
      <div className="conn-card duel-conn">
        <div className="conn-top">
          <b>
            {DUEL.ours.dep} → {DUEL.ours.arr}
          </b>
          <span className="conn-dur">{DUEL.ours.durationMin} min</span>
        </div>
        <p className="conn-time">
          {DUEL.from} → {DUEL.to} · bezpośrednio
        </p>
        <div className="conn-line">
          <span className="conn-badge">
            <BusFront size={15} strokeWidth={2.4} />
            {DUEL.ours.lines[0]}
          </span>
          <span className="conn-head">nocny, prosto do centrum</span>
        </div>
      </div>
      <p className="duel-note">Nocny 253 złapany o 03:54. Bez czekania do rana.</p>
    </article>
  );
}

function JdCard() {
  return (
    <article className="duel-card duel-jd" aria-label="Połączenie jakdojade">
      <div className="duel-brand duel-brand-jd">
        <img src="./jakdojade-logo.png" alt="jakdojade" width={26} height={26} />
        <span>jakdojade.pl</span>
        <span className="duel-lose">+36 min</span>
      </div>
      <div className="jd-card">
        <div className="jd-top">
          <span className="jd-departs">Departs</span>
          <span className="jd-time">{DUEL.jd.dep}</span>
        </div>
        <div className="jd-mid">
          <span className="jd-badge">
            <BusFront size={15} strokeWidth={2.4} />
            {DUEL.jd.lines[0]}
          </span>
          <span className="jd-dur">{DUEL.jd.durationMin} min</span>
        </div>
        <div className="jd-arr">{DUEL.jd.arr}</div>
      </div>
      <p className="duel-note">U nich ten sam wieczór kończy się o 04:20 na przystanku.</p>
    </article>
  );
}

function Chart() {
  const { ref, value } = useCountUp(Math.abs(DUEL.deltaMin));
  return (
    <div className="duel-chart">
      <div className="duel-big">
        <span ref={ref} className="duel-num">
          {value}
        </span>
        <span className="duel-unit">min</span>
      </div>
      <p className="duel-big-sub">wcześniej na miejscu tą samą nocą</p>
      <div className="duel-bars" role="img" aria-label={`Czas podróży: Kilometr ${OURS_MIN} minut, jakdojade ${JD_MIN} minut`}>
        <div className="duel-bar-row">
          <span className="duel-bar-label">Kilometr · {OURS_MIN} min</span>
          <div className="duel-track">
            <i className="duel-fill duel-fill-ours" style={{ ['--w' as string]: `${(OURS_MIN / JD_MIN) * 100}%` }} />
          </div>
        </div>
        <div className="duel-bar-row">
          <span className="duel-bar-label duel-bar-label-jd">jakdojade · {JD_MIN} min</span>
          <div className="duel-track">
            <i className="duel-fill duel-fill-jd" />
          </div>
        </div>
      </div>
      <ul className="duel-chips">
        <li>
          <b>{BENCHMARK.sample.wins}</b> wygranych
        </li>
        <li>
          <b>{BENCHMARK.sample.ties}</b> remisów
        </li>
        <li>
          <b>{BENCHMARK.sample.notWorsePct}%</b> nie gorzej
        </li>
      </ul>
      <a className="cta cta-primary duel-cta" href="#raport" target="_blank" rel="noopener noreferrer">
        <span>Zobacz pełny raport</span>
        <ArrowUpRight size={15} strokeWidth={2.4} />
      </a>
    </div>
  );
}

export function DuelSection() {
  return (
    <section className="duel" id="porownanie" aria-labelledby="duel-h">
      <div className="duel-head">
        <h2 id="duel-h">
          Najlepsze rozwiązanie na rynku.
          <br />
          <span className="duel-grad">Totalna deklasacja.</span>
        </h2>
      </div>
      <div className="duel-route" role="img" aria-label={`Trasa ${DUEL.from} do ${DUEL.to}, ${DUEL.queryDay} o ${DUEL.queryTime}`}>
        <div className="duel-route-places">
          <div className="duel-route-main">
            <b>{DUEL.from}</b>
            <span className="duel-route-arrow" aria-hidden="true">
              →
            </span>
            <b>{DUEL.to}</b>
          </div>
          <span className="duel-route-caption">Przykładowa trasa</span>
        </div>
        <div className="duel-route-time">
          <b>{DUEL.queryTime}</b>
          <span>{DUEL.queryDay}</span>
        </div>
      </div>
      <div className="duel-grid">
        <OursCard />
        <div className="duel-vs" aria-hidden="true">
          VS
        </div>
        <JdCard />
      </div>
      <Chart />
    </section>
  );
}
