import type { Strings } from './pl';
import { cityNames } from './cities';

export const de: Strings = {
  meta: {
    title: 'Kilometr. Deine Stadt. Dein Tempo.',
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
  theme: { light: 'Helles Design aktivieren', dark: 'Dunkles Design aktivieren' },
  hero: {
    eyebrow: 'Kilometr für Android',
    title: 'Deine Stadt.',
    accent: 'Dein Tempo.',
    body: 'Dein täglicher Begleiter im Nahverkehr. Jetzt in Städten in ganz Polen. Auch offline.',
    play: 'Bei Google Play herunterladen',
    secondary: 'So funktioniert’s',
  },
  intro: {
    title: 'Eine gute Verbindung.\nJeden Tag.',
    body: 'Zur Arbeit, zur Uni, ans andere Ende der Stadt. Kilometr plant die Route und du kümmerst dich um deinen Tag.',
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
    report: 'Benchmark',
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
    title: 'Datenschutz in Kilometr',
    intro: 'Informationen zur Android-App Kilometr und dieser Website. Stand: 19. Oktober 2026.',
    localTitle: 'Daten auf deinem Gerät',
    localBody:
      'Gespeicherte Orte, Suchverlauf, Einstellungen und heruntergeladene Fahrpläne liegen auf deinem Telefon. Die App benötigt kein Konto. Lokale Daten entfernst du über den App-Speicher in den Android-Einstellungen.',
    locationTitle: 'Standort und Benachrichtigungen',
    locationBody:
      'Mit deiner Erlaubnis nutzt die App den Standort für nahe Haltestellen, den Startpunkt und den Reiseverlauf. Aktivierte Reise- oder Aufzeichnungsfunktionen können den Standort im Hintergrund nutzen. Benachrichtigungen betreffen ausgewählte Fahrten. Berechtigungen kannst du in den Android-Einstellungen widerrufen.',
    networkTitle: 'Anfragen an externe Dienste',
    networkBody:
      'Fahrpläne, Karten, Meldungen und Fahrzeugpositionen werden von Datenanbietern geladen. Adresssuche und Fußwege nutzen OpenStreetMap-Quellen. Je nach Funktion können Anfragen Suchtext, Haltestelle, Linie oder Gebietskoordinaten enthalten. Anbieter erhalten technisch bedingt auch deine IP-Adresse.',
    exportTitle: 'Datenexport',
    exportBody:
      'Du kannst Sicherungen und aufgezeichnete Routen als Datei exportieren. Du entscheidest, mit wem du diese Datei teilst.',
    webTitle: 'Diese Website',
    webBody:
      'Die Website speichert nur Sprache und Design im Browserspeicher. Sie lädt keine Analyse- oder Werbetools. Für das Hosting durch GitHub Pages und verlinkte externe Seiten gelten die Regeln der jeweiligen Betreiber.',
    contactTitle: 'Fragen',
    contactBody:
      'Fragen zum Datenschutz und zur App kannst du im GitHub-Repository des Projekts stellen.',
    contact: 'Issue erstellen',
  },
  report: {
    title: 'Benchmark der Routenplanung',
    intro:
      'Historischer Vergleich für Wrocław. Die Ergebnisse gelten für die getesteten Routen, nicht für ganz Polen oder aktuelle Reisebedingungen.',
    sample: '72 Routen. Werktage und Wochenende.',
    body: 'Der Vergleich mit jakdojade umfasst 72 Routen an Werktagen und am Wochenende, mit einem Abfahrtsfenster von bis zu 120 Minuten. Kilometr fand in 46 Fällen eine frühere, in 24 die gleiche und in 2 eine spätere Ankunft.',
    methodology: 'Code und Methodik des Vergleichs',
  },
};
