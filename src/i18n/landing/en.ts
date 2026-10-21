import type { Strings } from './pl';
import { previewRoute } from './journey';
import { previewHome } from './home';

export const en: Strings = {
  meta: {
    title: 'Kilometr',
    description:
      'Public transport in cities across Poland. Plan journeys, check departures and use offline timetables. Free on Android.',
  },
  skip: 'Skip to content',
  nav: {
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
  homePreview: {
    screenLabel: 'App home screen',
    places: previewHome,
    title: 'Where to?',
    savedTitle: 'Saved places',
    edit: 'Edit',
    historyTitle: 'Recent places',
    home: 'Home',
    school: 'University',
    gym: 'Gym',
    stop: 'Stop',
    searchLabel: 'Where are you going?',
    startFrom: (title: string) => `from: ${title}`,
    departIn: (n: number) => `in ${n} min`,
  },
  journeyDemo: {
    choose: 'You choose',
    ride: '...and off you go',
    mock: 'Example journey. Times follow your device clock.',
    route: previewRoute,
    departIn: (n) => `in ${n} min`,
    duration: (n) => `${n} min`,
    transfers: (n) => (n === 0 ? 'direct' : n === 1 ? '1 transfer' : `${n} transfers`),
    fromPrefix: 'from ',
    toPrefix: 'to ',
    stopsSummary: (n, mins, open) =>
      `${n} ${n === 1 ? 'stop' : 'stops'} • ~${mins} min • ${open ? 'collapse' : 'expand'} stops`,
    expandA11y: (line, dir, expanded) =>
      `${line} towards ${dir}. ${expanded ? 'Collapse' : 'Expand'} the stop list.`,
  },
  promise: {
    ads: 'No ads.',
    free: 'Free.',
    forever: 'Forever.',
  },
  closing: {
    title: 'You deserve more than jakdojade',
    body: 'Plan journeys and check departures, even offline. Download Kilometr and, if it helps you, support its development.',
    support: 'Support development',
  },
  footer: {
    tagline: 'See you on the way.',
    privacy: 'Privacy',
    github: 'GitHub',
    license: 'Free software. GPL-3.0.',
    back: 'Back to the home page',
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
};
