import * as FileSystem from 'expo-file-system/legacy';
import { reloadWidgets } from '../../modules/kilometr-widgets';
import { getLocaleSync, tr } from '../i18n/locale';
import { getLineColors, inferTransitMode, normalizeLineName } from './lineIdentity';
import { toAbsoluteMs } from './notifications/format';
import type { Connection, Leg } from '../types/models';

// Widgety natywne odliczają ze znaczników czasu, także bez procesu JS.

const WIDGET_SNAPSHOT_FILE = 'kilometr-widget.json';

export interface WidgetLineBadge {
  mode: 'tram' | 'bus' | 'train' | 'cable' | 'trolleybus' | 'subway' | 'walk';
  line?: string;
  bg?: string;
  fg?: string;
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
  locale: string;
  labels: Record<string, string>;
  quick: WidgetQuickItem[];
  pinned: WidgetPinned | null;
  places: WidgetPlace[];
}

type WidgetData = Omit<WidgetSnapshot, 'v' | 'updatedAt' | 'labels' | 'locale'>;

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
  open?: string;
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
  if (args.open != null) q.open = args.open;
  const qs = Object.entries(q)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');
  return `kilometr://routes${qs ? `?${qs}` : ''}`;
}

/** Etykiety widgetów w bieżącym języku apki. Placeholdery podstawia widget. */
function widgetLabels(): Record<string, string> {
  const s = tr();
  const w = s.widgets;
  return {
    openApp: w.openApp,
    addPlace: w.addPlace,
    refresh: w.refresh,
    fromOrigin: w.fromOrigin('{name}'),
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
    destEmpty: w.destEmpty,
    tripEmptyTitle: w.tripEmptyTitle,
    tripEmptyBody: w.tripEmptyBody,
    placesEmpty: w.placesEmpty,
    search: w.search,
    placesTitle: w.picker.placesTitle,
    searchTitle: w.picker.searchTitle,
    departure: s.ios.departure,
    arrival: s.ios.arrival,
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
  locale: 'pl',
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
      if (raw?.v === 2) {
        current = {
          ...current,
          updatedAt: raw.updatedAt,
          origin: raw.origin,
          quick: raw.quick,
          pinned: raw.pinned,
          places: raw.places,
        };
      }
    } catch {
      // brak pliku albo uszkodzony
    }
    const departuresChanged = partial.quick !== undefined;
    const next: WidgetSnapshot = {
      ...current,
      ...partial,
      v: 2,
      // „Stan z 12:30” dotyczy odjazdów, więc samo przypięcie go nie przesuwa.
      updatedAt: departuresChanged ? Date.now() : current.updatedAt,
      labels: widgetLabels(),
      locale: getLocaleSync(),
    };
    // Zapis atomowy jak w storage.writeValue: natywny widget czyta ten plik
    // co minutę równolegle, a ubity proces w połowie zapisu zostawiał ucięty
    // JSON i widgety pokazywały "Otwórz aplikację" do następnego merge.
    const tmp = `${path}.tmp`;
    const json = JSON.stringify(next);
    await FileSystem.writeAsStringAsync(tmp, json);
    await FileSystem.moveAsync({ from: tmp, to: path });
    await reloadWidgets(json);
  } catch (err) {
    console.warn('[WidgetSnapshot] merge failed:', err);
  }
}
