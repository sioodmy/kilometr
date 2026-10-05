import { Anchor, ChevronLeft, Search, X } from 'lucide-react';
import { PixelFrame } from './Phone';

// ─────────────────────────────────────────────────────────────────────────────
// Kotwiczenie przystanku — widok „Przystanek kotwiczenia” z AddPlaceSheet.tsx
// (VIEW 2: PICK ANCHOR STOP). Elementy 1:1: uchwyt arkusza, przycisk cofnięcia,
// nagłówek z „Przystanek odjazdu dla: …”, pole wyszukiwania 48 dp, podpowiedź
// sekcji i wiersze „najbliższych przystanków” z kotwicą oraz pigułką „Wybierz”.
//
// Telefon jest przycięty do górnej części: arkusz zajmuje 92% wysokości ekranu
// (snapPoints AddPlaceSheet), więc dolna krawędź to cięcie, nie zaokrąglenie.
//
// Animacje startują dopiero po przewinięciu do sekcji (IntersectionObserver):
//  - telefon wjeżdża delikatnie w górę i jaśnieje,
//  - arkusz wysuwa się z dołu (jak BottomSheet),
//  - wiersze pojawiają się kaskadowo (jak SlideIn w SmartHistoryList).
// Wszystko wyłączone przy prefers-reduced-motion.
// ─────────────────────────────────────────────────────────────────────────────

/** Ile dp ekranu pokazujemy: 8% arkusza + nagłówek + pole + 4 wiersze. */
const CROP_DP = 556;
/** snapPoints ['65%','92%'] → arkusz zaczyna się 8% od góry ekranu. */
const SHEET_TOP_DP = 73;

const SHEET = {
  /** s.places.anchorTitle */
  title: 'Przystanek kotwiczenia',
  /** s.places.anchorFor('Praca') */
  subtitle: 'Przystanek odjazdu dla: Praca',
  /** s.places.searchStop */
  placeholder: 'Szukaj przystanku MPK…',
  /** s.places.nearStops */
  hint: 'Najbliższe przystanki wokół wybranego adresu:',
  /** s.places.choose */
  choose: 'Wybierz',
  /** Prawdziwe nazwy przystanków MPK z wyników wyszukiwarki w aplikacji
   *  (docs/screenshots/pr-41-szukanie-kotwicy.png); dystanse poglądowe. */
  stops: [
    { name: 'Dworzec Świebodzki', dist: '160 m' },
    { name: 'DWORZEC GŁÓWNY (Dworcowa)', dist: '350 m' },
    { name: 'Dworzec Główny (MDK)', dist: '470 m' },
    { name: 'DWORZEC AUTOBUSOWY', dist: '620 m' },
  ],
} as const;

// Animacje startują dopiero po przewinięciu — obsługuje je CSS
// `animation-timeline: view()` (patrz .anchor w styles.css). Dzięki temu
// sekcja jest widoczna z definicji, a animacja po prostu startuje przy
// wjeździe w kadr: bez IntersectionObservera i bez liczenia pozycji w JS.

const ic = (n: number) => `calc(${n} * var(--dp))`;

export function AnchorSection() {
  return (
    <section className="anchor">
      <div className="anchor-phone">
        <PixelFrame cropDp={CROP_DP}>
          {/* Wierzch ekranu głównego wystaje spod arkusza (8% wysokości). */}
          <div className="rn-app" style={{ top: 'calc(26 * var(--dp))' }}>
            <div className="rn-topbar">
              <h3 className="rn-h1">Gdzie jedziemy?</h3>
              <div className="rn-topbar-actions">
                <span className="rn-iconbtn">
                  <X size={ic(20)} color="#BFC9C5" strokeWidth={2} />
                </span>
              </div>
            </div>
          </div>

          <div
            className="an-sheet"
            style={{ top: `calc(${SHEET_TOP_DP} * var(--dp))` }}
          >
            <span className="an-handle" />

            <div className="an-header">
              <span className="an-backbtn">
                <ChevronLeft size={ic(22)} color="#E0E3E1" strokeWidth={2} />
              </span>
              <span className="an-header-text">
                <b>{SHEET.title}</b>
                <i>{SHEET.subtitle}</i>
              </span>
              <span className="an-closebtn">
                <X size={ic(20)} color="#BFC9C5" strokeWidth={2} />
              </span>
            </div>

            <div className="an-search">
              <Search size={ic(18)} color="#BFC9C5" strokeWidth={2} />
              <span>{SHEET.placeholder}</span>
            </div>

            <div className="an-hint">{SHEET.hint}</div>

            <div className="an-stops">
              {SHEET.stops.map((s, i) => (
                <div
                  className="an-row"
                  key={s.name}
                  style={{ '--i': i } as React.CSSProperties}
                >
                  <span className="an-row-icon">
                    <Anchor size={ic(17)} color="#5CDBBE" strokeWidth={2} />
                  </span>
                  <span className="an-row-text">
                    <b>{s.name}</b>
                    <i>{s.dist} od wybranego miejsca</i>
                  </span>
                  <span className="an-pill">{SHEET.choose}</span>
                </div>
              ))}
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
          Nazwy przystanków są prawdziwe, z wyników wyszukiwarki w aplikacji.
          Dystanse są przykładowe, tak jak cały ten widok.
        </p>
      </div>
    </section>
  );
}