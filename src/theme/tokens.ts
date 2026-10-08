// Material 3 (Material You) Dark scheme — seed: Wrocław MPK teal (#006A60).
// Hand-built M3 Dark tonal palette with deep surfaces and vibrant tonal containers.
//
// Paleta jest zmienna, bo na Androidzie 12+ podmieniamy ją na kolory z tapety
// (patrz `dynamic.ts`). Role, których nie da się przeliczyć z tapety (błędy,
// ostrzeżenia, kolory linii), zostają statyczne — kolor linii to informacja,
// a nie dekoracja.
import { StyleSheet } from 'react-native';

export type SchemeKey =
  | 'primary' | 'onPrimary' | 'primaryContainer' | 'onPrimaryContainer'
  | 'secondary' | 'onSecondary' | 'secondaryContainer' | 'onSecondaryContainer'
  | 'tertiary' | 'onTertiary' | 'tertiaryContainer' | 'onTertiaryContainer'
  | 'error' | 'onError' | 'errorContainer' | 'onErrorContainer'
  | 'surface' | 'onSurface' | 'onSurfaceVariant'
  | 'surfaceDim' | 'surfaceBright'
  | 'surfaceContainerLowest' | 'surfaceContainerLow' | 'surfaceContainer'
  | 'surfaceContainerHigh' | 'surfaceContainerHighest'
  | 'outline' | 'outlineVariant'
  | 'inverseSurface' | 'inverseOnSurface' | 'inversePrimary' | 'scrim'
  | 'success' | 'onSuccess' | 'successContainer' | 'onSuccessContainer'
  | 'warning' | 'onWarning' | 'warningContainer' | 'onWarningContainer';

export const scheme: Record<SchemeKey, string> = {
  // Primary (vibrant teal in dark mode for high accessibility and contrast)
  primary: '#5CDBBE',
  onPrimary: '#003831',
  primaryContainer: '#005047',
  onPrimaryContainer: '#7DF8DE',

  // Secondary (teal-tinted slate for secondary containers & chips)
  secondary: '#B1CCC5',
  onSecondary: '#1C3530',
  secondaryContainer: '#334B46',
  onSecondaryContainer: '#CDE8E1',

  // Tertiary (atmospheric blue tone for transit links and waypoints)
  tertiary: '#A5CCE8',
  onTertiary: '#07354B',
  tertiaryContainer: '#244C63',
  onTertiaryContainer: '#C4E7FF',

  // Error (M3 standard dark)
  error: '#FFB4AB',
  onError: '#690005',
  errorContainer: '#93000A',
  onErrorContainer: '#FFDAD6',

  // Surface scale (M3 dark elevation surfaces: deep obsidian with subtle cool undertones)
  surface: '#111414',
  onSurface: '#E0E3E1',
  onSurfaceVariant: '#BFC9C5',
  surfaceDim: '#0E1513',
  surfaceBright: '#373A39',
  surfaceContainerLowest: '#0C0F0E',
  surfaceContainerLow: '#171D1C',
  surfaceContainer: '#1B2120',
  surfaceContainerHigh: '#252B2A',
  surfaceContainerHighest: '#303635',

  // Outline & borders
  outline: '#899390',
  outlineVariant: '#3F4946',

  // Inverse
  inverseSurface: '#DEE4E1',
  inverseOnSurface: '#2B3230',
  inversePrimary: '#006A5F',
  scrim: '#000000',

  // Semantic transit statuses (tonal dark mode)
  success: '#7DD895',
  onSuccess: '#003914',
  successContainer: '#005321',
  onSuccessContainer: '#98F5AF',

  warning: '#FFB957',
  onWarning: '#452B00',
  warningContainer: '#633F00',
  onWarningContainer: '#FFDDB5',
};

// ─── Skąd braliśmy kolory ────────────────────────────────────────────────────
//
// `StyleSheet.create` w dev zamraża obiekty, które mu podamy, więc nie możemy
// dołożyć do nich kolorów po fakcie. Dlatego przy rejestrowaniu arkusza
// zostawiamy sobie OryGINAŁ, a React Native'owi oddajemy jego kopię. Dzięki
// temu `applyScheme` przemalowuje style powstałe na starcie modułu, a zachowanie
// dev i release jest identyczne.
type StyleSheetLike = Record<string, Record<string, unknown> | undefined>;
const createdSheets: StyleSheetLike[] = [];
let hookInstalled = false;

function installStyleSheetHook(): void {
  if (hookInstalled) return;
  hookInstalled = true;
  const original = StyleSheet.create.bind(StyleSheet) as (
    obj: StyleSheetLike,
  ) => StyleSheetLike;
  (StyleSheet as unknown as { create: (obj: StyleSheetLike) => StyleSheetLike }).create = (
    obj,
  ) => {
    const copy: StyleSheetLike = {};
    for (const key in obj) copy[key] = { ...obj[key] };
    try {
      original(copy);
    } catch {
      // Arkusz spoza naszego motywu — zostawiamy go w spokoju.
    }
    createdSheets.push(obj);
    return obj;
  };
}
installStyleSheetHook();

/** Wartości startowe — na nich opieramy podmianę hexów w stylach. */
const seedScheme: Record<string, string> = { ...scheme };

/** Przemalowuje wcześniej utworzone arkusze stylów na nową paletę. */
function repaintStyles(next: Record<SchemeKey, string>): void {
  const from = new Map<string, string>();
  for (const key of Object.keys(seedScheme) as SchemeKey[]) {
    const before = seedScheme[key];
    const after = next[key];
    if (before !== after) from.set(before.toLowerCase(), after);
  }
  if (from.size === 0) return;
  const swap = (value: unknown): unknown => {
    if (typeof value === 'string') return from.get(value.toLowerCase()) ?? value;
    if (Array.isArray(value)) return value.map(swap);
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const key in value as Record<string, unknown>) out[key] = swap((value as Record<string, unknown>)[key]);
      return out;
    }
    return value;
  };
  for (const sheet of createdSheets) {
    for (const key in sheet) {
      const style = sheet[key];
      if (!style || typeof style !== 'object') continue;
      const swapped = swap(style) as Record<string, unknown>;
      for (const prop in swapped) delete (style as Record<string, unknown>)[prop];
      Object.assign(style as Record<string, unknown>, swapped);
    }
  }
}

// ─── Back-compat aliases ─────────────────────────────────────────────────────
type ColorKey =
  | 'bg' | 'card' | 'ink' | 'muted' | 'faint' | 'line'
  | 'primary' | 'primaryDark' | 'primarySoft'
  | 'accent' | 'accentSoft'
  | 'success' | 'successSoft' | 'danger' | 'dangerSoft'
  | 'warning' | 'warningSoft'
  | 'lineTram' | 'lineBus' | 'lineTrain' | 'lineNight' | 'walk';

export const colors: Record<ColorKey, string> = {
  bg: scheme.surface,
  card: scheme.surfaceContainer,
  ink: scheme.onSurface,
  muted: scheme.onSurfaceVariant,
  faint: '#6E7875',
  line: scheme.outlineVariant,
  primary: scheme.primary,
  primaryDark: '#005047',
  primarySoft: scheme.secondaryContainer,
  accent: scheme.tertiary,
  accentSoft: scheme.tertiaryContainer,
  success: scheme.success,
  successSoft: scheme.successContainer,
  danger: scheme.error,
  dangerSoft: scheme.errorContainer,
  warning: scheme.warning,
  warningSoft: scheme.warningContainer,
  // Functional transit line coding (high legibility on dark surfaces)
  lineTram: '#00A896',
  lineBus: '#2979FF',
  // Pociągi KD: bursztyn z motywu (czytelny na ciemnym, w rodzinie warning),
  // kiwający w stronę żółci brandingu KD. Statyczny jak reszta linii.
  lineTrain: '#FFB957',
  lineNight: '#B39DDB',
  walk: scheme.onSurfaceVariant,
};

/**
 * Podmienia paletę na kolory z tapety (Material You).
 *
 * Robimy to PRZED pierwszym renderem (`initDynamicColors` w `_layout`), więc
 * nie ma potrzeby przerysowywać drzewa — wystarczy zaktualizować obiekty
 * motywu i arkusze stylów powstałe przy imporcie modułów.
 */
export function applyScheme(next: Partial<Record<SchemeKey, string>>): void {
  for (const key of Object.keys(next) as SchemeKey[]) {
    const value = next[key];
    if (typeof value === 'string' && value) scheme[key] = value;
  }
  colors.bg = scheme.surface;
  colors.card = scheme.surfaceContainer;
  colors.ink = scheme.onSurface;
  colors.muted = scheme.onSurfaceVariant;
  colors.faint = scheme.outline;
  colors.line = scheme.outlineVariant;
  colors.primary = scheme.primary;
  colors.primaryDark = scheme.primaryContainer;
  colors.primarySoft = scheme.secondaryContainer;
  colors.accent = scheme.tertiary;
  colors.accentSoft = scheme.tertiaryContainer;
  colors.success = scheme.success;
  colors.successSoft = scheme.successContainer;
  colors.danger = scheme.error;
  colors.dangerSoft = scheme.errorContainer;
  colors.warning = scheme.warning;
  colors.warningSoft = scheme.warningContainer;
  colors.walk = scheme.onSurfaceVariant;
  repaintStyles(scheme);
}

// ─── M3 shape scale ──────────────────────────────────────────────────────────
export const shape = {
  extraSmall: 4,
  small: 8,
  medium: 12,
  large: 16,
  extraLarge: 28,
  full: 999,
} as const;

export const radius = {
  sm: shape.small,
  md: shape.medium,
  lg: shape.large,
  xl: shape.extraLarge,
  full: shape.full,
} as const;

export const spacing = { xs: 6, sm: 10, md: 14, lg: 18, xl: 24, xxl: 32 } as const;

// ─── M3 elevation: tonal surfaces do the heavy lifting, shadows stay subtle ─
export const elev = {
  level0: { elevation: 0 },
  level1: {
    shadowColor: '#000000',
    shadowOpacity: 0.08,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  level2: {
    shadowColor: '#000000',
    shadowOpacity: 0.1,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  level3: {
    shadowColor: '#000000',
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 5 },
    elevation: 6,
  },
} as const;

export const shadow = {
  card: elev.level1,
  sheet: elev.level3,
} as const;

// ─── M3 type scale (sizes + weights; letterSpacing applied inline) ──────────
export const type = {
  displaySmall: { fontSize: 36, fontWeight: '400' },
  headlineSmall: { fontSize: 24, fontWeight: '400' },
  titleLarge: { fontSize: 22, fontWeight: '400' },
  titleMedium: { fontSize: 16, fontWeight: '500' },
  titleSmall: { fontSize: 14, fontWeight: '500' },
  bodyLarge: { fontSize: 16, fontWeight: '400' },
  bodyMedium: { fontSize: 14, fontWeight: '400' },
  bodySmall: { fontSize: 12, fontWeight: '400' },
  labelLarge: { fontSize: 14, fontWeight: '500' },
  labelMedium: { fontSize: 12, fontWeight: '500' },
  labelSmall: { fontSize: 11, fontWeight: '500' },
} as const;

export const font = {
  family: undefined as string | undefined,
  sizes: { hero: 30, title: 22, body: 15, small: 13, tiny: 11 },
} as const;
