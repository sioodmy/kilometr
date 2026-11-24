import { useSyncExternalStore } from 'react';
import { Platform } from 'react-native';
import { argbFromHex, Hct, hexFromArgb, SchemeTonalSpot } from '@material/material-color-utilities';
import { kvGet, kvSetStrict } from '../services/storage';
import { initDynamicColors } from './dynamic';
import { applyScheme, defaultScheme, scheme, type SchemeKey } from './tokens';

export const THEME_SEEDS = {
  teal: '#006A60',
  blue: '#315DA8',
  green: '#386A20',
  violet: '#77529A',
  rose: '#984061',
  orange: '#8B5000',
} as const;

export type ThemeSetting = 'system' | keyof typeof THEME_SEEDS;

const STORAGE_KEY = 'kilometr.theme.v1';
const DEFAULT_SETTING: ThemeSetting = Platform.OS === 'web' ? 'teal' : 'system';
const listeners = new Set<() => void>();
let setting: ThemeSetting = DEFAULT_SETTING;
let wallpaperScheme: Readonly<Record<SchemeKey, string>> = defaultScheme;
let wallpaperAvailable = false;

function presetScheme(seed: string): Record<SchemeKey, string> {
  const material = new SchemeTonalSpot(Hct.fromInt(argbFromHex(seed)), true, 0);
  const result = { ...defaultScheme };
  for (const key of Object.keys(result) as SchemeKey[]) {
    if (key in material) {
      const value = material[key as keyof typeof material];
      if (typeof value === 'number') result[key] = hexFromArgb(value);
    }
  }
  return result;
}

type ThemePresets = Record<keyof typeof THEME_SEEDS, Record<SchemeKey, string>>;
let presets: ThemePresets | null = null;

/**
 * Palety presetów. Liczone przy pierwszym użyciu (ekran personalizacji),
 * nie przy starcie: HCT dla sześciu seedów to zbędne millisekundy bootu.
 */
export function getThemePresets(): ThemePresets {
  presets ??= Object.fromEntries(
    Object.entries(THEME_SEEDS).map(([key, seed]) => [key, presetScheme(seed)]),
  ) as ThemePresets;
  return presets;
}

function isThemeSetting(value: unknown): value is ThemeSetting {
  return typeof value === 'string' && (value === 'system' || Object.hasOwn(THEME_SEEDS, value));
}

function applySetting(next: ThemeSetting): void {
  applyScheme(next === 'system' ? wallpaperScheme : getThemePresets()[next]);
  setting = next;
  for (const listener of listeners) listener();
}

export async function initTheme(): Promise<void> {
  applyScheme(defaultScheme);
  wallpaperAvailable = await initDynamicColors();
  wallpaperScheme = { ...scheme };
  const stored = await kvGet(STORAGE_KEY);
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
