import type { ShareStrings } from './pl';

export const de: ShareStrings = {
  title: 'Verbindung teilen', subtitle: 'Sag jemandem, womit du fährst und wann du ankommst.',
  brand: 'Kilometr', arrival: 'Ankunft', departure: 'Abfahrt', from: 'Von', to: 'Nach',
  duration: (n) => `${n} Min.`,
  transfers: (n) => n === 0 ? 'Ohne Umstieg' : n === 1 ? '1 Umstieg' : `${n} Umstiege`,
  walk: 'Zu Fuß', walkDistance: (n) => `${n} m zu Fuß`,
  modes: { walk: 'Zu Fuß', tram: 'Straßenbahn', bus: 'Bus', train: 'Zug', cable: 'Seilbahn', trolleybus: 'Oberleitungsbus', subway: 'U-Bahn' },
  direction: (name) => `Richtung: ${name}`,
  cardLabel: (from, to, at) => `Verbindung von ${from} nach ${to}, Ankunft um ${at}`,
  imageAndLink: 'Karte und Link teilen', linkOnly: 'Link teilen', sms: 'SMS senden', copy: 'Link kopieren', copied: 'Link kopiert',
  preparing: 'Karte wird vorbereitet…', error: 'Teilen fehlgeschlagen. Versuche es erneut oder kopiere den Link.',
  smsError: 'SMS konnte nicht geöffnet werden. Kopiere den Link und füge ihn in eine Nachricht ein.',
  close: 'Schließen',
  message: (from, to, departure, arrival, lines) =>
    `Ich fahre von ${from} nach ${to}${lines ? ` (${lines})` : ''}. Abfahrt ${departure}, Ankunft um ${arrival}.`,
  snapshot: 'Reiseplan zum Zeitpunkt des Teilens. Standort und Verspätungen werden nicht aktualisiert.',
  privacy: 'Der Link enthält deine Route und Zeiten. Jeder, dem du ihn sendest, kann ihn öffnen.',
  pageTitle: 'Geteilte Verbindung', itinerary: 'Reiseverlauf', loading: 'Haltestellen werden aus dem Fahrplan geladen…',
  stopsUnavailable: 'Haltestellendetails sind nicht verfügbar. Geteilte Zeiten und Umstiege stehen oben.',
  retry: 'Haltestellen erneut laden', showStops: (n) => `Haltestellen anzeigen (${n})`, timetable: 'Statischer Fahrplan',
  invalidTitle: 'Verbindung kann nicht geöffnet werden',
  invalidBody: 'Der Link ist unvollständig oder beschädigt. Bitte darum, die Verbindung erneut zu teilen.',
  home: 'Kilometr-Website', dayLater: (n) => `+${n} T`,
};
