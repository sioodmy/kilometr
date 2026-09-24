import { useCallback, useEffect, useState } from 'react';
import { kvGet, kvSet } from './storage';

export interface RoutingSettings {
  /** 0–3, default 2 */
  maxTransfers: number;
  /** sekundy, default 120 */
  minTransferSec: number;
  /** metry, default 800 */
  maxWalkM: number;
  /** m/s, default 1.3. Tempo chodzenia. */
  walkSpeedMps: number;
  /** metry, default 300. Promień kotwiczenia lokalizacji/przystanku. */
  anchorRadiusM: number;
}

export const DEFAULT_SETTINGS: RoutingSettings = {
  maxTransfers: 2,
  minTransferSec: 120,
  maxWalkM: 800,
  walkSpeedMps: 1.3,
  anchorRadiusM: 300,
};

export const SETTINGS_LIMITS = {
  maxTransfers: { min: 0, max: 3, step: 1 },
  minTransferSec: { min: 60, max: 600, step: 30 },
  maxWalkM: { min: 200, max: 1500, step: 100 },
  walkSpeedMps: { min: 0.8, max: 2.0, step: 0.1 },
  anchorRadiusM: { min: 100, max: 800, step: 50 },
} as const;

const STORAGE_KEY = 'kilometr.routingSettings.v1';

function clampSettings(s: Partial<RoutingSettings>): RoutingSettings {
  return {
    maxTransfers: Math.max(
      SETTINGS_LIMITS.maxTransfers.min,
      Math.min(SETTINGS_LIMITS.maxTransfers.max, Math.round(s.maxTransfers ?? DEFAULT_SETTINGS.maxTransfers)),
    ),
    minTransferSec: Math.max(
      SETTINGS_LIMITS.minTransferSec.min,
      Math.min(SETTINGS_LIMITS.minTransferSec.max, Math.round(s.minTransferSec ?? DEFAULT_SETTINGS.minTransferSec)),
    ),
    maxWalkM: Math.max(
      SETTINGS_LIMITS.maxWalkM.min,
      Math.min(SETTINGS_LIMITS.maxWalkM.max, Math.round(s.maxWalkM ?? DEFAULT_SETTINGS.maxWalkM)),
    ),
    walkSpeedMps: Math.max(
      SETTINGS_LIMITS.walkSpeedMps.min,
      Math.min(SETTINGS_LIMITS.walkSpeedMps.max,
        Math.round((s.walkSpeedMps ?? DEFAULT_SETTINGS.walkSpeedMps) * 10) / 10),
    ),
    anchorRadiusM: Math.max(
      SETTINGS_LIMITS.anchorRadiusM.min,
      Math.min(SETTINGS_LIMITS.anchorRadiusM.max, Math.round(s.anchorRadiusM ?? DEFAULT_SETTINGS.anchorRadiusM)),
    ),
  };
}

let cached: RoutingSettings = { ...DEFAULT_SETTINGS };
let loaded = false;
const listeners = new Set<(s: RoutingSettings) => void>();

function notify() {
  for (const l of listeners) l({ ...cached });
}

export async function loadSettings(): Promise<RoutingSettings> {
  if (loaded) return { ...cached };
  try {
    const raw = await kvGet(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<RoutingSettings>;
      cached = clampSettings(parsed);
    }
  } catch {
    // storage niedostępny — zostają defaulty
  }
  loaded = true;
  notify();
  return { ...cached };
}

export async function saveSettings(next: Partial<RoutingSettings>): Promise<RoutingSettings> {
  cached = clampSettings({ ...cached, ...next });
  notify();
  try {
    await kvSet(STORAGE_KEY, JSON.stringify(cached));
  } catch {
    // ignoruj błąd zapisu
  }
  return { ...cached };
}

export function getSettingsSync(): RoutingSettings {
  return { ...cached };
}

/** Hook do ekranów: ładuje z kv-store i subskrybuje zmiany. */
export function useRoutingSettings() {
  const [settings, setSettings] = useState<RoutingSettings>({ ...cached });

  useEffect(() => {
    listeners.add(setSettings);
    loadSettings().then(setSettings);
    return () => {
      listeners.delete(setSettings);
    };
  }, []);

  const update = useCallback((next: Partial<RoutingSettings>) => saveSettings(next), []);

  return { settings, update, reset: () => saveSettings({ ...DEFAULT_SETTINGS }) };
}

export function formatTransferTime(sec: number): string {
  const min = Math.round(sec / 60);
  return `${min} min`;
}

export function formatWalkTime(min: number): string {
  const m = Math.max(1, Math.round(min));
  if (m === 1) return '1 minuta pieszo';
  const last = m % 10;
  const teen = m % 100;
  if (last >= 2 && last <= 4 && (teen < 12 || teen > 14)) {
    return `${m} minuty pieszo`;
  }
  return `${m} minut pieszo`;
}

export function formatWalkDistance(m: number, speedMps = 1.3): string {
  const dist = m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`;
  const min = Math.max(1, Math.round(m / (speedMps * 60)));
  return `${dist} (~${min} min)`;
}

/**
 * Czytelne formatowanie odległości w metrach lub kilometrach (np. < 10 m, 45 m, 250 m, 1.2 km).
 */
export function formatDistance(meters: number): string {
  if (meters == null || isNaN(meters) || meters < 0) return '';
  if (meters < 10) return '< 10 m';
  if (meters < 100) return `${Math.round(meters / 5) * 5} m`;
  if (meters < 950) return `${Math.round(meters / 10) * 10} m`;
  if (meters < 9950) {
    const km = (meters / 1000).toFixed(1);
    return `${km} km`;
  }
  return `${Math.round(meters / 1000)} km`;
}

export function formatWalkSpeed(mps: number): string {
  const kmh = mps * 3.6;
  return `${kmh.toFixed(1)} km/h`;
}

export function walkSpeedLabel(mps: number): string {
  if (mps <= 0.9) return 'Wolny';
  if (mps <= 1.1) return 'Spokojny';
  if (mps <= 1.4) return 'Normalny';
  if (mps <= 1.7) return 'Szybki';
  return 'Bardzo szybki';
}
