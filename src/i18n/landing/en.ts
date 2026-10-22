import type { Strings } from './pl';
import { previewRoute } from './journey';
import { previewHome } from './home';

export const en: Strings = {
  meta: {
    title: 'Kilometr',
    imageAlt:
      'Kilometr. Your open source journey planner. The app on an iPhone, city coats of arms and a transit network diagram.',
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
  },
  install: {
    android: 'Android',
    ios: 'iOS',
    platform: 'Choose your phone system',
    newTab: '(opens in a new tab)',
  },
  android: {
    title: 'Join the Play Store beta',
    intro:
      'Kilometr is in testing. To download the Android app, first join the tester group, then join the beta on Google Play.',
    noteTitle: 'Use one Google account for both steps',
    noteBody:
      'Join the group and the beta with the same Google account. Use it in the Play Store on your phone too.',
    group: {
      title: 'Join the tester group',
      body: 'Open the Kilometr group in Google Groups. Sign in and select “Join group”. Opening the page alone does not add you to the group.',
      action: 'Join the Google group',
    },
    testing: {
      title: 'Join the beta and download the app',
      body: 'After joining the group, open the testing page. Confirm that you want to join the programme, then follow its Google Play link to install Kilometr.',
      action: 'Join the Google Play beta',
    },
    helpTitle: 'Cannot access the test?',
    helpBody:
      'Check that the group, testing page and Play Store all use the same Google account. If you just joined the group, wait a little and refresh the testing page. This is a test version, so you may encounter bugs.',
    alternative: {
      title: 'Boycotting Google? Download straight from the source',
      body: 'Obtainium downloads Kilometr and its updates directly from our GitHub. The button opens the configuration in Obtainium or helps you install it.',
      obtainium: 'Add to Obtainium',
      fdroid: 'F-Droid',
      soon: 'Coming soon',
      json: 'Download Obtainium configuration (JSON)',
    },
  },
  ios: {
    title: 'Install on iOS',
    intro:
      'You can install Kilometr on iOS from an IPA file, outside the App Store. This is called sideloading. Follow the steps below using Sideloadly.',
    noteTitle: 'Prepare your phone and computer',
    noteBody:
      'You need an iPhone with iOS 16.4 or later, a Mac or Windows computer, a USB cable and an Apple account. A free account is enough.',
    download: {
      title: 'Download the app file',
      body: 'Save kilometr-unsigned.ipa from the latest release to your computer. It is unsigned. You will sign it with your Apple account during installation.',
      action: 'Download IPA',
    },
    tool: {
      title: 'Install Sideloadly on your computer',
      body: 'Download the version for your system from the official website. On Windows, also install the Apple versions of iTunes and iCloud linked there.',
      action: 'Download Sideloadly',
    },
    sign: {
      title: 'Connect your iPhone and install Kilometr',
      body: 'Unlock your phone, connect it by cable and trust the computer. In Sideloadly, select your iPhone, drag in the IPA file and enter your Apple account. Keep the KilometrLiveActivity extension for Live Activities and Dynamic Island. Click Start and follow the prompts.',
    },
    open: {
      title: 'Trust the app on your phone',
      body: 'If iOS asks, go to Settings → General → VPN & Device Management and trust your Apple account profile. Enable Developer Mode in Settings → Privacy & Security if prompted. Then open Kilometr and download your city’s timetable.',
    },
    helpTitle: 'Remember to renew the signature',
    helpBody:
      'With a free Apple account, the signature expires after 7 days. Renew it with Sideloadly before the app stops opening. The tool supports automatic renewal when your computer and phone can connect. Use the same Apple account and app identifier for updates to keep your data.',
    appStore: {
      title: 'Why is Kilometr not on the App Store?',
      body: 'Apple charges 99 USD a year for a developer account, even for a free app. These rules are a scandal for small open-source projects: they favour corporations over independent creators. We cannot afford it, so for now we offer an IPA file you can install yourself.',
      supportBody:
        'Want to help us cover this fee? You can support the project. Every donation helps us develop Kilometr and fund its publication.',
    },
  },
  homePreview: {
    screenLabel: 'Kilometr home screen on an iPhone',
    statusTime: '21:36',
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
