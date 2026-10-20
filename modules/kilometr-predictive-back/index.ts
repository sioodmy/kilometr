import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo';

interface PredictiveBackNative {
  setEnabled(enabled: boolean): Promise<void>;
}

const native =
  Platform.OS === 'android' && Number(Platform.Version) >= 34
    ? requireOptionalNativeModule<PredictiveBackNative>('KilometrPredictiveBack')
    : null;

let navigationEnabled = false;
const blockers = new Set<symbol>();

function updateNative() {
  void native?.setEnabled(navigationEnabled && blockers.size === 0).catch((error: unknown) => {
    console.warn('[PredictiveBack]', error);
  });
}

export function setPredictiveBackEnabled(enabled: boolean) {
  navigationEnabled = enabled;
  updateNative();
}

export function suspendPredictiveBack(): () => void {
  const token = Symbol();
  blockers.add(token);
  updateNative();
  return () => {
    if (blockers.delete(token)) updateNative();
  };
}
