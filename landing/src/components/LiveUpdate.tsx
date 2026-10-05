import { useEffect, useState } from 'react';
import { Flag, TramFront } from 'lucide-react';
import { TramMark } from './TramMark';

// ─────────────────────────────────────────────────────────────────────────────
// Powiadomienie Live Update w wersji z Android 16 `Notification.ProgressStyle`
// (modules/kilometr-tracking/.../LiveUpdateFactory.kt). Android nie pozwala na
// RemoteViews przy Live Update, więc wygląd jest szablonem systemu, my
// odpowiadamy tylko za treść, segmenty i ikony, a landowanie odwzorowuje to,
// co robi system:
//
//  - pasek z segmentami: dojścia pieszo WALK_SEGMENT_COLOR, przejazdy w kolorze
//    linii, granice przesiadek jako punkty, nad paskiem ikona pojazdu
//    (setProgressTrackerIcon), a na końcach chorągiewka i pinezka
//    (setProgressStartIcon / setProgressEndIcon),
//  - dwa przyciski: `stop` i `route` z ikonami ic_kilometr_stop / _route,
//  - licznik systemowy (setWhen + setUsesChronometer) liczy do przyjazdu.
//
// Treść z buildPhaseCopy (src/services/notifications/content.ts, faza „riding")
// i buildLivePlan: tekst jest bezwzględny („na miejscu 22:44"), bo liczbę
// rysuje zegar systemowy, a nie my.
//
// Dane: tramwaj 4 do BISKUPIN, wysiadź Arkady (Capitol), z zrzutu ekranu
// powiadomienia na telefonie. Pasek startuje w 62%, a iconka pojazdu przesuwa
// się zgodnie z postępem (plan.progress), więc animacja jest prawdziwym
// odwzorowaniem zachowania, a nie dekoracją.
// ─────────────────────────────────────────────────────────────────────────────

/** WALK_SEGMENT_COLOR: src/services/notifications/content.ts */
const WALK_COLOR = '#8A8F98';
/** getLineColors('4', 'tram') → TRANSIT_PALETTE[4] */
const LINE_COLOR = '#F57C00';

// Zawartość powiadomienia: faza „riding" (buildPhaseCopy.riding).
const COPY = {
  /** n.rideTitle(service, arriveAt) → „Tramwaj 4 • na miejscu 22:44” */
  title: 'Tramwaj 4 • na miejscu 20:28 • 22:44',
  /** n.stops(20) */
  stops: '20 przystanków',
  /** „wysiadź: … • Do BISKUPIN” */
  alight: 'wysiadź: Arkady (Capitol) • Do BISKUPIN',
} as const;

const ACTIONS = {
  /** s.notification.actionStop */
  stop: 'Zakończ',
  /** s.notification.actionRoute */
  route: 'Trasa',
} as const;

/** Pasek postępu: odcinek pieszo, potem przejazd + punkt przesiadki. */
const SEGMENTS = [
  { mode: 'walk', width: 22, color: WALK_COLOR },
  { mode: 'tram', width: 46, color: LINE_COLOR },
  { mode: 'walk', width: 8, color: WALK_COLOR },
  { mode: 'tram', width: 24, color: LINE_COLOR },
] as const;

/** Punkt przesiadki: addProgressPoint, w kolorze akcentu. */
const TRANSFER_AT = 70;
/** Startowy postęp (plan.progressPermille): 62%. */
const PROGRESS_START = 62;

export function LiveUpdateSection() {
  // Postęp rośnie z czasem jak w serwisie Androida (co sekundę od nowego
  // planu). Zatrzymujemy go na chwilę przed celem, żeby nie zjechać z ikoną
  // poza pasek.
  const [progress, setProgress] = useState(PROGRESS_START);
  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) return;
    const started = Date.now();
    const id = setInterval(() => {
      const next = Math.min(97, PROGRESS_START + ((Date.now() - started) / 1000) * 1.4);
      setProgress(next);
    }, 250);
    return () => clearInterval(id);
  }, []);

  return (
    <section className="live">
      <div className="live-copy">
        <h2>Powiadomienie, które liczy za Ciebie.</h2>
        <p>
          Przypięte połączenie wraca do ekranu blokady i trzyma się w strefie
          Live Updates. Pasek pokazuje dojście, przejazdy i przesiadki, a
          licznik sam odlicza do przyjazdu, także wtedy, gdy aplikacja jest
          zamknięta.
        </p>
      </div>

      <div className="live-card-wrap">
        <div className="live-card">
          <div className="live-head">
            <TramMark size={40} />
            <span className="live-body">
              <b className="live-title">{COPY.title}</b>
              <span className="live-text">{COPY.stops}</span>
              <span className="live-text">{COPY.alight}</span>
            </span>
          </div>

          {/* ProgressStyle: pasek z segmentami + punkty + ikona pojazdu. */}
          <span className="live-bar">
            {SEGMENTS.map((s, i) => (
              <span
                className="live-seg"
                key={`${s.mode}-${i}`}
                style={{ width: `${s.width}%`, background: s.color }}
              />
            ))}
            <span
              className="live-point"
              style={{ left: `${TRANSFER_AT}%`, background: LINE_COLOR }}
            />
            {/* setProgressStartIcon ic_kilometr_start: tu zostawiamy sam
                początek paska, bez ikony: nie mamy odpowiednika w Lucide
                i domyślna ikona stóp myliła się z dojściem. */}
            <span
              className="live-tracker"
              style={{ left: `${progress}%`, background: LINE_COLOR }}
            >
              <TramFront size={13} color="#fff" strokeWidth={2.2} />
            </span>
            <span className="live-end">
              <Flag size={13} color="#fff" strokeWidth={2.2} fill="#fff" />
            </span>
          </span>

          {/* Akcje w poziomie pod paskiem. Android trzyma je na dole
              powiadomienia, nigdy z boku. Bez ikon: w szablonie systemowym
              to zwykłe etykiety z obwódką. */}
          <span className="live-actions">
            <span className="live-btn">{ACTIONS.stop}</span>
            <span className="live-btn">{ACTIONS.route}</span>
          </span>
        </div>
      </div>
    </section>
  );
}