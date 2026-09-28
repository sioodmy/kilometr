import { requireOptionalNativeModule } from 'expo-modules-core';
import type { NativeTrackingState } from '../../src/services/notifications/types';

// Publiczne wejście lokalnego modułu Androida. `src/services/notifications`
// ładuje je leniwie i dopiero na Androidzie; `requireOptionalNativeModule`
// zwraca null zamiast rzucać, więc build bez modułu (albo Expo Go) cicho
// schodzi na awaryjny wariant z expo-notifications.

export interface KilometrTrackingNativeModule {
  isAvailable(): boolean;
  ensureChannels(): Promise<void>;
  present(state: NativeTrackingState): Promise<boolean>;
  dismiss(): Promise<void>;
}

const native = requireOptionalNativeModule<KilometrTrackingNativeModule>('KilometrTracking');

export function isAvailable(): boolean {
  return native != null && native.isAvailable();
}

export function ensureChannels(): Promise<void> {
  return native ? native.ensureChannels() : Promise.resolve();
}

export function present(state: NativeTrackingState): Promise<boolean> {
  return native ? native.present(state) : Promise.resolve(false);
}

export function dismiss(): Promise<void> {
  return native ? native.dismiss() : Promise.resolve();
}

export default { isAvailable, ensureChannels, present, dismiss };
