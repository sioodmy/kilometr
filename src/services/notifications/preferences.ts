import { useEffect, useState } from 'react';
import { kvGet, kvSet } from '../storage';
import { DEFAULT_NOTIFICATION_PREFERENCES, type NotificationPreferences } from './types';

// Ustawienia powiadomień trzymamy osobno od ustawień trasowania: te drugie
// wpływają na wynik wyszukiwania, te pierwsze na to, czy czegoś się
// usłyszy. Zapis w kv-store, wzorzec identyczny jak w services/settings.ts.

const STORAGE_KEY = 'kilometr.notificationPrefs.v1';

let cached: NotificationPreferences = { ...DEFAULT_NOTIFICATION_PREFERENCES };
let loaded = false;
const listeners = new Set<(p: NotificationPreferences) => void>();

/** Wartości z KV i backupu bywają stringami, więc bierzemy tylko prawdziwe booleany. */
type PrefsInput = Partial<Record<keyof NotificationPreferences, unknown>>;

/** Brak wartości dziedziczy bazę, ale błędny typ (np. `"false"`) nigdy nie włącza powiadomień. */
function boolOr(value: unknown, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return value === true;
}

function clampPrefs(
  input: PrefsInput,
  base: NotificationPreferences = DEFAULT_NOTIFICATION_PREFERENCES,
): NotificationPreferences {
  return {
    trackingEnabled: boolOr(input.trackingEnabled, base.trackingEnabled),
    disruptionAlertsEnabled: boolOr(input.disruptionAlertsEnabled, base.disruptionAlertsEnabled),
    liveProgressEnabled: boolOr(input.liveProgressEnabled, base.liveProgressEnabled),
  };
}

function notify() {
  for (const l of listeners) l({ ...cached });
}

export function subscribeNotificationPreferences(
  listener: (prefs: NotificationPreferences) => void,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export async function loadNotificationPreferences(): Promise<NotificationPreferences> {
  if (loaded) return { ...cached };
  try {
    const raw = await kvGet(STORAGE_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed === 'object' && parsed !== null) cached = clampPrefs(parsed as PrefsInput);
    }
  } catch {
    // storage niedostępny: zostają domyślne
  }
  loaded = true;
  notify();
  return { ...cached };
}

export async function saveNotificationPreferences(
  next: PrefsInput,
): Promise<NotificationPreferences> {
  cached = clampPrefs({ ...cached, ...next }, cached);
  notify();
  try {
    await kvSet(STORAGE_KEY, JSON.stringify(cached));
  } catch {
    // ignoruj błąd zapisu
  }
  return { ...cached };
}

export function getNotificationPreferencesSync(): NotificationPreferences {
  return { ...cached };
}

export function useNotificationPreferences() {
  const [prefs, setPrefs] = useState<NotificationPreferences>({ ...cached });

  useEffect(() => {
    let mounted = true;
    listeners.add(setPrefs);
    void loadNotificationPreferences()
      .then((p) => {
        if (mounted) setPrefs(p);
      })
      .catch(() => {});
    return () => {
      mounted = false;
      listeners.delete(setPrefs);
    };
  }, []);

  return { prefs, update: saveNotificationPreferences };
}
