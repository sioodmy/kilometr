import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import {
  argbFromHex,
  hexFromArgb,
  Hct,
  SchemeExpressive,
  SchemeRainbow,
  SchemeTonalSpot,
  SchemeVibrant,
} from '@material/material-color-utilities';
import { ArrowLeft, ArrowUpRight, Bell, Check, Copy, Map, Navigation, Route, Search, Settings } from 'lucide-react';
import { useStrings } from '../i18n';
import { KOFI_URL } from '../data';
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

// Pary ról sprawdzane względem WCAG; minimalne współczynniki jak w M3.
const PAIR_SPECS = [
  { key: 'button', fg: 'onPrimary', bg: 'primary', min: 4.5 },
  { key: 'accentCard', fg: 'onPrimaryContainer', bg: 'primaryContainer', min: 4.5 },
  { key: 'chip', fg: 'onSecondaryContainer', bg: 'secondaryContainer', min: 4.5 },
  { key: 'body', fg: 'onSurface', bg: 'surface', min: 4.5 },
  { key: 'helper', fg: 'onSurfaceVariant', bg: 'surface', min: 4.5 },
  { key: 'card', fg: 'onSurface', bg: 'surfaceContainer', min: 4.5 },
  { key: 'error', fg: 'onErrorContainer', bg: 'errorContainer', min: 4.5 },
  { key: 'accent', fg: 'primary', bg: 'surface', min: 3 },
] as const;

function buildScheme(seedHex: string, variant: Variant, isDark: boolean): Scheme {
  const material = new VARIANTS[variant](Hct.fromInt(argbFromHex(seedHex)), isDark, 0);
  // Domyślny pusty string tylko dla typów: w 0.4.0 konstruktor zwraca wszystkie
  // poniższe role, pętla nadpisuje każdą wartość.
  const scheme: Scheme = {
    primary: '',
    onPrimary: '',
    primaryContainer: '',
    onPrimaryContainer: '',
    secondary: '',
    onSecondary: '',
    secondaryContainer: '',
    onSecondaryContainer: '',
    tertiary: '',
    onTertiary: '',
    tertiaryContainer: '',
    onTertiaryContainer: '',
    error: '',
    onError: '',
    errorContainer: '',
    onErrorContainer: '',
    surface: '',
    onSurface: '',
    onSurfaceVariant: '',
    surfaceContainer: '',
    surfaceContainerHigh: '',
    surfaceContainerHighest: '',
    outline: '',
    outlineVariant: '',
  };
  for (const key of SCHEME_KEYS) {
    if (key in material) {
      const value = material[key];
      if (typeof value === 'number') scheme[key] = hexFromArgb(value);
    }
  }
  return scheme;
}

function channel(hex: string, offset: number): number {
  const raw = Number.parseInt(hex.slice(1 + offset, 3 + offset), 16) / 255;
  return raw <= 0.03928 ? raw / 12.92 : ((raw + 0.055) / 1.055) ** 2.4;
}

/** Współczynnik kontrastu WCAG 2.1 dla pary kolorów hex. */
function contrastRatio(foreground: string, background: string): number {
  const first = 0.2126 * channel(foreground, 0) + 0.7152 * channel(foreground, 2) + 0.0722 * channel(foreground, 4);
  const second = 0.2126 * channel(background, 0) + 0.7152 * channel(background, 2) + 0.0722 * channel(background, 4);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
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

function StudioSlider({
  id,
  label,
  track,
  onChange,
  ...input
}: {
  id: string;
  label: string;
  track: string;
  min: number;
  max: number;
  step: number;
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
        aria-orientation="horizontal"
        style={{ '--studio-track': track } as CSSProperties}
        onChange={(event) => onChange(Number(event.target.value))}
        {...input}
      />
    </div>
  );
}

function StudioPills({
  label,
  hint,
  name,
  options,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  name: string;
  options: { key: string; text: string }[];
  value: string;
  onChange: (key: string) => void;
}) {
  return (
    <fieldset className="studio-fieldset">
      <legend>{label}</legend>
      {hint ? <p className="studio-hint">{hint}</p> : null}
      <div className="studio-pills">
        {options.map((option) => (
          <label key={option.key} className="studio-pill">
            <input
              type="radio"
              className="sr-only"
              name={name}
              value={option.key}
              checked={value === option.key}
              onChange={() => onChange(option.key)}
            />
            <span className="studio-pill-label" data-checked={value === option.key}>
              {option.text}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

const MOCK_DEPARTURES = [
  { line: '0', destination: 'Pilczyce' },
  { line: '10', destination: 'Biskupin' },
  { line: '114', destination: 'Rynek' },
];

function MockRow({
  badge,
  destination,
  right,
}: {
  badge: string;
  destination: string;
  right: ReactNode;
}) {
  return (
    <div className="km-row">
      <span className="km-badge">{badge}</span>
      <span className="km-dest">{destination}</span>
      {right}
    </div>
  );
}

export function ThemeStudioPage() {
  const s = useStrings();
  const t = s.themeStudio;
  const [hue, setHue] = useState(PRESETS[0].hue);
  const [chroma, setChroma] = useState(PRESETS[0].chroma);
  const [variant, setVariant] = useState<Variant>('tonal');
  const [mode, setMode] = useState<'dark' | 'light'>('dark');
  const [copyState, setCopyState] = useState<'idle' | 'ok' | 'fail'>('idle');
  const codeField = useRef<HTMLInputElement>(null);

  const seedHex = useMemo(
    () => hexFromArgb(Hct.from(hue, chroma, SEED_TONE).toInt()),
    [hue, chroma],
  );
  const scheme = useMemo(
    () => buildScheme(seedHex, variant, mode === 'dark'),
    [seedHex, variant, mode],
  );
  const code = useMemo(() => encodeThemeCode(seedHex, variant), [seedHex, variant]);
  const pairs = useMemo(
    () =>
      PAIR_SPECS.map((pair) => ({
        key: pair.key,
        ratio: contrastRatio(scheme[pair.fg], scheme[pair.bg]),
        min: pair.min,
      })),
    [scheme],
  );

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

  const hueTrack =
    'linear-gradient(90deg, hsl(0 65% 45%), hsl(60 65% 45%), hsl(120 65% 45%), hsl(180 65% 45%), hsl(240 65% 45%), hsl(300 65% 45%), hsl(360 65% 45%))';
  const chromaTrack = `linear-gradient(90deg, hsl(${hue} 0% 45%), hsl(${hue} 85% 45%))`;
  const activePreset = PRESETS.find(
    (preset) => preset.hue === Math.round(hue) && preset.chroma === Math.round(chroma),
  );

  return (
    <main className="studio-page section-shell" id="main" tabIndex={-1}>
      <a className="text-link" href="#top">
        <ArrowLeft size={17} aria-hidden="true" />
        {s.footer.back}
      </a>
      <h1>{t.title}</h1>
      <p className="studio-intro">{t.intro}</p>

      <div className="studio-grid">
        <section className="studio-controls" aria-labelledby="studio-controls-title">
          <h2 id="studio-controls-title">{t.controlsTitle}</h2>
          <p className="studio-hint">{t.controlsHint}</p>
          <p className="studio-seed">
            <span className="studio-seed-dot" style={{ background: seedHex }} />
            <code>{seedHex}</code>
          </p>
          <StudioSlider
            id="studio-hue"
            label={t.hueLabel}
            track={hueTrack}
            min={0}
            max={360}
            step={1}
            value={hue}
            onChange={setHue}
          />
          <StudioSlider
            id="studio-chroma"
            label={t.chromaLabel}
            track={chromaTrack}
            min={0}
            max={CHROMA_MAX}
            step={1}
            value={chroma}
            onChange={setChroma}
          />
          <StudioPills
            label={t.variantLabel}
            hint={t.variantHint}
            name="studio-variant"
            value={variant}
            onChange={(key) => setVariant(key as Variant)}
            options={(Object.keys(VARIANTS) as Variant[]).map((key) => ({
              key,
              text: t.variants[key],
            }))}
          />
          <p className="studio-presets-label" id="studio-presets-label">
            {t.presetsLabel}
          </p>
          <div className="studio-preset-row" role="group" aria-labelledby="studio-presets-label">
            {PRESETS.map((preset) => (
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
                <span className="studio-preset-dot" style={{ background: preset.hex }} />
                <span>{t.presetNames[preset.key]}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="studio-preview" aria-labelledby="studio-preview-title">
          <div className="studio-sticky">
            <h2 id="studio-preview-title">{t.previewTitle}</h2>
            <StudioPills
              label={t.modeLabel}
              name="studio-mode"
              value={mode}
              onChange={(key) => setMode(key as 'dark' | 'light')}
              options={[
                { key: 'dark', text: t.darkMode },
                { key: 'light', text: t.lightMode },
              ]}
            />
            <Phone className="studio-phone" label={t.previewAria}>
              <div
                className="km-screen"
                style={
                  {
                    '--k-primary': scheme.primary,
                    '--k-on-primary': scheme.onPrimary,
                    '--k-primary-container': scheme.primaryContainer,
                    '--k-on-primary-container': scheme.onPrimaryContainer,
                    '--k-secondary-container': scheme.secondaryContainer,
                    '--k-on-secondary-container': scheme.onSecondaryContainer,
                    '--k-error-container': scheme.errorContainer,
                    '--k-on-error-container': scheme.onErrorContainer,
                    '--k-surface': scheme.surface,
                    '--k-on-surface': scheme.onSurface,
                    '--k-on-surface-variant': scheme.onSurfaceVariant,
                    '--k-surface-container': scheme.surfaceContainer,
                    '--k-surface-container-high': scheme.surfaceContainerHigh,
                    '--k-outline-variant': scheme.outlineVariant,
                  } as CSSProperties
                }
              >
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
                <div className="km-card">
                  <p className="km-card-title">{t.mock.departures}</p>
                  <div className="km-rows">
                    <MockRow
                      badge={MOCK_DEPARTURES[0].line}
                      destination={MOCK_DEPARTURES[0].destination}
                      right={<span className="km-now">{t.mock.now}</span>}
                    />
                    <MockRow
                      badge={MOCK_DEPARTURES[1].line}
                      destination={MOCK_DEPARTURES[1].destination}
                      right={<span className="km-eta">{t.mock.minutes(8)}</span>}
                    />
                    <MockRow
                      badge={MOCK_DEPARTURES[2].line}
                      destination={MOCK_DEPARTURES[2].destination}
                      right={<span className="km-cancelled">{t.mock.cancelled}</span>}
                    />
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
            </Phone>
          </div>
        </section>
      </div>

      <section className="studio-checks" aria-labelledby="studio-checks-title">
        <h2 id="studio-checks-title">{t.complianceTitle}</h2>
        <p className="studio-hint">{t.complianceHint}</p>
        <ul className="studio-pairs">
          {pairs.map((pair) => (
            <li key={pair.key} className="studio-pair">
              <span className="studio-pair-label">{t.pairs[pair.key]}</span>
              <code>{t.ratio(pair.ratio)}</code>
              <span className="studio-pair-status" data-state={pair.ratio >= pair.min ? 'pass' : 'fail'}>
                {pair.ratio >= pair.min ? t.pass : t.fail}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="studio-roles" aria-labelledby="studio-roles-title">
        <h2 id="studio-roles-title">{t.paletteTitle}</h2>
        <ul className="studio-palette">
          {(Object.keys(t.roleLabels) as (keyof typeof t.roleLabels)[]).map((role) => (
            <li key={role} className="studio-role">
              <span className="studio-role-swatch" style={{ background: scheme[role as SchemeKey] }} />
              <span className="studio-role-name">{t.roleLabels[role]}</span>
              <code className="studio-role-hex">{scheme[role as SchemeKey]}</code>
            </li>
          ))}
        </ul>
      </section>

      <section className="studio-output" aria-labelledby="studio-output-title">
        <h2 id="studio-output-title">{t.outputTitle}</h2>
        <p className="studio-hint">{t.outputIntro}</p>
        <div className="studio-code-row">
          <input
            id="studio-code"
            ref={codeField}
            className="studio-code"
            type="text"
            readOnly
            value={code}
            aria-label={t.codeLabel}
            onFocus={(event) => event.target.select()}
            onClick={(event) => event.currentTarget.select()}
          />
          <button type="button" className="button button-primary" onClick={copyCode}>
            {copyState === 'ok' ? <Check size={17} aria-hidden="true" /> : <Copy size={17} aria-hidden="true" />}
            {copyState === 'ok' ? t.copied : t.copy}
          </button>
        </div>
        <p className="studio-copy-status" role="status">
          {copyState === 'ok' ? t.copied : copyState === 'fail' ? t.copyFailed : ''}
        </p>
        <a className="text-link" href={KOFI_URL} target="_blank" rel="noopener noreferrer">
          {t.sendOn}
          <ArrowUpRight size={15} aria-hidden="true" />
          <span className="sr-only">{s.install.newTab}</span>
        </a>
      </section>
    </main>
  );
}
