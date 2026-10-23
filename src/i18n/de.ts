// Deutsche Übersetzungen. Muss `Strings` (typeof pl) erfüllen - ein fehlender
// Schlüssel oder eine falsche Funktionssignatur ist ein Compile-Fehler.
import type { Strings } from './pl';
import { de as landing } from './landing/de';
import { de as share } from './share/de';

export const de: Strings = {
  landing,
  share,
  transferGuard: {
    title: 'Umstiegsbegleitung',
    waiting: 'Die Überwachung ist aktiv. Wir warten auf die GPS-Bestätigung deiner Fahrt.',
    buffer: (line: string, n: number) => `Umstieg auf ${line} · ${n} Min. Reserve`,
    riskTitle: (line: string) => `Der Umstieg auf ${line} ist gefährdet`,
    riskBody: 'Wir suchen einen anderen Umstieg.',
    stayOn: (line: string) => `Bleib in ${line}`,
    changedBody: (line: string, stop: string) => `Steige an der Haltestelle ${stop} in ${line} um.`,
    noAlternative: 'Keine erreichbare Alternative gefunden. Der aktuelle Umstieg könnte scheitern. Wir prüfen erneut.',
    unavailable: 'Umstieg kann nicht bewertet werden',
    unavailableBody: 'Wir warten auf eine genaue Position entlang der Route. Der aktuelle Plan bleibt sichtbar.',
    routingError: 'Die Umstiegsbegleitung konnte nicht vorbereitet werden. Versuche es erneut.',
    rerouting: 'Ein neuer Umstieg wird gesucht',
    next: (line: string, stop: string) => `${line} · ${stop}`,
    channel: 'Geänderte Umstiege',
    start: 'Mit Umstiegsbegleitung fahren',
    startBody: 'Wir warnen dich, wenn dein Umstieg gefährdet ist. Du entscheidest über eine andere Route.',
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
    todayLong: 'Heute',
    tomorrowLong: 'Morgen',
    todayLower: 'heute',
    tomorrowLower: 'morgen',
    durMin: (n: number) => `${n} Min.`,
    departIn: (n: number) => `in ${n} Min.`,
    departNow: 'gleich',
    departAgo: (n: number) => `vor ${n} Min.`,
    departJustAgo: 'gerade abgefahren',
    lessThan10m: '< 10 m',
    kmh: (v: string) => `${v} km/h`,
    add15: '+15 Min.',
    add30: '+30 Min.',
    add60: '+1 Std.',
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
    editCardSub: 'gespeicherte Orte',
    historyTitle: 'Letzte Orte',
    historyEmptyTitle: 'Keine letzten Orte',
    historyEmptyBody: 'Suche eine Verbindung, sie erscheint hier als Schnellziel.',
    historyEmptyAction: 'Verbindung suchen',
    openConnA11y: (title: string, label: string) => `Verbindung nach ${title} öffnen, ${label}`,
    gpsTitle: 'Mein Standort (GPS)',
    locationFallback: 'Dein Standort',
    gpsAddressHome: 'Aktuelle Geräteposition',
    importingTitle: (gen: string) => `Fahrplan für ${gen} wird geladen…`,
    importErrorTitle: 'Fehler beim Laden des Fahrplans',
    importErrorRetry: 'Tippen zum Wiederholen.',
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
    unsupportedHint: 'Wähle den Start manuell, um Verbindungen zu suchen.',
    unsupportedAction: 'Startpunkt wählen',
    pickStart: 'Startpunkt wählen',
    gpsBlockedTitle: 'GPS-Start nicht verfügbar',
    gpsBlockedBody: (city: string, supported: string) =>
      `Du bist außerhalb von ${supported} (${city}), GPS-Routen funktionieren daher nicht. Wähle den Start manuell.`,
    gpsBlockedBodyUnknown: (supported: string) =>
      `Du bist außerhalb von ${supported}, GPS-Routen funktionieren daher nicht. Wähle den Start manuell.`,
  },
  city: {
    section: 'Stadt',
    settingsTitle: 'Stadt',
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
    supportedList: 'Wrocław, Kraków, GZM, Warszawa, Poznań, Trójmiasto, Łódź, Szczecin, Kielce, Olsztyn, Białystok, Opole, Rzeszów, Lublin, Radom',
    changed: (name: string) => `Umgeschaltet auf: ${name}.`,
    switching: 'Stadt wird umgestellt…',
    blockedByDownload: 'Fahrplan wird geladen. Stadtwechsel danach möglich.',
    needDownload:
      'Für diese Stadt liegt noch kein Fahrplan auf dem Telefon. Lade ihn unter „Fahrplan und Karten“.',
    changeAction: 'Ändern',
    selectTitle: 'Stadt wählen',
    selectSub: 'Wählen Sie das Verkehrsgebiet für Ihre Routen.',
    searchPlaceholder: 'Stadt oder Betreiber',
    noSearchResults: (q: string) => `Keine Städte für „${q}“ gefunden`,
    searchEmptyHint:
      'Überprüfen Sie die Schreibweise oder suchen Sie nach einem anderen Verkehrsgebiet.',
    searchClearA11y: 'Suche löschen',
    closeSheetA11y: 'Stadtauswahl schließen',
    cityActiveBadge: 'Aktiv',
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
    planningSummary: (style: string, pace: string) => `${style} · ${pace}`,
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
    sectionSupport: 'Unterstützung',
    supportTitle: 'Projekt unterstützen',
    supportHint: 'Kilometr ist kostenlos. Ein Kaffee auf Ko-fi hilft bei der Weiterentwicklung.',
    supportButton: 'Ko-fi öffnen',
    supportA11y: 'Ko-fi-Seite im Browser öffnen',
    sectionOffline: 'Offline',
    sectionApp: 'App',
    sectionRoute: 'Route',
    sectionTransport: 'Verkehrsmittel',
    sectionData: 'Deine Daten',
    advancedShow: 'Erweitert',
    advancedHide: 'Erweitert ausblenden',
    notificationsSection: 'Benachrichtigungen',
    notificationsFoot:
      'Benachrichtigungen funktionieren im Dev-Build. Expo Go unterstützt sie nicht.',
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
    offlineMapDeleteBody: (mb: number) =>
      `Das gibt etwa ${mb} MB frei. Die Karte funktioniert weiterhin online. Erneut laden geht erst nach einem Monat.`,
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
      'Prüft die Fahrplandatenbank auf dem Telefon. Kopiere das Ergebnis, wenn du ein Problem meldest.',
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
    diagSearchOk: (weighted: number, pois: number) =>
      `Ranking bereit (${weighted} Haltestellen) • POIs: ${pois}`,
    diagSearchWeights: 'Vorschlagsranking nicht berechnet',
    diagSearchPois: 'Keine POI-Punkte. Adressen brauchen Internet.',
    diagCopy: 'Bericht kopieren',
    diagCopyA11y: 'Diagnosebericht in die Zwischenablage kopieren',
    diagCopied: 'Bericht in die Zwischenablage kopiert',
    diagCopyFail: 'Bericht konnte nicht kopiert werden',
    diagFix: 'Fahrplan erneut laden',
    diagFixA11y: 'Fahrplan-Download erzwingen',
    diagReportCity: 'Stadt',
    diagReportTimetable: 'Fahrplan',
    diagReportImported: 'Geladen',
    diagReportDb: 'Datenbank',
    diagReportUnknown: 'unbekannt',
    routeStyleTitle: 'Routenstil',
    routeStyleHint:
      'Bestimmt, was gewinnt, wenn sich Verbindungen um wenige Minuten unterscheiden: frühere Ankunft, kürzerer Fußweg oder weniger Umstiege. Die Grenzen unten gelten für jeden Stil.',
    styleFastest: 'Am schnellsten',
    styleFastestDesc: 'Früheste Ankunft',
    styleBalanced: 'Ausgewogen',
    styleBalancedDesc: 'Eine Minute für weniger Gehen',
    styleLessWalking: 'Weniger Gehen',
    styleLessWalkingDesc: 'Kurze Wege und Umstiege',
    styleFewerTransfers: 'Weniger Umstiege',
    styleFewerTransfersDesc: 'Direkt, auch wenn länger',
    transfersTitle: 'Max. Umstiege',
    transfersHint:
      'Höchstzahl der Umstiege pro Verbindung. Den Aufschlag pro Umstieg legt der Routenstil fest, deshalb schlagen 300 m Fußweg zu einer Direktverbindung meist das Umsteigen ab der nächsten Haltestelle.',
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
    transferTimeHint:
      'Wie viel Zeit wir zwischen Ausstieg und nächster Abfahrt einplanen. Höhere Werte schließen riskante Minuten-Umstiege aus.',
    transferTimeHintShort: 'Puffer zwischen Ausstieg und nächster Abfahrt.',
    trainTitle: 'Regionalzüge',
    trainHint:
      'Umstiege zu Regionalzügen. Nur im Modus „Alle“, der Tram/Bus-Schnellfilter rührt sie nicht an.',
    trainHintShort: 'Umstiege zu Regionalzügen. Nur im Modus „Alle”.',
    trainBufferTitle: 'Bahn-Puffer',
    trainBufferHint:
      'Mindestzeit für den Weg zum Bahnsteig nach dem Umstieg. Bahnhöfe sind keine Haltestellen, der Weg geht meist durch die Halle.',
    trainBufferHintShort: 'Zeit für den Weg zum Bahnsteig nach dem Umstieg.',
    trainNoData:
      'Der geladene Fahrplan enthält keine Züge. Prüfe oben auf Updates, um Zugumstiege zu aktivieren.',
    cableTitle: 'Polinka',
    cableHint:
      'Die Seilbahn der Technischen Universität Breslau über die Oder, zwischen Wyspiański-Ufer und der Na-Grobli-Straße. Fährt werktags 7:00–21:00 mit einer Pause von 13:30–14:00, alle 5 Minuten. Am Wochenende geschlossen. Nur im Modus „Fahrzeuge”.',
    cableHintShort: 'Seilbahn über die Oder. Nur im Modus „Alle”.',
    walkTitle: 'Max. Fußweg',
    walkHint:
      'Wie weit du zur Starthaltestelle und vom Ziel weg laufen kannst. Eine weitere Haltestelle mit direkter Tram schlägt oft die nächste Stange.',
    walkHintShort: 'Weg zur Starthaltestelle und vom Ziel weg.',
    speedTitle: 'Gehtempo',
    speedHint: 'Deine Wahl beeinflusst Fußwege, Umstiege und die geschätzte Ankunft.',
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
    intro: 'Wähle deine Stadt und lade den Fahrplan herunter. Verbindungen findest du auch offline.',
    openSettings: 'Einstellungen öffnen',
    permissionDenied: 'Du kannst ohne diese Berechtigung fortfahren und sie später in den Telefoneinstellungen ändern.',
    steps: ['Willkommen', 'Berechtigungen', 'Stadt', 'Fahrplan', 'Orte'],
    granted: 'An',
    denied: 'Aus',
    toEnable: 'Zu aktivieren',
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
    notifBody: 'Zeigen deine angeheftete Fahrt und erinnern an eine gewählte Abfahrt oder Haltestelle.',
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
    linesLabel: (lines: string) => `Linien ${lines}`,
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
    walkPrefix: 'Zu Fuß ',
    walkStageA11y: (dist: string) => `Fußetappe ${dist}`,
    lineStageA11y: (line: string, dir: string) => `Linie ${line} Richtung ${dir}`,
    lineLabel: (line: string) => `Linie ${line}`,
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
      detailA11y: (what: string, dist: string) => `${what}, ${dist}`,
    },
  },
  routes: {
    gpsAddress: 'Aktuelle Position verwenden',
    destFallback: 'Ziel',
    trackUnsupportedTitle: 'Verfolgung nicht verfügbar',
    trackUnsupportedBody:
      'Mitteilungen brauchen einen Entwicklungs-Build. Expo Go unterstützt sie nicht.',
    noConnectionsTitle: 'Keine Verbindungen',
    noConnectionsBody: 'Warte, bis eine Abfahrt auf dieser Route erscheint.',
    stopTrackingTripA11y: 'Reiseverfolgung beenden',
    trackTrip: 'Fahrt verfolgen',
    stopTrackTrip: 'Stopp',
    trackTripA11y: 'Diese Fahrt verfolgen',
    pinUnsupportedTitle: 'Anheften nicht verfügbar',
    pinUnsupportedBody:
      'Angeheftete Mitteilungen brauchen einen Entwicklungs-Build. Expo Go unterstützt keine Mitteilungen.',
    notifOffTitle: 'Mitteilungen aus',
    notifOffBody: 'Erlaube Mitteilungen in den Systemeinstellungen, um eine Verbindung anzuheften.',
    gpsFailTitle: 'Standortfehler',
    gpsFailBody:
      'Aktuelle GPS-Position konnte nicht ermittelt werden. Stelle sicher, dass der Standort am Telefon aktiviert ist.',
    now: 'Jetzt',
    title: (operator: string) => `${operator}-Verbindungen`,
    sortFastestA11y: 'Sortierung: Ankunft. Tippen, um auf Abfahrt zu wechseln.',
    sortEarliestA11y: 'Sortierung: Abfahrt. Tippen, um auf Ankunft zu wechseln.',
    sortFastest: 'Ankunft',
    sortEarliest: 'Abfahrt',
    unpinA11y: 'Verbindung lösen',
    pinA11y: 'Nächste Verbindung anheften',
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
    countNearest: 'nächste Abfahrten',
    countDepart: (label: string) => `Abfahrt ${label}`,
    countDirect: ' • nur direkt',
    countTram: ' • Trams',
    countBus: ' • Busse',
    countEarlier: ' • lade frühere…',
    offlineTapA11y: 'Neueste Cache-Daten. Tippen zum Aktualisieren.',
    offlineChip: 'offline',
    noLiveChip: 'keine Live-Daten',
    moreFail: 'Weitere Verbindungen konnten nicht geladen werden.',
    moreRetryA11y: 'Versuchen, weitere Verbindungen zu laden',
    noMore: 'Das sind alle Abfahrten dieser Route.',
    noMoreArrival: 'Keine früheren Verbindungen in diesem Zeitfenster. Wähle eine frühere Ankunftszeit.',
    emptyArrival: 'Keine Verbindungen vor der gewählten Uhrzeit. Wähle eine spätere Ankunftszeit oder ein anderes Ziel.',
    emptyFiltered: 'Keine Verbindungen für die gewählten Filter',
    emptyNone: 'Keine Verbindungen gefunden',
    emptyModeDirect: (veh: string) =>
      `Auf dieser Route gibt es gerade keinen ${veh}-Kurs ohne Umstieg. Filter lockern oder eine andere Zeit prüfen.`,
    emptyDirect:
      'Auf dieser Route gibt es gerade keine Direktverbindung. Deaktiviere den Filter „Nur direkt“, um Verbindungen mit Umstieg zu sehen, oder prüfe eine andere Zeit.',
    emptyMode: (veh: string) =>
      `Auf dieser Route gibt es gerade keinen ${veh}-Kurs. Wechsle auf „Alle“, um den Rest zu sehen.`,
    emptyPlain: 'Versuch ein anderes Ziel oder prüfe eine andere Abfahrtszeit.',
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
  },
  routeDetails: {
    departure: 'Abfahrt',
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
    scheduleCache: 'Fahrplan aus Cache',
    schedule: 'Fahrplan',
    noTrip: 'Kein Routenverlauf',
    noTripBody:
      'Diese Verbindung hat keine gespeicherten Haltestellen, daher kann die Route nicht gezeichnet und die nächste Haltestelle nicht gezeigt werden. Geh zurück und wähle eine andere Verbindung.',
    lineAlertsTitle: 'Meldungen zu deinen Linien',
    lineAlertsAll: 'Alle Neuigkeiten',
    lineAlertsEmpty: 'Keine Meldungen zu den Linien dieser Verbindung.',
    lineAlertsCount: (n: number) => (n === 1 ? '1 Meldung' : `${n} Meldungen`),
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
    recentTrips: 'Letzte Fahrten',
    savedA11y: (t: string) => `Gespeicherter Ort: ${t}`,
    searching: (city: string) => `${city} wird durchsucht…`,
    noResults: 'Keine Ergebnisse',
    noResultsHint: (id: string) =>
      `Versuch: ${id === 'krakow' ? '„rynek“, „grodzka“, „wawel“, „balice“' : id === 'gzm' ? '„katowice“, „gliwice“, „rynek“, „tychy“' : id === 'warszawa' ? '„metro“, „młociny“, „centralny“, „śródmieście“' : id === 'poznan' ? '„rynek“, „garbary“, „rondo“, „malta“' : id === 'trojmiasto' ? '„oliwa“, „wrzeszcz“, „orłowo“, „przymorze“' : id === 'lodz' ? '„piotrkowska“, „manufaktura“, „fabryczna“, „kaliska“' : id === 'szczecin' ? '„brama portowa“, „dąbie“, „police“, „pogodno“' : id === 'kielce' ? '„sienkiewicza“, „rynek“, „kadzielnia“, „herby“' : id === 'olsztyn' ? '„stare miasto“, „dworzec“, „jaroty“, „barczewo“' : id === 'bialystok' ? '„rynek kościuszki“, „lipowa“, „branicki“, „opera“' : id === 'opole' ? '„rynek“, „ozimska“, „solaris“, „dworzec“' : id === 'rzeszow' ? '„rynek“, „dworzec“, „rejtana“, „3 maja“' : id === 'lublin' ? '„krakowskie“, „zamek“, „felicity“, „świdnik“' : id === 'radom' ? '„żeromskiego“, „południe“, „gołębiów“, „idalin“' : '„arkady“, „biskupin“, „zoo“, „swojczycka“'}. Geht auch ohne polnische Zeichen und mit Tippfehlern.`,
    noResultsFor: (q: string) => `Nichts passt zu „${q}“`,
    yourPlaces: 'Deine Orte',
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
    moreIconsShort: '+ Mehr...',
    addressLabel: 'Zieladresse oder -haltestelle',
    changeBtn: 'Ändern',
    queryHint: 'Straße, Haltestelle oder Ort eingeben…',
    anchorOptional: 'Bevorzugte Haltestelle (optional)',
    anchorHint: 'Abfahrten ab dieser Haltestelle in der Nähe',
    assignAnchor: '+ Abfahrtshaltestelle zuweisen',
    saveChanges: 'Änderungen speichern',
    savePlace: 'Ort speichern',
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
    confirmNow: 'Ab jetzt suchen',
    confirmDepart: (day: string, hh: string, mm: string) => `Übernehmen: ${day}, ${hh}:${mm}`,
  },
  routesBar: {
    modeTram: 'Tram',
    modeBus: 'Bus',
    modeAll: 'Fahrzeuge',
    modeTramA11y: 'Trams',
    modeBusA11y: 'Busse',
    modeAllA11y: 'Alle Fahrzeuge',
    reverse: 'Umkehr',
    reverseA11y: 'Route umkehren: Start und Ziel tauschen',
    direct: 'Direkt',
    directOnA11y: 'Nur-Direkt-Filter: aktiv. Tippen, um alle zu zeigen.',
    directOffA11y: 'Nur-Direkt-Filter: inaktiv. Tippen zum Einschalten.',
    modeFilterA11y: (cur: string) => `Verkehrsmittel filtern: aktuell ${cur}. Tippen zum Ändern.`,
    timeA11y: (label: string) => `Abfahrtszeit: ${label}. Tippen zum Ändern.`,
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
    cardA11y: (
      dep: string,
      dur: number,
      depAt: string,
      arrAt: string,
      via: string,
      lines: string,
    ) =>
      `${dep}, Fahrzeit ${dur} Min., Abfahrt ${depAt}, Ankunft ${arrAt}, ${via}${lines ? `, Linien ${lines}` : ''}`,
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
    fareBoundaryDetail: (areas: string, point: string) => point ? `${areas} · ${point}` : areas,
    noData: 'Keine Routendaten',
    expandA11y: (line: string, dir: string, expanded: boolean) =>
      `${line} Richtung ${dir}. Haltestellenliste ${expanded ? 'ein' : 'aus'}klappen.`,
    vehicleBetween: (mode: string, from: string, to: string) =>
      `${mode} zwischen ${from} und ${to}`,
    vehicleFarBack: 'Fahrzeug ist weiter hinten auf der Strecke',
    vehicleNotStarted: 'Die Fahrt hat noch nicht begonnen',
    fromPrefix: 'ab ',
    toPrefix: 'bis ',
    stopsSummary: (n: number, mins: number, open: boolean) =>
      `${n} ${n === 1 ? 'Haltestelle' : 'Haltestellen'} • ~${mins} Min. • ${open ? 'ein' : 'aus'}klappen`,
  },
  compass: {
    journeyTitle: 'Navigation unterwegs',
    riding: 'Fahrt bis zur Ausstiegshaltestelle',
    transferWalk: 'Fußweg zum Umstieg',
    headToDestination: 'Gehe zum Ziel',
    navToDestination: (dist: string) => `${dist} bis zum Ziel`,
    nextStopAt: (name: string) => `Nächste Haltestelle: ${name}`,
    rideTo: (name: string) => `Fahre bis: ${name}`,
    waitForDeparture: (time: string) => `Warte auf die Abfahrt um ${time}`,
    journeyArrived: 'Du bist am Ziel',
    vehicleGps: 'GPS-Position des Fahrzeugs',
    vehicleGpsMissing: 'Keine aktuelle GPS-Position des Fahrzeugs. Die Route bleibt sichtbar.',
    alightAt: (name: string) => `Aussteigen: ${name}`,
    boardAt: (name: string) => `Einsteigen: ${name}`,
    stopsRemaining: (n: number) => `${n} ${n === 1 ? 'Haltestelle' : 'Haltestellen'} bis zum Ausstieg`,
    mapLoading: 'Karte wird geladen…',
    mapFailed: 'Die Karte konnte nicht geladen werden. Prüfe deine Internetverbindung.',
    mapRetry: 'Karte erneut laden',
    openMap: 'Vollständige Routenkarte öffnen',
    ahead: 'Geradeaus',
    slightRight: 'Leicht rechts',
    right: 'Rechts von dir',
    backRight: 'Hinter dir rechts',
    back: 'Hinter dir',
    backLeft: 'Hinter dir links',
    left: 'Links von dir',
    slightLeft: 'Leicht links',
    noCoords: 'Diese Haltestelle hat keine Koordinaten im Fahrplan.',
    locOff: 'Standort ist aus. Ohne ihn kann ich die Richtung zur Haltestelle nicht zeigen.',
    locWaiting: 'Noch keine Position. Warte auf GPS oder öffne die volle Karte.',
    title: 'Navigation zur Haltestelle',
    followCompass: 'Fußweg Schritt für Schritt',
    directionPrefix: (d: string) => `Richtung ${d}`,
    straight: 'Luftlinie',
    distanceText: (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`),
    walkMins: (m: number) => `~${m} Min. zu Fuß`,
    headToStop: 'Richtung Haltestelle gehen',
    nextStop: 'Nächste Haltestelle',
    navToStop: (dist: string) => `${dist} bis zur Haltestelle`,
    navA11y: (what: string, dist: string) =>
      `${what}, ${dist}. Tippen, um die volle Karte zu öffnen.`,
    rerouting: 'Neue Route wird gesucht',
    openSettingsA11y: 'App-Einstellungen öffnen',
    enableLoc: 'Standort in den Einstellungen aktivieren',
  },
  lastTrip: {
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
    stepDb: 'Datenbank laden…',
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
    startupHint: 'Kilometr kann nicht fortfahren. Teile den Bericht, um bei der Fehlersuche zu helfen.',
    startupShare: 'Teilen',
    locationPermission: 'Erlaube den Standortzugriff, um Verbindungen ab deinem Standort zu finden.',
    liveTitle: 'Live-Aktivität',
    liveHint: 'Fahrzeit auf dem Sperrbildschirm und in der Dynamic Island. Daten werden aktualisiert, solange die App aktiv ist.',
    liveDisabled: 'Aktiviere Live-Aktivitäten in den Systemeinstellungen für Kilometr.',
    stale: 'Laut Fahrplan. Öffne Kilometr zum Aktualisieren.',
    alarmHint: 'Eine Erinnerung mit Benachrichtigungston. Stummmodus und Fokus können sie stummschalten. Es öffnet sich kein Vollbildwecker.',
  },
  alarm: {
    title: 'Fahrtwecker',
    set: 'Wecker stellen',
    edit: 'Wecker ändern',
    hint: 'Ton, Vibration und Vollbild vor dem Losgehen.',
    question: 'Wie viel Zeit brauchst du vor dem Losgehen?',
    before: 'vor dem Losgehen',
    minutes: (n: number) => n === 1 ? 'Minute' : 'Minuten',
    lead: (n: number) => `${n} ${n === 1 ? 'Minute' : 'Minuten'} vor dem Losgehen`,
    less: 'Eine Minute später',
    more: 'Eine Minute früher',
    ringsAt: (time: string) => `Klingelt um ${time}`,
    journeyAt: (time: string) => `Losgehen um ${time}`,
    boarding: (line: string, time: string, stop: string) => `${line} • ${time} • ${stop}`,
    save: 'Wecker einschalten',
    saving: 'Wecker wird gestellt…',
    remove: 'Wecker entfernen',
    preview: 'Wecker ansehen',
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
    fullScreenHint: 'Erlaube Vollbildwecker, damit der Wecker auf dem gesperrten Telefon erscheint.',
    fullScreenAction: 'Vollbild erlauben',
    notificationHint: 'Aktiviere Weckerbenachrichtigungen, damit dein Telefon den Wecker anzeigen kann.',
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
    nowText: 'Abfahrt jetzt',
    inMin: (m: number) => `in ${m} Min.`,
    tram: 'Tram',
    bus: 'Bus',
    titleLine: (mode: string, line: string, time: string) => `${mode} ${line} • ${time}`,
    titlePlain: (time: string) => `Verbindung • ${time}`,
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
