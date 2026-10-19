import { requireOptionalNativeModule } from 'expo';

// Publiczne wejście lokalnego modułu Androida. `src/services/notifications`
// ładuje je leniwie i dopiero na Androidzie; `requireOptionalNativeModule`
// zwraca null zamiast rzucać, więc build bez modułu (albo Expo Go) cicho
// schodzi na awaryjny wariant z expo-notifications.
//
// Moduł nie rysuje powiadomienia — przekazuje plan podróży do `LiveTripService`,
// która sama pilnuje fazy i postępu. Dlatego nie ma tu ani `present`, ani
// `dismiss`: jest `startTrip` / `stopTrip` i pytanie, czy system dopuści
// powiadomienie do strefy Live Updates.

interface KilometrTrackingNativeModule {
  isAvailable(): boolean;
  /** Czy Android 16.1+ pozwoli wypchnąć powiadomienie do Live Updates. */
  canPromote(): Promise<boolean>;
  openNotificationSettings(): Promise<boolean>;
  /** Startuje albo aktualizuje plan. Zwraca false, gdy brak zgody na powiadomienia. */
  startTrip(planJson: string): Promise<boolean>;
  /** Zatrzymuje serwis i zdejmuje powiadomienie. */
  stopTrip(): Promise<boolean>;
  /** Czy przycisk „Zakończ" pod powiadomieniem zadziałał natywnie. */
  consumeStopRequest(): Promise<boolean>;
  hasStopRequest(): Promise<boolean>;
}

const native = requireOptionalNativeModule<KilometrTrackingNativeModule>('KilometrTracking');

function isAvailable(): boolean {
  return native != null && native.isAvailable();
}

function canPromote(): Promise<boolean> {
  return native ? native.canPromote() : Promise.resolve(false);
}

function openNotificationSettings(): Promise<boolean> {
  return native ? native.openNotificationSettings() : Promise.resolve(false);
}

function startTrip(planJson: string): Promise<boolean> {
  return native ? native.startTrip(planJson) : Promise.resolve(false);
}

function stopTrip(): Promise<boolean> {
  return native ? native.stopTrip() : Promise.resolve(false);
}

function consumeStopRequest(): Promise<boolean> {
  return native ? native.consumeStopRequest() : Promise.resolve(false);
}

function hasStopRequest(): Promise<boolean> {
  return native ? native.hasStopRequest() : Promise.resolve(false);
}

export default {
  isAvailable,
  canPromote,
  openNotificationSettings,
  startTrip,
  stopTrip,
  consumeStopRequest,
  hasStopRequest,
};
