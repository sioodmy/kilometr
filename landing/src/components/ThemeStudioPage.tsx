import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import {
  argbFromHex,
  hexFromArgb,
  Hct,
  SchemeExpressive,
  SchemeRainbow,
  SchemeTonalSpot,
  SchemeVibrant,
} from '@material/material-color-utilities';
import {
  ArrowLeft,
  ArrowUpRight,
  Bell,
  Briefcase,
  BusFront,
  Check,
  ChevronRight,
  Copy,
  Heart,
  Home,
  Map,
  Moon,
  Navigation,
  Palette,
  Route,
  Search,
  Settings,
  Sun,
  TrainFront,
  TramFront,
  TriangleAlert,
} from 'lucide-react';
import { useStrings } from '../i18n';
import { COFFEE_URL } from '../data';
import { Phone } from './Phone';
import './themeStudio.css';

// Warianty schematu wspierane przez @material/material-color-utilities 0.4.0.
// `tonal` jest wariantem domyślnym aplikacji (src/theme/personalization.ts).
const VARIANTS = {
  tonal: SchemeTonalSpot,
  expressive: SchemeExpressive,
  vibrant: SchemeVibrant,
  rainbow: SchemeRainbow,
} as const;
type Variant = keyof typeof VARIANTS;

const SCHEME_KEYS = [
  'primary',
  'onPrimary',
  'primaryContainer',
  'onPrimaryContainer',
  'secondary',
  'onSecondary',
  'secondaryContainer',
  'onSecondaryContainer',
  'tertiary',
  'onTertiary',
  'tertiaryContainer',
  'onTertiaryContainer',
  'error',
  'onError',
  'errorContainer',
  'onErrorContainer',
  'surface',
  'onSurface',
  'onSurfaceVariant',
  'surfaceContainerLow',
  'surfaceContainer',
  'surfaceContainerHigh',
  'surfaceContainerHighest',
  'outline',
  'outlineVariant',
] as const;
type SchemeKey = (typeof SCHEME_KEYS)[number];
type Scheme = Record<SchemeKey, string>;

// Te same wartości co THEME_SEEDS w src/theme/personalization.ts; nie importujemy
// ich stamtąd, bo ten moduł ciągnąłby zależności React Native do buildu strony.
const PRESET_SEEDS = {
  teal: '#006A60',
  blue: '#315DA8',
  green: '#386A20',
  violet: '#77529A',
  rose: '#984061',
  orange: '#8B5000',
} as const;
type PresetKey = keyof typeof PRESET_SEEDS;

const PRESETS: { key: PresetKey; hex: string; hue: number; chroma: number }[] = Object.entries(
  PRESET_SEEDS,
).map(([key, hex]) => {
  const hct = Hct.fromInt(argbFromHex(hex));
  return { key: key as PresetKey, hex, hue: Math.round(hct.hue), chroma: Math.round(hct.chroma) };
});

const SEED_TONE = 40;
const CHROMA_MAX = 84;

// Tor suwaka odcienia w HCT, żeby kolor na torze zgadzał się z tym, co wyjdzie w schemacie.
const HUE_TRACK = `linear-gradient(90deg, ${Array.from({ length: 13 }, (_, i) =>
  hexFromArgb(Hct.from(i * 30, 48, 60).toInt()),
).join(', ')})`;

// Port kolorów pigułek linii z src/services/lineIdentity.ts (paleta M3 tone 80,
// hash po nazwie linii, tekst biały/czarny wg luminancji). Kolor linii to
// informacja o linii, nie element motywu, więc w makiecie pozostaje stały.
const TRANSIT_PALETTE = [
  '#71D8C2',
  '#96CCFF',
  '#FFB3B6',
  '#EBB2FF',
  '#FFB95A',
  '#BAC3FF',
  '#97D77D',
  '#FFAEDE',
  '#6DD5E6',
  '#FFB596',
  '#CBBEFF',
  '#87CFFA',
  '#CECC50',
  '#FCABF7',
  '#79D6D3',
  '#AFCBD5',
  '#F6BA8C',
  '#7ADA9E',
  '#ACC7FF',
  '#FFB1C5',
  '#98D3B9',
  '#FFB4A7',
  '#DAB9FF',
  '#ABCAE5',
];
const TRAIN_BADGE_BG = '#FFB957';

function relativeLuminance(hex: string): number {
  const linear = [0, 2, 4].map((offset) => {
    const value = Number.parseInt(hex.slice(1 + offset, 3 + offset), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function badgeColors(mode: 'tram' | 'bus' | 'train', line: string): { bg: string; fg: string } {
  if (mode === 'train') return { bg: TRAIN_BADGE_BG, fg: '#000000' };
  const key = `${mode}:${line.trim().toUpperCase()}`;
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = ((hash << 5) - hash + key.charCodeAt(i)) | 0;
  const bg = TRANSIT_PALETTE[Math.abs(hash * 7) % TRANSIT_PALETTE.length];
  // Tak jak getContrastForeground w lineIdentity: biel albo czerń wg luminancji.
  const lum = relativeLuminance(bg);
  const whiteContrast = 1.05 / (lum + 0.05);
  const blackContrast = (lum + 0.05) / 0.05;
  return { bg, fg: whiteContrast >= blackContrast ? '#FFFFFF' : '#000000' };
}

function MockLineBadge({ mode, line }: { mode: 'tram' | 'bus' | 'train'; line: string }) {
  const { bg, fg } = badgeColors(mode, line);
  const Icon = mode === 'tram' ? TramFront : mode === 'train' ? TrainFront : BusFront;
  return (
    <span className="km-badge" style={{ background: bg, color: fg }}>
      <Icon size={13} />
      {line}
    </span>
  );
}

function buildScheme(seedHex: string, variant: Variant, isDark: boolean): Scheme {
  const material = new VARIANTS[variant](Hct.fromInt(argbFromHex(seedHex)), isDark, 0);
  const scheme = {} as Scheme;
  for (const key of SCHEME_KEYS) scheme[key] = hexFromArgb(material[key]);
  return scheme;
}

/** Zamienia schemat na zmienne CSS: `--{prefix}-primary-container` itd. */
function schemeVars(prefix: string, scheme: Scheme): CSSProperties {
  const vars: Record<string, string> = {};
  for (const key of SCHEME_KEYS) {
    vars[`--${prefix}-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`] = scheme[key];
  }
  return vars;
}

/**
 * Kod motywu do wysłania: KM1. + base64url JSON-u {"v":1,"seed":"#RRGGBB","variant":"..."}.
 * Odbiorca dekoduje base64url i odtwarza schemat tym samym wariantem Material 3.
 */
function encodeThemeCode(seedHex: string, variant: Variant): string {
  const payload = JSON.stringify({ v: 1, seed: seedHex, variant });
  let binary = '';
  for (const byte of new TextEncoder().encode(payload)) binary += String.fromCharCode(byte);
  const base64 = btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
  return `KM1.${base64}`;
}

/** Kształt M3 Expressive (cookie, clover, sunny): okrąg z falą o `lobes` garbach. */
function shapePath(lobes: number, depth: number): string {
  const points: string[] = [];
  for (let i = 0; i < 240; i++) {
    const angle = (i / 240) * Math.PI * 2;
    const radius = 100 * (1 - depth + depth * Math.cos(lobes * angle));
    points.push(
      `${(100 + radius * Math.cos(angle)).toFixed(2)} ${(100 + radius * Math.sin(angle)).toFixed(2)}`,
    );
  }
  return `M${points.join('L')}Z`;
}

const COOKIE = shapePath(9, 0.06);
const CLOVER = shapePath(4, 0.16);
const SUNNY = shapePath(8, 0.1);

type Step = 'thanks' | 'studio';

function readStep(): Step {
  const state: unknown = window.history.state;
  return typeof state === 'object' && state !== null && 'themeStep' in state && state.themeStep === 'studio'
    ? 'studio'
    : 'thanks';
}

// Przejście między ekranami: View Transitions, jeśli przeglądarka je ma i ruch jest dozwolony.
function withTransition(update: () => void) {
  const run = () => {
    flushSync(update);
    window.scrollTo({ top: 0, behavior: 'instant' });
    document.getElementById('main')?.focus({ preventScroll: true });
  };
  if (
    'startViewTransition' in document &&
    !window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
    document.startViewTransition(run);
  else run();
}

function MockScreen({ scheme }: { scheme: Scheme }) {
  const t = useStrings().themeStudio;
  return (
    <div className="km-screen" style={schemeVars('k', scheme)}>
      <header className="km-topbar">
        <span className="km-brand">Kilometr</span>
        <span className="km-topbar-icons">
          <Bell size={20} />
          <Settings size={20} />
        </span>
      </header>
      <div className="km-search">
        <Search size={18} />
        <span>{t.mock.search}</span>
      </div>
      <div className="km-alert">
        <TriangleAlert size={17} className="km-alert-icon" />
        <MockLineBadge mode="tram" line="10" />
        <span className="km-alert-text">{t.mock.detour}</span>
        <ChevronRight size={16} />
      </div>
      <div className="km-places">
        <span className="km-place">
          <span className="km-place-icon km-place-icon-home">
            <Home size={18} />
          </span>
          {t.mock.home}
        </span>
        <span className="km-place">
          <span className="km-place-icon km-place-icon-work">
            <Briefcase size={18} />
          </span>
          {t.mock.work}
        </span>
      </div>
      <div className="km-card">
        <p className="km-card-title">{t.mock.departures}</p>
        <div className="km-rows">
          <MockRow badge={<MockLineBadge mode="tram" line="0" />} destination="Pilczyce">
            <span className="km-now">{t.mock.now}</span>
          </MockRow>
          <MockRow badge={<MockLineBadge mode="tram" line="10" />} destination="Biskupin">
            <span className="km-eta">{t.mock.minutes(8)}</span>
            <span className="km-delay">{t.mock.delay(2)}</span>
          </MockRow>
          <MockRow badge={<MockLineBadge mode="bus" line="114" />} destination="Rynek">
            <span className="km-eta">{t.mock.minutes(14)}</span>
          </MockRow>
          <MockRow badge={<MockLineBadge mode="train" line="KD" />} destination="Środa Śląska">
            <span className="km-eta">{t.mock.minutes(21)}</span>
            <span className="km-cancelled">{t.mock.cancelled}</span>
          </MockRow>
        </div>
      </div>
      <span className="km-pin">
        <Navigation size={18} />
        {t.mock.pin}
      </span>
      <nav className="km-navbar">
        <Map size={22} />
        <Route size={22} className="km-nav-active" />
        <Settings size={22} />
      </nav>
    </div>
  );
}

function MockRow({
  badge,
  destination,
  children,
}: {
  badge: ReactNode;
  destination: string;
  children: ReactNode;
}) {
  return (
    <div className="km-row">
      {badge}
      <span className="km-dest">{destination}</span>
      <span className="km-right">{children}</span>
    </div>
  );
}

function ThanksScreen({ onContinue }: { onContinue: () => void }) {
  const s = useStrings();
  const t = s.themeStudio;
  return (
    <section className="thanks" aria-labelledby="thanks-title">
      <header className="thanks-bar">
        <a className="studio-home-link" href="#top">
          <ArrowLeft size={18} aria-hidden="true" />
          {s.footer.back}
        </a>
        <div className="brand thanks-brand">
          <img src="./icon.png" alt="" width="28" height="28" />
          <span>Kilometr</span>
        </div>
      </header>
      <div className="thanks-body">
        <div className="thanks-shapes" aria-hidden="true">
          <svg className="thanks-shape thanks-shape-cookie" viewBox="0 0 200 200">
            <path d={COOKIE} />
          </svg>
          <svg className="thanks-shape thanks-shape-clover" viewBox="0 0 200 200">
            <path d={CLOVER} />
          </svg>
          <svg className="thanks-shape thanks-shape-sunny" viewBox="0 0 200 200">
            <path d={SUNNY} />
          </svg>
          <Heart className="thanks-heart" fill="currentColor" strokeWidth={0} />
        </div>
        <div className="thanks-copy">
          <h1 id="thanks-title">{t.thanksTitle}</h1>
          <p className="thanks-text">{t.thanksBody}</p>
          <button type="button" className="m3-button m3-button-filled thanks-cta" onClick={onContinue}>
            <Palette size={22} aria-hidden="true" />
            {t.thanksCta}
          </button>
          <p className="thanks-not-yet">
            {t.notYet}{' '}
            <a href={COFFEE_URL} target="_blank" rel="noopener noreferrer">
              {t.notYetLink}
              <span className="sr-only"> {s.install.newTab}</span>
            </a>
          </p>
        </div>
      </div>
    </section>
  );
}

function Swatch({ scheme }: { scheme: Scheme }) {
  return (
    <span
      className="studio-swatch-colors"
      style={{
        background: `conic-gradient(from 90deg, ${scheme.tertiary} 0 90deg, ${scheme.secondary} 90deg 180deg, ${scheme.primary} 180deg 360deg)`,
      }}
    />
  );
}

export function ThemeStudioPage() {
  const s = useStrings();
  const t = s.themeStudio;
  const [step, setStep] = useState<Step>(readStep);
  const [hue, setHue] = useState(PRESETS[0].hue);
  const [chroma, setChroma] = useState(PRESETS[0].chroma);
  const [variant, setVariant] = useState<Variant>('tonal');
  const [mode, setMode] = useState<'dark' | 'light'>('dark');
  const [copyState, setCopyState] = useState<'idle' | 'ok' | 'fail'>('idle');
  const codeField = useRef<HTMLInputElement>(null);

  // Krok trzymamy w history.state, więc systemowy "wstecz" na telefonie wraca do podziękowania.
  useEffect(() => {
    const onPop = () => withTransition(() => setStep(readStep()));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const openStudio = () => {
    window.history.pushState({ themeStep: 'studio' }, '', '#motyw');
    withTransition(() => setStep('studio'));
  };
  const backToThanks = () => {
    if (readStep() === 'studio') window.history.back();
    else withTransition(() => setStep('thanks'));
  };

  const seedHex = useMemo(
    () => hexFromArgb(Hct.from(hue, chroma, SEED_TONE).toInt()),
    [hue, chroma],
  );
  const pageScheme = useMemo(() => buildScheme(seedHex, variant, true), [seedHex, variant]);
  const previewScheme = useMemo(
    () => (mode === 'dark' ? pageScheme : buildScheme(seedHex, variant, false)),
    [pageScheme, seedHex, variant, mode],
  );
  const presetSchemes = useMemo(
    () => PRESETS.map((preset) => buildScheme(preset.hex, variant, true)),
    [variant],
  );
  const variantSchemes = useMemo(
    () => (Object.keys(VARIANTS) as Variant[]).map((key) => [key, buildScheme(seedHex, key, true)] as const),
    [seedHex],
  );
  const code = useMemo(() => encodeThemeCode(seedHex, variant), [seedHex, variant]);

  useEffect(() => {
    setCopyState('idle');
  }, [code]);

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopyState('ok');
    } catch {
      codeField.current?.focus();
      codeField.current?.select();
      setCopyState('fail');
    }
  };

  const chromaTrack = `linear-gradient(90deg, ${hexFromArgb(Hct.from(hue, 0, 60).toInt())}, ${hexFromArgb(
    Hct.from(hue, CHROMA_MAX, 60).toInt(),
  )})`;
  const activePreset = PRESETS.find(
    (preset) => preset.hue === Math.round(hue) && preset.chroma === Math.round(chroma),
  );

  return (
    <main className="studio" id="main" tabIndex={-1} style={schemeVars('s', pageScheme)}>
      {step === 'thanks' ? (
        <ThanksScreen onContinue={openStudio} />
      ) : (
        <div className="studio-shell">
          <header className="studio-bar">
            <button
              type="button"
              className="studio-icon-button"
              onClick={backToThanks}
              aria-label={t.back}
            >
              <ArrowLeft size={22} aria-hidden="true" />
            </button>
            <h1>{t.title}</h1>
            <fieldset className="studio-mode">
              <legend className="sr-only">{t.modeLabel}</legend>
              {(
                [
                  ['dark', t.darkMode, Moon],
                  ['light', t.lightMode, Sun],
                ] as const
              ).map(([key, label, Icon]) => (
                <label key={key} className="studio-mode-option">
                  <input
                    type="radio"
                    className="sr-only"
                    name="studio-mode"
                    checked={mode === key}
                    onChange={() => setMode(key)}
                  />
                  <span className="studio-mode-chip">
                    <Icon size={18} aria-hidden="true" />
                    <span className="studio-mode-text">{label}</span>
                  </span>
                </label>
              ))}
            </fieldset>
          </header>
          <p className="studio-intro">{t.intro}</p>

          <div className="studio-grid">
            <section className="studio-preview" aria-label={t.previewTitle}>
              <div className="studio-phone-crop">
                <Phone className="studio-phone" label={t.previewAria}>
                  <MockScreen scheme={previewScheme} />
                </Phone>
              </div>
            </section>

            <div className="studio-controls">
              <section className="studio-card" aria-labelledby="studio-presets-title">
                <h2 id="studio-presets-title">{t.presetsLabel}</h2>
                <div className="studio-presets">
                  {PRESETS.map((preset, index) => (
                    <button
                      key={preset.key}
                      type="button"
                      className="studio-preset"
                      aria-pressed={preset.key === activePreset?.key}
                      onClick={() => {
                        setHue(preset.hue);
                        setChroma(preset.chroma);
                      }}
                    >
                      <span className="studio-swatch">
                        <Swatch scheme={presetSchemes[index]} />
                        <Check className="studio-swatch-check" size={22} aria-hidden="true" />
                      </span>
                      <span className="studio-preset-name">{t.presetNames[preset.key]}</span>
                    </button>
                  ))}
                </div>
              </section>

              <section className="studio-card" aria-labelledby="studio-custom-title">
                <div className="studio-card-head">
                  <h2 id="studio-custom-title">{t.customTitle}</h2>
                  <span className="studio-seed">
                    <span className="studio-seed-dot" style={{ background: pageScheme.primary }} />
                    {seedHex.toUpperCase()}
                  </span>
                </div>
                <StudioSlider
                  id="studio-hue"
                  label={t.hueLabel}
                  track={HUE_TRACK}
                  max={360}
                  value={hue}
                  onChange={setHue}
                />
                <StudioSlider
                  id="studio-chroma"
                  label={t.chromaLabel}
                  track={chromaTrack}
                  max={CHROMA_MAX}
                  value={chroma}
                  onChange={setChroma}
                />
              </section>

              <section className="studio-card" aria-labelledby="studio-variant-title">
                <h2 id="studio-variant-title">{t.variantLabel}</h2>
                <div className="studio-variants" role="radiogroup" aria-labelledby="studio-variant-title">
                  {variantSchemes.map(([key, scheme]) => (
                    <label key={key} className="studio-variant">
                      <input
                        type="radio"
                        className="sr-only"
                        name="studio-variant"
                        checked={variant === key}
                        onChange={() => setVariant(key)}
                      />
                      <span className="studio-variant-body">
                        <span className="studio-variant-dots" aria-hidden="true">
                          <span style={{ background: scheme.primary }} />
                          <span style={{ background: scheme.secondary }} />
                          <span style={{ background: scheme.tertiary }} />
                        </span>
                        {t.variants[key]}
                      </span>
                    </label>
                  ))}
                </div>
              </section>

              <section className="studio-card studio-output" aria-labelledby="studio-output-title">
                <h2 id="studio-output-title">{t.outputTitle}</h2>
                <p className="studio-hint">{t.outputIntro}</p>
                <input
                  ref={codeField}
                  className="studio-code"
                  type="text"
                  readOnly
                  value={code}
                  aria-label={t.codeLabel}
                  onFocus={(event) => event.target.select()}
                  onClick={(event) => event.currentTarget.select()}
                />
                <div className="studio-actions">
                  <button type="button" className="m3-button m3-button-filled" onClick={copyCode}>
                    {copyState === 'ok' ? (
                      <Check size={20} aria-hidden="true" />
                    ) : (
                      <Copy size={20} aria-hidden="true" />
                    )}
                    {copyState === 'ok' ? t.copied : t.copy}
                  </button>
                  <a
                    className="m3-button m3-button-tonal"
                    href={COFFEE_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {t.sendOn}
                    <ArrowUpRight size={20} aria-hidden="true" />
                    <span className="sr-only">{s.install.newTab}</span>
                  </a>
                </div>
                <p className="studio-copy-status" role="status">
                  {copyState === 'fail' ? t.copyFailed : ''}
                </p>
              </section>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function StudioSlider({
  id,
  label,
  track,
  max,
  value,
  onChange,
}: {
  id: string;
  label: string;
  track: string;
  max: number;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="studio-slider">
      <label className="studio-slider-label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className="studio-range"
        type="range"
        min={0}
        max={max}
        step={1}
        value={value}
        style={{ '--studio-track': track } as CSSProperties}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </div>
  );
}
