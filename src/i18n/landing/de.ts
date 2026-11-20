import type { Strings } from './pl';

function countLabel(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export const de: Strings = {
  meta: {
    title: 'Kilometr',
    imageAlt:
      'Kilometr. Dein quelloffener Reiseplaner. Die App auf einem iPhone, Stadtwappen und ein Liniennetz.',
    description:
      'Nahverkehr in Städten in ganz Polen. Verbindungen planen, Abfahrten prüfen und Fahrpläne offline nutzen. Kostenlos für Android.',
  },
  skip: 'Zum Inhalt',
  nav: {
    label: 'Hauptnavigation',
  },
  language: 'Sprache der Website',
  sendSms: 'SMS senden',
  hero: {
    eyebrow: 'Kilometr für Android',
    title: 'Dein',
    accent: 'quelloffener',
    titleEnd: 'Reiseplaner',
    body: 'Plane deine Route, prüfe Abfahrten und fahr los. Nahverkehr in ganz Polen, auch offline. Ohne Werbung und ohne Konto.',
    phoneAlt: 'Kilometr-Startseite mit gespeicherten Orten und nächsten Abfahrten',
  },
  install: {
    android: 'Android',
    ios: 'iOS',
    platform: 'Betriebssystem des Telefons wählen',
    newTab: '(öffnet einen neuen Tab)',
  },
  android: {
    title: 'An der Play-Store-Beta teilnehmen',
    intro:
      'Kilometr befindet sich in der Testphase. Um die Android-App herunterzuladen, tritt zuerst der Testgruppe bei und melde dich dann bei Google Play für die Beta an.',
    noteTitle: 'Ein Google-Konto für beide Schritte',
    noteBody:
      'Tritt der Gruppe und der Beta mit demselben Google-Konto bei. Verwende es auch im Play Store auf deinem Telefon.',
    group: {
      title: 'Der Testgruppe beitreten',
      body: 'Öffne die Kilometr-Gruppe in Google Groups. Melde dich an und wähle „Gruppe beitreten“. Das Öffnen der Seite allein reicht nicht aus.',
      action: 'Der Google-Gruppe beitreten',
    },
    testing: {
      title: 'Für die Beta anmelden und App herunterladen',
      body: 'Öffne nach dem Gruppenbeitritt die Testseite. Bestätige deine Teilnahme und folge dann dem Link zu Google Play, um Kilometr zu installieren.',
      action: 'An der Google-Play-Beta teilnehmen',
    },
    helpTitle: 'Kein Zugriff auf den Test?',
    helpBody:
      'Prüfe, ob die Gruppe, die Testseite und der Play Store dasselbe Google-Konto verwenden. Wenn du der Gruppe gerade beigetreten bist, warte kurz und lade die Testseite neu. Dies ist eine Testversion, in der Fehler auftreten können.',
    alternative: {
      title: 'Du boykottierst Google? Lade direkt von der Quelle herunter',
      body: 'Obtainium lädt Kilometr und Updates direkt von unserem GitHub herunter. Der Button öffnet die Konfiguration in Obtainium oder hilft dir bei der Installation.',
      obtainium: 'Zu Obtainium hinzufügen',
      fdroid: 'F-Droid',
      soon: 'Demnächst',
      json: 'Obtainium-Konfiguration herunterladen (JSON)',
    },
  },
  ios: {
    title: 'Auf iOS installieren',
    intro:
      'Du kannst Kilometr auf iOS aus einer IPA-Datei außerhalb des App Store installieren. Das heißt Sideloading. Die folgende Anleitung verwendet Sideloadly.',
    noteTitle: 'Telefon und Computer vorbereiten',
    noteBody:
      'Du brauchst ein iPhone mit iOS 16.4 oder neuer, einen Mac oder Windows-PC, ein USB-Kabel und ein Apple-Konto. Ein kostenloses Konto genügt.',
    download: {
      title: 'App-Datei herunterladen',
      body: 'Speichere kilometr-unsigned.ipa aus der neuesten Veröffentlichung auf deinem Computer. Die Datei ist nicht signiert. Du signierst sie bei der Installation mit deinem Apple-Konto.',
      action: 'IPA herunterladen',
    },
    tool: {
      title: 'Sideloadly auf dem Computer installieren',
      body: 'Lade die Version für dein System von der offiziellen Website herunter. Installiere unter Windows auch die dort verlinkten Apple-Versionen von iTunes und iCloud.',
      action: 'Sideloadly herunterladen',
    },
    sign: {
      title: 'iPhone verbinden und Kilometr installieren',
      body: 'Entsperre dein Telefon, verbinde es per Kabel und vertraue dem Computer. Wähle dein iPhone in Sideloadly, ziehe die IPA-Datei ins Fenster und gib dein Apple-Konto an. Behalte die Erweiterung KilometrLiveActivity für Live-Aktivitäten und Dynamic Island. Klicke auf Start und folge den Anweisungen.',
    },
    open: {
      title: 'Der App auf dem Telefon vertrauen',
      body: 'Falls iOS dich dazu auffordert, öffne Einstellungen → Allgemein → VPN und Geräteverwaltung und vertraue dem Profil deines Apple-Kontos. Aktiviere bei Bedarf den Entwicklermodus unter Einstellungen → Datenschutz & Sicherheit. Öffne dann Kilometr und lade den Fahrplan deiner Stadt herunter.',
    },
    helpTitle: 'Signatur rechtzeitig erneuern',
    helpBody:
      'Mit einem kostenlosen Apple-Konto läuft die Signatur nach 7 Tagen ab. Erneuere sie über Sideloadly, bevor sich die App nicht mehr öffnen lässt. Das Tool unterstützt die automatische Erneuerung, wenn sich Computer und Telefon verbinden können. Verwende bei Updates dasselbe Apple-Konto und dieselbe App-ID, um deine Daten zu behalten.',
    appStore: {
      title: 'Warum gibt es Kilometr nicht im App Store?',
      body: 'Apple verlangt 99 USD pro Jahr für ein Entwicklerkonto, auch für eine kostenlose App. Diese Regeln sind ein Skandal für kleine Open-Source-Projekte: Sie bevorzugen Konzerne gegenüber unabhängigen Entwicklern. Dafür haben wir kein Budget. Deshalb bieten wir vorerst eine IPA-Datei zur eigenen Installation an.',
      supportBody:
        'Möchtest du uns helfen, diese Gebühr zu decken? Du kannst das Projekt unterstützen. Jede Spende hilft uns, Kilometr weiterzuentwickeln und die Veröffentlichung zu finanzieren.',
    },
  },
  showcase: {
    prevLabel: 'Vorheriger Bildschirm',
    nextLabel: 'Nächster Bildschirm',
    tabsLabel: 'Kilometr App-Ansichten',
    stepCounter: (current: number, total: number) => `${current} / ${total}`,
    slides: [
      {
        id: 'home',
        shortLabel: 'Startseite',
        title: 'Gespeicherte Halte und Suche direkt beim Start',
        body: 'Beim Öffnen siehst du sofort den Countdown deiner gespeicherten Haltestellen direkt über der Routensuche, auch über Stadtgrenzen hinweg. Keine Werbung oder Pop-ups vor der Abfahrtsprüfung.',
        imageAlt: 'Kilometr-Startseite mit gespeicherten Orten und nächsten Abfahrten',
      },
      {
        id: 'routes',
        shortLabel: 'Verbindungen',
        title: 'Stadtverkehr und Bahn in einer Liste',
        body: 'Eine Suche kombiniert Fußwege, Straßenbahnen, Busse und Züge auf einer gemeinsamen Zeitleiste mit Umstiegen. Wo Live-Daten vorliegen, siehst du Abweichungen vom Fahrplan.',
        imageAlt: 'Liste von Stadt- und Bahnverbindungen in Kilometr',
      },
      {
        id: 'trip',
        shortLabel: 'Fahrtinfos',
        title: 'Steighinweis, Gleisangabe und Datenalter',
        body: 'An großen Umsteigeknoten zeigt ein kurzer Hinweis, welche Insel oder welchen Steig du ansteuerst. Bei Zügen siehst du zusätzlich Gleis, Ausstattung und wie alt die Positionsmeldung in Sekunden ist.',
        imageAlt: 'Verbindungsdetails mit Bahnsteighinweis und Live-Zugverfolgung',
      },
      {
        id: 'share',
        shortLabel: 'Teilen',
        title: 'Verbindungskarte und Link für den Browser',
        body: 'Statt Umstiege auf Screenshots zu erklären, verschickst du eine übersichtliche Verbindungskarte mit Halten und Fußwegen oder einen Link, der direkt im Browser aufgeht.',
        imageAlt: 'Ansicht zum Teilen einer Verbindungskarte und eines Links',
      },
      {
        id: 'alerts',
        shortLabel: 'Meldungen',
        title: 'Klare Umleitungen statt Textwand',
        body: 'Meldungen trennen Bauzeit, betroffene Linien und entfallende Haltesteige direkt sichtbar. So erkennst du sofort, welche Linien ausfallen und welche am Ersatzhalt abfahren.',
        imageAlt: 'Details zu Verkehrsmeldungen und Umleitungen auf Linien',
      },
    ],
  },
  coverage: {
    eyebrow: 'Abdeckung in Polen',
    title: 'Prüfe deine Stadt und Verkehrsbetriebe',
    body: (count: number) =>
      `${count} Städte und Ballungsräume in einer App, einschließlich der Metropole GZM. Wähle einen Punkt auf der Karte oder suche nach deiner Stadt, um Live-Positionen, Meldungen und Betreiber zu prüfen.`,
    searchPlaceholder: 'Stadt suchen, z. B. Wrocław, Katowice, Gdańsk...',
    searchLabel: 'Unterstützte Stadt suchen',
    browseListLabel: 'Städteliste umschalten',
    clearSearch: 'Suche löschen',
    mapAria: 'Klickbare Karte Polens mit unterstützten Städten',
    mapHint: (count: number) => `${count} unterstützte Netze · Punkt auf der Karte wählen`,
    citiesListLabel: 'Liste unterstützter Städte',
    emptyTitle: 'Keine passende Stadt gefunden',
    emptyBody: 'Prüfe die Schreibweise oder setze den Filter zurück, um alle Städte zu sehen.',
    emptyReset: 'Alle Städte zeigen',
    liveLabel: 'Live-Positionen',
    liveValue: (vehicles: number | null) =>
      vehicles == null
        ? 'Verfügbar (Fahrzeug-GPS)'
        : vehicles === 0
          ? 'Verfügbar (derzeit keine Fahrzeuge)'
          : `Verfügbar (${countLabel(vehicles, 'Fahrzeug', 'Fahrzeuge')} live)`,
    liveUnavailable: 'Kein Live-GPS (statischer Fahrplan)',
    newsLabel: 'Fahrgastmeldungen',
    newsAvailable: 'Verfügbar',
    newsUnavailable: 'Keine städtischen Meldungen',
    stopHintsLabel: 'Haltestellenhinweise',
    stopHintsValue: (stops: number) =>
      `Verfügbar (${countLabel(stops, 'Haltestelle', 'Haltestellen')})`,
    stopHintsUnavailable: 'Keine Haltestellenhinweise',
    statsUpdated: (date: string) => `Datenstand: ${date}`,
    operatorsLabel: 'Verkehrsbetriebe',
    railGatewayNote: (stations: string) =>
      `Fernverkehr (PKP Intercity, POLREGIO) über den Bahnhof: ${stations}.`,
    modes: {
      bus: 'Busse',
      tram: 'Straßenbahnen',
      trolley: 'Oberleitungsbusse',
      metro: 'U-Bahn',
      rail: 'Bahn',
      cable: 'Seilbahn',
    },
  },
  promise: {
    ads: 'Keine Werbung.',
    free: 'Kostenlos.',
    forever: 'Für immer.',
  },
  closing: {
    title: 'Du verdienst mehr als jakdojade',
    body: 'Plane Fahrten und prüfe Abfahrten, auch offline. Lade Kilometr herunter und unterstütze die Entwicklung, wenn dir die App hilft.',
    support: 'Entwicklung fördern',
  },
  themeStudio: {
    title: 'Deine Farbe in der App',
    intro: 'Wähle Farben, schau dir die Vorschau an und schick den fertigen Code über Ko-fi.',
    thanksTitle: 'Danke!',
    thanksBody:
      'Deine Unterstützung hält Kilometr frei von Werbung und Tracking. Als Dankeschön stellst du dir dein eigenes App-Design zusammen.',
    thanksCta: 'Dein Design wählen',
    notYet: 'Noch nicht dabei?',
    notYetLink: 'Auf Ko-fi unterstützen',
    back: 'Zurück zum Dankeschön',
    customTitle: 'Eigene Farbe',
    hueLabel: 'Farbe',
    chromaLabel: 'Intensität',
    variantLabel: 'Stil',
    variants: {
      tonal: 'Ruhig',
      expressive: 'Deutlich',
      vibrant: 'Kräftig',
      rainbow: 'Bunt',
    },
    presetsLabel: 'Fertige Farben',
    presetNames: {
      teal: 'Smaragd',
      blue: 'Blau',
      green: 'Grün',
      violet: 'Violett',
      rose: 'Rosa',
      orange: 'Orange',
    },
    previewTitle: 'So wird es aussehen',
    modeLabel: 'Darstellung',
    lightMode: 'Hell',
    darkMode: 'Dunkel',
    previewAria: 'Kilometr-App-Vorschau in deinen Farben',
    mock: {
      departures: 'Nächste Abfahrten',
      search: 'Wohin fährst du?',
      pin: 'Reise anheften',
      detour: 'Umleitung über die Podwale-Straße',
      home: 'Zuhause',
      work: 'Arbeit',
      now: 'jetzt',
      minutes: (n: number) => `${n} Min.`,
      delay: (n: number) => `+${n} Min.`,
      cancelled: 'entfallen',
    },
    outputTitle: 'Schema senden',
    outputIntro: 'Kopiere den Code und füge ihn in eine Ko-fi-Nachricht ein.',
    copy: 'Code kopieren',
    copied: 'Kopiert',
    copyFailed: 'Code markieren und Strg+C drücken',
    codeLabel: 'Dein Schemacode',
    sendOn: 'Ko-fi öffnen',
    footerLink: 'Farbschema für Unterstützer',
  },
  footer: {
    tagline: 'Bis unterwegs.',
    privacy: 'Datenschutz',
    github: 'GitHub',
    license: 'Freie Software. GPL-3.0.',
    back: 'Zurück zur Startseite',
  },
  privacy: {
    title: 'Datenschutzerklärung für Kilometr',
    linkLabel: 'Datenschutzerklärung',
    linkError:
      'GitHub konnte nicht geöffnet werden. Prüfe deine Verbindung und versuche es erneut.',
    intro:
      'Gilt für die Android-App Kilometr (app.kilometr) und die Projektwebsite. Aktualisiert: 20. Oktober 2026. Kilometr ist ein Open-Source-Projekt von sioodmy auf GitHub. Die App benötigt kein Konto und enthält weder Werbung noch Analysewerkzeuge.',
    localTitle: 'Daten auf deinem Gerät',
    localBody:
      'Gespeicherte Orte mit Namen und Koordinaten, Suchverlauf, Einstellungen, Sicherungen und heruntergeladene Fahrpläne liegen im App-Speicher auf deinem Telefon. Verbindungen mit heruntergeladenen Fahrplänen werden auf dem Gerät berechnet. Kilometr synchronisiert diese Daten nicht mit einem Serverkonto.',
    locationTitle: 'Standort und Benachrichtigungen',
    locationBody:
      'Der Standortzugriff ist optional. Er dient der Suche nach nahen Haltestellen, dem Startpunkt und der Überwachung einer aktiven Fahrt. Eine von dir gestartete Fahrt kann GPS bei ausgeschaltetem Bildschirm mit sichtbarer Dienstbenachrichtigung weiter nutzen. Die App fordert keinen dauerhaften Standortzugriff im Hintergrund an. Mitteilungen zeigen angeheftete Fahrten, Abfahrtsalarme und Ausstiegserinnerungen. Du kannst die Fahrt beenden oder Berechtigungen in den Android-Einstellungen widerrufen. Ohne Erlaubnis wählst du den Startpunkt manuell.',
    networkTitle: 'Anfragen an externe Dienste',
    networkBody:
      'Fahrpläne kommen von der Kilometr-Infrastruktur, Meldungen und Fahrzeugpositionen von Verkehrsunternehmen und Datenanbietern. OpenStreetMap Nominatim erhält den Suchtext einer Adresse und das Stadtgebiet sowie Koordinaten zur Umwandlung einer GPS-Position in eine Adresse. OpenFreeMap erhält Kartenkachelanfragen für das betrachtete Gebiet. Der öffentliche OSRM-Server erhält Koordinaten von Routenpunkten, wenn die App die Routengeometrie lädt. Anbieter erhalten auch deine IP-Adresse und Anfrageparameter und können nach ihren eigenen Regeln Protokolle speichern. Diese Verbindungen dienen den von dir genutzten Funktionen.',
    exportTitle: 'Datenexport',
    exportBody:
      'Eine exportierte Sicherung enthält gespeicherte Orte, Verlauf und Einstellungen. Eine geteilte Fahrt kann Namen und Koordinaten von Start und Ziel, Haltestellen und Reisezeiten enthalten. Der Link speichert diese Angaben hinter dem Zeichen #, das die Website im Browser ausliest. Empfänger einer Datei, eines Bildes oder Links können den Inhalt lesen und weitergeben. Du startest die Freigabe selbst.',
    retentionTitle: 'Speicherung und Löschung',
    retentionBody:
      'Lokale Daten bleiben auf deinem Gerät, bis du sie löschst oder die App zwischengespeicherte Daten ersetzt. Orte und Verlauf kannst du in der App löschen. Alle lokalen Daten entfernst du über Android-Einstellungen → Apps → Kilometr → Speicher → Daten löschen. Exportierte Dateien und Kopien bei Empfängern müssen separat gelöscht werden. Externe Betreiber bestimmen ihre eigenen Aufbewahrungsfristen für Protokolle.',
    securityTitle: 'Datenübertragung',
    securityBody:
      'Die öffentlichen Standarddienste für Fahrpläne, Karten, Adressen und Routengeometrie verwenden HTTPS. Lokale Daten liegen im privaten, von Android geschützten App-Speicher. Exportierte Dateien und Fahrtlinks haben keinen Passwortschutz. Teile sie nicht, wenn sie eine Adresse enthalten, die du privat halten möchtest.',
    webTitle: 'Diese Website',
    webBody:
      'Die Website speichert nur die Sprache im Browserspeicher. Sie lädt keine Analyse- oder Werbetools. Für das Hosting durch GitHub Pages und verlinkte externe Seiten gelten die Regeln der jeweiligen Betreiber.',
    contactTitle: 'Datenschutzkontakt',
    contactBody:
      'Kilometr wird von sioodmy (github.com/sioodmy) betreut. Datenschutzfragen und Anfragen zu Daten kannst du über Issues unter github.com/sioodmy/kilometr stellen. Issues sind öffentlich; veröffentliche dort keine Wohnadresse oder andere sensible Daten. Änderungen der Datenverarbeitung werden in dieser Erklärung mit aktualisiertem Datum beschrieben.',
    contact: 'Issue erstellen',
  },
};
