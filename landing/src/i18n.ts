import { useSyncExternalStore } from 'react';
import {
  getDefaultWebStrings,
  getWebLocale,
  getWebStrings,
  subscribeWebLocale,
} from '../../src/i18n/web';

export { initWebLocale, setWebLocale, type Locale } from '../../src/i18n/web';

export function useWebLocale() {
  return useSyncExternalStore(subscribeWebLocale, getWebLocale, () => 'pl' as const);
}

export function useStrings() {
  return useSyncExternalStore(subscribeWebLocale, getWebStrings, getDefaultWebStrings);
}
