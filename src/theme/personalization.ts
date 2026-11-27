import { useSyncExternalStore } from 'react';
import { Platform } from 'react-native';
import { kvGet, kvSetStrict } from '../services/storage';
import { readDynamicColors } from './dynamic';
import { applyScheme, defaultScheme, type SchemeKey } from './tokens';

export const THEME_SEEDS = {
  teal: '#006A60',
  blue: '#315DA8',
  green: '#386A20',
  violet: '#77529A',
  rose: '#984061',
  orange: '#8B5000',
} as const;

export type ThemeSetting = 'system' | keyof typeof THEME_SEEDS;

// Prekomputowane różnice względem `defaultScheme` wygenerowane z `SchemeTonalSpot`
// (eliminują ciężki runtime'owy import `@material/material-color-utilities` przy starcie).
const PRESET_PATCHES: Record<keyof typeof THEME_SEEDS, Partial<Record<SchemeKey, string>>> = {
  teal: {
    primary: '#82d5c8',
    onPrimary: '#003732',
    primaryContainer: '#005048',
    onPrimaryContainer: '#9ef2e4',
    secondary: '#b1ccc6',
    onSecondary: '#1c3531',
    secondaryContainer: '#334b47',
    onSecondaryContainer: '#cce8e2',
    tertiary: '#adcae6',
    onTertiary: '#153349',
    tertiaryContainer: '#2d4961',
    onTertiaryContainer: '#cce5ff',
    error: '#ffb4ab',
    errorContainer: '#93000a',
    onErrorContainer: '#ffdad6',
    surface: '#0e1513',
    onSurface: '#dde4e1',
    onSurfaceVariant: '#bec9c6',
    surfaceDim: '#0e1513',
    surfaceBright: '#343a39',
    surfaceContainerLowest: '#090f0e',
    surfaceContainerLow: '#161d1c',
    surfaceContainer: '#1a2120',
    surfaceContainerHigh: '#252b2a',
    outlineVariant: '#3f4947',
    inverseSurface: '#dde4e1',
    inverseOnSurface: '#2b3230',
    inversePrimary: '#006a60',
  },
  blue: {
    primary: '#adc6ff',
    onPrimary: '#102f60',
    primaryContainer: '#2b4678',
    onPrimaryContainer: '#d8e2ff',
    secondary: '#bfc6dc',
    onSecondary: '#293041',
    secondaryContainer: '#3f4759',
    onSecondaryContainer: '#dbe2f9',
    tertiary: '#debcdf',
    onTertiary: '#402843',
    tertiaryContainer: '#583e5b',
    onTertiaryContainer: '#fbd7fc',
    error: '#ffb4ab',
    errorContainer: '#93000a',
    onErrorContainer: '#ffdad6',
    surface: '#111318',
    onSurface: '#e2e2e9',
    onSurfaceVariant: '#c4c6d0',
    surfaceDim: '#111318',
    surfaceBright: '#37393e',
    surfaceContainerLowest: '#0c0e13',
    surfaceContainerLow: '#1a1b20',
    surfaceContainer: '#1e1f25',
    surfaceContainerHigh: '#282a2f',
    surfaceContainerHighest: '#33353a',
    outline: '#8e9099',
    outlineVariant: '#44474f',
    inverseSurface: '#e2e2e9',
    inverseOnSurface: '#2f3036',
    inversePrimary: '#445e91',
  },
  green: {
    primary: '#a9d291',
    onPrimary: '#173807',
    primaryContainer: '#2d4f1c',
    onPrimaryContainer: '#c5efab',
    secondary: '#bdcbb0',
    onSecondary: '#283420',
    secondaryContainer: '#3e4a35',
    onSecondaryContainer: '#d8e7cb',
    tertiary: '#a0cfd0',
    onTertiary: '#003738',
    tertiaryContainer: '#1e4e4f',
    onTertiaryContainer: '#bbebec',
    error: '#ffb4ab',
    errorContainer: '#93000a',
    onErrorContainer: '#ffdad6',
    surface: '#11140f',
    onSurface: '#e1e4d9',
    onSurfaceVariant: '#c3c8bb',
    surfaceDim: '#11140f',
    surfaceBright: '#373a33',
    surfaceContainerLowest: '#0c0f0a',
    surfaceContainerLow: '#191d16',
    surfaceContainer: '#1d211a',
    surfaceContainerHigh: '#282b24',
    surfaceContainerHighest: '#32362f',
    outline: '#8d9286',
    outlineVariant: '#43483e',
    inverseSurface: '#e1e4d9',
    inverseOnSurface: '#2e312b',
    inversePrimary: '#446732',
  },
  violet: {
    primary: '#dbb9f9',
    onPrimary: '#3f2458',
    primaryContainer: '#563a70',
    onPrimaryContainer: '#f0dbff',
    secondary: '#d0c1d9',
    onSecondary: '#372c3f',
    secondaryContainer: '#4e4356',
    onSecondaryContainer: '#edddf6',
    tertiary: '#f3b7bd',
    onTertiary: '#4b252a',
    tertiaryContainer: '#653a40',
    onTertiaryContainer: '#ffd9dc',
    error: '#ffb4ab',
    errorContainer: '#93000a',
    onErrorContainer: '#ffdad6',
    surface: '#151217',
    onSurface: '#e8e0e8',
    onSurfaceVariant: '#cdc4ce',
    surfaceDim: '#151217',
    surfaceBright: '#3c383e',
    surfaceContainerLowest: '#100d12',
    surfaceContainerLow: '#1e1a20',
    surfaceContainer: '#221e24',
    surfaceContainerHigh: '#2c292e',
    surfaceContainerHighest: '#373339',
    outline: '#968e98',
    outlineVariant: '#4a454e',
    inverseSurface: '#e8e0e8',
    inverseOnSurface: '#332f35',
    inversePrimary: '#6f528a',
  },
  rose: {
    primary: '#ffb0c8',
    onPrimary: '#541d32',
    primaryContainer: '#703349',
    onPrimaryContainer: '#ffd9e2',
    secondary: '#e2bdc6',
    onSecondary: '#422931',
    secondaryContainer: '#5a3f47',
    onSecondaryContainer: '#ffd9e2',
    tertiary: '#efbd94',
    onTertiary: '#48290c',
    tertiaryContainer: '#623f20',
    onTertiaryContainer: '#ffdcc2',
    error: '#ffb4ab',
    errorContainer: '#93000a',
    onErrorContainer: '#ffdad6',
    surface: '#191113',
    onSurface: '#efdfe1',
    onSurfaceVariant: '#d5c2c6',
    surfaceDim: '#191113',
    surfaceBright: '#413739',
    surfaceContainerLowest: '#140c0e',
    surfaceContainerLow: '#22191c',
    surfaceContainer: '#261d20',
    surfaceContainerHigh: '#31282a',
    surfaceContainerHighest: '#3c3235',
    outline: '#9e8c90',
    outlineVariant: '#514347',
    inverseSurface: '#efdfe1',
    inverseOnSurface: '#372e30',
    inversePrimary: '#8c4a60',
  },
  orange: {
    primary: '#fdb975',
    onPrimary: '#4a2800',
    primaryContainer: '#6a3c01',
    onPrimaryContainer: '#ffdcbe',
    secondary: '#e1c1a4',
    onSecondary: '#402c18',
    secondaryContainer: '#59422d',
    onSecondaryContainer: '#ffdcbe',
    tertiary: '#c0cc9a',
    onTertiary: '#2b3410',
    tertiaryContainer: '#414b24',
    onTertiaryContainer: '#dce8b4',
    error: '#ffb4ab',
    errorContainer: '#93000a',
    onErrorContainer: '#ffdad6',
    surface: '#19120c',
    onSurface: '#efe0d5',
    onSurfaceVariant: '#d5c3b5',
    surfaceDim: '#19120c',
    surfaceBright: '#403830',
    surfaceContainerLowest: '#130d07',
    surfaceContainerLow: '#211a14',
    surfaceContainer: '#261e18',
    surfaceContainerHigh: '#302822',
    surfaceContainerHighest: '#3c332c',
    outline: '#9e8e81',
    outlineVariant: '#51453a',
    inverseSurface: '#efe0d5',
    inverseOnSurface: '#372f28',
    inversePrimary: '#865319',
  },
};

const STORAGE_KEY = 'kilometr.theme.v1';
const DEFAULT_SETTING: ThemeSetting = Platform.OS === 'web' ? 'teal' : 'system';
const listeners = new Set<() => void>();
let setting: ThemeSetting = DEFAULT_SETTING;
let wallpaperScheme: Readonly<Record<SchemeKey, string>> = defaultScheme;
let wallpaperAvailable = false;

type ThemePresets = Record<keyof typeof THEME_SEEDS, Record<SchemeKey, string>>;
const presetCache: Partial<ThemePresets> = {};
let presets: ThemePresets | null = null;

function getThemePreset(key: keyof typeof THEME_SEEDS): Record<SchemeKey, string> {
  let cached = presetCache[key];
  if (!cached) {
    cached = { ...defaultScheme, ...PRESET_PATCHES[key] };
    presetCache[key] = cached;
  }
  return cached;
}

/** Palety presetów dla ekranu personalizacji. */
export function getThemePresets(): ThemePresets {
  presets ??= Object.fromEntries(
    (Object.keys(THEME_SEEDS) as (keyof typeof THEME_SEEDS)[]).map((key) => [
      key,
      getThemePreset(key),
    ]),
  ) as ThemePresets;
  return presets;
}

function isThemeSetting(value: unknown): value is ThemeSetting {
  return typeof value === 'string' && (value === 'system' || Object.hasOwn(THEME_SEEDS, value));
}

function applySetting(next: ThemeSetting): void {
  applyScheme(next === 'system' ? wallpaperScheme : getThemePreset(next));
  setting = next;
  for (const listener of listeners) listener();
}

export async function initTheme(): Promise<void> {
  const [dynamicPatch, stored] = await Promise.all([readDynamicColors(), kvGet(STORAGE_KEY)]);
  wallpaperAvailable = dynamicPatch !== null;
  wallpaperScheme = dynamicPatch ? { ...defaultScheme, ...dynamicPatch } : defaultScheme;
  const resolved = isThemeSetting(stored) ? stored : DEFAULT_SETTING;
  // Przeglądarka nie udostępnia kolorów tapety, więc na Web wybieramy domyślny preset.
  applySetting(Platform.OS === 'web' && resolved === 'system' ? 'teal' : resolved);
}

export async function setThemeSetting(next: ThemeSetting): Promise<void> {
  if (next === setting) return;
  await kvSetStrict(STORAGE_KEY, next);
  applySetting(next);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useThemeSetting(): ThemeSetting {
  return useSyncExternalStore(subscribe, () => setting);
}

export function getWallpaperScheme(): Readonly<Record<SchemeKey, string>> {
  return wallpaperScheme;
}

export function hasWallpaperColors(): boolean {
  return wallpaperAvailable;
}
