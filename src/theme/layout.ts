import { createElement, useEffect, useRef } from 'react';
import { Platform, View, useWindowDimensions, type ViewStyle } from 'react-native';
import { scheme, shape } from './tokens';

/** Górny odstęp w wycentrowanych dialogach desktopowych zamiast uchwytu przeciągania. */
export const DESKTOP_SHEET_TOP_SPACER_HEIGHT = 18;

/** Pusty dystans górny dla arkuszy @gorhom/bottom-sheet wyświetlanych jako dialogi na desktopie. */
export function DesktopSheetTopSpacer() {
  return createElement(View, { style: { height: DESKTOP_SHEET_TOP_SPACER_HEIGHT } });
}

export interface WebLayoutInfo {
  width: number;
  height: number;
  isWeb: boolean;
  /** >= 768px na webie: boczny rail nawigacji (80px) oraz wycentrowane dialogi. */
  isMedium: boolean;
  /** >= 1024px na webie: pełny sidebar (244px) i układy dwukolumnowe. */
  isDesktop: boolean;
  /** >= 1280px na webie: rozszerzone układy dwukolumnowe (np. ekran główny). */
  isWide: boolean;
  sidebarWidth: number;
  contentWidth: number;
}

/** Zwraca breakpointy i wymiary obszaru roboczego dla responsywnego layoutu Web PWA. */
export function useWebLayout(): WebLayoutInfo {
  const { width, height } = useWindowDimensions();
  const isWeb = Platform.OS === 'web';
  const isMedium = isWeb && width >= 768;
  const isDesktop = isWeb && width >= 1024;
  const isWide = isWeb && width >= 1280;
  const sidebarWidth = isDesktop ? 244 : isMedium ? 80 : 0;
  const contentWidth = Math.max(320, width - sidebarWidth);

  return {
    width,
    height,
    isWeb,
    isMedium,
    isDesktop,
    isWide,
    sidebarWidth,
    contentWidth,
  };
}

export interface DesktopSheetProps {
  detached: boolean;
  bottomInset: number;
  sheetStyle: ViewStyle | undefined;
  backgroundExtraStyle: ViewStyle | undefined;
  innerWidth: number;
}

/** Wspólne parametry pozycjonowania arkuszy @gorhom/bottom-sheet jako wycentrowanych dialogów na desktopie. */
export function getDesktopSheetProps(
  layout: WebLayoutInfo,
  insetsBottom: number,
  maxWidth = 560,
  sheetHeight?: number,
): DesktopSheetProps {
  if (!layout.isMedium) {
    return {
      detached: false,
      bottomInset: insetsBottom,
      sheetStyle: undefined,
      backgroundExtraStyle: undefined,
      innerWidth: layout.width,
    };
  }
  const innerWidth = Math.min(maxWidth, Math.max(360, layout.contentWidth - 48));
  const sideMargin = Math.max(24, Math.floor((layout.contentWidth - innerWidth) / 2));
  const bottomInset =
    sheetHeight != null && Number.isFinite(sheetHeight) && sheetHeight > 0
      ? Math.max(24, Math.floor((layout.height - sheetHeight) / 2))
      : Math.max(24, Math.min(48, Math.round(layout.height * 0.06)));

  return {
    detached: true,
    bottomInset,
    sheetStyle: { marginHorizontal: sideMargin },
    backgroundExtraStyle: {
      borderRadius: shape.extraLarge,
      borderWidth: 2,
      borderColor: scheme.outlineVariant,
    },
    innerWidth,
  };
}

/** Zamyka aktywny arkusz lub dialog klawiszem Escape w przeglądarce desktopowej. */
export function useEscapeKey(enabled: boolean, onEscape: () => void): void {
  const callbackRef = useRef(onEscape);
  callbackRef.current = onEscape;

  useEffect(() => {
    if (Platform.OS !== 'web' || !enabled || typeof window === 'undefined') return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        callbackRef.current();
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [enabled]);
}
