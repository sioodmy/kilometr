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

function clampPrefs(p: Partial<NotificationPreferences>): NotificationPreferences {
  const lead = Math.round(p.departureAlertLeadMin ?? DEFAULT_NOTIFICATION_PREFERENCES.departureAlertLeadMin);
  return {
    trackingEnabled: p.trackingEnabled ?? DEFAULT_NOTIFICATION_PREFERENCES.trackingEnabled,
    departureAlertsEnabled: p.departureAlertsEnabled ?? DEFAULT_NOTIFICATION_PREFERENCES.departureAlertsEnabled,
    disruptionAlertsEnabled:
      p.disruptionAlertsEnabled ?? DEFAULT_NOTIFICATION_PREFERENCES.disruptionAlertsEnabled,
    departureAlertLeadMin: Math.max(1, Math.min(30, isFinite(lead) ? lead : 5)),
    imminentAlert: p.imminentAlert ?? DEFAULT_NOTIFICATION_PREFERENCES.imminentAlert,
    liveProgressEnabled: p.liveProgressEnabled ?? DEFAULT_NOTIFICATION_PREFERENCES.liveProgressEnabled,
  };
}

function notify() {
  for (const l of listeners) l({ ...cached });
}

export async function loadNotificationPreferences(): Promise<NotificationPreferences> {
  if (loaded) return { ...cached };
  try {
    const raw = await kvGet(STORAGE_KEY);
    if (raw) cached = clampPrefs(JSON.parse(raw) as Partial<NotificationPreferences>);
  } catch {
    // storage niedostępny — zostają domyślne
  }
  loaded = true;
  notify();
  return { ...cached };
}

export async function saveNotificationPreferences(
  next: Partial<NotificationPreferences>,
): Promise<NotificationPreferences> {
  cached = clampPrefs({ ...cached, ...next });
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
    listeners.add(setPrefs);
    loadNotificationPreferences().then(setPrefs);
    return () => {
      listeners.delete(setPrefs);
    };
  }, []);

  return { prefs, update: saveNotificationPreferences };
}
