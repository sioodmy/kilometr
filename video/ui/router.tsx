// expo-router dla zrzutów: parametry ekranu z window.uiParams, nawigacja nic nie robi.
import { useEffect, type ReactNode } from 'react';

declare global {
  interface Window {
    uiParams?: Record<string, string>;
  }
}

const noop = () => {};
export const router = { push: noop, back: noop, replace: noop, navigate: noop, setParams: noop, canGoBack: () => true, dismiss: noop };
export const useRouter = () => router;
export const useLocalSearchParams = () => window.uiParams ?? {};
export const useGlobalSearchParams = useLocalSearchParams;
export const usePathname = () => '/';
export const useSegments = () => [];
export const useNavigation = () => ({ addListener: () => noop, setOptions: noop, getState: () => ({ routes: [] }) });
export const useFocusEffect = (effect: () => void | (() => void)) => useEffect(effect, [effect]);
export const Link = ({ children }: { children?: ReactNode }) => <>{children}</>;
export const Redirect = () => null;
export const Stack = Object.assign(() => null, { Screen: () => null });
