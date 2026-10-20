/**
 * Sprawdza spójność mapy kolorów badge'a w module widgetów Androida z paletą TS.
 * WidgetParts.kt mapuje hex -> shape res/, więc każda zmiana palety
 * w lineIdentity.ts wymaga dedykowanego drawabla. Skrypt pilnuje obu stron.
 */
import { readFileSync, existsSync } from 'fs';
import {
  TRANSIT_PALETTE,
  TRAIN_BADGE_BG,
  CABLE_BADGE_BG,
  TROLLEY_BADGE_BG,
  SUBWAY_BADGE_BG,
  SUBWAY_BADGE_FALLBACK_BG,
} from '../src/services/lineIdentity';

let failures = 0;
function check(label: string, cond: boolean, detail = '') {
  console.log(`  ${cond ? 'PASS' : 'FAIL'} ${label}${detail ? `: ${detail}` : ''}`);
  if (!cond) failures++;
}

const norm = (h: string) => h.trim().replace(/^#/, '').toUpperCase();

const KOTLIN =
  'modules/kilometr-widgets/android/src/main/java/app/kilometr/widgets/WidgetParts.kt';
const DRAWABLE_DIR = 'modules/kilometr-widgets/android/src/main/res/drawable';

console.log('=== Spójność badge\'a linii: paleta TS vs mapa widgetu Androida ===');

// Klucz = hex, wartość = nazwa drawabla w res/drawable.
const hexToDrawable = new Map<string, string>();
const drawableFiles = new Set<string>();
const src = readFileSync(KOTLIN, 'utf8');
for (const m of src.matchAll(/"([0-9A-Fa-f]{6})" -> R\.drawable\.(kw_badge_\w+)/g)) {
  const hex = m[1].toUpperCase();
  if (hexToDrawable.has(hex)) {
    check(`Mapa Kotlin: duplikat ${hex}`, false);
  }
  hexToDrawable.set(hex, m[2]);
}
for (const m of src.matchAll(/R\.drawable\.(kw_badge_\w+)/g)) {
  drawableFiles.add(m[1]);
}

const tsBgs = new Set([
  ...TRANSIT_PALETTE,
  TRAIN_BADGE_BG,
  CABLE_BADGE_BG,
  TROLLEY_BADGE_BG,
  SUBWAY_BADGE_FALLBACK_BG,
  ...Object.values(SUBWAY_BADGE_BG),
].map(norm));

// Stałe semantyczne poza paletą: nazwa drawabla -> hex z lineIdentity.
const semantic: Record<string, string> = {
  kw_badge_train: norm(TRAIN_BADGE_BG),
  kw_badge_cable: norm(CABLE_BADGE_BG),
  kw_badge_m1: norm(SUBWAY_BADGE_BG.M1),
  kw_badge_m2: norm(SUBWAY_BADGE_BG.M2),
  kw_badge_walk: '',
  kw_badge_container: '',
};

// 1. Każdy bg, który apka może wysłać w snapshot, ma wpis w mapie Kotlin.
{
  const missing = [...tsBgs].filter((h) => !hexToDrawable.has(h));
  check(
    `Paleta TS (${tsBgs.size}) pokryta mapą Kotlin`,
    missing.length === 0,
    missing.length ? `brak: ${missing.join(', ')}` : 'complete',
  );
}

// 2. Mapa nie przeciąga martwych kolorów.
{
  const stale = [...hexToDrawable.keys()].filter((h) => !tsBgs.has(h));
  check(
    'Mapa Kotlin nie zawiera nieużywanych hexów',
    stale.length === 0,
    stale.length ? `nieużywane: ${stale.join(', ')}` : 'complete',
  );
}

// 3. Każdy hex z mapy wskazuje shape z tym samym kolorem.
{
  const expected: Array<[string, string]> = [...hexToDrawable].map(([hex, name]) => [
    name,
    semantic[name] ?? hex.toUpperCase(),
  ]);
  const bad: string[] = [];
  for (const [name, hex] of expected) {
    const path = `${DRAWABLE_DIR}/${name}.xml`;
    const xml = existsSync(path) ? readFileSync(path, 'utf8') : '';
    if (!xml.includes(`<solid android:color="#${hex}"`)) {
      bad.push(`${name}: brak <solid #${hex}`);
    }
  }
  const allFiles = [...hexToDrawable.values()].every((n) => existsSync(`${DRAWABLE_DIR}/${n}.xml`));
  check('Pliki drawabli istnieją', allFiles);
  check('Każdy shape ma właściwy kolor', bad.length === 0, bad.join(', '));
}

// 4. Walk i container: @color, żeby swap motywu w values-v31 działał bez zmian w mapie.
{
  const walkOk = readFileSync(`${DRAWABLE_DIR}/kw_badge_walk.xml`, 'utf8')
    .includes('@color/kw_surface_high');
  const containerOk = readFileSync(`${DRAWABLE_DIR}/kw_badge_container.xml`, 'utf8')
    .includes('@color/kw_primary_container');
  check('kw_badge_walk tło = @color/kw_surface_high', walkOk);
  check('kw_badge_container tło = @color/kw_primary_container', containerOk);
}

// 5. Odporność na format hex: badgeBgResource musi usuwać prefiks # przed dopasowaniem.
{
  const stripsHash = src.includes('removePrefix("#")');
  check('badgeBgResource usuwa prefiks # przed dopasowaniem', stripsHash);
}

// 6. Bezpieczeństwo kontrastu: fallback container nie dziedziczy fg z jasnego tła.
{
  const containerContrastSafe =
    src.includes('context.getColor(R.color.kw_on_primary_container)') &&
    src.includes('ColorUtils.calculateContrast');
  check('lineBadge chroni kontrast (kw_on_primary_container + ColorUtils)', containerContrastSafe);
}

console.log('────────────────────────────────────────────────────────────');
console.log(`Wynik: ${failures === 0 ? 'WSZYSTKO OK' : `${failures} BŁĘDÓW`}`);

if (failures > 0) {
  process.exit(1);
}
