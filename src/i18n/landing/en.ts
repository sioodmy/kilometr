import type { Strings } from './pl';
import { cityNames } from './cities';

export const en: Strings = {
  meta: {
    title: 'Kilometr. Your city. Your pace.',
    description:
      'Public transport in cities across Poland. Plan journeys, check departures and use offline timetables. Free on Android.',
  },
  skip: 'Skip to content',
  nav: {
    features: 'Features',
    coverage: 'Coverage',
    download: 'Download',
    menu: 'Menu',
    close: 'Close menu',
    label: 'Main navigation',
  },
  language: 'Website language',
  hero: {
    eyebrow: 'Kilometr for Android',
    title: 'Your',
    accent: 'open-source',
    titleEnd: 'journey planner',
    body: 'Plan your route, check departures and head into town. Public transport across Poland, even offline. No ads or account needed.',
    play: 'Get it on Google Play',
    secondary: 'See how it works',
  },
  intro: {
    title: 'A good connection.\nEvery day.',
    body: 'To work, to class, across town. Kilometr plans the route so you can get on with your day.',
  },
  features: {
    label: 'App features',
    plan: 'Plan',
    saved: 'Return',
    ride: 'Ride',
    planTitle: 'You pick the place.\nWe find the route.',
    planBody:
      'Enter an address or stop. Compare journeys, choose your transport and set your transfer preferences.',
    planDetail:
      'Buses, trams and rail where available. Including the walk to your stop and destination.',
    savedTitle: 'Your places.\nCloser than you think.',
    savedBody:
      'Home, work, your favourite café. Save the places you return to and check the next departures on the home screen.',
    savedDetail:
      'Recent searches stay close at hand. Set your starting point independently of GPS.',
    rideTitle: 'Know where you are.\nAnd what comes next.',
    rideBody:
      'See your route on the map, check the stops along the way and follow your journey. A notification reminds you when to leave.',
    rideDetail: 'Vehicle positions and delays appear where the operator provides them.',
  },
  offline: {
    eyebrow: 'Made for the journey',
    title: 'Signal gone.\nRoute still here.',
    body: 'Download your city’s timetable and map. Kilometr calculates journeys on your phone, so you can plan without an internet connection.',
    note: 'Internet is needed to download and update data, and for live information.',
    local: 'Routes calculated on your phone',
    timetable: 'Offline timetables',
    maps: 'Your downloaded map',
    airplane: 'Airplane mode',
    ready: 'Ready when you are.',
  },
  coverage: {
    cities: cityNames,
    eyebrow: 'Now across Poland',
    title: 'Another city.\nThe same Kilometr.',
    body: 'At home during the week, somewhere else at the weekend. Pick a city and travel with the app you already know.',
    count: (n) => `${n} cities and metropolitan areas`,
    label: 'Choose a city',
    map: 'Map of supported cities in Poland',
    selected: (name) => `Selected city: ${name}`,
    timetable: 'Timetables',
    offline: 'Offline map',
    rail: 'Regional rail',
    note: 'Transport options and live data vary by city. Change your city in the app’s Settings.',
    metro: 'Upper Silesian and Zagłębie Metropolis',
  },
  principles: {
    title: 'Just hop on.',
    free: 'Free.',
    freeBody: 'Plan journeys without a subscription or paid features.',
    ads: 'No ads.',
    adsBody: 'Your screen has room for your route.',
    account: 'No account.',
    accountBody: 'Open the app and choose where you’re going.',
    open: 'Open source.',
    openBody: 'Kilometr is developed in public. Read the code on GitHub.',
    source: 'View the code on GitHub',
  },
  donation: {
    title: 'Help develop Kilometr.',
    body: 'Kilometr is free and open source. If it helps you get around, you can support its development on Ko-fi.',
    cta: 'Support on Ko-fi',
  },
  download: {
    title: 'Next stop?\nYours.',
    body: 'Take Kilometr on your next journey.',
    android: 'For Android phones. Free.',
    apk: 'APK on GitHub',
    github: 'Stable release from GitHub',
    alternatives: 'Prefer another way to install?',
    nightly: 'Test releases',
    obtainium: 'Add to Obtainium',
    obtainiumHelp: 'Requires Obtainium to be installed.',
  },
  footer: {
    tagline: 'See you on the way.',
    privacy: 'Privacy',
    report: 'Benchmark',
    github: 'GitHub',
    license: 'Free software. GPL-3.0.',
    back: 'Back to the home page',
  },
  preview: {
    home: 'App home screen',
    routes: 'Journey results',
    trip: 'Journey details',
    placeholder: 'Screenshot placeholder',
    device: 'Pixel 7a / 1080 × 2400',
    placeholderLabel: (screen) => `${screen}. Space for an authentic screenshot from a Pixel 7a.`,
  },
  privacy: {
    title: 'Kilometr privacy policy',
    linkLabel: 'Privacy policy',
    linkError: 'Could not open GitHub. Check your connection and try again.',
    intro:
      'Applies to the Kilometr Android app (app.kilometr) and the project website. Updated: 20 October 2026. Kilometr is an open source project developed by sioodmy on GitHub. The app requires no account and contains no ads or analytics tools.',
    localTitle: 'Data on your device',
    localBody:
      'Saved places with their names and coordinates, search history, settings, backups and downloaded timetables are stored in the app’s storage on your phone. Journeys using downloaded timetables are planned on your device. Kilometr does not sync this data to a server account.',
    locationTitle: 'Location and notifications',
    locationBody:
      'Location is optional. It helps find nearby stops, set the start of a route and monitor an active journey. A journey you start may keep using GPS with the screen off, with a visible service notification. The app does not request permanent background location access. Notifications cover pinned journeys, departure alarms and reminders to get off. You can stop a journey or revoke permissions in Android Settings. Without permission you can still choose your starting point manually.',
    networkTitle: 'Requests to external services',
    networkBody:
      'Timetables come from Kilometr infrastructure; service updates and vehicle positions come from transport operators and data providers. OpenStreetMap Nominatim receives address search text and the city area, and coordinates when GPS positions are converted to addresses. OpenFreeMap receives requests for map tiles covering an area. The public OSRM server receives route point coordinates when the app loads route geometry. Providers also receive your IP address and request parameters and may keep logs under their own policies. These connections provide the features you use.',
    exportTitle: 'Data exports',
    exportBody:
      'Exporting a backup creates a file containing saved places, history and settings. A shared journey may contain the names and coordinates of its start and destination, stops and travel times. The link stores this information after the # character, which the website reads in your browser. Anyone receiving a file, image or link can read and forward its contents. You initiate sharing yourself.',
    retentionTitle: 'Retention and deletion',
    retentionBody:
      'Local data stays on your device until you delete it or the app replaces cached data. You can remove saved places and history in the app. Remove all local data through Android Settings → Apps → Kilometr → Storage → Clear data. Delete exported files and copies held by recipients separately. External service operators set their own log retention periods.',
    securityTitle: 'Data transfer',
    securityBody:
      'The default public timetable, map, address and route geometry services use HTTPS. Local data is kept in private app storage protected by Android. Exported files and journey links are not password protected. Avoid sharing them if they contain an address you wish to keep private.',
    webTitle: 'This website',
    webBody:
      'This website only saves your language preference in browser storage. It loads no analytics or advertising tools. GitHub Pages hosting and external sites you open via links are subject to their operators’ policies.',
    contactTitle: 'Privacy contact',
    contactBody:
      'Kilometr is maintained by sioodmy (github.com/sioodmy). Send privacy questions and data requests through Issues at github.com/sioodmy/kilometr. Issues are public, so do not include your home address or other sensitive data. Changes to data handling will be described in this policy with an updated date.',
    contact: 'Open an issue',
  },
  report: {
    title: 'Journey planner benchmark',
    intro:
      'A historical comparison for Wrocław. Results apply to the tested routes, not all of Poland or current travel conditions.',
    sample: '72 routes. Weekdays and weekends.',
    body: 'The comparison with jakdojade covers 72 weekday and weekend routes, with a departure window of up to 120 minutes. Kilometr found an earlier arrival in 46 cases, an equal arrival in 24 and a later arrival in 2.',
    methodology: 'Comparison code and methodology',
  },
};
