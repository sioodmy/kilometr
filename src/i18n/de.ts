// Deutsche Übersetzungen. Muss `Strings` (typeof pl) erfüllen - ein fehlender
// Schlüssel oder eine falsche Funktionssignatur ist ein Compile-Fehler.
import type { Strings } from './pl';
import { de as landing } from './landing/de';
import { de as share } from './share/de';

function formatDuration(mins: number): string {
  if (!Number.isFinite(mins) || mins <= 0) return "0 Min.";
  const rounded = Math.round(mins);
  if (rounded >= 60) {
    const h = Math.floor(rounded / 60);
    const m = rounded % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  return `${rounded} Min.`;
}

export const de: Strings = {
  landing,
  share,
  lineTimetable: {
    title: 'Linienfahrplan',
    line: (line: string) => `Linie ${line}`,
    open: (line: string) => `Fahrplan der Linie ${line} öffnen`,
    searchHint: 'Haltestellen und Abfahrtszeiten',
    direction: 'Richtung',
    variant: (n: number) => `Variante ${n}`,
    stops: 'Haltestellen',
    stopsHint: 'Tippe auf eine Haltestelle, um Abfahrten zu sehen.',
    departures: 'Abfahrten',
    stopCode: (code: string) => `Haltestellencode ${code}`,
    selectStop: (name: string) => `Abfahrten anzeigen: ${name}`,
    loading: 'Fahrplan wird geladen…',
    error: 'Der Fahrplan konnte nicht geladen werden. Versuche es erneut.',
    empty:
      'Keine Fahrten im gespeicherten Fahrplan für diesen Tag. Wähle einen anderen Tag oder aktualisiere den Fahrplan in den Einstellungen.',
    missing:
      'Diese Linie fehlt im gespeicherten Fahrplan. Kehre zur Suche zurück oder aktualisiere die Daten in den Einstellungen.',
    missingStop:
      'Diese Haltestelle oder Linienvariante ist nicht mehr im Fahrplan. Kehre zur Haltestellenliste zurück.',
    terminal: 'Endhaltestelle',
    terminalHint: 'Wähle eine frühere Haltestelle, um Abfahrten zu sehen.',
    scheduled: 'Zeiten aus dem gespeicherten Fahrplan',
    nextDay: 'Nächster Tag',
    previousDay: 'Vorheriger Tag',
    back: 'Zurück',
    dayOffset: (days: number) => `+${days} ${days === 1 ? 'Tag' : 'Tage'}`,
    nextDayTime: (time: string, days: number) =>
      `${time} (+${days} ${days === 1 ? 'Tag' : 'Tage'})`,
  },
  transferGuard: {
    enabled: 'Aktiviert',
    disabled: 'Deaktiviert',
    title: 'Umstiegsbegleitung',
    waiting: 'Die Überwachung ist aktiv. Wir warten auf die GPS-Bestätigung deiner Fahrt.',
    buffer: (line: string, n: number) => `Umstieg auf ${line} · ${n} Min. Reserve`,
    riskTitle: (line: string) => `Der Umstieg auf ${line} ist gefährdet`,
    riskBody: 'Wir suchen einen anderen Umstieg.',
    stayOn: (line: string) => `Bleib in ${line}`,
    changedBody: (line: string, stop: string) => `Steige an der Haltestelle ${stop} in ${line} um.`,
    noAlternative:
      'Keine erreichbare Alternative gefunden. Der aktuelle Umstieg könnte scheitern. Wir prüfen erneut.',
    conductorTitle: 'Zug verpasst',
    conductorBody: 'Informiere das Zugpersonal über den geplanten Umstieg',
    nextTrainLabel: 'Nächster Zug',
    nextTrainAt: (time: string) => `fährt ab um ${time}`,

    unavailable: 'Umstieg kann nicht bewertet werden',
    unavailableBody:
      'Wir warten auf eine genaue Position entlang der Route. Der aktuelle Plan bleibt sichtbar.',
    routingError: 'Die Umstiegsbegleitung konnte nicht vorbereitet werden. Versuche es erneut.',
    rerouting: 'Ein neuer Umstieg wird gesucht',
    next: (line: string, stop: string) => `${line} · ${stop}`,
    channel: 'Geänderte Umstiege',
    start: 'Mit Umstiegsbegleitung fahren',
    startBody:
      'Wir warnen dich, wenn dein Umstieg gefährdet ist. Du entscheidest über eine andere Route.',
    locationRequired: 'Die Umstiegsbegleitung braucht während der Fahrt deinen genauen Standort.',
    active: 'Begleitung aktiv',
    preparing: 'Umstiegsbegleitung wird vorbereitet…',
    safe: 'Du hast Zeit zum Umsteigen',
    attention: 'Prüfe deinen Umstieg',
    alternativeTitle: 'Du kannst anders weiterfahren',
    alternativeBody: 'Prüfe die andere Route und entscheide, ob du sie nehmen möchtest.',
    originalPlan: 'Aktueller Plan',
    suggestedPlan: 'Andere Route',
    unchanged: 'Die Route ändert sich erst nach deiner Bestätigung.',
    sameStop: 'Umstieg an derselben Haltestelle',
    stayUntil: (line: string, stop: string) => `Fahre mit ${line} bis: ${stop}`,
    fromHere: 'Vom aktuellen Standort starten',
    departure: 'Abfahrt',
    arrival: 'Am Ziel',
    delay: (n: number) => `Verspätung +${n} Min.`,
    shortBy: (n: number) => `Zum Umsteigen fehlen ${n} Min.`,
    spare: (n: number) => `${n} Min. Reserve`,
    schedule: 'Laut Fahrplan',
    live: 'Echtzeitdaten',
    choose: 'Diese Route nehmen',
    keepPlan: 'Bei meinem Plan bleiben',
    showOptions: 'Umstieg prüfen',
    later: 'Minimieren',
    expired: 'Dieser Vorschlag ist nicht mehr aktuell. Wir prüfen andere Routen.',
    acceptError: 'Die Route konnte nicht geändert werden. Dein aktueller Plan bleibt aktiv.',
    stop: 'Fahrt beenden',
    foreground: 'Die Begleitung funktioniert bei geöffneter App.',
    background: 'Die Begleitung funktioniert auch bei gesperrtem Bildschirm.',
    complete: 'Auf dieser Route stehen keine weiteren Umstiege an.',
    demo: 'Testszenario',
  },
  common: {
    retry: 'Erneut versuchen',
    cancel: 'Abbrechen',
    close: 'Schließen',
    no: 'Nein',
    yesRemove: 'Ja, entfernen',
    now: 'Jetzt',
    today: 'Heute',
    tomorrow: 'Morgen',
    durMin: (n: number) => formatDuration(n),
    departIn: (n: number) => `in ${n} Min.`,
    departNow: 'gleich',
    departAgo: (n: number) => `vor ${n} Min.`,
    departJustAgo: 'gerade abgefahren',
    lessThan10m: '< 10 m',
    kmh: (v: string) => `${v} km/h`,
    add15: '+15 Min.',
    add30: '+30 Min.',
    add45: '+45 Min.',
    add60: '+1 Std.',
    storageFailTitle: 'Änderungen konnten nicht gespeichert werden',
    storageFailBody: 'Prüfe den freien Speicher auf dem Telefon und versuche es erneut.',
  },
  home: {
    searchToA11y: (title: string) => `Verbindungen suchen nach: ${title}`,
    editPlaceHint: 'Gedrückt halten, um diesen Ort zu bearbeiten.',
    title: 'Wohin geht’s?',
    newsA11y: 'Meldungen',
    newsAlertA11y: 'Meldungen: neue Störungen',
    searchLabel: 'Wohin fährst du?',
    searchA11y: 'Adresse, Haltestelle oder Ort suchen',
    startCustomA11y: (t: string) => `Start: ${t}. Tippen zum Ändern.`,
    startGpsA11y: (t: string) => `Standort: ${t}. Tippen, um den Start zu ändern.`,
    startFrom: (t: string) => `ab: ${t}`,
    resetStartA11y: 'Aktuellen GPS-Standort wiederherstellen',
    savedTitle: 'Gespeicherte Orte',
    editSavedA11y: 'Gespeicherte Orte bearbeiten',
    editCard: 'Bearbeiten',
    tabRecent: 'Letzte Verbindungen',
    tabSaved: 'Deine Routen',
    historyTitle: 'Letzte Orte',
    historyEmptyTitle: 'Keine letzten Orte',
    historyEmptyBody: 'Suche eine Verbindung, sie erscheint hier als Schnellziel.',
    savedRoutesEmptyTitle: 'Keine gespeicherten Routen',
    savedRoutesEmptyBody:
      'Verfolge eine Verbindung oder hänge ein Bahnticket an, dann erscheint sie hier.',
    routeActive: 'Unterwegs',
    ticketAttachedA11y: 'Bahnticket gespeichert',
    dockPinnedA11y: (title: string, time?: string) =>
      `Angeheftete Fahrt nach ${title}${time ? `, ${time}` : ''}. Tippen zum Öffnen.`,
    dockTicketA11y: (title: string, time: string) =>
      `Zug nach ${title}, Abfahrt ${time}. Tippen zum Öffnen.`,
    removeRouteA11y: (title: string) => `Verbindung nach ${title} aus deinen Routen entfernen`,
    pinRouteA11y: (title: string) => `Verbindung nach ${title} zu deinen Routen anpinnen`,
    unpinRouteA11y: (title: string) => `Verbindung nach ${title} von deinen Routen lösen`,
    openConnA11y: (title: string, label: string) => `Verbindung nach ${title} öffnen, ${label}`,
    gpsTitle: 'Mein Standort (GPS)',
    locationFallback: 'Dein Standort',
    gpsAddressHome: 'Aktuelle Geräteposition',
    importingTitle: (gen: string) => `Fahrplan für ${gen} wird geladen…`,
    importErrorTitle: 'Fehler beim Laden des Fahrplans',
    importErrorRetry: 'Tippen zum Wiederholen.',
    timetableUpdateTitle: 'Ein neuerer Fahrplan ist verfügbar',
    timetableUpdateBody: 'Lade ihn, damit der Planer aktuelle Linien und Zeiten hat.',
    timetableUpdateA11y: 'Neueren Fahrplan herunterladen',
    saveFailTitle: 'Keine Datenbankverbindung',
    saveFailBody: 'Ort konnte nicht gespeichert werden. Versuch es erneut.',
    searchPlaceholderTo: 'Wohin fährst du?',
    searchPlaceholderFrom: 'Wo startest du?',
    unsupportedTitle: 'Nicht unterstützte Stadt',
    unsupportedTitleOther: 'Andere Stadt in der App',
    unsupportedBody: (city: string, supported: string) =>
      `Dein GPS-Standort zeigt auf ${city}. Aktuell bedienen wir nur: ${supported}.`,
    unsupportedBodyOther: (city: string, active: string) =>
      `Du bist in ${city}, die App ist aber auf ${active} eingestellt. Stadt in den Einstellungen wechseln.`,
    unsupportedBodyUnknown: (supported: string) =>
      `Dein GPS-Standort liegt außerhalb des unterstützten Gebiets. Aktuell bedienen wir nur: ${supported}.`,
    unsupportedAction: 'Startpunkt wählen',
    unsupportedActionShort: 'Start wählen',
    unsupportedSwitchCity: (city: string) => `Zu ${city} wechseln`,
    unsupportedSwitchCityA11y: (city: string) => `Stadt auf ${city} ändern`,
    pickStart: 'Startpunkt wählen',
    gpsBlockedTitle: 'GPS-Start nicht verfügbar',
    gpsBlockedBody: (city: string, supported: string) =>
      `Du bist außerhalb von ${supported} (${city}), GPS-Routen funktionieren daher nicht. Wähle den Start manuell.`,
    gpsBlockedBodyUnknown: (supported: string) =>
      `Du bist außerhalb von ${supported}, GPS-Routen funktionieren daher nicht. Wähle den Start manuell.`,
  },
  city: {
    section: 'Stadt',
    settingsHint:
      'Fahrplan, Offline-Karte und Meldungen folgen der Stadt. Die Daten der anderen Stadt bleiben auf dem Telefon.',
    name: (id: string): string =>
      id === 'krakow'
        ? 'Kraków'
        : id === 'gzm'
          ? 'GZM'
          : id === 'warszawa'
            ? 'Warszawa'
            : id === 'poznan'
              ? 'Poznań'
              : id === 'trojmiasto'
                ? 'Trójmiasto'
                : id === 'lodz'
                  ? 'Łódź'
                  : id === 'szczecin'
                    ? 'Szczecin'
                    : id === 'kielce'
                      ? 'Kielce'
                      : id === 'olsztyn'
                        ? 'Olsztyn'
                        : id === 'bialystok'
                          ? 'Białystok'
                          : id === 'opole'
                            ? 'Opole'
                            : id === 'rzeszow'
                              ? 'Rzeszów'
                              : id === 'lublin'
                                ? 'Lublin'
                                : id === 'radom'
                                  ? 'Radom'
                                  : 'Wrocław',
    gen: (id: string): string =>
      id === 'krakow'
        ? 'Kraków'
        : id === 'gzm'
          ? 'GZM'
          : id === 'warszawa'
            ? 'Warszawa'
            : id === 'poznan'
              ? 'Poznań'
              : id === 'trojmiasto'
                ? 'Trójmiasto'
                : id === 'lodz'
                  ? 'Łódź'
                  : id === 'szczecin'
                    ? 'Szczecin'
                    : id === 'kielce'
                      ? 'Kielce'
                      : id === 'olsztyn'
                        ? 'Olsztyn'
                        : id === 'bialystok'
                          ? 'Białystok'
                          : id === 'opole'
                            ? 'Opole'
                            : id === 'rzeszow'
                              ? 'Rzeszów'
                              : id === 'lublin'
                                ? 'Lublin'
                                : id === 'radom'
                                  ? 'Radom'
                                  : 'Wrocław',
    acc: (id: string): string =>
      id === 'krakow'
        ? 'Kraków'
        : id === 'gzm'
          ? 'GZM'
          : id === 'warszawa'
            ? 'Warszawa'
            : id === 'poznan'
              ? 'Poznań'
              : id === 'trojmiasto'
                ? 'Trójmiasto'
                : id === 'lodz'
                  ? 'Łódź'
                  : id === 'szczecin'
                    ? 'Szczecin'
                    : id === 'kielce'
                      ? 'Kielce'
                      : id === 'olsztyn'
                        ? 'Olsztyn'
                        : id === 'bialystok'
                          ? 'Białystok'
                          : id === 'opole'
                            ? 'Opole'
                            : id === 'rzeszow'
                              ? 'Rzeszów'
                              : id === 'lublin'
                                ? 'Lublin'
                                : id === 'radom'
                                  ? 'Radom'
                                  : 'Wrocław',
    loc: (id: string): string =>
      id === 'krakow'
        ? 'Kraków'
        : id === 'gzm'
          ? 'GZM'
          : id === 'warszawa'
            ? 'Warszawa'
            : id === 'poznan'
              ? 'Poznań'
              : id === 'trojmiasto'
                ? 'Trójmiasto'
                : id === 'lodz'
                  ? 'Łódź'
                  : id === 'szczecin'
                    ? 'Szczecin'
                    : id === 'kielce'
                      ? 'Kielce'
                      : id === 'olsztyn'
                        ? 'Olsztyn'
                        : id === 'bialystok'
                          ? 'Białystok'
                          : id === 'opole'
                            ? 'Opole'
                            : id === 'rzeszow'
                              ? 'Rzeszów'
                              : id === 'lublin'
                                ? 'Lublin'
                                : 'Wrocław',
    feeds: (id: string): string =>
      id === 'krakow'
        ? 'ZTP und Koleje Małopolskie'
        : id === 'gzm'
          ? 'ZTM, Koleje Śląskie, POLREGIO und PKP Intercity'
          : id === 'warszawa'
            ? 'WTP, SKA, Koleje Mazowieckie und WKD'
            : id === 'poznan'
              ? 'ZTM und Koleje Wielkopolskie'
              : id === 'trojmiasto'
                ? 'ZTM Gdańsk, ZKM Gdynia und SKM'
                : id === 'lodz'
                  ? 'MPK und Łódzka Kolej Aglomeracyjna'
                  : id === 'szczecin'
                    ? 'ZDiTM Szczecin'
                    : id === 'kielce'
                      ? 'ZTM Kielce'
                      : id === 'olsztyn'
                        ? 'ZDZiT Olsztyn'
                        : id === 'bialystok'
                          ? 'BKM Białystok'
                          : id === 'opole'
                            ? 'MZK Opole'
                            : id === 'rzeszow'
                              ? 'ZTM Rzeszów'
                              : id === 'lublin'
                                ? 'ZDiTM Lublin'
                                : id === 'radom'
                                  ? 'MZDiK Radom'
                                  : 'MPK und Koleje Dolnośląskie',
    newsSources: (id: string): string =>
      id === 'krakow'
        ? 'ZTP Kraków'
        : id === 'gzm'
          ? 'ZTM GZM'
          : id === 'warszawa'
            ? 'WTP Warszawa'
            : id === 'poznan'
              ? 'ZTM Poznań'
              : id === 'trojmiasto'
                ? 'ZTM Gdańsk'
                : id === 'lodz'
                  ? 'MPK Łódź'
                  : id === 'szczecin'
                    ? 'ZDiTM Szczecin'
                    : id === 'kielce'
                      ? 'ZTM Kielce'
                      : id === 'olsztyn'
                        ? 'ZDZiT Olsztyn'
                        : id === 'bialystok'
                          ? 'BKM Białystok'
                          : id === 'opole'
                            ? 'MZK Opole'
                            : id === 'rzeszow'
                              ? 'ZTM Rzeszów'
                              : id === 'lublin'
                                ? 'ZDiTM Lublin'
                                : id === 'radom'
                                  ? 'MZDiK Radom'
                                  : 'MPK Wrocław • wroclaw.pl',
    operator: (id: string): string =>
      id === 'krakow'
        ? 'ZTP Kraków'
        : id === 'gzm'
          ? 'ZTM GZM'
          : id === 'warszawa'
            ? 'WTP Warszawa'
            : id === 'poznan'
              ? 'ZTM Poznań'
              : id === 'trojmiasto'
                ? 'ZTM Gdańsk'
                : id === 'lodz'
                  ? 'MPK Łódź'
                  : id === 'szczecin'
                    ? 'ZDiTM Szczecin'
                    : id === 'kielce'
                      ? 'ZTM Kielce'
                      : id === 'olsztyn'
                        ? 'ZDZiT Olsztyn'
                        : id === 'bialystok'
                          ? 'BKM Białystok'
                          : id === 'opole'
                            ? 'MZK Opole'
                            : id === 'rzeszow'
                              ? 'ZTM Rzeszów'
                              : id === 'lublin'
                                ? 'ZDiTM Lublin'
                                : id === 'radom'
                                  ? 'MZDiK Radom'
                                  : 'MPK Wrocław',
    operatorShort: (id: string): string =>
      id === 'krakow'
        ? 'ZTP'
        : id === 'gzm'
          ? 'ZTM'
          : id === 'warszawa'
            ? 'WTP'
            : id === 'poznan'
              ? 'ZTM'
              : id === 'trojmiasto'
                ? 'ZTM / ZKM'
                : id === 'szczecin'
                  ? 'ZDiTM'
                  : id === 'kielce'
                    ? 'ZTM'
                    : id === 'olsztyn'
                      ? 'ZDZiT'
                      : id === 'bialystok'
                        ? 'BKM'
                        : id === 'opole'
                          ? 'MZK'
                          : id === 'rzeszow'
                            ? 'ZTM'
                            : id === 'lublin'
                              ? 'ZDiTM'
                              : id === 'radom'
                                ? 'MZDiK'
                                : 'MPK',
    portal: (id: string): string =>
      id === 'krakow'
        ? 'ztp.krakow.pl'
        : id === 'gzm'
          ? 'metropoliaztm.pl'
          : id === 'warszawa'
            ? 'wtp.waw.pl'
            : id === 'poznan'
              ? 'ztm.poznan.pl'
              : id === 'trojmiasto'
                ? 'ztm.gda.pl'
                : id === 'lodz'
                  ? 'mpk.lodz.pl'
                  : id === 'szczecin'
                    ? 'zditm.szczecin.pl'
                    : id === 'kielce'
                      ? 'ztm.kielce.pl'
                      : id === 'olsztyn'
                        ? 'zdzit.olsztyn.eu'
                        : id === 'bialystok'
                          ? 'komunikacja.bialystok.pl'
                          : id === 'opole'
                            ? 'mzkopole.pl'
                            : id === 'rzeszow'
                              ? 'ztm.erzeszow.pl'
                              : id === 'lublin'
                                ? 'zdtm.lublin.eu'
                                : id === 'radom'
                                  ? 'mzdik.pl'
                                  : 'wroclaw.pl',
    supportedList:
      'Wrocław, Kraków, GZM, Warszawa, Poznań, Trójmiasto, Łódź, Szczecin, Kielce, Olsztyn, Białystok, Opole, Rzeszów, Lublin, Radom',
    changed: (name: string) => `Umgeschaltet auf: ${name}.`,
    switching: 'Stadt wird umgestellt…',
    blockedByDownload: 'Fahrplan wird geladen. Stadtwechsel danach möglich.',
    needDownload:
      'Für diese Stadt liegt noch kein Fahrplan auf dem Telefon. Lade ihn unter „Fahrplan und Karten“.',
    changeAction: 'Ändern',
    downloadAction: 'Fahrplan herunterladen',
    selectTitle: 'Stadt wählen',
    selectSub: 'Wählen Sie das Verkehrsgebiet für Ihre Routen.',
    searchPlaceholder: 'Stadt oder Betreiber',
    noSearchResults: (q: string) => `Keine Städte für „${q}“ gefunden`,
    searchEmptyHint:
      'Überprüfen Sie die Schreibweise oder suchen Sie nach einem anderen Verkehrsgebiet.',
    searchClearA11y: 'Suche löschen',
    closeSheetA11y: 'Stadtauswahl schließen',
  },
  personalization: {
    colors: 'App-Farben',
    system: 'Vom Hintergrundbild',
    systemDescription: 'Standardfarben von Material You',
    wallpaperUnavailable: 'Hintergrundfarben nicht verfügbar. Standardpalette aktiv.',
    teal: 'Türkis',
    blue: 'Blau',
    green: 'Grün',
    violet: 'Violett',
    rose: 'Rosa',
    orange: 'Orange',
    saving: 'Farbe wird gespeichert…',
    saveError: 'Die Farbe konnte nicht gespeichert werden. Wähle sie erneut aus.',
  },
  settings: {
    planningTitle: 'Reiseplanung',
    offlineTitle: 'Fahrplan und Karten',
    notificationsSummary: 'Reiseverfolgung und Meldungen',
    backupSummary: 'Gespeicherte Orte, Verlauf und Einstellungen',
    planningSummary: (pace: string) => pace,
    appSummary: (language: string, color: string) => `${language} · ${color}`,
    resetRoutes: 'Routeneinstellungen zurücksetzen',
    resetRoutesBody: 'Stellt die Standardeinstellungen für die Reiseplanung wieder her.',
    decrease: (label: string) => `Verringern: ${label}`,
    increase: (label: string) => `Erhöhen: ${label}`,
    langPolish: 'Polski',
    langEnglish: 'English',
    langGerman: 'Deutsch',
    langUkrainian: 'Українська',
    title: 'Einstellungen',
    resetA11y: 'Standards wiederherstellen',
    supportTitle: 'Projekt unterstützen',
    supportHint: 'Kilometr ist kostenlos. Ein Kaffee auf Ko-fi hilft bei der Weiterentwicklung.',
    supportA11y: 'Ko-fi-Seite im Browser öffnen',
    sectionOffline: 'Offline',
    sectionApp: 'App',
    sectionRoute: 'Route',
    sectionTransport: 'Verkehrsmittel',
    advancedShow: 'Erweitert',
    advancedHide: 'Erweitert ausblenden',
    offlineMapTitle: (name: string) => `Offline-Karte (${name})`,
    offlineMapHint: (name: string, mb: number) =>
      `Lade die Kartenkacheln von ${name} (etwa ${mb} MB), damit Routen ohne Internet funktionieren.`,
    offlineMapReady: (name: string) =>
      `Die ${name}-Karte ist auf dem Telefon. Routen funktionieren ohne Internet.`,
    offlineMapDownload: 'Karte laden',
    offlineMapDownloadA11y: (name: string) => `Die ${name}-Karte für offline laden`,
    offlineMapDownloading: (pct: number) => `Lädt… ${pct}%`,
    offlineMapStepTiles: (name: string) => `Kacheln für ${name}`,
    offlineMapStepDone: 'fertig',
    offlineMapDelete: 'Löschen',
    offlineMapDeleteA11y: 'Offline-Karte löschen',
    offlineMapDeleteTitle: 'Offline-Karte löschen?',
    offlineMapDeleteBody: (mb: number, invalid: boolean) =>
      invalid
        ? `Das gibt etwa ${mb} MB frei. Die beschädigte Datei wird gelöscht, danach kannst du die Karte sofort erneut laden.`
        : `Das gibt etwa ${mb} MB frei. Die Karte funktioniert weiterhin online. Erneut laden geht erst nach einem Monat.`,
    offlineMapInvalid: (name: string) =>
      `Die Kartendatei für ${name} ist beschädigt. Lösche sie und lade die Karte erneut.`,
    offlineMapInvalidDownload:
      'Die geladene Kartendatei war beschädigt und wurde gelöscht. Versuche es erneut.',
    offlineMapInvalidShort: 'beschädigt',
    offlineMapOthersTitle: 'Karten anderer Städte',
    offlineMapOthersHint: 'Früher geladen. Du kannst sie einzeln löschen, um Platz freizugeben.',
    offlineMapSize: (mb: number) => `${mb} MB`,
    offlineMapDeleteCityA11y: (name: string) => `${name}-Karte löschen`,
    offlineMapFailTitle: 'Karte konnte nicht geladen werden',
    offlineMapFailBody:
      'Prüfe die Verbindung und versuche es erneut. Der Rest der App funktioniert normal.',
    offlineMapCooldownTitle: 'Karte schon geladen',
    offlineMapCooldownBody: (days: number) =>
      days <= 1
        ? 'Die Karte kannst du morgen erneut laden. Einmal geladen reicht lange.'
        : `Die Karte kannst du in ${days} Tagen erneut laden. Einmal geladen reicht lange.`,
    backupTitle: 'Deine Daten',
    backupHint:
      'Gespeicherte Orte, letzte Fahrten und Einstellungen in einer Datei. Exportiere vor dem Handywechsel, oder einfach zur Sicherheit.',
    backupExcludeHint: 'Fahrplan, Cache und Daten zur Kursverfolgung bleiben auf dem Gerät.',
    backupExport: 'In Datei exportieren',
    backupImport: 'Aus Datei importieren',
    backupExportA11y: 'Daten in eine Datei exportieren',
    backupImportA11y: 'Daten aus einer Datei importieren',
    backupEmpty: 'Es gibt noch nichts zu sichern.',
    backupCurrent: (places: number, routes: number, trips: number) =>
      `${places} ${places === 1 ? 'Ort' : 'Orte'} • ${routes} gespeicherte ${routes === 1 ? 'Route' : 'Routen'} • ${trips} ${trips === 1 ? 'Fahrt' : 'Fahrten'}`,
    backupExportDoneTitle: 'Fertig',
    backupExportDoneBody: (path: string) => `Datei gespeichert unter ${path}`,
    backupExportFailTitle: 'Datei konnte nicht gesichert werden',
    backupExportFailBody: (reason: string) =>
      `${reason}. Prüfe den freien Speicher und versuche es erneut.`,
    backupExportFailFallback: 'Bitte gleich noch einmal versuchen.',
    backupImportConfirmTitle: 'Diese Daten importieren?',
    backupImportConfirmBody: (summary: string) =>
      `${summary}\n\nGespeicherte Orte und Fahrten werden mit deinen vorhandenen zusammengeführt, nichts geht verloren. Einstellungen werden überschrieben.`,
    backupImportAction: 'Importieren',
    backupImportCancel: 'Abbrechen',
    backupImportDoneTitle: 'Daten importiert',
    backupImportDoneBody: (summary: string) => `Zusammengeführt: ${summary}`,
    backupImportNothing: 'Diese Sicherung enthält keine Daten von dir.',
    backupFailNoFile: 'Keine Datei gefunden.',
    backupFailUnreadable: 'Datei konnte nicht gelesen werden.',
    backupFailNotBackup: 'Das ist keine Kilometr-Sicherung.',
    backupFailSchemaTooNew: 'Diese Sicherung stammt aus einer neueren App-Version.',
    dataTitle: (operator: string) => `${operator}-Fahrplan`,
    dataHint: (feeds: string) =>
      `Fahrpläne von ${feeds} vom Kilometr-Server. Einmal laden, dann offline.`,
    dataEmpty: 'Keine Offline-Daten.',
    dataDownloading: (p: number) => `Wird geladen… ${p} %`,
    dataStep: (step: string, p: number) => `${step} ${p} %`,
    dataReady: (stops: number, trips: number) =>
      `Vollständiger Fahrplan: ${stops} Haltestellen, ${trips} Fahrten`,
    dataError: (msg: string) => `Fehler: ${msg}`,
    downloadA11y: 'Fahrplan laden',
    downloadCheckA11y: 'Prüfen, ob es einen neueren Fahrplan gibt',
    downloadReady: 'Auf Updates prüfen',
    downloadEmpty: 'Vollständigen Fahrplan laden',
    downloadFailTitle: 'Fahrplan konnte nicht geladen werden',
    downloadFailBody: (reason: string) =>
      `${reason}. Die App lädt eine fertige Datenbank vom Kilometr-Server oder klassisch aus den offenen Daten der Stadt.`,
    downloadFailFallback: 'Versuch es gleich erneut.',
    railTitle: 'Nationales Bahnfahrplan',
    railHint:
      'Züge aller Betreiber für die Planung von Reisen zwischen Städten: IC, EIC, PolRegio, KM und weitere.',
    railReady: (date: string) => `Heruntergeladen (gültig bis ${date})`,
    railEmpty: 'Nicht heruntergeladen',
    railDownload: 'Herunterladen',
    railCheck: 'Nach Updates suchen',
    railDelete: 'Vom Handy entfernen',
    railDeleteTitle: 'Bahnfahrplan entfernen?',
    railDeleteBody: 'Die Planung von Reisen zwischen Städten funktioniert dann offline nicht mehr.',
    railDeleteConfirm: 'Entfernen',
    railCancel: 'Abbrechen',

    downloadDone: 'Fahrplan aktualisiert.',
    downloadUpToDate: 'Der Fahrplan ist schon aktuell.',
    downloadKeptLocal:
      'Die neue Version konnte nicht geladen werden. Es bleibt der Fahrplan vom Telefon.',
    downloadCooldown: (hours: number) =>
      hours <= 1
        ? 'Der Fahrplan wurde gerade erst geladen. Ein erneutes volles Laden ist in etwa einer Stunde möglich.'
        : `Der Fahrplan wurde gerade erst geladen. Ein erneutes volles Laden ist in ${hours} h möglich.`,
    diagTitle: 'Daten-Diagnose',
    diagHint:
      'Prüft Fahrplan, Bahn, Offline-Karte und Live-Quellen. Kopiere das Ergebnis, wenn du ein Problem meldest.',
    diagRun: 'Daten prüfen',
    diagRerun: 'Erneut prüfen',
    diagRunning: 'Prüfe…',
    diagRunA11y: 'Datendiagnose starten',
    diagOk: 'OK',
    diagWarn: 'Warnung',
    diagError: 'Fehler',
    diagDb: 'SQLite-Datenbank',
    diagDbDamaged: 'Datenbank ist beschädigt',
    diagDbSize: (mb: string) => `Datenbankgröße: ${mb} MB`,
    diagDbOrphan: (name: string) => `Übrig gebliebene Temp-Datei: ${name}`,
    diagDbWal: (mb: string) => `WAL: ${mb} MB`,
    diagDbNoAccess: 'Kein Zugriff auf die Datenbankdatei',
    diagCounts: 'Fahrplanzähler',
    diagCountsLine: (stops: number, routes: number, trips: number, times: number) =>
      `${stops} Haltestellen • ${routes} Linien • ${trips} Fahrten • ${times} Abfahrten`,
    diagCountsEmpty: 'Datenbank ist leer. Lade unten den Fahrplan herunter.',
    diagCountsNoRoutes: 'Keine Linien in der Datenbank',
    diagTrains: 'Regionalzüge',
    diagTrainsLine: (n: number) => (n === 1 ? '1 Bahnlinie' : `${n} Bahnlinien`),
    diagTrainsNone: 'Keine Bahnlinien. Lade einen neueren Fahrplan.',
    diagTrainsNotSupported: 'Nicht zutreffend für diese Stadt (ÖPNV ohne Bahn)',
    diagCalendar: 'GTFS-Kalender',
    diagCalendarLine: (from: string, to: string) => `Fahrplan gültig ${from} bis ${to}`,
    diagCalendarEmpty: 'Kein Kalender in der Datenbank',
    diagCalendarOutside: 'Heute liegt außerhalb des Fahrplans',
    diagCalendarExpiring: (days: number) =>
      days <= 1 ? 'Fahrplan läuft morgen ab' : `Fahrplan läuft in ${days} Tagen ab`,
    diagCalendarServices: (n: number) => `Aktive Dienste heute: ${n}`,
    diagSearch: 'Suche',
    diagSearchOk: (weighted: number, pois: number, addresses: number) =>
      `Ranking bereit (${weighted === 1 ? '1 Haltestelle' : `${weighted} Haltestellen`}) • POIs: ${pois} • Adressen: ${addresses}`,
    diagSearchWeights: 'Vorschlagsranking nicht berechnet',
    diagSearchPois: 'Keine POI-Punkte',
    diagSearchNoAddresses: 'Kein Adressindex. Adresssuche braucht Internet.',
    diagRail: 'Bundesweite Bahn',
    diagRailNone: 'Nicht geladen (Verbindungen zwischen Städten brauchen Internet)',
    diagRailLine: (version: string, to: string | null) =>
      to ? `Version ${version}, Fahrplan bis ${to}` : `Version ${version}`,
    diagRailOutside: 'Bahnfahrplan ist abgelaufen',
    diagRailExpiring: (days: number) =>
      days <= 1 ? 'Bahnfahrplan läuft morgen ab' : `Bahnfahrplan läuft in ${days} Tagen ab`,
    diagMap: 'Offline-Karte',
    diagMapNone: 'Nicht geladen (Karte braucht Internet)',
    diagMapReady: (mb: string) => `Kachelpaket bereit: ${mb} MB`,
    diagMapInvalid: 'Kachelpaket beschädigt. Karte neu laden.',
    diagLive: 'Live-Quellen',
    diagLiveNone: 'Keine Messungen in dieser Sitzung',
    diagLiveOkLine: (source: string, at: string) => `${source}: OK (${at})`,
    diagLiveRecoveredLine: (source: string, at: string) => `${source}: wieder aktiv (${at})`,
    diagLiveErrLine: (source: string, error: string) => `${source}: Fehler, ${error}`,
    diagLiveNoAnswer: (source: string) => `${source}: keine Antwort`,
    diagCopy: 'Bericht kopieren',
    diagCopyA11y: 'Diagnosebericht in die Zwischenablage kopieren',
    diagCopied: 'Bericht in die Zwischenablage kopiert',
    diagCopyFail: 'Bericht konnte nicht kopiert werden',
    diagFix: 'Fahrplan erneut laden',
    diagFixA11y: 'Fahrplan-Download erzwingen',
    diagReportCity: 'Stadt',
    diagReportTimetable: 'Fahrplan',
    diagReportImported: 'Geladen',
    diagReportLastCheck: 'Prüfung',
    diagReportRemote: 'Verfügbar',
    diagReportFeeds: 'Feeds',
    diagReportDb: 'Datenbank',
    diagReportRail: 'Bahn',
    diagReportMap: 'Karte',
    diagReportLive: 'Live',
    diagReportNotDownloaded: 'nicht geladen',
    diagReportMapInvalid: 'beschädigt',
    diagReportUnknown: 'unbekannt',
    transfersTitle: 'Max. Umstiege',
    transfersHintShort: 'Obergrenze pro Verbindung.',
    directValue: 'Direkt',
    allowTransferTitle: 'Umsteigen erlauben auf:',
    allowTransferHint: 'Ausgeschaltete Fahrzeuge erscheinen nicht in den Ergebnissen.',
    modeTram: 'Straßenbahn',
    modeBus: 'Bus',
    modeTrolleybus: 'Obus',
    modeSubway: 'U-Bahn',
    modeTrain: 'Zug',
    modeCable: 'Seilbahn',
    transferTimeTitle: 'Min. Umsteigezeit',
    transferTimeHintShort: 'Puffer zwischen Ausstieg und nächster Abfahrt.',
    trainBufferTitle: 'Bahn-Puffer',
    trainNoData:
      'Der geladene Fahrplan enthält keine Züge. Prüfe oben auf Updates, um Zugumstiege zu aktivieren.',
    walkTitle: 'Max. Fußweg',
    walkHintShort: 'Weg zur Starthaltestelle und vom Ziel weg.',
    speedTitle: 'Gehtempo',
    paceSlow: 'Langsam',
    paceNormal: 'Normal',
    paceFast: 'Schnell',
    paceSlowDesc: 'Gemütlicher Spaziergang',
    paceNormalDesc: 'Alltäglicher Stadtgang',
    paceFastDesc: 'Zügiger Schritt',
    anchorTitle: 'Anker-Radius',
    anchorHint:
      'Wenn du in diesem Radius um einen gespeicherten Ort bist (z. B. Zuhause), verankert die Navigation den Start automatisch an dessen Haltestelle und glättet GPS-Ungenauigkeiten.',
    anchorHintShort: 'Start automatisch bei gespeichertem Ort verankern.',
    foot: 'Einstellungen werden automatisch gespeichert und gelten für weitere Suchen.',
    walkTime: (n: number) => (n === 1 ? '1 Minute zu Fuß' : `${n} Minuten zu Fuß`),
    langTitle: 'Sprache',
    langSystem: 'System',
  },
  onboarding: {
    stepCount: (n: number, total: number) => `${n} / ${total}`,
    intro:
      'Wähle deine Stadt und lade den Fahrplan herunter. Verbindungen findest du auch offline.',
    openSettings: 'Einstellungen öffnen',
    permissionDenied:
      'Du kannst ohne diese Berechtigung fortfahren und sie später in den Telefoneinstellungen ändern.',
    steps: ['Willkommen', 'Berechtigungen', 'Stadt', 'Fahrplan', 'Orte'],
    granted: 'An',
    denied: 'Aus',
    slotHome: 'Zuhause',
    slotHomeHint: (id: string) =>
      id === 'krakow'
        ? 'z. B. Krowoderska 12'
        : id === 'warszawa'
          ? 'z. B. Marszałkowska 12'
          : id === 'poznan'
            ? 'z. B. Głogowska 12'
            : id === 'trojmiasto'
              ? 'z. B. Długa 12'
              : id === 'lodz'
                ? 'z. B. Piotrkowska 12'
                : id === 'szczecin'
                  ? 'z. B. Wojska Polskiego 12'
                  : id === 'kielce'
                    ? 'z. B. Sienkiewicza 12'
                    : id === 'olsztyn'
                      ? 'z. B. Partyzantów 12'
                      : id === 'bialystok'
                        ? 'z. B. Lipowa 12'
                        : id === 'opole'
                          ? 'z. B. Ozimska 12'
                          : id === 'rzeszow'
                            ? 'z. B. 3 Maja 12'
                            : id === 'lublin'
                              ? 'z. B. Krakowskie Przedmieście 12'
                              : id === 'radom'
                                ? 'z. B. Żeromskiego 12'
                                : 'z. B. Swojczycka 41',
    slotWork: 'Arbeit',
    slotWorkHint: (id: string) =>
      id === 'krakow'
        ? 'z. B. Galeria Krakowska'
        : id === 'warszawa'
          ? 'z. B. Złote Tarasy'
          : id === 'poznan'
            ? 'z. B. Stary Browar'
            : id === 'trojmiasto'
              ? 'z. B. Galeria Bałtycka'
              : id === 'lodz'
                ? 'z. B. Manufaktura'
                : id === 'szczecin'
                  ? 'z. B. Galeria Kaskada'
                  : id === 'kielce'
                    ? 'z. B. Galeria Echo'
                    : id === 'olsztyn'
                      ? 'z. B. Galeria Warmińska'
                      : id === 'bialystok'
                        ? 'z. B. Galeria Jurowiecka'
                        : id === 'opole'
                          ? 'z. B. Solaris Center'
                          : id === 'rzeszow'
                            ? 'z. B. Galeria Rzeszów'
                            : id === 'lublin'
                              ? 'z. B. Felicity'
                              : id === 'radom'
                                ? 'z. B. Galeria Słoneczna'
                                : 'z. B. Sky Tower',
    slotUni: 'Uni',
    slotUniHint: (id: string) =>
      id === 'krakow'
        ? 'z. B. AGH'
        : id === 'warszawa'
          ? 'z. B. Uniwersytet'
          : id === 'poznan'
            ? 'z. B. UAM'
            : id === 'trojmiasto'
              ? 'z. B. UG'
              : id === 'lodz'
                ? 'z. B. UŁ'
                : id === 'szczecin'
                  ? 'z. B. US'
                  : id === 'kielce'
                    ? 'z. B. UJK'
                    : id === 'olsztyn'
                      ? 'z. B. UWM'
                      : id === 'bialystok'
                        ? 'z. B. UwB'
                        : id === 'opole'
                          ? 'z. B. UO'
                          : id === 'rzeszow'
                            ? 'z. B. PRz'
                            : id === 'lublin'
                              ? 'z. B. UMCS'
                              : id === 'radom'
                                ? 'z. B. UTH'
                                : 'z. B. Politechnika',
    backA11y: 'Zurück',
    stepOf: (n: number, len: number, name: string) => `Schritt ${n} von ${len} • ${name}`,
    brand: 'Kilometr',
    tagline: 'Diesmal schaffst du es.',
    fast: 'Verbindungen offline planen',
    noAds: 'Keine Werbung',
    noPay: 'Keine Mikrozahlungen',
    permTitle: 'App-Zugriff',
    permSub: 'Standort und Mitteilungen. Beides optional.',
    locTitle: 'Standort',
    locBody:
      'Zeigt nahe Haltestellen und den Verlauf deiner aktiven Fahrt. Zur Adressbestimmung werden Koordinaten an OpenStreetMap Nominatim gesendet. Während einer Fahrt kann GPS bei ausgeschaltetem Bildschirm aktiv bleiben.',
    locOn: 'Standort aktiviert.',
    locAllow: 'Standort erlauben',
    notifTitle: 'Mitteilungen',
    notifBody:
      'Zeigen deine angeheftete Fahrt und erinnern an eine gewählte Abfahrt oder Haltestelle.',
    notifOn: 'Mitteilungen aktiviert.',
    notifExpoGo:
      'Expo-Go-Vorschau: Mitteilungen (angeheftete Verbindung) funktionieren im Entwicklungs-Build.',
    notifAllow: 'Mitteilungen aktivieren',
    cityTitle: 'In welcher Stadt bist du unterwegs?',
    cityBody:
      'Fahrplan, Karte und Meldungen folgen deiner Wahl. Die Stadt lässt sich später in den Einstellungen ändern.',
    citySuggested: (name: string) => `Laut GPS bist du in: ${name}.`,
    cityNoGps: 'Ohne GPS-Zugriff wähle die Stadt aus der Liste.',
    cityLocating: 'GPS-Position wird ermittelt…',
    cityNoMatch: 'GPS ist in keiner unterstützten Stadt. Wähle eine aus der Liste.',
    cityPickA11y: (name: string) => `Stadt wählen: ${name}`,
    citySuggestedA11y: (name: string) => `Vorgeschlagene Stadt laut GPS: ${name}`,
    dlTitle: (gen: string) => `Fahrplan für ${gen} laden`,
    dlBody: (feeds: string) =>
      `Fertige Datenbank: ${feeds} vom Kilometr-Server. Einmal laden, dann offline.`,
    dlEmpty: 'Keine Offline-Daten.',
    dlSize: 'Ein Download • wenige Minuten • dann offline',
    dlProgress: (p: number) => `Wird geladen… ${p} %`,
    dlStep: (step: string, p: number) => `${step} ${p} %`,
    dlKeepOpen: 'App während des Ladens nicht schließen.',
    dlDone: 'Fahrplan bereit.',
    dlDoneSub: (stops: number, trips: number) => `${stops} Haltestellen • ${trips} Fahrten.`,
    dlFail: 'Etwas ist schiefgelaufen',
    dlFailBody: (msg: string) => `${msg}. Verbindung prüfen und erneut versuchen.`,
    saveFail: 'Ort konnte nicht gespeichert werden',
    saveFailBody: 'Versuche es erneut.',
    placesTitle: 'Wo bist du am häufigsten?',
    placesBody:
      'Gespeicherte Orte beschleunigen die Suche. Dieser Schritt kann übersprungen werden.',
    added: 'Hinzugefügt',
    removeSlotA11y: (name: string) => `${name} entfernen`,
    closeAction: 'Schließen',
    addAction: '+ Hinzufügen',
    addressFor: (name: string) => `Adresse für: ${name}…`,
    noResults: (q: string) =>
      `Keine Ergebnisse für „${q}“. Haltestellen werden offline gesucht, Adressen brauchen Internet.`,
    start: 'Kilometr einrichten',
    next: 'Weiter',
    later: 'Später',
    footerRetry: 'Erneut versuchen',
    footerDownloading: 'Wird geladen…',
    footerDownload: 'Fahrplan laden',
    needTimetable: 'Ohne Fahrplan keine Verbindungssuche möglich.',
    doneCount: (n: number) => `Fertig (${n})`,
    donePlain: 'Fertig',
    skip: 'Erstmal überspringen',
    skipTimetable: 'Überspringen, Fahrplan lade ich später',
  },
  news: {
    chip: 'Störungen',
    fetchFail: 'Meldungen konnten nicht geladen werden. Verbindung prüfen und erneut versuchen.',
    title: 'Neuigkeiten',
    sourceLoading: (feeds: string) => feeds,
    sourceEmpty: (combined: string) => combined,
    count: (n: number, urgent: number) =>
      `${n} Meldungen${urgent > 0 ? ` • ${urgent} dringend` : ''}`,
    refreshA11y: 'Meldungen aktualisieren',
    loading: 'Meldungen werden geladen…',
    noConnection: 'Keine Verbindung',
    emptyTitle: 'Keine Meldungen',
    emptyBody: (name: string) =>
      `${name} hat gerade keine Störungen veröffentlicht. Zum Aktualisieren nach unten ziehen.`,
    sectionChanges: 'Linienänderungen',
    sectionCity: 'Nachrichten',
    sourceMpk: (operator: string) => operator,
    sourceCity: (portal: string) => portal,
    openBrowser: 'Im Browser öffnen',
    articleFail: 'Dieser Beitrag konnte nicht geladen werden.',
    articleEmpty: 'Auf dieser Seite steht kein Text, den die App anzeigen kann.',
    filterAll: 'Alle',
    filterMyLines: 'Meine Linien',
    filterMyLinesA11y: 'Nur Meldungen zu Linien aus deinen letzten Verbindungen',
    filterEmptyTitle: 'Nichts auf deinen Linien',
    filterEmptyBody:
      'Keine Meldungen zu Linien aus Verbindungen, die du in den letzten zwei Wochen geprüft hast.',
    filterNoHistoryTitle: 'Noch keine Linien',
    filterNoHistoryBody:
      'Suche eine Verbindung in der App, danach siehst du hier Meldungen zu diesen Linien.',
    resolved: 'Verkehr wieder frei',
    solutionLabel: 'Umleitung',
    detourLabel: 'Umleitung',
    detourAndReplacement: 'Umleitung und Ersatzverkehr',
    replacementBus: 'Ersatzbus',
    urgentChip: 'Störung',
    plannedChip: 'Fahrplanänderung',
    omittedStopsPrefix: 'Ohne Halt:',
  },
  newsSvc: {
    justNow: 'gerade eben',
    minsAgo: (m: number) => `vor ${m} Min.`,
    hoursAgo: (h: number) => (h === 1 ? 'vor 1 Stunde' : `vor ${h} Stunden`),
    yesterday: 'gestern',
    daysAgo: (d: number) => (d === 1 ? 'vor 1 Tag' : `vor ${d} Tagen`),
    untitled: '(ohne Titel)',
  },
  map: {
    title: 'Routenkarte',
    stagesTitle: 'Reiseabschnitte',
    showWholeRoute: 'Ganze Route',
    loadFail: 'Verbindung konnte nicht geladen werden',
    loadFailBody:
      'Die Karte zeigt eine konkrete Verbindung, sie muss daher im Speicher oder Cache verfügbar sein.',
    backToDetails: 'Zurück zu den Details',
    assembling: 'Verbindung wird zusammengesetzt…',
    offlineTitle: 'Karte nicht verfügbar. Prüfe deine Netzwerkverbindung.',
    offlineSub: 'Kacheln laden nicht',
    backA11y: 'Zurück',
    transfersSuffix: (n: number) => (n === 1 ? ' • 1 Umstieg.' : ` • ${n} Umstiege.`),
    delaySuffix: (d: number) => ` • ${d > 0 ? '+' : ''}${d} Min.`,
    walkStageA11y: (dist: string) => `Fußetappe ${dist}`,
    lineStageA11y: (line: string, dir: string) => `Linie ${line} Richtung ${dir}`,
    legStops: (n: number) => (n === 1 ? '1 Halt' : `${n} Halte`),
    board: 'Einsteigen',
    alight: 'Aussteigen',
    mapLoadFail: 'Karte konnte nicht geladen werden',
    maneuver: {
      depart: 'Zur Haltestelle gehen',
      straight: 'Geradeaus weiter',
      slightLeft: 'Leicht links halten',
      left: 'Links abbiegen',
      sharpLeft: 'Scharf links abbiegen',
      slightRight: 'Leicht rechts halten',
      right: 'Rechts abbiegen',
      sharpRight: 'Scharf rechts abbiegen',
      uturn: 'Umkehren',
      board: 'Einsteigen',
      alight: 'Aussteigen',
      arrive: 'Du bist angekommen',
      then: 'danach',
      in: 'in',
      onStop: 'an der Haltestelle',
    },
  },
  routes: {
    gpsAddress: 'Aktuelle Position verwenden',
    destFallback: 'Ziel',
    trackUnsupportedTitle: 'Verfolgung nicht verfügbar',
    trackUnsupportedBody:
      'Mitteilungen brauchen einen Entwicklungs-Build. Expo Go unterstützt sie nicht.',
    trackFailTitle: 'Verfolgung fehlgeschlagen',
    trackFailBody: 'Versuche es gleich noch einmal.',
    stopTrackingTripA11y: 'Reiseverfolgung beenden',
    trackTripA11y: 'Diese Fahrt verfolgen',
    notifOffTitle: 'Mitteilungen aus',
    gpsFailTitle: 'Standortfehler',
    gpsFailBody:
      'Aktuelle GPS-Position konnte nicht ermittelt werden. Stelle sicher, dass der Standort am Telefon aktiviert ist.',
    now: 'Jetzt',
    title: (operator: string) => `${operator}-Verbindungen`,
    changeFromA11y: (t: string) => `Start ändern, aktuell ${t}`,
    changeFromAnchorA11y: (t: string, stop: string) =>
      `Start ändern, aktuell ${t}, Abfahrt ab Haltestelle ${stop}`,
    dismissAnchorA11y: 'Haltestellenanker entfernen und ab GPS suchen',
    swapA11y: 'Route umkehren: Start und Ziel tauschen',
    changeToA11y: (t: string) => `Ziel ändern, aktuell ${t}`,
    searching: 'Verbindungen werden gesucht…',
    calcFail: 'Verbindungen konnten nicht berechnet werden',
    noTimetable: 'Kein Fahrplan',
    calcFailBody:
      'Der Planer rechnet Routen auf deinem Telefon. Versuch es erneut. Bei Dauerfehlern den Fahrplan in den Einstellungen aktualisieren.',
    noTimetableBody:
      'Die App berechnet Routen auf deinem Telefon aus dem vollen Fahrplan. Ohne ihn gibt es keine Verbindungen. Einmal laden, danach offline nutzbar.',
    downloadA11y: 'Fahrplan laden',
    downloading: (p: number) => `Wird geladen… ${p} %`,
    downloadingStep: (step: string, p: number) => `${step} ${p} %`,
    downloadingPlain: 'Wird geladen…',
    downloadAction: 'Fahrplan laden',
    earlierAction: 'Frühere Verbindungen',
    earlierLoading: 'Frühere Verbindungen werden geladen…',
    earlierEmpty: 'Keine früheren Verbindungen an diesem Tag',
    earlierRetry: 'Verbindungen konnten nicht geladen werden. Erneut versuchen',
    offlineTapA11y: 'Neueste Cache-Daten. Tippen zum Aktualisieren.',
    offlineChip: 'offline',
    noLiveChip: 'keine Live-Daten',
    moreFail: 'Weitere Verbindungen konnten nicht geladen werden.',
    moreRetryA11y: 'Versuchen, weitere Verbindungen zu laden',
    noMore: 'Das sind alle Abfahrten dieser Route.',
    noMoreArrival:
      'Keine früheren Verbindungen in diesem Zeitfenster. Wähle eine frühere Ankunftszeit.',
    emptyArrival:
      'Keine Verbindungen vor der gewählten Uhrzeit. Wähle eine spätere Ankunftszeit oder ein anderes Ziel.',
    emptyFiltered: 'Keine Verbindungen für die gewählten Filter',
    emptyNone: 'Keine Verbindungen gefunden',
    emptyModeDirect: (veh: string) =>
      `Auf dieser Route gibt es gerade keinen ${veh}-Kurs ohne Umstieg. Filter lockern oder eine andere Zeit prüfen.`,
    emptyDirect:
      'Auf dieser Route gibt es gerade keine Direktverbindung. Deaktiviere den Filter „Nur direkt“, um Verbindungen mit Umstieg zu sehen, oder prüfe eine andere Zeit.',
    emptyMode: (veh: string) =>
      `Auf dieser Route gibt es gerade keinen ${veh}-Kurs. Wechsle auf „Alle“, um den Rest zu sehen.`,
    emptyPlain: 'Versuch ein anderes Ziel oder prüfe eine andere Abfahrtszeit.',
    emptyLive: 'Keine Verbindungen mit Live-Daten',
    samePlaceTitle: 'Start und Ziel sind derselbe Ort',
    samePlaceBody:
      'Du bist schon da, also gibt es nichts zu planen. Wähle ein anderes Ziel, um Verbindungen zu sehen.',
    vehicleTramGen: 'mit der Tram',
    vehicleBusGen: 'mit dem Bus',
    vehicleTrolleyGen: 'mit dem Obus',
    vehicleTrainGen: 'mit dem Zug',
    vehicleSubwayGen: 'mit der U-Bahn',
    vehicleCableGen: 'mit der Seilbahn',
    showWithChangesA11y: 'Verbindungen mit Umstieg zeigen',
    showWithChanges: 'Mit Umstieg zeigen',
    showAllVehiclesA11y: 'Alle Fahrzeuge zeigen',
    showAllVehicles: 'Alle Fahrzeuge zeigen',
    showWithoutLive: 'Ohne Live anzeigen',
  },
  routeDetails: {
    departure: 'Abfahrt',
    vehicleDeparture: 'Abfahrt',
    scheduledTime: (time: string) => `Planmäßig ${time}`,
    estimatedDelay: (n: number) => `Etwa +${n} Min., aus anderen Bussen geschätzt`,
    untrackedVehicle: 'Keine aktuelle Position. Verspätung möglich.',
    uncertainTransfer: 'Wenig Zeit zum Umsteigen. Die Verspätung dieses Busses ist ungewiss.',
    arrival: 'Ankunft',
    origin: 'Von',
    destination: 'Nach',
    late: (n: number) => `${n} Min. Verspätung`,
    early: (n: number) => `${n} Min. früher`,
    title: 'Verbindungsdetails',
    loadFail: 'Verbindung konnte nicht geladen werden.',
    backToList: 'Zurück zur Liste',
    offlineNote: 'Offline gespeichert. Fahrplanzeiten ohne Live-Daten.',
    noLiveNote: 'Fahrplanzeiten. Keine Live-Daten.',
    onTime: 'Pünktlich',
    liveDataAge: (s: number) => `Daten von vor ${s}s`,
    schedule: 'Fahrplan',
    noTrip: 'Kein Routenverlauf',
    noTripBody:
      'Diese Verbindung hat keine gespeicherten Haltestellen, daher kann die Route nicht gezeichnet und die nächste Haltestelle nicht gezeigt werden. Geh zurück und wähle eine andere Verbindung.',
    lineAlertsTitle: 'Meldungen zu deinen Linien',
    lineAlertsAll: 'Alle Neuigkeiten',
    lineAlertsCount: (n: number) => (n === 1 ? '1 Meldung' : `${n} Meldungen`),
    lineAlertsLoading: 'Störungen werden geprüft…',
    lineAlertsError: 'Störungen konnten nicht geprüft werden.',
  },
  search: {
    suggestedPlaces: 'Vorgeschlagene Orte',
    emptyTitle: 'Wohin geht’s?',
    emptyHint: 'Gib eine Haltestelle, Adresse oder einen Ort ein. Deine Auswahl erscheint hier.',
    errorTitle: 'Suche fehlgeschlagen',
    errorHint:
      'Ändere die Suchanfrage und versuche es erneut. Prüfe, ob der Stadtfahrplan heruntergeladen ist.',
    defaultPlaceholder: (city: string) => `In ${city} suchen…`,
    originA11y: (t: string) => `Startpunkt: ${t}. Tippen zum Ändern.`,
    fromPrefix: 'Ab:',
    change: 'Ändern',
    closeA11y: 'Suche schließen',
    clearA11y: 'Anfrage löschen',
    resultsFor: (q: string, n: number) => `Ergebnisse für „${q}“ (${n})`,
    savedA11y: (t: string) => `Gespeicherter Ort: ${t}`,
    searching: (city: string) => `${city} wird durchsucht…`,
    noResults: 'Keine Ergebnisse',
    noResultsHint: (id: string) =>
      `Versuch: ${id === 'krakow' ? '„rynek“, „grodzka“, „wawel“, „balice“' : id === 'gzm' ? '„katowice“, „gliwice“, „rynek“, „tychy“' : id === 'warszawa' ? '„metro“, „młociny“, „centralny“, „śródmieście“' : id === 'poznan' ? '„rynek“, „garbary“, „rondo“, „malta“' : id === 'trojmiasto' ? '„oliwa“, „wrzeszcz“, „orłowo“, „przymorze“' : id === 'lodz' ? '„piotrkowska“, „manufaktura“, „fabryczna“, „kaliska“' : id === 'szczecin' ? '„brama portowa“, „dąbie“, „police“, „pogodno“' : id === 'kielce' ? '„sienkiewicza“, „rynek“, „kadzielnia“, „herby“' : id === 'olsztyn' ? '„stare miasto“, „dworzec“, „jaroty“, „barczewo“' : id === 'bialystok' ? '„rynek kościuszki“, „lipowa“, „branicki“, „opera“' : id === 'opole' ? '„rynek“, „ozimska“, „solaris“, „dworzec“' : id === 'rzeszow' ? '„rynek“, „dworzec“, „rejtana“, „3 maja“' : id === 'lublin' ? '„krakowskie“, „zamek“, „felicity“, „świdnik“' : id === 'radom' ? '„żeromskiego“, „południe“, „gołębiów“, „idalin“' : '„arkady“, „biskupin“, „zoo“, „swojczycka“'}. Geht auch ohne polnische Zeichen und mit Tippfehlern.`,
    noResultsFor: (q: string) => `Nichts passt zu „${q}“`,
    gpsOutsideNotice: 'GPS außerhalb der Stadt, Punkt manuell wählen.',
  },
  places: {
    editAction: 'Bearbeiten',
    editA11y: (name: string) => `Ort bearbeiten: ${name}`,
    removeA11y: (name: string) => `Ort löschen: ${name}`,
    clearAnchorA11y: 'Zugewiesene Haltestelle entfernen',
    manageTitle: 'Gespeicherte Orte',
    manageSub: 'Deine Schnellziele verwalten',
    emptyTitle: 'Keine gespeicherten Orte',
    emptyBody:
      'Füge Zuhause, Arbeit oder Lieblingsorte hinzu, um Verbindungen mit einem Tipp zu prüfen.',
    addNew: 'Neuen Ort hinzufügen',
    removeTitle: (name: string) => `„${name}“ entfernen?`,
    removeGeneric: 'Diesen Ort entfernen?',
    removeConfirm: 'Entfernen',
    pwrBuildingTitle: (code: string) => `PWr-Gebäude ${code}`,
    iconCategories: {
      all: 'Alle',
      frequent: 'Häufig',
      transit: 'Reise',
      food: 'Essen',
      health: 'Gesundheit',
      culture: 'Kultur',
      sport: 'Sport',
      services: 'Dienste',
    },
    iconName: {
      home: 'Zuhause',
      work: 'Arbeit',
      school: 'Schule',
      university: 'Uni',
      gym: 'Fitnessstudio',
      coffee: 'Café',
      shopping: 'Laden',
      star: 'Favoriten',
      heart: 'Wichtig',
      friends: 'Freunde',
      train: 'Bahnhof',
      tram: 'Tram',
      bus: 'Bus',
      plane: 'Flughafen',
      bike: 'Fahrrad',
      car: 'Auto',
      fuel: 'Tankstelle',
      ship: 'Fähre / Hafen',
      compass: 'Kompass',
      restaurant: 'Restaurant',
      pizza: 'Pizzeria',
      sandwich: 'Bistro',
      beer: 'Pub / Bier',
      wine: 'Bar / Wein',
      market: 'Markt',
      cart: 'Supermarkt',
      pharmacy: 'Apotheke',
      hospital: 'Krankenhaus',
      doctor: 'Arztpraxis',
      scissors: 'Friseur',
      sparkles: 'Beauty / Spa',
      cinema: 'Kino',
      theater: 'Theater',
      culture: 'Museum',
      library: 'Bibliothek',
      music: 'Musik',
      ticket: 'Event',
      gamepad: 'Unterhaltung',
      park: 'Park',
      mountain: 'Berge',
      tent: 'Camping',
      trophy: 'Stadion',
      swimming: 'Pool / Strand',
      church: 'Kirche',
      baby: 'Kindergarten',
      pet: 'Haustier',
      hotel: 'Hotel',
      bank: 'Bank / Geldautomat',
      post: 'Post / Paket',
      laptop: 'Coworking',
      mapPin: 'Sonstige',
      plus: 'Sonstige',
    },
    chooseIcon: 'Symbol wählen',
    iconFor: (name: string) => `Symbol für: ${name}`,
    iconForFallback: 'diesen Ort',
    searchIcon: 'Symbole suchen (z. B. Zug, Kaffee, Arzt)…',
    anchorTitle: 'Anker-Haltestelle',
    anchorFor: (name: string) => `Abfahrtshaltestelle wählen für: ${name}`,
    searchStop: 'Haltestelle suchen…',
    nearStops: 'Nächste Haltestellen um die gewählte Adresse:',
    typeStopAbove: 'Haltestellennamen oben eingeben zum Suchen.',
    metersAway: (m: number) => `${m} m vom gewählten Ort`,
    choose: 'Wählen',
    editPlace: 'Ort bearbeiten',
    newPlace: 'Neuer gespeicherter Ort',
    chooseTarget: 'Zieladresse oder -haltestelle wählen',
    editHint: 'Namen, Symbol oder Adresse ändern',
    newHint: 'Ziel wählen und zu Schnellrouten hinzufügen',
    nameLabel: 'Ortsname',
    nameHint: 'z. B. Zuhause, Uni, Arbeit, Fitness',
    moreIcons: (n: number) => `Weitere Symbole (${n}) ›`,
    addressLabel: 'Zieladresse oder -haltestelle',
    changeBtn: 'Ändern',
    queryHint: 'Straße, Haltestelle oder Ort eingeben…',
    anchorOptional: 'Bevorzugte Haltestelle (optional)',
    anchorHint: 'Abfahrten ab dieser Haltestelle in der Nähe',
    assignAnchor: '+ Abfahrtshaltestelle zuweisen',
    saveChanges: 'Änderungen speichern',
    savePlace: 'Ort speichern',
    saveFail: 'Ort konnte nicht gespeichert werden',
  },
  timeSheet: {
    title: 'Reisezeit',
    modeDeparture: 'Abfahrt um',
    modeArrival: 'Ankunft bis',
    selectedArrival: (day: string, hh: string, mm: string) => `Ankunft bis: ${day}, ${hh}:${mm}`,
    confirmAction: 'Verbindungen anzeigen',
    selectedDeparture: (day: string, hh: string, mm: string) => `${day}, ${hh}:${mm}`,
    minutePreset: (mm: string) => `Minute auf ${mm} setzen`,
    dayToday: 'Heute',
    dayTomorrow: 'Morgen',
    hourLabel: 'Stunde',
    minuteLabel: 'Minute',
    pastWarning: 'Die gewählte Zeit ist bereits vergangen',
    switchTomorrow: 'Auf morgen umstellen',
  },
  routesBar: {
    modeTram: 'Tram',
    modeBus: 'Bus',
    reverse: 'Umkehr',
    direct: 'Direkt',
    timeA11y: (label: string) => `Abfahrtszeit: ${label}. Tippen zum Ändern.`,
    arrivalShort: (time: string) => `bis ${time}`,
  },
  routesFilters: {
    title: 'Filter',
    filterButton: 'Filter',
    filterA11y: 'Routenfilter',
    vehiclesSection: 'Verkehrsmittel',
    allVehicles: 'Alle',
    transfersSection: 'Umstiege',
    transfersAll: 'Alle',
    transfersMax1: 'Max. 1 Umstieg',
    transfersDirect: 'Nur Direkt',
    directOnly: 'Nur Direktverbindungen',
    liveSection: 'Echtzeitdaten',
    liveOnly: 'Nur Fahrzeuge mit Live-GPS',
    liveOnlyHint: 'Fahrten ohne Echtzeitverfolgung ausblenden',
    reset: 'Zurücksetzen',
    resetA11y: 'Filter zurücksetzen',
    done: 'Fertig',
    closeA11y: 'Filter schließen',
  },
  connection: {
    previewTitle: 'Verbindungsvorschau',
    previewHint: 'Gedrückt halten, um die Verbindung anzusehen.',
    previewSwipe: 'Nach oben schieben, um Details zu öffnen',
    previewRelease: 'Loslassen, um Details zu öffnen',
    previewOpen: 'Verbindungsdetails öffnen',
    transfers: (n: number) => (n <= 0 ? 'direkt' : n === 1 ? '1 Umstieg' : `${n} Umstiege`),
    connections: (n: number) => (n === 1 ? '1 Verbindung' : `${n} Verbindungen`),
    walkAll: 'alles zu Fuß',
    walkLeg: 'zu Fuß',
    walkTo: (stop: string) => `Fußweg zu: ${stop}`,
    cardA11y: (
      dep: string,
      dur: number,
      depAt: string,
      arrAt: string,
      via: string,
      lines: string,
    ) =>
      `${dep}, Fahrzeit ${formatDuration(dur)}, Abfahrt ${depAt}, Ankunft ${arrAt}, ${via}${lines ? `, Linien ${lines}` : ''}`,
    walkRoute: 'Fußweg',
  },
  vehiclePos: {
    noRoute: 'Keine Routendaten',
    liveBetween: (from: string, to: string) => `Fahrzeug: ${from} → ${to} • live`,
    liveBefore: (stop: string) => `Fahrzeug: vor ${stop} • live`,
    liveAt: (stop: string) => `Fahrzeug: ${stop} • live`,
    liveNear: (stop: string) => `Fahrzeug: in der Nähe von ${stop} • live`,
    estRoute: (from: string, to: string) => `Geschätzte Position: ${from} → ${to}`,
    estBefore: (at: string) => `Vor Abfahrt (${at}) • geschätzte Position`,
    estDone: `Fahrt beendet • geschätzte Position`,
    estBetween: (from: string, to: string) => `Fahrzeug (geschätzt): ${from} → ${to}`,
  },
  leg: {
    fareBoundary: 'Tarifzonengrenze',
    fareBoundaryDetail: (areas: string, point: string) => (point ? `${areas} · ${point}` : areas),
    noData: 'Keine Routendaten',
    expandA11y: (line: string, dir: string, expanded: boolean) =>
      `${line} Richtung ${dir}. Haltestellenliste ${expanded ? 'ein' : 'aus'}klappen.`,
    expandStationsA11y: (line: string, dir: string, expanded: boolean) =>
      `${line} Richtung ${dir}. Bahnhofsliste ${expanded ? 'ein' : 'aus'}klappen.`,
    vehicleBetween: (mode: string, from: string, to: string) =>
      `${mode} zwischen ${from} und ${to}`,
    fromPrefix: 'ab ',
    toPrefix: 'bis ',
    modeTram: 'Straßenbahn',
    modeBus: 'Bus',
    modeTrain: 'Zug',
    modeSubway: 'U-Bahn',
    modeTrolley: 'Oberleitungsbus',
    modeCable: 'Seilbahn',
    modeVehicle: 'Fahrzeug',
    currentLocation: (stop: string) => `Aktueller Standort: ${stop}`,
    waitingAtTerminus: 'Wartet auf Abfahrt an der Endhaltestelle',
    liveTracking: 'Live-Verfolgung',
    transfer: 'Umstieg',
    transferMinutes: (min: number) => `Umstieg · ~${min} Min.`,
    nearStop: (mode: string, stop: string) => `${mode} nahe Haltestelle: ${stop}`,
    stopsSummary: (n: number, mins: number, open: boolean) =>
      `${n} ${n === 1 ? 'Haltestelle' : 'Haltestellen'} • ~${formatDuration(mins)} • ${open ? 'ein' : 'aus'}klappen`,
    stationsSummary: (n: number, mins: number, open: boolean) =>
      `${n} ${n === 1 ? 'Bahnhof' : 'Bahnhöfe'} • ~${mins} Min. • ${open ? 'ein' : 'aus'}klappen`,
    platformPeron: (code: string) => `Bahnsteig ${code}`,
    platformPeronTrack: (code: string, track: string) => `Bahnsteig ${code}, Gleis ${track}`,
    platformTrack: (track: string) => `Gleis ${track}`,
    platformPole: (code: string) => `Mast ${code}`,
    platformBay: (code: string) => `Stand ${code}`,
    platformPst: (code: string) => `PST-Mast ${code}`,
  },
  compass: {
    fullscreen: 'Navigation im Vollbild',
    recenter: 'Position wieder folgen',
    following: 'Position wird verfolgt',
    northUp: 'Norden oben anzeigen',
    boarded: 'Ich bin eingestiegen',
    alighted: 'Ausgestiegen. Weiteren Weg zeigen',
    journeyTitle: 'Navigation unterwegs',
    riding: 'Fahrt bis zur Ausstiegshaltestelle',
    transferWalk: 'Fußweg zum Umstieg',
    alightAt: (name: string) => `Aussteigen: ${name}`,
    boardAt: (name: string) => `Einsteigen: ${name}`,
    mapLoading: 'Karte wird geladen…',
    mapTapToLoad: 'Tippen, um die Karte zu laden',
    mapFailed:
      'Karte konnte nicht geladen werden. Versuche es erneut oder lade in den Einstellungen eine Offline-Karte herunter.',
    mapRetry: 'Karte erneut laden',
    openMap: 'Vollständige Routenkarte öffnen',
    ahead: 'Geradeaus',
    slightRight: 'Leicht rechts',
    right: 'Rechts von dir',
    back: 'Hinter dir',
    left: 'Links von dir',
    slightLeft: 'Leicht links',
    title: 'Navigation zur Haltestelle',
    straight: 'Luftlinie',
    distanceText: (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`),
    walkMins: (m: number) => `~${m} Min. zu Fuß`,
    nextStop: 'Nächste Haltestelle',
    rerouting: 'Neue Route wird gesucht',
    openSettingsA11y: 'App-Einstellungen öffnen',
  },
  lastTrip: {
    activateHint: 'Aktivieren, um diese Verbindung zu suchen.',
    backA11y: (from: string, to: string) =>
      `Schnelle Rückkehr: ${from} nach ${to}. Zum Suchen loslassen.`,
    lastA11y: (from: string, to: string) =>
      `Letzte Verbindung: ${from} nach ${to}. Weiter ziehen zum Umkehren.`,
    pullHint: 'Zuletzt gesuchte Verbindung.\nZum Suchen loslassen',
    pullHintBack: 'Rückweg.\nZum Suchen loslassen',
  },
  suggestion: {
    stopFallback: 'Haltestelle',
  },
  intercity: {
    stationAddress: 'Bahnhof',
    downloadTitle: 'Nationales Bahnfahrplan',
    downloadBody:
      'Lade den bundesweiten Zugfahrplan herunter, um Reisen zwischen Städten zu planen: IC, EIC, PolRegio, KM und weitere Betreiber.',
    downloadCta: 'Fahrplan herunterladen',
    downloadSize: (mb: string) => `ca. ${mb} MB`,
    downloading: 'Bahnfahrplan wird heruntergeladen…',
    downloadFailed: 'Bahnfahrplan konnte nicht heruntergeladen werden. Versuche es später erneut.',
    ready: (date: string) => `Bahnfahrplan bereit (gültig bis ${date})`,
    noTrainsTitle: 'Keine Züge',
    noTrainsHint: 'Prüfe Datum und Uhrzeit oder wähle einen anderen Zielbahnhof.',
    nearestStation: (name: string, dist: string) => `Nächster Bahnhof: ${name} (${dist})`,
    startAtStation: 'Züge von diesem Bahnhof zeigen',
  },

  railAlerts: {
    cardA11y: (line: string) => `Warnung für Zug ${line}`,
    fallbackLine: 'Zug',
    disruptionsBadgeA11y: 'Störungen auf der Route',
  },

  data: {
    stepUnpack: 'Entpacken…',
    stepStops: 'Haltestellen…',
    stepLines: 'Linien…',
    stepCalendar: 'Kalender…',
    stepTrips: 'Fahrten…',
    stepTimes: 'Abfahrtszeiten…',
    stepTimesK: (k: number) => `Abfahrtszeiten… (${k} Tsd.)`,
    stepIndex: 'Indizes werden gebaut…',
    stepWeights: 'Haltestellengewichte…',
    stepVerify: 'Prüfen…',
    errStops: 'stops.txt fehlt im GTFS-Archiv',
    errTrips: 'trips.txt fehlt im GTFS-Archiv',
    errTimes: 'stop_times.txt fehlt im GTFS-Archiv',
    prepareFail: 'Fahrplan konnte nicht vorbereitet werden',
    retryHint: 'Tippen zum Wiederholen.',
  },
  downloader: {
    noNet: 'Keine Internetverbindung',
    timeout: 'Download hat zu lange gedauert',
    noSpace: 'Zu wenig Speicher auf dem Telefon',
    unavailable: 'Fahrplan vorübergehend nicht verfügbar',
    failed: 'Fahrplan konnte nicht geladen werden',
    hintRetry: 'Verbindung prüfen und tippen zum Wiederholen.',
    hintTouch: 'Tippen zum Wiederholen.',
    hintSpace: 'Speicher freigeben und tippen zum Wiederholen.',
    hintLater: 'Versuch es später erneut.',
    noFile: 'GTFS-Download lieferte keine Datei',
  },
  notification: {
    channelTracking: 'Fahrtverfolgung',
    channelTrackingDesc: 'Stiller Fahrtfortschritt mit Countdown bis zur Abfahrt oder Ankunft.',
    channelAlerts: 'Fahrtmeldungen',
    channelAlertsDesc: 'Verspätungen, Änderungen und Ankunft.',
    permDenied:
      'Benachrichtigungen sind deaktiviert. Aktiviere sie in den Systemeinstellungen für kilometr, um Abfahrt und Fahrtfortschritt zu verfolgen.',
    actionStop: 'Beenden',
    actionRoute: 'Route',
    showRoutes: 'Route anzeigen',
    actionOk: 'OK',
    modeWalk: 'Zu Fuß',
    modeTram: 'Straßenbahn',
    modeBus: 'Bus',
    modeTrain: 'Zug',
    modeSubway: 'U-Bahn',
    modeCable: 'Seilbahn',
    modeTrolleybus: 'Obus',
    departTitle: (service: string, at: string) => `${service} • ab ${at}`,
    rideTitle: (service: string, at: string) => `${service} • an ${at}`,
    transferTitle: (service: string, at: string) => `Umsteigen • ${service} • ab ${at}`,
    arrivedTitle: 'Du bist angekommen',
    arrivedBody: (at: string, dur: string) => `Ankunft ${at} • Fahrt dauerte ${dur}`,
    nextStop: (name: string) => `nächste ${name}`,
    estimatedNextStop: (name: string) => `Voraussichtlich nächste Haltestelle: ${name}`,
    stopHere: (name: string) => `Haltestelle ${name}`,
    alightAt: (name: string) => `Ausstieg: ${name}`,
    directionTo: (dir: string) => `Richtung ${dir}`,
    platform: (num: string) => `Gleis ${num}`,
    platformPeron: (num: string) => `Bahnsteig ${num}`,
    platformPeronTrack: (num: string, track: string) => `Bahnsteig ${num}, Gleis ${track}`,
    platformTrack: (track: string) => `Gleis ${track}`,
    walkApproach: (min: number) => `~${min} Min. zu Fuß`,
    rideLength: (min: number) => `${min} Min. Fahrt`,
    departAt: (at: string) => `ab ${at}`,
    arriveAt: (at: string) => `an ${at}`,
    delayLate: (min: number) => `verspätet +${Math.round(min)} Min.`,
    delayEarly: (min: number) => `${Math.abs(Math.round(min))} Min. früher`,
    stops: (n: number) => `${n} ${n === 1 ? 'Haltestelle' : 'Haltestellen'}`,
    transfers: (n: number) => `${n} ${n === 1 ? 'Umstieg' : 'Umstiege'}`,
    newDeparture: (at: string) => `neue Abfahrt ${at}`,
    delayTitle: (line: string, eta: string) => `Verspätung • ${line} • ${eta}`,
  },
  ios: {
    departure: 'Abfahrt',
    arrival: 'Ankunft',
    alighting: 'Aussteigen',
    walking: 'Fußweg',
    waiting: 'Warten',
    riding: 'Unterwegs',
    transfer: 'Umstieg',
    nextStop: 'Nächste Haltestelle',
    startupTitle: 'App-Fehler',
    startupHint:
      'Kilometr kann nicht fortfahren. Teile den Bericht, um bei der Fehlersuche zu helfen.',
    startupShare: 'Teilen',
    locationPermission:
      'Erlaube den Standortzugriff, um Verbindungen ab deinem Standort zu finden.',
    liveTitle: 'Live-Aktivität',
    liveHint:
      'Fahrzeit auf dem Sperrbildschirm und in der Dynamic Island. Daten werden aktualisiert, solange die App aktiv ist.',
    liveDisabled: 'Aktiviere Live-Aktivitäten in den Systemeinstellungen für Kilometr.',
    stale: 'Laut Fahrplan. Öffne Kilometr zum Aktualisieren.',
    alarmHint:
      'Eine Erinnerung mit Benachrichtigungston. Stummmodus und Fokus können sie stummschalten. Es öffnet sich kein Vollbildwecker.',
  },
  alarm: {
    title: 'Fahrtwecker',
    set: 'Wecker stellen',
    edit: 'Wecker ändern',
    hint: 'Ton, Vibration und Vollbild vor dem Losgehen.',
    question: 'Wie viel Zeit brauchst du vor dem Losgehen?',
    before: 'vor dem Losgehen',
    minutes: (n: number) => (n === 1 ? 'Minute' : 'Minuten'),
    lead: (n: number) => `${n} ${n === 1 ? 'Minute' : 'Minuten'} vor dem Losgehen`,
    less: 'Eine Minute später',
    more: 'Eine Minute früher',
    ringsAt: (time: string) => `Klingelt um ${time}`,
    journeyAt: (time: string) => `Losgehen um ${time}`,
    boarding: (line: string, time: string, stop: string) => `${line} • ${time} • ${stop}`,
    save: 'Wecker einschalten',
    saving: 'Wecker wird gestellt…',
    remove: 'Wecker entfernen',
    ringTitle: 'Zeit, dich fertigzumachen',
    dismiss: 'Wecker ausschalten',
    showRoute: 'Verbindung anzeigen',
    channel: 'Fahrtwecker',
    channelDescription: 'Vollbildwecker für eine ausgewählte Verbindung.',
    unavailable: 'Installiere die aktuelle Kilometr-App, um eine Erinnerung einzustellen.',
    tooLate: 'Diese Uhrzeit ist vorbei. Wähle weniger Minuten vor dem Losgehen.',
    past: 'Diese Fahrt hat bereits begonnen.',
    error: 'Der Wecker konnte nicht gestellt werden. Versuche es erneut.',
    replace: 'Dieser Wecker ersetzt den für die andere Fahrt.',
    exactHint: 'Erlaube Wecker und Erinnerungen, damit der Wecker zur gewählten Zeit klingelt.',
    exactAction: 'Wecker erlauben',
    fullScreenHint:
      'Erlaube Vollbildwecker, damit der Wecker auf dem gesperrten Telefon erscheint.',
    fullScreenAction: 'Vollbild erlauben',
    notificationHint:
      'Aktiviere Weckerbenachrichtigungen, damit dein Telefon den Wecker anzeigen kann.',
    notificationAction: 'Benachrichtigungen aktivieren',
    soundHint: 'Verwendet den Weckton und die Weckerlautstärke deines Telefons.',
  },
  notificationPrefs: {
    title: 'Benachrichtigungen',
    devBuildWarn:
      'Benötigt einen Development-Build. In Expo Go funktionieren Benachrichtigungen nicht.',
    unsupportedTitle: 'Benachrichtigungen nicht verfügbar',
    unsupportedBody:
      'Fahrtverfolgung braucht einen Development-Build. Expo Go unterstützt keine Benachrichtigungen.',
    trackTitle: 'Fahrtverfolgung',
    trackHint: 'Eine Benachrichtigung mit aktueller Fahrtphase und Verbindungsdetails.',
    liveTitle: 'Fortschritt und Timer',
    liveHint: 'Das System aktualisiert den Streckenbalken und Timer bei geschlossener App.',
    liveHintBasic:
      'Diese Version unterstützt keinen Live-Fortschritt. Die Mitteilung zeigt weiterhin Fahrtphase und Verbindungsdetails.',
    livePromoteHint:
      'Das System zeigt diese Benachrichtigung nicht unter Live Updates. Erlaube Live Updates in den Benachrichtigungseinstellungen von kilometr.',
    openNotificationSettings: 'Benachrichtigungseinstellungen öffnen',
    alertsTitle: 'Warnungen',
    disruptionTitle: 'Verspätungswarnung',
    disruptionHint: 'Wenn die Verbindung deutlich später fährt als zuvor gemeldet.',
    on: 'An',
    off: 'Aus',
  },
  pinned: {
    channel: 'Angeheftete Verbindung',
    tram: 'Tram',
    bus: 'Bus',
  },
  railTickets: {
    loading: 'Laden…',
    buyKoleo: 'Fahrkarte in KOLEO kaufen',
    buyKoleoSub: (from: string, to: string) => `${from} nach ${to}`,
    buyKoleoTransferSub: (from: string, to: string, transfers: number) =>
      transfers === 1
        ? `${from} nach ${to} · 1 Umstieg`
        : `${from} nach ${to} · ${transfers} Umstiege`,
    attachPdf: 'PDF-Fahrkarte anhängen',
    attachedTitle: 'Zugfahrkarte',
    attachedDetails: (wagon?: string, seat?: string, seatType?: string) => {
      const parts: string[] = [];
      if (wagon) parts.push(`Wagen ${wagon}`);
      if (seat) parts.push(`Sitzplatz ${seat}`);
      if (seatType) parts.push(seatType);
      return parts.join(', ');
    },
    showTicket: 'Fahrkarte anzeigen',
    removeTicket: 'Fahrkarte entfernen',
    removeConfirmTitle: 'Fahrkarte wirklich entfernen?',
    removeConfirmBody: 'Die PDF-Datei wird aus dem Speicher gelöscht.',
    fileLabel: (fileName: string) => `Datei: ${fileName}`,
    importSuccess: 'PDF-Fahrkarte erfolgreich angehängt.',
    importError: 'PDF-Datei konnte nicht geladen werden.',
  },
  widgets: {
    journeyTitle: 'Deine Ziele',
    journeyDescription: 'Losgehzeit und Linien zu gespeicherten und zuletzt gesuchten Zielen',
    trackingTitle: 'Deine Fahrt',
    openApp: 'Route in Kilometr suchen',
    addPlace: 'Ort hinzufügen',
    refresh: 'In der App aktualisieren',
    fromOrigin: (name: string) => `Von: ${name}`,
    picker: {
      tripDescription: 'Zeit bis zum Losgehen oder zur Ankunft, Fortschritt und Umstiege',
      searchTitle: 'Wohin?',
      searchDescription: 'Route suchen oder einen gespeicherten Ort wählen',
      placesTitle: 'Meine Orte',
      placesDescription: 'Mit einem Tippen eine Route vom aktuellen Standort suchen',
    },
    preview: {
      home: 'Zuhause',
      work: 'Arbeit',
      gym: 'Fitnessstudio',
      school: 'Schule',
      origin: 'Zentrum',
    },
    checkRoutes: 'Verbindungen suchen',
    early: (n: string) => `-${n} Min.`,
    now: 'jetzt',
    min: 'Min.',
    onTime: 'Pünktlich',
    timetable: 'Fahrplan',
    late: (n: string) => `+${n} Min.`,
    departAt: (t: string) => `Losgehen ${t}`,
    departIn: (n: string) => `Los in ${n} Min.`,
    departNow: 'Jetzt losgehen',
    arriveIn: (n: string) => `Ankunft in ${n} Min.`,
    arrived: 'Angekommen',
    updated: (t: string) => `Stand ${t}`,
    stale: 'Nächste Verbindung suchen',
    destEmpty: 'Suche eine Route, um sie hier zu sehen.',
    tripEmptyTitle: 'Keine Fahrt verfolgt',
    tripEmptyBody: 'Wähle eine Verbindung und schalte die Verfolgung ein.',
    placesEmpty: 'Füge deinen ersten Ort hinzu',
    search: 'Wohin?',
  },
};
