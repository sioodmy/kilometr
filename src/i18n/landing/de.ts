import type { Strings } from './pl';
import { cityNames } from './cities';
import { previewRoute } from './journey';
import { previewHome } from './home';

export const de: Strings = {
  meta: {
    title: 'Kilometr',
    description:
      'Nahverkehr in Städten in ganz Polen. Verbindungen planen, Abfahrten prüfen und Fahrpläne offline nutzen. Kostenlos für Android.',
  },
  skip: 'Zum Inhalt',
  nav: {
    features: 'Funktionen',
    coverage: 'Städte',
    download: 'Herunterladen',
    menu: 'Menü',
    close: 'Menü schließen',
    label: 'Hauptnavigation',
  },
  language: 'Sprache der Website',
  hero: {
    eyebrow: 'Kilometr für Android',
    title: 'Dein',
    accent: 'quelloffener',
    titleEnd: 'Reiseplaner',
    body: 'Plane deine Route, prüfe Abfahrten und fahr los. Nahverkehr in ganz Polen, auch offline. Ohne Werbung und ohne Konto.',
    play: 'Bei Google Play herunterladen',
    secondary: 'So funktioniert’s',
  },
  homePreview: {
    places: previewHome,
    title: 'Wohin geht’s?',
    savedTitle: 'Gespeicherte Orte',
    edit: 'Bearbeiten',
    historyTitle: 'Letzte Orte',
    home: 'Zuhause',
    school: 'Uni',
    gym: 'Fitnessstudio',
    stop: 'Haltestelle',
    searchLabel: 'Wohin fährst du?',
    startFrom: (title: string) => `ab: ${title}`,
    departIn: (n: number) => `in ${n} Min.`,
  },
  journeyDemo: {
    choose: 'Du wählst',
    ride: '...und fährst los',
    mock: 'Beispielfahrt. Die Zeiten folgen deiner Geräteuhr.',
    route: previewRoute,
    departIn: (n) => `in ${n} Min.`,
    duration: (n) => `${n} Min.`,
    transfers: (n) => (n === 0 ? 'direkt' : n === 1 ? '1 Umstieg' : `${n} Umstiege`),
    fromPrefix: 'ab ',
    toPrefix: 'bis ',
    stopsSummary: (n, mins, open) =>
      `${n} ${n === 1 ? 'Haltestelle' : 'Haltestellen'} • ~${mins} Min. • ${open ? 'ein' : 'aus'}klappen`,
    expandA11y: (line, dir, expanded) =>
      `${line} Richtung ${dir}. Haltestellenliste ${expanded ? 'ein' : 'aus'}klappen.`,
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
  features: {
    label: 'App-Funktionen',
    plan: 'Planen',
    saved: 'Zurückkehren',
    ride: 'Fahren',
    planTitle: 'Dein Ziel.\nUnsere Route.',
    planBody:
      'Gib eine Adresse oder Haltestelle ein. Vergleiche Verbindungen, wähle Verkehrsmittel und passe die Umstiege an.',
    planDetail:
      'Busse, Straßenbahnen und verfügbare Bahnverbindungen. Mit Fußwegen zur Haltestelle und zum Ziel.',
    savedTitle: 'Deine Orte.\nNäher als du denkst.',
    savedBody:
      'Zuhause, Arbeit, dein Lieblingscafé. Speichere häufige Ziele und sieh die nächsten Abfahrten direkt auf der Startseite.',
    savedDetail:
      'Letzte Suchen bleiben griffbereit. Den Startpunkt kannst du unabhängig vom GPS festlegen.',
    rideTitle: 'Du weißt, wo du bist.\nUnd wie es weitergeht.',
    rideBody:
      'Öffne die Route auf der Karte, prüfe die Haltestellen und verfolge deine Fahrt. Eine Benachrichtigung erinnert dich ans Losgehen.',
    rideDetail:
      'Fahrzeugpositionen und Verspätungen erscheinen, wenn der Betreiber sie bereitstellt.',
  },
  offline: {
    eyebrow: 'Für unterwegs gemacht',
    title: 'Empfang weg.\nRoute noch da.',
    body: 'Lade Fahrplan und Karte deiner Stadt herunter. Kilometr berechnet Verbindungen auf deinem Telefon, auch ohne Internet.',
    note: 'Zum Herunterladen, Aktualisieren und für Echtzeitdaten wird Internet benötigt.',
    local: 'Routenberechnung auf dem Telefon',
    timetable: 'Offline-Fahrpläne',
    maps: 'Heruntergeladene Karte',
    airplane: 'Flugmodus',
    ready: 'Du kannst los.',
  },
  coverage: {
    cities: cityNames,
    eyebrow: 'Jetzt in ganz Polen',
    title: 'Andere Stadt.\nDerselbe Kilometr.',
    body: 'Im Alltag zu Hause, am Wochenende woanders. Wähle eine Stadt und fahre mit der App, die du schon kennst.',
    count: (n) => `${n} Städte und Ballungsräume`,
    label: 'Stadt auswählen',
    map: 'Karte der unterstützten Städte in Polen',
    selected: (name) => `Ausgewählte Stadt: ${name}`,
    timetable: 'Fahrplan',
    offline: 'Offline-Karte',
    rail: 'Regionalbahn',
    note: 'Verkehrsmittel und Echtzeitdaten unterscheiden sich je nach Stadt. Die Stadt wechselst du in den Einstellungen der App.',
    metro: 'Oberschlesisch-Zagłębier Metropole',
  },
  principles: {
    title: 'Einfach einsteigen.',
    free: 'Kostenlos.',
    freeBody: 'Verbindungen planen ohne Abo oder kostenpflichtige Funktionen.',
    ads: 'Ohne Werbung.',
    adsBody: 'Auf dem Bildschirm ist Platz für deine Route.',
    account: 'Ohne Konto.',
    accountBody: 'App öffnen und dein Ziel wählen.',
    open: 'Offener Quellcode.',
    openBody: 'Kilometr wird öffentlich entwickelt. Den Code findest du auf GitHub.',
    source: 'Quellcode auf GitHub ansehen',
  },
  donation: {
    title: 'Hilf, Kilometr weiterzuentwickeln.',
    body: 'Kilometr ist kostenlos und quelloffen. Wenn dir die App unterwegs hilft, kannst du ihre Weiterentwicklung auf Ko-fi unterstützen.',
    cta: 'Auf Ko-fi unterstützen',
  },
  download: {
    title: 'Nächster Halt?\nDeiner.',
    body: 'Nimm Kilometr auf deine nächste Fahrt mit.',
    android: 'Für Android-Telefone. Kostenlos.',
    apk: 'APK auf GitHub',
    github: 'Stabile Version von GitHub',
    alternatives: 'Lieber anders installieren?',
    nightly: 'Testversionen',
    obtainium: 'Zu Obtainium hinzufügen',
    obtainiumHelp: 'Obtainium muss installiert sein.',
  },
  footer: {
    tagline: 'Bis unterwegs.',
    privacy: 'Datenschutz',
    github: 'GitHub',
    license: 'Freie Software. GPL-3.0.',
    back: 'Zurück zur Startseite',
  },
  preview: {
    home: 'Startseite der App',
    routes: 'Verbindungsliste',
    trip: 'Fahrtdetails',
    placeholder: 'Platz für einen Screenshot',
    device: 'Pixel 7a / 1080 × 2400',
    placeholderLabel: (screen) =>
      `${screen}. Platz für einen echten Screenshot von einem Pixel 7a.`,
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
