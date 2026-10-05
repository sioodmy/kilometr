import type { ReactNode } from 'react';
import {
  BatteryFull,
  Bell,
  Briefcase,
  BusFront,
  History,
  Home,
  LocateFixed,
  MapPin,
  Pencil,
  Search,
  Settings2,
  Signal,
  TramFront,
  University,
  Wifi,
} from 'lucide-react';
import { CONFIRMED } from '../data';

// ─────────────────────────────────────────────────────────────────────────────
// Mock ekranu głównego przepisany z prawdziwego kodu React Native,
// app/index.tsx + src/components/{SmartHistoryList,SavedPlacesRow,HomeThumbBar,
// ThumbBar}.tsx, z tokenami z src/theme/tokens.ts.
//
// Kanonia to 402 × 893 dp (ekran Pixela 8a), a każda wartość w mocku jest
// liczona w jednostce --dp zdefiniowanej w CSS (.pixel), więc proporcje są 1:1
// z telefonem i skalują się bez transformów oraz bez pomiarów w JS.
//
// Treść pochodzi ze screenshotów prawdziwego telefonu (docs/screenshots/).
// Badge linii w wierszach celu celowo BRAK: w kodzie pojawia się dopiero, gdy
// planer zna pierwszą linię do danego celu: nie zmyślamy, która to jest.
// ─────────────────────────────────────────────────────────────────────────────

// ─── Geometria Google Pixel 8a ───────────────────────────────────────────────
// Wymiary z karty technicznej: 152,1 × 72,7 × 8,9 mm, ekran 6,1" 1080 × 2400
// przy ~430 ppi. Przeliczenie na dp (430 ppi / 160 → 2,6875 dp/px, czyli
// 6,299 dp na milimetr):
//
//   obudowa  72,7 mm  → 458 dp     ekran  63,8 mm  → 402 dp
//            152,1 mm → 958 dp             141,8 mm  → 893 dp
//   → ramka boczna 28 dp, górna 33 dp, podbródkowa 32 dp.
//
// Uwaga na „ramkę": to nie ozdobne 11 px. Pixel 8a ma wyraźnie grube ramki
// (recenzje wprost o tym mówią) i właśnie one rozpoznawalnie identyfikują
// ten model, więc_mock musi pokazywać dokładnie takie proporcje.
const SCREEN_W = 402;
const SCREEN_H = 893;
const DEVICE_W = 458;
const DEVICE_H = 958;
/** Aluminiowa obrączka wokół szkła: cienka, bo to framka, nie bezel. */
const RIM_DP = 3;

const STATUS_H = 26; // systemowy pasek stanu Androida, poza aplikacją
const NAV_H = 22; // gestowy pasek nawigacji, poza aplikacją
/** Rozmiar ikony w dp: w CSS to calc(N * var(--dp)), bo kanwa jest przeskalowana. */
const ic = (n: number) => `calc(${n} * var(--dp))`;

/**
 * Ostatnie miejsce: wiersz SmartHistoryList.
 *
 * Ikona nie jest już domyślnym zegarem: `smartIcons` w app/index.tsx bierze ją
 * z `getSuggestionIconMeta` wiersza z historii wyszukiwania, więc przystanek
 * dostaje BusFront na `secondaryContainer`, a adres MapPin na
 * `tertiaryContainer` (kolor niebieski). Zegar zostaje tylko dla wpisów
 * bez dopasowania.
 *
 * `badge` to badge pierwszej linii z `lineBadges`: w kodzie pojawia się
 * dopiero, gdy planer zna kurs, więc pusty slot na górze wiersza jest
 * normalnym stanem, a nie brakiem.
 */
function HomeRow({
  place,
  depart,
  icon,
  badge,
}: {
  place: string;
  depart: string;
  icon: 'stop' | 'address';
  badge?: string;
}) {
  const Icon = icon === 'stop' ? BusFront : MapPin;
  const bg = icon === 'stop' ? '#334B46' : '#244C63';
  const fg = icon === 'stop' ? '#CDE8E1' : '#C4E7FF';
  return (
    <div className="rn-row">
      <div className="rn-row-icon" style={{ background: bg }}>
        <Icon size={ic(19)} color={fg} strokeWidth={2} />
      </div>
      <div className="rn-row-mid">
        <b>{place}</b>
        <i>Przystanek</i>
      </div>
      {/* badgeSlot 28 dp: LineBadge albo pusty slot */}
      <div className="rn-row-badge">
        {badge ? <LineBadge line={badge} /> : null}
      </div>
      <div className="rn-row-depart">{depart}</div>
    </div>
  );
}

/** LineBadge: radius 8, minWidth 44, height 28, padding 9/4, TramFront 13. */
function LineBadge({ line }: { line: string }) {
  const colors: Record<string, string> = {
    '23': '#E64A19',
    '5': '#BF360C',
    '3': '#0288D1',
  };
  const color = colors[line] ?? '#E64A19';
  return (
    <span className="rn-linebadge" style={{ background: color }}>
      <TramFront size={ic(13)} color="#fff" strokeWidth={2} />
      {line}
    </span>
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
/** Jedna karta zapisanego miejsca (SavedPlacesRow): kwadrat 116 × 116. */
function PlaceCard({
  name,
  addr,
  Icon,
  edit = false,
}: {
  name: string;
  addr: string;
  Icon: typeof Home;
  edit?: boolean;
}) {
  return (
    <div className="rn-place">
      <span className={`rn-place-icon${edit ? ' rn-place-icon-edit' : ''}`}>
        {edit ? (
          <Pencil size={ic(20)} color="#5CDBBE" strokeWidth={2} />
        ) : (
          <Icon size={ic(20)} color="#CDE8E1" strokeWidth={2} />
        )}
      </span>
      <b>{name}</b>
      <i>{addr}</i>
    </div>
  );
}

/** Wiersz „Zapisane miejsca” + karta edycji (SavedPlacesRow). */
export function SavedPlaces({ className }: { className?: string }) {
  return (
    <div className={className}>
      <PlaceCard name="Dom" addr="Swojczycka 41" Icon={Home} />
      <PlaceCard name="Praca" addr="Sky Tower" Icon={Briefcase} />
      <PlaceCard name="Uczelnia" addr="Politechnika" Icon={University} />
      <PlaceCard name="Edytuj" addr="zapisane miejsca" Icon={Pencil} edit />
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
 * Obudowa Google Pixela 8a. `cropDp` przycina telefon w dolną stronę (bez
 * dolnego bezela i zaokrągleń): używane przez sekcję z kotwiczeniem, gdzie
 * ekran jest ucięty i pokazujemy tylko jego górną część.
 *
 * Proporcje z karty technicznej, nie z okularu: szkło 402 × 893 dp w ramce
 * 458 × 958 dp, z aluminium i grubymi czarnymi bezlami (patrz stałe wyżej).
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
        // Geometria idzie z JS, żeby CSS nie trzymał własnej kopii liczb.
        style={
          {
            '--device-w': DEVICE_W,
            '--device-h': DEVICE_H,
            '--screen-w': SCREEN_W,
            '--screen-h': SCREEN_H,
            '--rim': RIM_DP,
            ...(cropDp ? { '--crop-dp': cropDp } : null),
          } as React.CSSProperties
        }
      >
        {/* Fizyczne przyciski: Pixel 8a ma je po obu stronach. */}
        <span className="pixel-btn pixel-btn-power" aria-hidden="true" />
        <span className="pixel-btn pixel-btn-vol" aria-hidden="true" />

        <div className="pixel-screen">
          {/* Punch-hole: otwór w szkle, więc musi leżeć NAD ekranem. */}
          <span className="pixel-camera" aria-hidden="true" />
          <div className="rn-canvas">
            <StatusBar />
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Pełny telefon z ekranem głównym: sekcja hero. */
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
            <HomeRow
              key={r.name}
              place={r.name}
              depart={r.dep}
              icon={r.kind}
              badge={r.line}
            />
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