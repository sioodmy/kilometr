import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo';

interface PredictiveBackEvent {
  /** Postęp systemowego gestu wstecz w zakresie 0..1. */
  progress: number;
  /** Pozycja pozioma palca w dp. */
  touchX: number;
  /** Pozycja pionowa palca w dp. */
  touchY: number;
  /** 0 = lewa krawędź ekranu, 1 = prawa krawędź ekranu. */
  swipeEdge: number;
}

interface PredictiveBackHandlers {
  onStart: (event: PredictiveBackEvent) => void;
  onProgress: (event: PredictiveBackEvent) => void;
  onInvoke: () => void;
  onCancel: () => void;
}

interface NativeSubscription {
  remove: () => void;
}

interface PredictiveBackNativeModule {
  isSupported(): boolean;
  setEnabled(enabled: boolean): boolean;
  addListener(
    event: 'onBackStarted' | 'onBackProgressed',
    cb: (event: PredictiveBackEvent) => void,
  ): NativeSubscription;
  addListener(event: 'onBackInvoked' | 'onBackCancelled', cb: () => void): NativeSubscription;
}

const native =
  Platform.OS === 'android'
    ? requireOptionalNativeModule<PredictiveBackNativeModule>('KilometrPredictiveBack')
    : null;

const handlerStack: PredictiveBackHandlers[] = [];
let nativeSubs: NativeSubscription[] = [];

function topHandler(): PredictiveBackHandlers | undefined {
  return handlerStack[handlerStack.length - 1];
}

function attachNativeListeners() {
  if (!native || nativeSubs.length > 0) return;
  nativeSubs = [
    native.addListener('onBackStarted', (event) => topHandler()?.onStart(event)),
    native.addListener('onBackProgressed', (event) => topHandler()?.onProgress(event)),
    native.addListener('onBackInvoked', () => topHandler()?.onInvoke()),
    native.addListener('onBackCancelled', () => topHandler()?.onCancel()),
  ];
}

function detachNativeListeners() {
  for (const sub of nativeSubs) {
    try {
      sub.remove();
    } catch {
      // ignore
    }
  }
  nativeSubs = [];
}

/** Zwraca true na Androidzie 14+ (API 34+) z dostępnym natywnym modułem predictive back. */
export function isNativePredictiveBackSupported(): boolean {
  if (Platform.OS !== 'android' || !native) return false;
  try {
    return native.isSupported() === true;
  } catch {
    return false;
  }
}

/**
 * Rejestruje aktywnego odbiorcę zdarzeń Android Predictive Back na szczycie stosu.
 * Zwraca funkcję odpinającą; po zdjęciu ostatniego odbiorcy wyrejestrowuje callback natywny.
 */
export function acquirePredictiveBack(handlers: PredictiveBackHandlers): () => void {
  if (!isNativePredictiveBackSupported() || !native) {
    return () => {};
  }

  const wasEmpty = handlerStack.length === 0;
  handlerStack.push(handlers);
  if (wasEmpty) {
    attachNativeListeners();
    try {
      native.setEnabled(true);
    } catch {
      // ignore
    }
  }

  let released = false;
  return () => {
    if (released) return;
    released = true;
    const idx = handlerStack.lastIndexOf(handlers);
    if (idx >= 0) {
      handlerStack.splice(idx, 1);
    }
    if (handlerStack.length === 0) {
      try {
        native.setEnabled(false);
      } catch {
        // ignore
      }
      detachNativeListeners();
    }
  };
}
