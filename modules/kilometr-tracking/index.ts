import { requireOptionalNativeModule } from 'expo-modules-core';

// Publiczne wejście lokalnego modułu Androida. `src/services/notifications`
// ładuje je leniwie i dopiero na Androidzie; `requireOptionalNativeModule`
// zwraca null zamiast rzucać, więc build bez modułu (albo Expo Go) cicho
// schodzi na awaryjny wariant z expo-notifications.
//
// Moduł nie rysuje powiadomienia — przekazuje plan podróży do `LiveTripService`,
// która sama pilnuje fazy i postępu. Dlatego nie ma tu ani `present`, ani
// `dismiss`: jest `startTrip` / `stopTrip` i pytanie, czy system dopuści
// powiadomienie do strefy Live Updates.

export interface KilometrTrackingNativeModule {
  isAvailable(): boolean;
  ensureChannels(): Promise<void>;
  /** Czy Android 16.1+ pozwoli wypchnąć powiadomienie do Live Updates. */
  canPromote(): Promise<boolean>;
  /** Startuje albo aktualizuje plan. Zwraca false, gdy brak zgody na powiadomienia. */
  startTrip(planJson: string): Promise<boolean>;
  /** Zatrzymuje serwis i zdejmuje powiadomienie. */
  stopTrip(): Promise<boolean>;
  /** Czy przycisk „Zakończ" pod powiadomieniem zadziałał natywnie. */
  consumeStopRequest(): Promise<boolean>;
}

const native = requireOptionalNativeModule<KilometrTrackingNativeModule>('KilometrTracking');

export function isAvailable(): boolean {
  return native != null && native.isAvailable();
}

export function ensureChannels(): Promise<void> {
  return native ? native.ensureChannels() : Promise.resolve();
}

export function canPromote(): Promise<boolean> {
  return native ? native.canPromote() : Promise.resolve(false);
}

export function startTrip(planJson: string): Promise<boolean> {
  return native ? native.startTrip(planJson) : Promise.resolve(false);
}

export function stopTrip(): Promise<boolean> {
  return native ? native.stopTrip() : Promise.resolve(false);
}

export function consumeStopRequest(): Promise<boolean> {
  return native ? native.consumeStopRequest() : Promise.resolve(false);
}

export default { isAvailable, ensureChannels, canPromote, startTrip, stopTrip, consumeStopRequest };