import { requireOptionalNativeModule } from 'expo';

// Widgety z ekranu głównego Androida. Snapshot pisze `src/services/widgetSnapshot.ts`,
// a `reload` każe je przerysować od razu. Bez modułu (Expo Go, iOS) to no-op.

interface KilometrWidgetsNativeModule {
  reload(): Promise<boolean>;
}

const native = requireOptionalNativeModule<KilometrWidgetsNativeModule>('KilometrWidgets');

export function reloadWidgets(): Promise<boolean> {
  return native ? native.reload().catch(() => false) : Promise.resolve(false);
}
