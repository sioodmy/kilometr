// Most do natywnego zbierania w tle (modules/kilometr-contributor).
//
// Serwis Androida `ContributorService` pisze JSONL do pliku w prywatnym
// katalogu aplikacji - JS nie musi żyć, żeby tło miało próbkę. Ingest
// przenosi pliki do SQLite przy pierwszym otwarciu aplikacji po sesji.
//
// Moduł jest osobnym projektem autolinkingu i buildy prod/play wyłączają go
// całe (plugins/with-contributor.js). `requireOptionalNativeModule` zwraca
// wtedy null albo moduł bez funkcji; ścieżka natywna wprost odpada, a prod
// nie pokazuje interfejsu (`isContributorAvailable()`) w ogóle.

import { requireOptionalNativeModule } from 'expo-modules-core';
import * as FileSystem from 'expo-file-system/legacy';
import type { SessionMeta } from './store';

export interface ContributorNativeModule {
  startContributor(metaJson: string): Promise<boolean>;
  stopContributor(): Promise<boolean>;
  isContributorRunning(): boolean;
}

export interface NativeNotificationContent {
  title: string;
  text: string;
  channelName?: string;
  channelDescription?: string;
}

let native: ContributorNativeModule | null | undefined;

function getNative(): ContributorNativeModule | null {
  if (native !== undefined) return native;
  try {
    const mod = requireOptionalNativeModule<ContributorNativeModule>('KilometrContributor');
    // Build prod/play nie ma tego modułu albo jego funkcji (moduł wyłączony
    // z autolinkingu). Zwracamy null zamiast cienia modułu, żeby ścieżka
    // natywna wprost odpadała zamiast przechodzić przez try/catch w starcie.
    native = mod && typeof mod.startContributor === 'function' ? mod : null;
  } catch {
    native = null;
  }
  return native;
}

export function hasNativeCollector(): boolean {
  return getNative() != null;
}

export function isNativeRunning(): boolean {
  return getNative()?.isContributorRunning() ?? false;
}

/** JSON z metadanych sesji, plus treść powiadomienia (teksty już przetłumaczone). */
export async function startNativeCollector(
  meta: SessionMeta,
  deviceId: string,
  notification: NativeNotificationContent,
): Promise<boolean> {
  const mod = getNative();
  if (!mod) return false;
  try {
    return await mod.startContributor(
      JSON.stringify({
        ...meta,
        deviceId,
        title: notification.title,
        text: notification.text,
        ...(notification.channelName !== undefined ? { channelName: notification.channelName } : {}),
        ...(notification.channelDescription !== undefined
          ? { channelDescription: notification.channelDescription }
          : {}),
      }),
    );
  } catch (err) {
    console.warn('[Contributor] start FGS failed:', err);
    return false;
  }
}

export async function stopNativeCollector(): Promise<boolean> {
  const mod = getNative();
  if (!mod) return false;
  try {
    return await mod.stopContributor();
  } catch {
    return false;
  }
}

const FILE_DIR = `${FileSystem.documentDirectory ?? ''}contributor/`;

/** Pliki sesji zapisane przez serwis natywny (jeden JSONL z nagłówkiem). */
export async function listNativeFiles(): Promise<string[]> {
  if (!FileSystem.documentDirectory) return [];
  try {
    const names = await FileSystem.readDirectoryAsync(FILE_DIR);
    return names.filter((n) => n.endsWith('.jsonl')).sort();
  } catch {
    return [];
  }
}

export async function readNativeFile(name: string): Promise<string | null> {
  try {
    return await FileSystem.readAsStringAsync(`${FILE_DIR}${name}`, {
      encoding: FileSystem.EncodingType.UTF8,
    });
  } catch {
    return null;
  }
}

export async function deleteNativeFile(name: string): Promise<void> {
  await FileSystem.deleteAsync(`${FILE_DIR}${name}`, { idempotent: true });
}
