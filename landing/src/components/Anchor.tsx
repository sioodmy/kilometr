import { Anchor, ArrowRight, ChevronLeft, Footprints, Pin, X } from 'lucide-react';
import { PixelFrame, StatusBar } from './Phone';

// ─────────────────────────────────────────────────────────────────────────────
// Kotwiczenie przystanku w miejscu, w którym naprawdę działa: górny pasek
// ekranu „Połączenia MPK” (app/routes/index.tsx) — Wstecz + pinezka śledzenia,
// a pod nim nagłówek trasy „Start → Cel” z dopiską kotwicy (Anchor 12,
// nazwa przystanku, „· miejsce”, krzyżyk) i licznik połączeń z chipem.
//
// Wartości skopiowane z app/routes/index.tsx: topBar (padding 14/8, gap 10,
// przyciski 40), routeHeader (minHeight 68, padding 16/12), routeText 20/26,
// routeSide maxWidth 42 %, routeArrowBtn 36, countRow, offlineChip.
//
// Animacje startują dopiero po przewinięciu — CSS `animation-timeline: view()`.
// ─────────────────────────────────────────────────────────────────────────────

/** Ile dp ekranu pokazujemy: treść kończy się ~333 dp, więc 380 z małym
 *  zapasem — inaczej pod cięciem zostaje pusty pas ekranu. */
const CROP_DP = 380;

const ROUTES = {
  /** s.routes.title */
  title: 'Połączenia MPK',
  /** s.routes.countNearest + connectionsLabel */
  count: '11 połączeń • najbliższe odjazdy',
  /** s.routes.noLiveChip */
  noLive: 'brak danych live',
  /** routeText (start) — kolor onSurfaceVariant */
  from: 'Twoja lokalizacja',
  /** routeTextStrong (cel) — kolor onSurface */
  to: 'DWORZEC GŁÓWNY (Dworcowa)',
  /** activeAnchor.stopName */
  anchorStop: 'Dworzec Świebodzki',
  /** activeAnchor.placeName */
  anchorPlace: 'Praca',
  /** s.connection.transfers(0) */
  transfers: 'bezpośrednio',
  /** Pierwsza karta listy — ConnectionCard. */
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
          <div className="rn-app" style={{ top: `calc(26 * var(--dp))` }}>
            {/* 1. Górny pasek: Wstecz (40), tytuł, pinezka śledzenia (40). */}
            <div className="rt-topbar">
              <span className="rt-back">
                <ChevronLeft size={ic(23)} color="#E0E3E1" strokeWidth={2} />
              </span>
              <span className="rt-title">{ROUTES.title}</span>
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

            {/* Pierwsza karta z listy — żeby było widać, że to ekran połączeń. */}
            <div className="rt-card">
              <div className="rt-card-top">
                <b>{card.depart}</b>
                <span className="rt-card-dur">{card.duration}</span>
              </div>
              <p className="rt-card-hours">
                {card.hours} · {ROUTES.transfers}
              </p>
              <div className="rt-card-legs">
                <span className="rt-walk">
                  <Footprints size={ic(12)} color="#BFC9C5" strokeWidth={2.2} />
                  {card.walkIn}
                </span>
                <span className="rt-line">
                  <span
                    className="rt-line-badge"
                    style={{ background: card.lineColor }}
                  >
                    {card.line}
                  </span>
                  {card.headsign}
                </span>
                <span className="rt-walk">
                  <Footprints size={ic(12)} color="#BFC9C5" strokeWidth={2.2} />
                  {card.walkOut}
                </span>
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
          do najbliższego słupka w promieniu kilkuset metrów.
        </p>
        <p className="anchor-note">
          Nazwa przystanku pochodzi z wyników wyszukiwarki w aplikacji.
          Reszta tego widoku to realny interfejs ekranu „Połączenia MPK”.
        </p>
      </div>
    </section>
  );
}

export { StatusBar };