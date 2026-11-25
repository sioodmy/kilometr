import { useCallback, useEffect, useRef, type RefObject } from 'react';
import { BackHandler } from 'react-native';
import type BottomSheet from '@gorhom/bottom-sheet';

interface UseSheetBackHandlerOptions {
  /** Wywoływane przed zamknięciem arkusza (np. cofnięcie podwidoku). Zwrócenie `true` zatrzymuje zamykanie. */
  onBeforeClose?: () => boolean;
}

/**
 * Obsługuje systemowy gest wstecz dla arkuszy `@gorhom/bottom-sheet`:
 * pierwsze cofnięcie zamyka arkusz animacją, drugie (lub brak refa) domyka go natychmiast,
 * żeby gest wstecz nigdy nie był połykany.
 */
export function useSheetBackHandler(
  sheetRef: RefObject<BottomSheet | null>,
  onClose: () => void,
  options?: UseSheetBackHandlerOptions,
) {
  const closingRef = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const onBeforeCloseRef = useRef(options?.onBeforeClose);
  onBeforeCloseRef.current = options?.onBeforeClose;

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (onBeforeCloseRef.current?.()) {
        return true;
      }
      if (closingRef.current || !sheetRef.current) {
        onCloseRef.current();
        return true;
      }
      closingRef.current = true;
      sheetRef.current.close();
      return true;
    });
    return () => sub.remove();
  }, [sheetRef]);

  const onSheetChange = useCallback((index: number) => {
    if (index >= 0) {
      closingRef.current = false;
    }
  }, []);

  return { onSheetChange };
}
