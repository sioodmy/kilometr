import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

// Snapshot iOS trafia do App Group; Android czyta plik aplikacji.

interface KilometrWidgetsNativeModule {
  reload(): Promise<boolean>;
  syncSnapshot?(snapshot: string): Promise<boolean>;
}

const native = requireOptionalNativeModule<KilometrWidgetsNativeModule>('KilometrWidgets');

export function reloadWidgets(snapshot: string): Promise<boolean> {
  if (!native) return Promise.resolve(false);
  if (Platform.OS === 'ios') {
    return native.syncSnapshot?.(snapshot).catch(() => false) ?? Promise.resolve(false);
  }
  return native.reload().catch(() => false);
}
