// Kilometr Contributor: telemetria GPS + akcelerometr dla testerów.
//
// Dostępna wyłącznie poza kanałem prod (nightly/dev/test/dev-lokalny).
// Schemat decyzji w issue #308: build z CI dostaje APP_VERSION (prod vX.Y.Z,
// nightly-*, dev-/test-*), ta sama konwencja co versionCode w app.config.js.
// Locally compiler bez APP_VERSION zostaje 1.0.0 z app.json, więc wersje
// semver traktujemy jak prod, a __DEV__ ma pierwszeństwo (dev build nigdy
// nie jest prodem).

import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { kvGet, kvSet } from '../storage';

export type ContributorChannel = 'prod' | 'nightly' | 'dev' | 'local';

export interface ContributorSettings {
  /** Zbieraj automatycznie każde śledzeniem podróży. */
  autoFollow: boolean;
}

export const DEFAULT_CONTRIBUTOR_SETTINGS: ContributorSettings = { autoFollow: false };

function channelFromVersion(version: string): ContributorChannel {
  if (version.startsWith('nightly-')) return 'nightly';
  if (version.startsWith('dev-') || version.startsWith('test-')) return 'dev';
  // AAB do Google Play (play-*) nie linkuje Contributora (plugins/
  // with-contributor.js), więc karta w Ustawieniach nie może go pokazywać.
  if (version.startsWith('play-')) return 'prod';
  if (/^v?\d+\.\d+\.\d+$/.test(version)) return 'prod';
  return 'local';
}

export function contributorChannel(): ContributorChannel {
  if (__DEV__) return 'local';
  const version = Constants.expoConfig?.version ?? '';
  return channelFromVersion(version);
}

export function isContributorAvailable(): boolean {
  return Platform.OS === 'android' && contributorChannel() !== 'prod';
}

export function contributorVersion(): string {
  return Constants.expoConfig?.version ?? '';
}

const DEVICE_ID_KEY = 'contributor.deviceId.v1';
const SETTINGS_KEY = 'contributor.settings.v1';

let cachedDeviceId: string | null = null;

export async function getContributorDeviceId(): Promise<string> {
  if (cachedDeviceId) return cachedDeviceId;
  const stored = await kvGet(DEVICE_ID_KEY);
  if (stored) {
    cachedDeviceId = stored;
    return stored;
  }
  const id = randomId();
  cachedDeviceId = id;
  await kvSet(DEVICE_ID_KEY, id);
  return id;
}

export function randomId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function parseSettings(raw: string | null): ContributorSettings {
  if (!raw) return DEFAULT_CONTRIBUTOR_SETTINGS;
  try {
    const parsed = JSON.parse(raw) as Partial<ContributorSettings>;
    return { autoFollow: parsed.autoFollow === true };
  } catch {
    return DEFAULT_CONTRIBUTOR_SETTINGS;
  }
}

let cachedSettings: ContributorSettings | null = null;
const listeners = new Set<() => void>();

/** Szybki odczyt ustawień po pierwszym załadowaniu (collector pyta synchronicznie). */
export function getContributorSettingsSync(): ContributorSettings {
  return cachedSettings ?? DEFAULT_CONTRIBUTOR_SETTINGS;
}

export async function loadContributorSettings(): Promise<ContributorSettings> {
  const settings = parseSettings(await kvGet(SETTINGS_KEY));
  cachedSettings = settings;
  return settings;
}

export async function saveContributorSettings(next: ContributorSettings): Promise<void> {
  cachedSettings = next;
  await kvSet(SETTINGS_KEY, JSON.stringify(next));
  for (const l of listeners) l();
}

export function subscribeContributorSettings(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
