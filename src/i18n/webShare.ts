import { pl } from './share/pl';
import { en } from './share/en';
import { de } from './share/de';
import { uk } from './share/uk';
import type { Locale } from './web';

const shareDictionaries = { pl, en, de, uk };

export function getWebShareStrings(locale: Locale) {
  return shareDictionaries[locale];
}
