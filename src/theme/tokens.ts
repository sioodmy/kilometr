// Material 3 (Material You) Dark scheme — seed: Wrocław MPK teal (#006A60).
// Hand-built M3 Dark tonal palette with deep surfaces and vibrant tonal containers.
export const scheme = {
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
} as const;

// ─── Back-compat aliases ─────────────────────────────────────────────────────
export const colors = {
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
  lineNight: '#B39DDB',
  walk: scheme.onSurfaceVariant,
} as const;

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
