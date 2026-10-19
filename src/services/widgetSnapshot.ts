import * as FileSystem from 'expo-file-system/legacy';
import { reloadWidgets } from '../../modules/kilometr-widgets';
import { tr } from '../i18n/locale';
import { getLineColors, inferTransitMode, normalizeLineName } from './lineIdentity';
import { toAbsoluteMs } from './notifications/format';
import type { Connection, Leg } from '../types/models';

// Snapshot dla natywnych widgetów z ekranu głównego (modules/kilometr-widgets).
// Odjazdy zapisujemy jako znaczniki czasu: minuty do odjazdu liczy widget sam,
// co minutę, więc odliczanie nie zamarza po zamknięciu apki. Po każdym zapisie
// prosimy o przerysowanie, zamiast czekać na systemowe odświeżenie co 30 min.
// Widgety NIE działają w Expo Go, wymagają dev-build APK.

const WIDGET_SNAPSHOT_FILE = 'kilometr-widget.json';

export interface WidgetLineBadge {
  mode: 'tram' | 'bus' | 'train' | 'cable' | 'trolleybus' | 'subway' | 'walk';
  line?: string;
  bg?: string;
  fg?: string;
}

export interface WidgetNext {
  line: string;
  mode: WidgetLineBadge['mode'];
  lineBg: string;
  lineFg: string;
  dest: string;
  departTs: number;
  departAt: string;
  delayMin: number;
  live: boolean;
  deepLink: string;
}

export interface WidgetQuickItem {
  id: string;
  title: string;
  /** Ikona zapisanego miejsca (SavedPlaceIcon) albo 'history'. */
  icon: string;
  line?: string;
  mode?: WidgetLineBadge['mode'];
  lineBg?: string;
  lineFg?: string;
  departTs?: number;
  departAt?: string;
  delayMin?: number;
  live?: boolean;
  deepLink: string;
}

export interface WidgetPinned {
  fromTitle: string;
  toTitle: string;
  departTs: number;
  arriveTs: number;
  departAt: string;
  arriveAt: string;
  delayMin: number;
  live: boolean;
  legs: WidgetLineBadge[];
  deepLink: string;
}

export interface WidgetPlace {
  id: string;
  name: string;
  icon: string;
  deepLink: string;
}

interface WidgetSnapshot {
  v: 2;
  updatedAt: number;
  origin: string;
  labels: Record<string, string>;
  next: WidgetNext[];
  quick: WidgetQuickItem[];
  pinned: WidgetPinned | null;
  places: WidgetPlace[];
}

type WidgetData = Omit<WidgetSnapshot, 'v' | 'updatedAt' | 'labels'>;

/** Deep link do ekranu połączeń: parametry 1:1 z useLocalSearchParams w app/routes. */
export function buildRoutesLink(args: {
  fromTitle?: string;
  fromLat?: number;
  fromLon?: number;
  fromGps?: boolean;
  toId?: string;
  toTitle?: string;
  toLat?: number;
  toLon?: number;
}): string {
  const q: Record<string, string> = {};
  if (args.fromTitle != null) q.fromTitle = args.fromTitle;
  if (args.fromLat != null) q.fromLat = String(args.fromLat);
  if (args.fromLon != null) q.fromLon = String(args.fromLon);
  if (args.fromGps) q.fromGps = '1';
  if (args.toId != null) q.toId = args.toId;
  if (args.toTitle != null) q.toTitle = args.toTitle;
  if (args.toLat != null) q.toLat = String(args.toLat);
  if (args.toLon != null) q.toLon = String(args.toLon);
  const qs = Object.entries(q)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');
  return `kilometr://routes${qs ? `?${qs}` : ''}`;
}

/** Etykiety widgetów w bieżącym języku apki. Placeholdery podstawia widget. */
function widgetLabels(): Record<string, string> {
  const w = tr().widgets;
  return {
    journeyTitle: w.journeyTitle,
    trackingTitle: w.trackingTitle,
    checkRoutes: w.checkRoutes,
    early: w.early('{n}'),
    now: w.now,
    min: w.min,
    onTime: w.onTime,
    timetable: w.timetable,
    late: w.late('{n}'),
    departAt: w.departAt('{t}'),
    departIn: w.departIn('{n}'),
    departNow: w.departNow,
    arriveIn: w.arriveIn('{n}'),
    arrived: w.arrived,
    updated: w.updated('{t}'),
    stale: w.stale,
    nextEmpty: w.nextEmpty,
    destEmpty: w.destEmpty,
    tripEmptyTitle: w.tripEmptyTitle,
    tripEmptyBody: w.tripEmptyBody,
    placesEmpty: w.placesEmpty,
    search: w.search,
  };
}

/** Odjazd połączenia jako znacznik czasu (sekundy od północy mogą sięgać jutra). */
export function departureTs(conn: Pick<Connection, 'departureSec' | 'departInMin'>): number {
  if (conn.departureSec > 0) return toAbsoluteMs(conn.departureSec);
  return Date.now() + conn.departInMin * 60_000;
}

export function legBadge(leg: Pick<Leg, 'mode' | 'line'>): WidgetLineBadge {
  const line = normalizeLineName(leg.line, leg.mode, true);
  const mode = inferTransitMode(leg.mode, line || leg.line);
  if (mode === 'walk') return { mode };
  const { bg, fg } = getLineColors(line || leg.line, leg.mode);
  return { mode, line: line || leg.line, bg, fg };
}

/** Pierwszy odcinek z pojazdem, czyli to, na co trzeba zdążyć. */
export function firstRideBadge(conn: Connection): WidgetLineBadge | null {
  const ride = conn.legs.find((l) => l.mode !== 'walk' && l.line);
  return ride ? legBadge(ride) : null;
}

function snapshotPath(): string | null {
  const base = FileSystem.documentDirectory;
  if (!base) return null;
  return `${base}${WIDGET_SNAPSHOT_FILE}`;
}

const EMPTY: Omit<WidgetSnapshot, 'labels'> = {
  v: 2,
  updatedAt: 0,
  origin: '',
  next: [],
  quick: [],
  pinned: null,
  places: [],
};

// Ekran główny i monitor podróży piszą niezależnie; kolejka chroni przed
// zgubieniem sekcji przy dwóch równoległych read-modify-write.
let queue: Promise<void> = Promise.resolve();

/** Częściowa aktualizacja (np. samo przypięcie) bez nadpisywania reszty. */
export function mergeWidgetSnapshot(partial: Partial<WidgetData>): Promise<void> {
  queue = queue.then(() => writeMerged(partial));
  return queue;
}

async function writeMerged(partial: Partial<WidgetData>): Promise<void> {
  try {
    const path = snapshotPath();
    if (!path) return;
    let current = { ...EMPTY };
    try {
      const raw = JSON.parse(await FileSystem.readAsStringAsync(path));
      // Stary format (v1) miał inne pola; zaczynamy od zera zamiast je mieszać.
      if (raw?.v === 2) current = { ...current, ...raw };
    } catch {
      // brak pliku albo uszkodzony
    }
    const departuresChanged = partial.next !== undefined || partial.quick !== undefined;
    const next: WidgetSnapshot = {
      ...current,
      ...partial,
      v: 2,
      // „Stan z 12:30” dotyczy odjazdów, więc samo przypięcie go nie przesuwa.
      updatedAt: departuresChanged ? Date.now() : current.updatedAt,
      labels: widgetLabels(),
    };
    await FileSystem.writeAsStringAsync(path, JSON.stringify(next));
    await reloadWidgets();
  } catch (err) {
    console.warn('[WidgetSnapshot] merge failed:', err);
  }
}
