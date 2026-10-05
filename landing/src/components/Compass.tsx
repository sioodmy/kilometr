import { useEffect, useState } from 'react';
import { Map as MapIcon, Navigation2, TramFront } from 'lucide-react';
import { CONFIRMED } from '../data';

// ─────────────────────────────────────────────────────────────────────────────
// Karta kompasu przepisana 1:1 ze StopCompassCard.tsx: ten sam nagłówek,
// ten sam blok przystanku, ten sam radar 120 dp z belką w stronę słupka i ten
// sam przycisk „Nawiguj”. Kolory z src/theme/tokens.ts, akcent linii 23
// policzony z src/services/lineIdentity.ts (#E64A19).
//
// Dane są mockowane: przystanek, kierunek i dystans pochodzą z realnego
// połączenia ze screenów telefonu (DWORZEC GŁÓWNY (Dworcowa), tramwaj 23 w
// kierunku Nowego Dworu), ale dystans to liczba poglądowa.
//
// Animacja: wskazówka kołysze się ±6° wokół kursu (tak jak w aplikacji,
// gdzie wskazówka goni heading), znacznik słupka kręci się w przeciwną stronę,
// żeby ikonka stała prosto, a punkt „ty” delikatnie pulsuje. Wszystko
// transform/opacity, wyłączone przy prefers-reduced-motion.
// ─────────────────────────────────────────────────────────────────────────────

const LINE_ACCENT = '#E64A19'; // getLineColors('23', 'tram') → TRANSIT_PALETTE[9]
const LINE_FG = '#FFFFFF'; // luminancja #E64A19 > 145 → biały tekst

const TARGET = {
  /** s.compass.title */
  title: 'Lokalizacja przystanku',
  /** s.compass.followCompass */
  subtitle: 'Kieruj się według kompasu',
  /** s.compass.directionPrefix(leg.direction) */
  direction: 'kierunek Wrocław Nowy Dwór (P+R)',
  /** activeLeg.fromStop: realna nazwa przystanku ze screenów */
  stop: 'DWORZEC GŁÓWNY (Dworcowa)',
  line: CONFIRMED.connection.line,
  /** s.compass.getDirectionLabel: kąt 12° → „Prosto przed Tobą” */
  guide: 'Prosto przed Tobą',
  /** s.compass.straight */
  straight: 'w linii prostej',
  /** s.compass.mapTitle */
  mapTitle: 'Mapa trasy',
  /** s.compass.navigate */
  navigate: 'Nawiguj',
} as const;

// Dystans schodzi z 80 m do 60 m w tempie chodzenia: 1,3 m/s (domyślne
// `DEFAULT_SETTINGS.walkSpeedMps`) to 78 m/min, więc 20 m ≈ 15 s. Ten sam
// wzór liczy `walkMinutesFor`, a `formatDistance` z settings zaokrąglania do
// 5 m poniżej 100 m: dlatego kroki wychodzą 80 → 75 → 70 → 65 → 60.
const DIST_START_M = 80;
const DIST_END_M = 60;
const WALK_MPS = 1.3;
const WALK_M_PER_MIN = WALK_MPS * 60;
const WALK_SECONDS = (DIST_START_M - DIST_END_M) / WALK_MPS;

/** 'NN m': jak formatDistance ze settings: poniżej 100 m do 5 m. */
function formatMeters(m: number): string {
  return `${Math.round(m / 5) * 5} m`;
}

/** Zegar systemowy w sekundach: CSS nie policzy „od startu strony". */
function useWalkedSeconds(paused: boolean) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (paused) return;
    // Skok do docelowego miejsca przy starcie: setInterval nie nadrobi tego,
    // co minęło, gdy karta była poza kadrem (IntersectionObserver).
    const started = Date.now();
    const id = setInterval(() => {
      setSeconds(Math.min(WALK_SECONDS, (Date.now() - started) / 1000));
    }, 250);
    return () => clearInterval(id);
  }, [paused]);
  return seconds;
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

// Wejście animacji obsługuje CSS `animation-timeline: view()` (patrz
// .compass w styles.css): animacja startuje dokładnie wtedy, gdy sekcja
// wjeżdża w kadr, bez IntersectionObservera i bez liczenia pozycji w JS.

export function CompassSection() {
  const reduce = prefersReducedMotion();
  const walked = useWalkedSeconds(reduce);
  const meters = DIST_START_M - walked * WALK_MPS;
  // s.compass.walkMins: minuty z tego samego wzoru co walkMinutesFor.
  const walkMin = Math.max(1, Math.round(meters / WALK_M_PER_MIN));
  return (
    <section className="compass">
      <div className="compass-copy">
        <h2>5 przystanków o tej samej nazwie?</h2>
        <p>
          Kompas prowadzi do właściwego słupka, a pod nim wypisuje, ile
          minut dojścia zostało. Nie musisz szukać przystanku o tej nazwie
          na mapie.
        </p>
      </div>

      {/* Karta: układ i wartości ze StopCompassCard */}
      <div className="cp-card">
        <div className="cp-header">
          <span className="cp-header-icon">
            <Navigation2 size={18} strokeWidth={2} color="#5CDBBE" />
          </span>
          <span className="cp-header-text">
            <b>{TARGET.title}</b>
            <i>{TARGET.subtitle}</i>
          </span>
        </div>

        <div className="cp-stop">
          <div className="cp-badgerow">
            <span className="cp-linebadge">
              <TramFront size={13} strokeWidth={2} color={LINE_FG} />
              {TARGET.line}
            </span>
            <span className="cp-direction">{TARGET.direction}</span>
          </div>
          <div className="cp-stopname">{TARGET.stop}</div>
        </div>

        <div className="cp-row">
          {/* dial: 120 dp, innerRing 68, krzyż 1 px, wskazówka u góry */}
          <div className="cp-dial">
            <span className="cp-ring" />
            <span className="cp-cross cp-cross-v" />
            <span className="cp-cross cp-cross-h" />
            <span className="cp-pointer">
              <span className="cp-beam" style={{ background: LINE_ACCENT }} />
              <span className="cp-target" style={{ background: LINE_ACCENT }}>
                <span className="cp-target-icon">
                  <TramFront size={16} strokeWidth={2} color={LINE_FG} />
                </span>
              </span>
            </span>
            <span className="cp-pulse">
              <span className="cp-dot" />
            </span>
          </div>

          <div className="cp-info">
            <span className="cp-guide">{TARGET.guide}</span>
            {/* Odliczanie bez animacji przy prefers-reduced-motion: stoi
                na dystansie docelowym, żeby nie zdradzać ruchu tekstem. */}
            <span className="cp-distance">
              {formatMeters(reduce ? DIST_END_M : meters)}
            </span>
            <span className="cp-straight">{TARGET.straight}</span>
            <span className="cp-walk">
              {`~${reduce ? Math.max(1, Math.round(DIST_END_M / WALK_M_PER_MIN)) : walkMin} min pieszo`}
            </span>
          </div>
        </div>

        <div className="cp-actions">
          <span className="cp-btn cp-btn-primary">
            <MapIcon size={18} strokeWidth={2} color="#003831" />
            {TARGET.mapTitle}
          </span>
          <span className="cp-btn cp-btn-secondary">
            <Navigation2 size={18} strokeWidth={2} color="#CDE8E1" />
            {TARGET.navigate}
          </span>
        </div>
      </div>
    </section>
  );
}