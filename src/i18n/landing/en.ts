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
  theme: { light: 'Use light theme', dark: 'Use dark theme' },
  hero: {
    eyebrow: 'Kilometr for Android',
    title: 'Your city.',
    accent: 'Your pace.',
    body: 'Your everyday public transport planner. Now in cities across Poland. Offline, too.',
    play: 'Get it on Google Play',
    secondary: 'See how it works',
    caption: 'Screenshots from a Pixel 7a.',
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
    title: 'Privacy in Kilometr',
    intro: 'Information about the Kilometr Android app and this website. As of 19 October 2026.',
    localTitle: 'Data on your device',
    localBody:
      'Saved places, search history, settings and downloaded timetables are stored on your phone. The app does not require an account. Remove local data by clearing the app’s storage in Android Settings.',
    locationTitle: 'Location and notifications',
    locationBody:
      'With your permission, the app uses location to find nearby stops, set your starting point and follow your journey. Enabled journey or route recording features may use location in the background. Notifications relate to selected journeys. Revoke permissions in Android Settings.',
    networkTitle: 'Requests to external services',
    networkBody:
      'Downloading timetables, maps, service updates and vehicle positions requires connections to data providers. Address searches and walking routes use OpenStreetMap sources. Depending on the feature, requests may contain search text, a stop, a line or area coordinates. Providers also receive your IP address as part of normal internet communication.',
    exportTitle: 'Data exports',
    exportBody:
      'You can export backups and recorded routes to a file. You decide who to share that file with.',
    webTitle: 'This website',
    webBody:
      'This website only saves your language and theme preferences in browser storage. It loads no analytics or advertising tools. GitHub Pages hosting and external sites you open via links are subject to their operators’ policies.',
    contactTitle: 'Questions',
    contactBody: 'Ask questions about privacy and the app in the project’s GitHub repository.',
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
