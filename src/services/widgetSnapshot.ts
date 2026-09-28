import * as FileSystem from 'expo-file-system/legacy';
import { getLineColors } from './lineIdentity';
import type { Connection } from '../types/models';

// Snapshot dla natywnych widgetów z ekranu głównego (Android AppWidgetProvider
// czyta ten plik z filesDir przy każdym odświeżeniu — max co ~30 min z racji
// updatePeriodMillis, plus świeże dane po każdym otwarciu aplikacji, bo tap
// w widget otwiera apkę przez deep link, a apka przy starcie nadpisuje plik).
// Widgety NIE działają w Expo Go — wymagają dev-build APK (nix run .#build-apk).

export const WIDGET_SNAPSHOT_FILE = 'kilometr-widget.json';

export interface WidgetNext {
  line: string;
  lineColor: string;
  dest: string;
  departInMin: number;
  departAt: string;
  delayMin: number;
  live: boolean;
  deepLink: string;
}

export interface WidgetPinned {
  fromTitle: string;
  toTitle: string;
  departAt?: string;
  arriveAt?: string;
  durationMin?: number;
  delayMin?: number;
  live?: boolean;
  deepLink: string;
}

export interface WidgetQuickItem {
  id: string;
  title: string;
  departInMin?: number;
  deepLink: string;
}

export interface WidgetSnapshot {
  updatedAt: number;
  next: WidgetNext | null;
  pinned: WidgetPinned | null;
  quick: WidgetQuickItem[];
}

/** Deep link do ekranu połączeń — parametry 1:1 z useLocalSearchParams w app/routes. */
export function buildRoutesLink(args: {
  fromTitle?: string;
  fromLat?: number;
  fromLon?: number;
  toId?: string;
  toTitle?: string;
  toLat?: number;
  toLon?: number;
}): string {
  const q: Record<string, string> = {};
  if (args.fromTitle != null) q.fromTitle = args.fromTitle;
  if (args.fromLat != null) q.fromLat = String(args.fromLat);
  if (args.fromLon != null) q.fromLon = String(args.fromLon);
  if (args.toId != null) q.toId = args.toId;
  if (args.toTitle != null) q.toTitle = args.toTitle;
  if (args.toLat != null) q.toLat = String(args.toLat);
  if (args.toLon != null) q.toLon = String(args.toLon);
  const qs = Object.entries(q)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');
  return `kilometr://routes${qs ? `?${qs}` : ''}`;
}

function snapshotPath(): string | null {
  const base = FileSystem.documentDirectory;
  if (!base) return null;
  return `${base}${WIDGET_SNAPSHOT_FILE}`;
}

/** Najwcześniejsze połączenie z listy — to ląduje w widgecie 4x1. */
export function pickNextConnection(conns: Connection[]): Connection | null {
  if (conns.length === 0) return null;
  return conns.reduce((best, c) => (c.departureSec < best.departureSec ? c : best), conns[0]);
}

export function connectionToWidgetNext(
  conn: Connection,
  from: { title: string; lat: number; lon: number },
  to: { id: string; title: string; lat: number; lon: number },
): WidgetNext {
  const boarding = conn.legs.filter((l) => l.mode !== 'walk');
  const first = boarding[0];
  const { bg } = getLineColors(first?.line, first?.mode);
  return {
    line: first?.line || '•',
    lineColor: bg,
    dest: conn.toTitle,
    departInMin: conn.departInMin,
    departAt: conn.departAt,
    delayMin: conn.delayMin,
    live: conn.live,
    deepLink: buildRoutesLink({
      fromTitle: from.title,
      fromLat: from.lat,
      fromLon: from.lon,
      toId: to.id,
      toTitle: to.title,
      toLat: to.lat,
      toLon: to.lon,
    }),
  };
}

export async function writeWidgetSnapshot(snap: WidgetSnapshot): Promise<void> {
  try {
    const path = snapshotPath();
    if (!path) return;
    await FileSystem.writeAsStringAsync(path, JSON.stringify(snap));
  } catch (err) {
    console.warn('[WidgetSnapshot] write failed:', err);
  }
}

/** Częściowa aktualizacja (np. samo przypięcie) bez nadpisywania reszty. */
export async function mergeWidgetSnapshot(partial: Partial<WidgetSnapshot>): Promise<void> {
  try {
    const path = snapshotPath();
    if (!path) return;
    let current: WidgetSnapshot = { updatedAt: 0, next: null, pinned: null, quick: [] };
    try {
      const raw = await FileSystem.readAsStringAsync(path);
      current = { ...current, ...JSON.parse(raw) };
    } catch {
      // brak pliku albo uszkodzony — zaczynamy od pustego
    }
    await FileSystem.writeAsStringAsync(
      path,
      JSON.stringify({ ...current, ...partial, updatedAt: Date.now() }),
    );
  } catch (err) {
    console.warn('[WidgetSnapshot] merge failed:', err);
  }
}
