import { useSyncExternalStore } from 'react';
import {
  getWebLocale,
  getWebStrings,
  getWebShareStrings,
  subscribeWebLocale,
} from '../../src/i18n/web';

export { initWebLocale, setWebLocale, type Locale } from '../../src/i18n/web';

export function useWebLocale() {
  return useSyncExternalStore(subscribeWebLocale, getWebLocale, () => 'pl' as const);
}

export function useStrings() {
  useWebLocale();
  return getWebStrings();
}

export function useShareStrings() {
  useWebLocale();
  return getWebShareStrings();
}
