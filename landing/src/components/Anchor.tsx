import { Anchor, ArrowRight, ChevronLeft, Clock3, Footprints, Pin, Rocket, TramFront, X } from 'lucide-react';
import { PixelFrame, StatusBar } from './Phone';

// ─────────────────────────────────────────────────────────────────────────────
// Kotwiczenie przystanku w miejscu, w którym naprawdę działa: górny pasek
// ekranu „Połączenia MPK” (app/routes/index.tsx): Wstecz + pinezka śledzenia,
// a pod nim nagłówek trasy „Start → Cel” z dopiską kotwicy (Anchor 12,
// nazwa przystanku, „· miejsce”, krzyżyk) i licznik połączeń z chipem.
//
// Wartości skopiowane z app/routes/index.tsx: topBar (padding 14/8, gap 10,
// przyciski 40), routeHeader (minHeight 68, padding 16/12), routeText 20/26,
// routeSide maxWidth 42 %, routeArrowBtn 36, countRow, offlineChip.
//
// Animacje startują dopiero po przewinięciu: CSS `animation-timeline: view()`.
// ─────────────────────────────────────────────────────────────────────────────

/** Ile dp ekranu pokazujemy: pasek z toglem, nagłówek i karta z paskiem
 *  trasy kończą się około 430 dp. */
const CROP_DP = 450;

const ROUTES = {
  /** s.routes.title */
  title: 'Połączenia MPK',
  /** s.routes.countNearest + connectionsLabel */
  count: '11 połączeń • najbliższe odjazdy',
  /** s.routes.noLiveChip */
  noLive: 'brak danych live',
  /** routeText (start): kolor onSurfaceVariant */
  from: 'Twoja lokalizacja',
  /** routeTextStrong (cel): kolor onSurface */
  to: 'DWORZEC GŁÓWNY (Dworcowa)',
  /** activeAnchor.stopName */
  anchorStop: 'Dworzec Świebodzki',
  /** activeAnchor.placeName */
  anchorPlace: 'Praca',
  /** s.connection.transfers(0) */
  transfers: 'bezpośrednio',
  /** Pierwsza karta listy: ConnectionCard. */
  card: {
    depart: 'za 4 min',
    hours: '12:07 → 12:15',
    walkIn: '1m',
    /** getLineColors('23', 'tram') → TRANSIT_PALETTE[9] */
    line: '23',
    lineColor: '#E64A19',
    headsign: 'Wrocław Nowy Dwór (P+R)',
    walkOut: '3m',
    duration: '9 min',
  },
} as const;

const ic = (n: number) => `calc(${n} * var(--dp))`;

export function AnchorSection() {
  const card = ROUTES.card;
  return (
    <section className="anchor">
      <div className="anchor-phone">
        <PixelFrame cropDp={CROP_DP}>
          <div className="rn-app rn-routes" style={{ top: `calc(26 * var(--dp))` }}>
            {/* 1. Górny pasek: Wstecz, tytuł, toggle sortowania, pinezka. */}
            <div className="rt-topbar">
              <span className="rt-back">
                <ChevronLeft size={ic(23)} color="#E0E3E1" strokeWidth={2} />
              </span>
              <span className="rt-title">{ROUTES.title}</span>
              <span className="rt-sort">
                <span className="rt-sort-toggle">
                  <span className="rt-sort-thumb" />
                  <Clock3 size={ic(15)} color="#CDE8E1" strokeWidth={2} />
                  <Rocket size={ic(15)} color="#BFC9C5" strokeWidth={2} />
                </span>
                <span className="rt-sort-label">odjazd</span>
              </span>
              <span className="rt-pin">
                <Pin size={ic(19)} color="#E0E3E1" strokeWidth={2} />
              </span>
            </div>

            {/* 2. Nagłówek „Start → Cel” z dopiską kotwicy pod startem. */}
            <div className="rt-routehead">
              <span className="rt-side">
                <span className="rt-text">{ROUTES.from}</span>
                <span className="rt-anchor">
                  <Anchor size={ic(12)} color="#5CDBBE" strokeWidth={2} />
                  <span className="rt-anchor-text">{ROUTES.anchorStop}</span>
                  <span className="rt-anchor-place"> · {ROUTES.anchorPlace}</span>
                  <span className="rt-anchor-x">
                    <X size={ic(12)} color="#BFC9C5" strokeWidth={2.5} />
                  </span>
                </span>
              </span>

              <span className="rt-arrow">
                <ArrowRight size={ic(21)} color="#5CDBBE" strokeWidth={2.5} />
              </span>

              <span className="rt-side rt-side-grow">
                <span className="rt-text rt-text-strong">{ROUTES.to}</span>
              </span>
            </div>

            {/* 3. Licznik połączeń + chip „brak danych live”. */}
            <div className="rt-countrow">
              <span className="rt-count">{ROUTES.count}</span>
              <span className="rt-chip">
                <span className="rt-chip-dot" />
                {ROUTES.noLive}
              </span>
            </div>

            {/* Pierwsza karta z listy: żeby było widać, że to ekran połączeń. */}
            <div className="rt-card">
              <div className="rt-card-top">
                <div className="rt-card-left">
                  <b>{card.depart}</b>
                  <p className="rt-card-hours">
                    <span>12:07</span>
                    <ArrowRight size={ic(11)} color="#BFC9C5" strokeWidth={2.2} />
                    <span>12:15</span>
                    <span className="rt-card-dot">·</span>
                    <span>{ROUTES.transfers}</span>
                  </p>
                </div>
                <span className="rt-card-dur">{card.duration}</span>
              </div>
              <div className="rt-strip">
                <div className="rt-strip-cell" style={{ flex: 1 }}>
                  <span className="rt-strip-line" style={{ background: '#3F4946' }} />
                  <span className="rt-walk">
                    <Footprints size={ic(10)} color="#BFC9C5" strokeWidth={2.4} />
                    {card.walkIn}
                  </span>
                </div>
                <div className="rt-strip-cell" style={{ flex: 8 }}>
                  <span className="rt-strip-line" style={{ background: card.lineColor }} />
                  <span className="rt-strip-badge">
                    <span className="rt-line-badge" style={{ background: card.lineColor }}>
                      <TramFront size={ic(13)} color="#fff" strokeWidth={2} />
                      {card.line}
                    </span>
                    <span className="rt-strip-depart">12:07</span>
                  </span>
                </div>
                <div className="rt-strip-cell" style={{ flex: 3 }}>
                  <span className="rt-strip-line" style={{ background: '#3F4946' }} />
                  <span className="rt-walk">
                    <Footprints size={ic(10)} color="#BFC9C5" strokeWidth={2.4} />
                    {card.walkOut}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </PixelFrame>
      </div>

      <div className="anchor-copy">
        <h2>GPS nie musi się zgadzać co do metra.</h2>
        <p>
          Przypisz do miejsca jeden przystanek odjazdu. Gdy jesteś w jego
          okolicy, planer zakotwicza punkt startowy właśnie tam, zamiast liczyć
          do najbliższego przystanku w promieniu kilkuset metrów.
        </p>
      </div>
    </section>
  );
}

export { StatusBar };