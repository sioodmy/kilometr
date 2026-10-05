import type { ReactNode } from 'react';
import {
  BatteryFull,
  Bell,
  Briefcase,
  Clock3,
  History,
  Home,
  LocateFixed,
  Pencil,
  Search,
  Settings2,
  Signal,
  University,
  Wifi,
} from 'lucide-react';
import { CONFIRMED } from '../data';

// ─────────────────────────────────────────────────────────────────────────────
// Mock ekranu głównego przepisany z prawdziwego kodu React Native —
// app/index.tsx + src/components/{SmartHistoryList,SavedPlacesRow,HomeThumbBar,
// ThumbBar}.tsx, z tokenami z src/theme/tokens.ts.
//
// Kanonia to 412 × 915 dp (Pixel 8), a każda wartość w mocku jest liczona
// w jednostce --dp zdefiniowanej w CSS (.pixel), więc proporcje są 1:1
// z telefonem i skalują się bez transformów oraz bez pomiarów w JS.
//
// Treść pochodzi ze screenshotów prawdziwego telefonu (docs/screenshots/).
// Badge linii w wierszach celu celowo BRAK: w kodzie pojawia się dopiero, gdy
// planer zna pierwszą linię do danego celu — nie zmyślamy, która to jest.
// ─────────────────────────────────────────────────────────────────────────────

const STATUS_H = 26; // systemowy pasek stanu Androida, poza aplikacją
const NAV_H = 22; // gestowy pasek nawigacji, poza aplikacją
/** Rozmiar ikony w dp — w CSS to calc(N * --dp), bo kanwa jest przeskalowana. */
const ic = (n: number) => `calc(${n} * var(--dp))`;

function HomeRow({ place, depart }: { place: string; depart: string }) {
  return (
    <div className="rn-row">
      <div className="rn-row-icon">
        {/* KIND_META.history → surfaceContainerHighest / onSurfaceVariant */}
        <Clock3 size={ic(19)} color="#BFC9C5" strokeWidth={2} />
      </div>
      <div className="rn-row-mid">
        <b>{place}</b>
        <i>Przystanek</i>
      </div>
      {/* badgeSlot 28 dp — pusty, dopóki planer nie zna pierwszej linii */}
      <div className="rn-row-badge" />
      <div className="rn-row-depart">{depart}</div>
    </div>
  );
}

function StatusBar() {
  return (
    <div className="rn-status" style={{ height: `calc(${STATUS_H} * var(--dp))` }}>
      <span className="rn-status-time">21:37</span>
      <span className="rn-status-icons">
        <Signal size={ic(15)} strokeWidth={2.2} />
        <Wifi size={ic(15)} strokeWidth={2.2} />
        <BatteryFull size={ic(18)} strokeWidth={1.8} />
      </span>
    </div>
  );
}

/** Wiersz „Zapisane miejsca” + karta edycji (SavedPlacesRow). */
export function SavedPlaces({ className }: { className?: string }) {
  return (
    <div className={className}>
      <div className="rn-place">
        <span className="rn-place-icon">
          <Home size={ic(20)} color="#CDE8E1" strokeWidth={2} />
        </span>
        <b>Dom</b>
        <i>Przystanek</i>
      </div>
      <div className="rn-place">
        <span className="rn-place-icon">
          <Briefcase size={ic(20)} color="#CDE8E1" strokeWidth={2} />
        </span>
        <b>Praca</b>
        <i>Sky Tower</i>
      </div>
      <div className="rn-place">
        <span className="rn-place-icon">
          <University size={ic(20)} color="#CDE8E1" strokeWidth={2} />
        </span>
        <b>Uczelnia</b>
        <i>Politechnika Wrocławska</i>
      </div>
      <div className="rn-place">
        <span className="rn-place-icon rn-place-icon-edit">
          <Pencil size={ic(20)} color="#5CDBBE" strokeWidth={2} />
        </span>
        <b>Edytuj</b>
        <i>zapisane miejsca</i>
      </div>
    </div>
  );
}

/** Dolny pasek kciuka (HomeThumbBar). */
function ThumbBar() {
  return (
    /* bottom = max(inset.bottom, 10) + 10; gestowa nawigacja ≈ 22 dp */
    <div className="rn-thumb" style={{ bottom: `calc(${NAV_H + 10} * var(--dp))` }}>
      <div className="rn-thumb-search">
        <Search size={ic(18)} color="#5CDBBE" strokeWidth={2} />
        <span>{CONFIRMED.searchLabel}</span>
      </div>
      <span className="rn-thumb-divider" />
      <div className="rn-thumb-start">
        <span>{CONFIRMED.startFrom}</span>
        <LocateFixed size={ic(18)} color="#BFC9C5" strokeWidth={2} />
      </div>
    </div>
  );
}

/** Nawigacja gestowa (poza aplikacją). */
function NavBar() {
  return (
    <div className="rn-nav" style={{ height: `calc(${NAV_H} * var(--dp))` }}>
      <span className="rn-nav-pill" />
    </div>
  );
}

/** Pasek systemowy (poza aplikacją). */
export { StatusBar };

/**
 * Obudowa Pixela. `cropDp` przycina telefon w dolną stronę (bez dolnego bezela
 * i zaokrągleń) — używane przez sekcję z kotwiczeniem, gdzie arkusz zajmuje
 * 92% wysokości i pokazujemy tylko jego górną część.
 */
export function PixelFrame({
  children,
  cropDp,
}: {
  children: ReactNode;
  cropDp?: number;
}) {
  return (
    <div className="pixel-wrap">
      <div className="pixel-glow" aria-hidden="true" />
      <div
        className={`pixel${cropDp ? ' pixel--crop' : ''}`}
        style={cropDp ? ({ '--crop-dp': cropDp } as React.CSSProperties) : undefined}
      >
        <span className="pixel-btn pixel-btn-power" aria-hidden="true" />
        <span className="pixel-btn pixel-btn-vol" aria-hidden="true" />
        <div className="pixel-screen">
          <div className="rn-canvas">
            <StatusBar />
            {children}
          </div>
        </div>
        <span className="pixel-camera" aria-hidden="true" />
      </div>
    </div>
  );
}

/** Pełny telefon z ekranem głównym — sekcja hero. */
export function PixelPhone() {
  return (
    <PixelFrame>
      <div
        className="rn-app"
        style={{ top: `calc(${STATUS_H} * var(--dp))`, bottom: `calc(${NAV_H} * var(--dp))` }}
      >
        <div className="rn-topbar">
          <h3 className="rn-h1">{CONFIRMED.homeTitle}</h3>
          <div className="rn-topbar-actions">
            <span className="rn-iconbtn">
              <Bell size={ic(20)} color="#BFC9C5" strokeWidth={2} />
            </span>
            <span className="rn-iconbtn">
              <Settings2 size={ic(20)} color="#BFC9C5" strokeWidth={2} />
            </span>
          </div>
        </div>

        <div className="rn-gap" />

        <div className="rn-list">
          <div className="rn-list-header">
            <History size={ic(16)} color="#5CDBBE" strokeWidth={2} />
            <span>{CONFIRMED.recentTitle}</span>
          </div>
          {CONFIRMED.recent.map((r) => (
            <HomeRow key={r.name} place={r.name} depart={r.dep} />
          ))}
        </div>

        <div className="rn-gap-lg" />

        <div className="rn-section">{CONFIRMED.savedTitle}</div>
        <SavedPlaces className="rn-places" />
      </div>
      <ThumbBar />
      <NavBar />
    </PixelFrame>
  );
}