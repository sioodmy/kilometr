import { useCallback, useEffect, useState } from 'react';
import { kvGet, kvSet } from './storage';
import { getLocaleSync, type Strings } from '../i18n';
import { pl } from '../i18n/pl';
import { en } from '../i18n/en';
import { de } from '../i18n/de';
import { uk } from '../i18n/uk';

const SETTINGS_DICTS: Record<string, Strings> = { pl, en, de, uk };

/** Słownik pod bieżące locale — do synchronicznych helperów formatujących. */
function tr(): Strings {
  return SETTINGS_DICTS[getLocaleSync()] ?? pl;
}

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
  /** Czy RAPTOR uwzględnia pociągi KD w trybie 'all'. Default true. */
  trainsEnabled: boolean;
  /** Minimalny zapas na wsiadanie do pociągu po przesiadce. Default 300. */
  trainMinTransferSec: number;
}

export const DEFAULT_SETTINGS: RoutingSettings = {
  maxTransfers: 2,
  minTransferSec: 120,
  maxWalkM: 800,
  walkSpeedMps: 1.3,
  anchorRadiusM: 300,
  trainsEnabled: true,
  trainMinTransferSec: 300,
};

export const SETTINGS_LIMITS = {
  maxTransfers: { min: 0, max: 3, step: 1 },
  minTransferSec: { min: 60, max: 600, step: 30 },
  maxWalkM: { min: 200, max: 1500, step: 100 },
  walkSpeedMps: { min: 0.8, max: 2.0, step: 0.1 },
  anchorRadiusM: { min: 100, max: 800, step: 50 },
  trainMinTransferSec: { min: 120, max: 1200, step: 60 },
} as const;

const STORAGE_KEY = 'kilometr.routingSettings.v1';

function clampInt(value: unknown, def: number, min: number, max: number): number {
  const n = Number(value);
  return Math.max(min, Math.min(max, Math.round(Number.isFinite(n) ? n : def)));
}

function clampTenths(value: unknown, def: number, min: number, max: number): number {
  const n = Number(value);
  return Math.max(min, Math.min(max, Math.round((Number.isFinite(n) ? n : def) * 10) / 10));
}

function clampSettings(s: Partial<RoutingSettings>): RoutingSettings {
  return {
    maxTransfers: clampInt(s.maxTransfers, DEFAULT_SETTINGS.maxTransfers, SETTINGS_LIMITS.maxTransfers.min, SETTINGS_LIMITS.maxTransfers.max),
    minTransferSec: clampInt(s.minTransferSec, DEFAULT_SETTINGS.minTransferSec, SETTINGS_LIMITS.minTransferSec.min, SETTINGS_LIMITS.minTransferSec.max),
    maxWalkM: clampInt(s.maxWalkM, DEFAULT_SETTINGS.maxWalkM, SETTINGS_LIMITS.maxWalkM.min, SETTINGS_LIMITS.maxWalkM.max),
    walkSpeedMps: clampTenths(s.walkSpeedMps, DEFAULT_SETTINGS.walkSpeedMps, SETTINGS_LIMITS.walkSpeedMps.min, SETTINGS_LIMITS.walkSpeedMps.max),
    anchorRadiusM: clampInt(s.anchorRadiusM, DEFAULT_SETTINGS.anchorRadiusM, SETTINGS_LIMITS.anchorRadiusM.min, SETTINGS_LIMITS.anchorRadiusM.max),
    trainsEnabled: typeof s.trainsEnabled === 'boolean' ? s.trainsEnabled : DEFAULT_SETTINGS.trainsEnabled,
    trainMinTransferSec: clampInt(s.trainMinTransferSec, DEFAULT_SETTINGS.trainMinTransferSec, SETTINGS_LIMITS.trainMinTransferSec.min, SETTINGS_LIMITS.trainMinTransferSec.max),
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

/**
 * Tylko tempo chodzenia (m/s) — lekka subskrypcja dla komponentów, które
 * jedynie przeliczają metry na minuty (karty połączeń, oś czasu, kompas).
 * Bez tego podpięcia każda kartka trzymała własny, wpisany na sztywno
 * `m / 80` i ignorowała ustawienie „Tempo chodzenia” z ekranu ustawień.
 */
export function useWalkSpeedMps(): number {
  const [mps, setMps] = useState(cached.walkSpeedMps);

  useEffect(() => {
    const onChange = (s: RoutingSettings) => setMps(s.walkSpeedMps);
    listeners.add(onChange);
    return () => {
      listeners.delete(onChange);
    };
  }, []);

  return mps;
}

/** Metry przechodzone w minucie dla danego tempa (1.3 m/s ≈ 78 m/min). */
export function walkMetersPerMinute(speedMps: number = DEFAULT_SETTINGS.walkSpeedMps): number {
  return Math.max(1, speedMps * 60);
}

/** Minuty piesza dla dystansu, zgodnie z tempem ustawionym przez użytkownika. */
export function walkMinutesFor(meters: number, speedMps?: number): number {
  return Math.max(1, Math.round(meters / walkMetersPerMinute(speedMps)));
}



export function formatTransferTime(sec: number): string {
  const min = Math.round(sec / 60);
  return `${min} min`;
}

export function formatWalkTime(min: number): string {
  const m = Math.max(1, Math.round(min));
  return tr().settings.walkTime(m);
}

export function formatWalkDistance(m: number, speedMps = 1.3): string {
  const dist = m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`;
  return `${dist} (~${walkMinutesFor(m, speedMps)} min)`;
}

/**
 * Czytelne formatowanie odległości w metrach lub kilometrach (np. < 10 m, 45 m, 250 m, 1.2 km).
 */
export function formatDistance(meters: number): string {
  if (meters == null || isNaN(meters) || meters < 0) return '';
  if (meters < 10) return tr().common.lessThan10m;
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
  return tr().common.kmh(kmh.toFixed(1));
}

export function walkSpeedLabel(mps: number): string {
  const s = tr().settings;
  if (mps <= 0.9) return s.speedSlow;
  if (mps <= 1.1) return s.speedCalm;
  if (mps <= 1.4) return s.speedNormal;
  if (mps <= 1.7) return s.speedFast;
  return s.speedVeryFast;
}
