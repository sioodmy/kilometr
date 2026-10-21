import assert from 'node:assert/strict';
import Module, { createRequire } from 'node:module';
import { argbFromHex, hexFromArgb, themeFromSourceColor } from '@material/material-color-utilities';

const require = createRequire(import.meta.url);
const rn = require('react-native');
let stored: string | null = null;
let failWrite = false;
let nativeAvailable = false;
const source = themeFromSourceColor(argbFromHex('#9B405D'));
const rawPalette: Record<string, string> = {};
for (const [family, palette] of Object.entries({
  accent1: source.palettes.primary,
  accent2: source.palettes.secondary,
  accent3: source.palettes.tertiary,
  neutral1: source.palettes.neutral,
  neutral2: source.palettes.neutralVariant,
})) {
  for (const tone of [0, 5, 10, 20, 30, 40, 50, 60, 70, 80, 90, 95, 100]) {
    rawPalette[`${family}_${tone * 10}`] = hexFromArgb(palette.tone(tone));
  }
}

const loader = Module as unknown as {
  _load: (request: string, parent: { filename?: string }, ...rest: unknown[]) => unknown;
};
const original = loader._load;
loader._load = function (request, parent, ...rest) {
  if (parent?.filename?.includes('/src/theme/')) {
    if (request === '../services/storage') {
      return {
        kvGet: async () => stored,
        kvSetStrict: async (_key: string, value: string) => {
          if (failWrite) throw new Error('write failed');
          stored = value;
        },
      };
    }
    if (request === '../services/notifications/module') {
      return {
        getTrackingNative: () =>
          nativeAvailable ? { getSystemPalette: async () => rawPalette } : null,
      };
    }
  }
  return original.call(this, request, parent, ...rest);
};

const {
  scheme,
  colors,
  defaultScheme,
}: typeof import('../src/theme/tokens') = require('../src/theme/tokens');
const {
  initTheme,
  setThemeSetting,
  THEME_PRESETS,
  hasWallpaperColors,
}: typeof import('../src/theme/personalization') = require('../src/theme/personalization');

function luminance(hex: string): number {
  const linear = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrast(a: string, b: string): number {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

async function main() {
  const early = rn.StyleSheet.create({
    card: {
      color: scheme.primary,
      backgroundColor: scheme.surface,
      borderColor: scheme.primary + '80',
    },
  });
  rn.Platform.OS = 'ios';
  stored = 'invalid';
  await initTheme();
  assert.deepEqual(scheme, defaultScheme);
  assert.equal(hasWallpaperColors(), false);

  await setThemeSetting('blue');
  assert.equal(stored, 'blue');
  const late = rn.StyleSheet.create({
    card: { color: scheme.primary, backgroundColor: scheme.surface },
  });
  await setThemeSetting('rose');
  assert.equal(early.card.color, THEME_PRESETS.rose.primary);
  assert.equal(late.card.color, THEME_PRESETS.rose.primary);
  assert.equal(early.card.borderColor, THEME_PRESETS.rose.primary + '80');
  assert.equal(colors.primary, scheme.primary);
  await setThemeSetting('system');
  assert.deepEqual(scheme, defaultScheme);
  assert.equal(early.card.color, defaultScheme.primary);
  assert.equal(late.card.color, defaultScheme.primary);
  assert.equal(late.card.backgroundColor, defaultScheme.surface);

  failWrite = true;
  await assert.rejects(setThemeSetting('green'));
  assert.equal(stored, 'system');
  assert.deepEqual(scheme, defaultScheme);
  failWrite = false;
  stored = 'violet';
  await initTheme();
  assert.deepEqual(scheme, THEME_PRESETS.violet);

  rn.Platform.OS = 'android';
  rn.Platform.Version = 36;
  nativeAvailable = true;
  stored = null;
  await initTheme();
  assert.equal(hasWallpaperColors(), true);
  assert.equal(scheme.primary, hexFromArgb(source.palettes.primary.tone(80)));
  const wallpaper = { ...scheme };
  await setThemeSetting('orange');
  await setThemeSetting('system');
  assert.deepEqual(scheme, wallpaper);
  nativeAvailable = false;
  await initTheme();
  assert.equal(hasWallpaperColors(), false);
  assert.deepEqual(scheme, defaultScheme);
  nativeAvailable = true;
  rn.Platform.Version = 30;
  await initTheme();
  assert.equal(hasWallpaperColors(), false);

  const pairs = [
    ['onPrimary', 'primary'],
    ['onPrimaryContainer', 'primaryContainer'],
    ['onSecondary', 'secondary'],
    ['onSecondaryContainer', 'secondaryContainer'],
    ['onTertiary', 'tertiary'],
    ['onTertiaryContainer', 'tertiaryContainer'],
    ['onSurface', 'surface'],
    ['onSurface', 'surfaceContainer'],
    ['onSurfaceVariant', 'surfaceContainerLow'],
    ['onSurfaceVariant', 'primaryContainer'],
    ['onSurface', 'primaryContainer'],
    ['onError', 'error'],
  ] as const;
  let minimum = Infinity;
  for (const [name, palette] of Object.entries(THEME_PRESETS)) {
    for (const [text, background] of pairs) {
      const ratio = contrast(palette[text], palette[background]);
      assert.ok(ratio >= 4.5, `${name}: ${text}/${background} = ${ratio.toFixed(2)}`);
      minimum = Math.min(minimum, ratio);
    }
    for (const key of [
      'success',
      'onSuccess',
      'warning',
      'onWarning',
      'error',
      'onError',
    ] as const) {
      assert.equal(palette[key].toLowerCase(), defaultScheme[key].toLowerCase());
    }
  }
  console.log(
    `PASS: zapis, odczyt, błąd zapisu, Material You, fallback, wielokrotne zmiany stylów i ${pairs.length * 6} par kolorów (minimum ${minimum.toFixed(2)}:1).`,
  );
}

void main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
