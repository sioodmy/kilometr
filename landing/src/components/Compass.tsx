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
  /** activeLeg.fromStop — realna nazwa przystanku ze screenów */
  stop: 'DWORZEC GŁÓWNY (Dworcowa)',
  line: CONFIRMED.connection.line,
  /** s.compass.getDirectionLabel — kąt 12° → „Prosto przed Tobą” */
  guide: 'Prosto przed Tobą',
  /** zawsze zaokrąglane do 5 m (Math.round(dist / 5) * 5) */
  distance: '320 m',
  /** s.compass.straight */
  straight: 'w linii prostej',
  /** s.compass.walkMins(4) — 320 m przy 1,3 m/s ≈ 4 min */
  walk: '~4 min pieszo',
  /** s.compass.mapTitle */
  mapTitle: 'Mapa trasy',
  /** s.compass.navigate */
  navigate: 'Nawiguj',
} as const;

// Wejście animacji obsługuje CSS `animation-timeline: view()` (patrz
// .compass w styles.css) — animacja startuje dokładnie wtedy, gdy sekcja
// wjeżdża w kadr, bez IntersectionObservera i bez liczenia pozycji w JS.

export function CompassSection() {
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
            <span className="cp-distance">{TARGET.distance}</span>
            <span className="cp-straight">{TARGET.straight}</span>
            <span className="cp-walk">{TARGET.walk}</span>
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