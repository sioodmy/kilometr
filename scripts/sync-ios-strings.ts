import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { pl } from '../src/i18n/pl';
import { en } from '../src/i18n/en';
import { de } from '../src/i18n/de';
import { uk } from '../src/i18n/uk';

const check = process.argv.includes('--check');
for (const [locale, strings] of Object.entries({ pl, en, de, uk })) {
  const file = `src/i18n/native/${locale}.json`;
  const contents = JSON.stringify({
    ios: { NSLocationWhenInUseUsageDescription: strings.ios.locationPermission },
  }, null, 2) + '\n';
  if (check) {
    if (readFileSync(file, 'utf8') !== contents) throw new Error(`${file}: npm run sync:ios-strings`);
  } else {
    mkdirSync('src/i18n/native', { recursive: true });
    writeFileSync(file, contents);
  }
}
