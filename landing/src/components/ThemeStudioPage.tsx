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
import {
  ArrowLeft,
  ArrowUpRight,
  Bell,
  Briefcase,
  BusFront,
  Check,
  ChevronRight,
  Copy,
  Home,
  Map,
  Navigation,
  Route,
  Search,
  Settings,
  TrainFront,
  TramFront,
  TriangleAlert,
} from 'lucide-react';
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

function StudioSegment({
  label,
  name,
  options,
  value,
  onChange,
  columns = 2,
}: {
  label: string;
  name: string;
  options: { key: string; text: string }[];
  value: string;
  onChange: (key: string) => void;
  columns?: 2 | 4;
}) {
  return (
    <fieldset className="studio-fieldset">
      <legend>{label}</legend>
      <div className="studio-segment" data-columns={columns} role="presentation">
        {options.map((option) => (
          <label key={option.key} className="studio-segment-option">
            <input
              type="radio"
              className="sr-only"
              name={name}
              value={option.key}
              checked={value === option.key}
              onChange={() => onChange(option.key)}
            />
            <span className="studio-segment-label" data-checked={value === option.key}>
              {option.text}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

const MOCK_DEPARTURES = [
  { mode: 'tram', line: '0', destination: 'Pilczyce' },
  { mode: 'tram', line: '10', destination: 'Biskupin' },
  { mode: 'bus', line: '114', destination: 'Rynek' },
  { mode: 'train', line: 'KD', destination: 'Środa Śląska' },
] as const;

function MockRow({
  badge,
  destination,
  right,
}: {
  badge: ReactNode;
  destination: string;
  right: ReactNode;
}) {
  return (
    <div className="km-row">
      {badge}
      <span className="km-dest">{destination}</span>
      <span className="km-right">{right}</span>
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

  const phoneScreen = (
    <div
      className="km-screen"
      style={
        {
          '--k-primary': scheme.primary,
          '--k-on-primary': scheme.onPrimary,
          '--k-primary-container': scheme.primaryContainer,
          '--k-on-primary-container': scheme.onPrimaryContainer,
          '--k-tertiary-container': scheme.tertiaryContainer,
          '--k-on-tertiary-container': scheme.onTertiaryContainer,
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
          <MockRow
            badge={<MockLineBadge mode="tram" line="0" />}
            destination={MOCK_DEPARTURES[0].destination}
            right={<span className="km-now">{t.mock.now}</span>}
          />
          <MockRow
            badge={<MockLineBadge mode="tram" line="10" />}
            destination={MOCK_DEPARTURES[1].destination}
            right={
              <>
                <span className="km-eta">{t.mock.minutes(8)}</span>
                <span className="km-delay">{t.mock.delay(2)}</span>
              </>
            }
          />
          <MockRow
            badge={<MockLineBadge mode="bus" line="114" />}
            destination={MOCK_DEPARTURES[2].destination}
            right={<span className="km-eta">{t.mock.minutes(14)}</span>}
          />
          <MockRow
            badge={<MockLineBadge mode="train" line="KD" />}
            destination={MOCK_DEPARTURES[3].destination}
            right={
              <>
                <span className="km-eta">{t.mock.minutes(21)}</span>
                <span className="km-cancelled">{t.mock.cancelled}</span>
              </>
            }
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
  );

  return (
    <main className="studio-page section-shell" id="main" tabIndex={-1}>
      <header className="studio-hero">
        <a className="studio-back text-link" href="#top">
          <ArrowLeft size={17} aria-hidden="true" />
          {s.footer.back}
        </a>
        <h1>{t.title}</h1>
        <p className="studio-intro">{t.intro}</p>
      </header>

      <div className="studio-workspace">
        <section className="studio-panel" aria-labelledby="studio-controls-title">
          <div className="studio-panel-head">
            <h2 id="studio-controls-title">{t.controlsTitle}</h2>
            <p className="studio-hint">{t.controlsHint}</p>
            <div className="studio-live-swatch" aria-hidden="true">
              <span className="studio-live-swatch-dot" style={{ background: seedHex }} />
            </div>
          </div>

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
                <span className="studio-preset-name">{t.presetNames[preset.key]}</span>
              </button>
            ))}
          </div>

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
          <StudioSegment
            label={t.variantLabel}
            name="studio-variant"
            columns={2}
            value={variant}
            onChange={(key) => setVariant(key as Variant)}
            options={(Object.keys(VARIANTS) as Variant[]).map((key) => ({
              key,
              text: t.variants[key],
            }))}
          />
        </section>

        <section className="studio-preview" aria-labelledby="studio-preview-title">
          <div className="studio-preview-head">
            <h2 id="studio-preview-title">{t.previewTitle}</h2>
            <StudioSegment
              label={t.modeLabel}
              name="studio-mode"
              columns={2}
              value={mode}
              onChange={(key) => setMode(key as 'dark' | 'light')}
              options={[
                { key: 'dark', text: t.darkMode },
                { key: 'light', text: t.lightMode },
              ]}
            />
          </div>
          <div className="studio-phone-wrap">
            <Phone className="studio-phone" label={t.previewAria}>
              {phoneScreen}
            </Phone>
          </div>
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
            <button type="button" className="button button-primary studio-copy" onClick={copyCode}>
              {copyState === 'ok' ? (
                <Check size={17} aria-hidden="true" />
              ) : (
                <Copy size={17} aria-hidden="true" />
              )}
              {copyState === 'ok' ? t.copied : t.copy}
            </button>
          </div>
          <p className="studio-copy-status" role="status">
            {copyState === 'ok' ? t.copied : copyState === 'fail' ? t.copyFailed : ''}
          </p>
          <a className="studio-kofi text-link" href={KOFI_URL} target="_blank" rel="noopener noreferrer">
            {t.sendOn}
            <ArrowUpRight size={15} aria-hidden="true" />
            <span className="sr-only">{s.install.newTab}</span>
          </a>
        </section>
      </div>
    </main>
  );
}
