// Material 3 (Material You) light scheme — seed: MPK teal.
// Hand-built tonal palette in the M3 baseline style. When real dynamic-color
// lands (Android 12+ wallpaper extraction), replace `scheme` generation only.
export const scheme = {
  primary: '#006A60',
  onPrimary: '#FFFFFF',
  primaryContainer: '#70F7DC',
  onPrimaryContainer: '#00201B',
  secondary: '#4A6360',
  onSecondary: '#FFFFFF',
  secondaryContainer: '#CCE8E2',
  onSecondaryContainer: '#06201C',
  tertiary: '#446179',
  onTertiary: '#FFFFFF',
  tertiaryContainer: '#CDE5FF',
  onTertiaryContainer: '#001E31',
  error: '#BA1A1A',
  onError: '#FFFFFF',
  errorContainer: '#FFDAD6',
  onErrorContainer: '#410002',
  surface: '#F4FBF8',
  onSurface: '#161D1C',
  onSurfaceVariant: '#3F4947',
  surfaceDim: '#D8E2DF',
  surfaceBright: '#F4FBF8',
  surfaceContainerLowest: '#FFFFFF',
  surfaceContainerLow: '#EDF5F2',
  surfaceContainer: '#E7EFEC',
  surfaceContainerHigh: '#E1E9E6',
  surfaceContainerHighest: '#DBE4E1',
  outline: '#6F7976',
  outlineVariant: '#BEC9C5',
  inverseSurface: '#2B3231',
  inverseOnSurface: '#ECF2F0',
  inversePrimary: '#5CDBBE',
  scrim: '#000000',
  // M3 has no semantic success/warning — transit needs them, tonal style:
  success: '#146C2E',
  onSuccess: '#FFFFFF',
  successContainer: '#B7F0C0',
  onSuccessContainer: '#00210B',
  warning: '#7C4D00',
  onWarning: '#FFFFFF',
  warningContainer: '#FFDFA6',
  onWarningContainer: '#2A1800',
} as const;

// ─── Back-compat aliases (existing components keep compiling) ────────────────
export const colors = {
  bg: scheme.surface,
  card: scheme.surfaceContainerLow,
  ink: scheme.onSurface,
  muted: scheme.onSurfaceVariant,
  faint: '#727876',
  line: scheme.outlineVariant,
  primary: scheme.primary,
  primaryDark: '#005049',
  primarySoft: scheme.secondaryContainer,
  accent: scheme.tertiary,
  accentSoft: scheme.tertiaryContainer,
  success: scheme.success,
  successSoft: scheme.successContainer,
  danger: scheme.error,
  dangerSoft: scheme.errorContainer,
  warning: scheme.warning,
  warningSoft: scheme.warningContainer,
  // Functional transit line coding (Google Maps-style saturated pills)
  lineTram: '#006A60',
  lineBus: '#0B57D0',
  lineNight: '#301878',
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
