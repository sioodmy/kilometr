import { Platform } from 'react-native';
import { getTrackingNative } from '../services/notifications/module';
import { applyScheme, type SchemeKey } from './tokens';

// Kolory Material You z tapety.
//
// Android 12+ wystawia pięć palet tonalnych, w których nazwa zasobu koduje
// ton: `system_accent1_200` to ton 20, `system_accent1_900` — ton 90. Dostępne
// tony to 0, 5, 10, 20, 30, …, 100, a powierzchnie w ciemnym motywie
// Material 3 siedzą nisko (L* 4–24). Dlatego nie bierzemy „najbliższego tonu”,
// tylko interpolujemy między dwoma tonami w przestrzeni liniowej — inaczej
// karty i tło dostałyby ten sam kolor, a schody wysokości znikłyby z ekranu.
//
// Role (L*) są dokładnie te, co w oficjalnym Material Theme Builder dla trybu
// ciemnego: akcent 80 na tle 20, kontener 30 z tekstem 90, powierzchnie 4–24
// z tekstem 90. Dzięki temu kontrast trzyma się WCAG AA niezależnie od tapety,
// a tonalna paleta jest z definicji monotoniczna.
//
// Czego z tapety nie bierzemy: błędów, ostrzeżeń i kolorów linii
// transportowych. Kolor linii to informacja, a nie dekoracja — musi być
// rozpoznawalny niezależnie od tapety.

/** Surowa paleta z natywnego modułu: `rodzina_ton` → kolor. */
type SystemPalette = Record<string, string | number | null | undefined>;

/** Rodzina palet systemowych po tonach. */
type Family = { tone: number; linear: number[]; hex: string; y: number }[];

/**
 * Kanały w przestrzeni liniowej (0..1) — w niej miesza się tony, bo dopiero
 * w niej luminancja jest liniowa, a mieszanie w sRGB rozjaśniałoby wynik.
 */
function parseLinear(hex: string): number[] | null {
  const match = /^#?([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(hex.trim());
  if (!match) return null;
  const int = Number.parseInt(match[1], 16);
  return [((int >> 16) & 255) / 255, ((int >> 8) & 255) / 255, (int & 255) / 255].map(
    (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4),
  );
}

/** Kanały liniowe → `#rrggbb`. */
function toHex(linear: number[]): string | null {
  const bytes = linear.map((c) => {
    const v = c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
    return Math.round(Math.min(1, Math.max(0, v)) * 255);
  });
  return `#${bytes.map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

/** Względna jasność wg Rec. 709 — ta sama miara, której używa kontrast WCAG. */
function relativeLuminance(linear: number[]): number {
  const [r, g, b] = linear;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Jasność, której odpowiada dany ton palety tonalnej Material (L* → Y). */
function targetLuminance(lStar: number): number {
  return lStar > 8 ? ((lStar + 16) / 116) ** 3 : lStar / 903.3;
}

/**
 * Kolor rodziny o jasności `targetL`. Interpolujemy po liniowej przestrzeni
 * RGB między sąsiednimi tonami — oba końce leżą na tej samej palecie, więc
 * wynik zostaje w gamutie i zachowuje barwę.
 */
function toneAt(family: Family, targetL: number): string | null {
  if (family.length === 0) return null;
  const target = targetLuminance(targetL);
  if (target <= family[0].y) return family[0].hex;
  const last = family[family.length - 1];
  if (target >= last.y) return last.hex;
  for (let i = 0; i < family.length - 1; i++) {
    const a = family[i];
    const b = family[i + 1];
    if (target < a.y || target > b.y) continue;
    const span = b.y - a.y;
    const t = span > 0 ? (target - a.y) / span : 0;
    const mixed = a.linear.map((v, k) => v + (b.linear[k] - v) * t);
    return toHex(mixed) ?? a.hex;
  }
  return last.hex;
}

function collect(palette: SystemPalette, family: string): Family {
  const out: Family = [];
  const matcher = new RegExp(`^${family}_(\\d+)$`);
  for (const [key, value] of Object.entries(palette)) {
    const match = matcher.exec(key);
    if (!match || typeof value !== 'string') continue;
    const linear = parseLinear(value);
    if (!linear) continue;
    out.push({
      tone: Number(match[1]),
      linear,
      hex: toHex(linear) ?? value,
      y: relativeLuminance(linear),
    });
  }
  return out.sort((a, b) => a.y - b.y);
}

/**
 * Role motywu ciemnego w skali L* — te same, co w Material Theme Builder
 * (primary P80 na onPrimary P20, kontener P30 z P90, powierzchnie N4–N24).
 */
const ROLE_L: Record<string, [family: string, lStar: number]> = {
  primary: ['accent1', 80],
  onPrimary: ['accent1', 20],
  primaryContainer: ['accent1', 30],
  onPrimaryContainer: ['accent1', 90],

  secondary: ['accent2', 80],
  onSecondary: ['accent2', 20],
  secondaryContainer: ['accent2', 30],
  onSecondaryContainer: ['accent2', 90],

  tertiary: ['accent3', 80],
  onTertiary: ['accent3', 20],
  tertiaryContainer: ['accent3', 30],
  onTertiaryContainer: ['accent3', 90],

  surfaceContainerLowest: ['neutral1', 4],
  surfaceDim: ['neutral1', 6],
  surface: ['neutral1', 6],
  surfaceContainerLow: ['neutral1', 10],
  surfaceContainer: ['neutral1', 12],
  surfaceContainerHigh: ['neutral1', 17],
  surfaceContainerHighest: ['neutral1', 22],
  surfaceBright: ['neutral1', 24],
  onSurface: ['neutral1', 90],

  onSurfaceVariant: ['neutral2', 80],
  outline: ['neutral2', 60],
  outlineVariant: ['neutral2', 30],

  inverseSurface: ['neutral1', 90],
  inverseOnSurface: ['neutral1', 20],
  inversePrimary: ['accent1', 40],
};

/**
 * Buduje paletę motywu z surowych tonów systemu. Role, dla których w palecie
 * brakuje tonu (albo system ich nie wystawia), pomijamy — wtedy zostaje
 * wartość startowa motywu.
 */
export function paletteFromSystem(raw: SystemPalette): Partial<Record<SchemeKey, string>> {
  const families: Record<string, Family> = {
    accent1: collect(raw, 'accent1'),
    accent2: collect(raw, 'accent2'),
    accent3: collect(raw, 'accent3'),
    neutral1: collect(raw, 'neutral1'),
    neutral2: collect(raw, 'neutral2'),
  };
  const out: Partial<Record<SchemeKey, string>> = {};
  for (const [role, [family, lStar]] of Object.entries(ROLE_L)) {
    const picked = toneAt(families[family] ?? [], lStar);
    if (picked) out[role as SchemeKey] = picked;
  }
  return out;
}

/**
 * Wczytuje kolory tapety i podmienia paletę. Wołane przed pierwszym renderem
 * z `app/_layout`, więc ekran od razu startuje w kolorach systemu.
 *
 * Zwraca `true`, gdy motyw faktycznie poszedł z tapety — do logów i testów.
 */
export async function initDynamicColors(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  if (typeof Platform.Version === 'number' && Platform.Version < 31) return false;
  // Kolory czytamy tym samym lokalnym modułem co powiadomienia — to jedyny
  // most do natywy w tej aplikacji, a szukanie drugiego nic nie wnosi.
  const native = getTrackingNative();
  if (typeof native?.getSystemPalette !== 'function') return false;
  try {
    const patch = paletteFromSystem((await native.getSystemPalette()) ?? {});
    if (Object.keys(patch).length === 0) return false;
    applyScheme(patch);
    return true;
  } catch {
    // Brak modułu (Expo Go) albo brak zasobów — zostaje własna paleta.
    return false;
  }
}