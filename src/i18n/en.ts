// English dictionary. Must satisfy `Strings` (typeof pl) - a missing key
// or a wrong function signature is a compile error, not an empty label.
import type { Strings } from './pl';
import { en as landing } from './landing/en';
import { en as share } from './share/en';

export const en: Strings = {
  landing,
  share,
  lineTimetable: {
    title: 'Line timetable',
    line: (line: string) => `Line ${line}`,
    open: (line: string) => `Open timetable for line ${line}`,
    searchHint: 'Stops and departure times',
    direction: 'Direction',
    variant: (n: number) => `Variant ${n}`,
    stops: 'Stops',
    stopsHint: 'Tap a stop to see departures.',
    departures: 'Departures',
    stopCode: (code: string) => `Stop code ${code}`,
    selectStop: (name: string) => `Show departures: ${name}`,
    loading: 'Loading timetable…',
    error: 'Could not load the timetable. Try again.',
    empty: 'No trips in the saved timetable for this date. Choose another day or update the timetable in Settings.',
    missing: 'This line is missing from the saved timetable. Return to search or update the data in Settings.',
    missingStop: 'This stop or route variant is no longer in the timetable. Return to the stop list.',
    terminal: 'Last stop',
    terminalHint: 'Choose an earlier stop to see departures.',
    scheduled: 'Times from the saved timetable',
    nextDay: 'Next day',
    previousDay: 'Previous day',
    back: 'Back',
    dayOffset: (days: number) => `+${days} ${days === 1 ? 'day' : 'days'}`,
    nextDayTime: (time: string, days: number) => `${time} (+${days} ${days === 1 ? 'day' : 'days'})`,
  },
  transferGuard: {
    enabled: 'On',
    disabled: 'Off',
    title: 'Transfer protection',
    waiting: 'We will check your transfer once you start riding.',
    buffer: (line: string, n: number) => `Transfer to ${line} · ${n} min to spare`,
    riskTitle: (line: string) => `You may miss your transfer to ${line}`,
    riskBody: 'Looking for another transfer.',
    stayOn: (line: string) => `Stay on ${line}`,
    changedBody: (line: string, stop: string) => `Transfer to ${line} at ${stop}.`,
    noAlternative: 'No other route is available right now. We will check again shortly.',
    unavailable: 'Cannot assess your transfer',
    unavailableBody: 'Waiting for an accurate position on your route. Your current plan is still shown.',
    routingError: 'Could not prepare transfer protection. Please try again.',
    rerouting: 'Finding a new transfer',
    next: (line: string, stop: string) => `${line} · ${stop}`,
    channel: 'Transfer changes',
    start: 'Travel with transfer protection',
    startBody: 'We will warn you if you may miss a transfer. You choose whether to change routes.',
    locationRequired: 'Transfer protection needs your precise location during the journey.',
    active: 'Protection is on',
    preparing: 'Preparing transfer protection…',
    safe: 'You have time to transfer',
    attention: 'Check your transfer',
    alternativeTitle: 'You can take another route',
    alternativeBody: 'Check the other route and choose whether to take it.',
    originalPlan: 'Current plan',
    suggestedPlan: 'Another route',
    unchanged: 'Your route changes only after you confirm.',
    sameStop: 'Transfer at the same stop',
    stayUntil: (line: string, stop: string) => `Take line ${line} to: ${stop}`,
    fromHere: 'Leave from your current location',
    departure: 'Departure',
    arrival: 'At your destination',
    delay: (n: number) => `Delay +${n} min`,
    shortBy: (n: number) => `You need ${n} more min to transfer`,
    spare: (n: number) => `${n} min to spare`,
    schedule: 'Scheduled times',
    live: 'Live data',
    choose: 'Take this route',
    keepPlan: 'Keep my current plan',
    showOptions: 'Check transfer',
    later: 'Minimize',
    expired: 'This option is no longer available. Checking other routes.',
    acceptError: 'Could not change routes. Your current plan is still active.',
    stop: 'End journey',
    foreground: 'Protection works while the app is open.',
    background: 'Protection also works with the screen locked.',
    complete: 'You have no more transfers on this route.',
    demo: 'Test scenario',
  },
  common: {
    retry: 'Try again',
    cancel: 'Cancel',
    close: 'Close',
    no: 'No',
    yesRemove: 'Yes, remove',
    now: 'Now',
    today: 'Today',
    tomorrow: 'Tomorrow',
    todayLong: 'Today',
    tomorrowLong: 'Tomorrow',
    todayLower: 'today',
    tomorrowLower: 'tomorrow',
    durMin: (n: number) => `${n} min`,
    departIn: (n: number) => `in ${n} min`,
    departNow: 'due',
    departAgo: (n: number) => `${n} min ago`,
    departJustAgo: 'just left',
    lessThan10m: '< 10 m',
    kmh: (v: string) => `${v} km/h`,
    add15: '+15 min',
    add30: '+30 min',
    add45: '+45 min',
    add60: '+1 hr',
  },
  home: {
    searchToA11y: (title: string) => `Find connections to: ${title}`,
    editPlaceHint: 'Press and hold to edit this place.',
    title: 'Where to?',
    newsA11y: 'Service updates',
    newsAlertA11y: 'Service updates: new disruptions',
    searchLabel: 'Where are you going?',
    searchA11y: 'Search for an address, stop or place',
    startCustomA11y: (t: string) => `Route start: ${t}. Tap to change.`,
    startGpsA11y: (t: string) => `Location: ${t}. Tap to change the start.`,
    startFrom: (t: string) => `from: ${t}`,
    resetStartA11y: 'Restore current GPS location',
    savedTitle: 'Saved places',
    editSavedA11y: 'Edit saved places',
    editCard: 'Edit',
    editCardSub: 'saved places',
    historyTitle: 'Recent places',
    historyEmptyTitle: 'No recent places',
    historyEmptyBody: 'Search a connection and it will show up here as a quick destination.',
    historyEmptyAction: 'Search connections',
    openConnA11y: (title: string, label: string) => `Open connection to ${title}, ${label}`,
    gpsTitle: 'My location (GPS)',
    locationFallback: 'Your location',
    gpsAddressHome: 'Current device position',
    importingTitle: (gen: string) => `Downloading the ${gen} timetable…`,
    importErrorTitle: 'Timetable download error',
    importErrorRetry: 'Tap to retry.',
    saveFailTitle: 'No database connection',
    saveFailBody: 'Could not save the place. Try again.',
    searchPlaceholderTo: 'Where are you going?',
    searchPlaceholderFrom: 'Where are you starting from?',
    unsupportedTitle: 'Unsupported city',
    unsupportedTitleOther: 'Different city in the app',
    unsupportedBody: (city: string, supported: string) =>
      `Your GPS location points to ${city}. We currently serve only: ${supported}.`,
    unsupportedBodyOther: (city: string, active: string) =>
      `You are in ${city}, but the app is set to ${active}. Change the city in Settings.`,
    unsupportedBodyUnknown: (supported: string) =>
      `Your GPS location is outside the supported area. We currently serve only: ${supported}.`,
    unsupportedHint: 'Pick a start point manually to search connections.',
    unsupportedAction: 'Pick a start point',
    pickStart: 'Pick a start point',
    gpsBlockedTitle: 'GPS start unavailable',
    gpsBlockedBody: (city: string, supported: string) =>
      `You are outside the ${supported} area (${city}), so GPS routes will not work. Pick a start point manually.`,
    gpsBlockedBodyUnknown: (supported: string) =>
      `You are outside the ${supported} area, so GPS routes will not work. Pick a start point manually.`,
  },
  city: {
    section: 'City',
    settingsTitle: 'City',
    settingsHint:
      'Timetable, offline map and news follow the city. The other city’s data stays on the phone.',
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
        ? 'ZTP and Koleje Małopolskie'
        : id === 'gzm'
          ? 'ZTM, Koleje Śląskie, POLREGIO and PKP Intercity'
          : id === 'warszawa'
            ? 'WTP, SKA, Koleje Mazowieckie and WKD'
            : id === 'poznan'
              ? 'ZTM and Koleje Wielkopolskie'
              : id === 'trojmiasto'
                ? 'ZTM Gdańsk, ZKM Gdynia and SKM'
: id === 'lodz'
                  ? 'MPK and Łódzka Kolej Aglomeracyjna'
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
                              : id === 'radom'
                                ? 'MZDiK Radom'
                              : 'MPK and Koleje Dolnośląskie',
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
    changed: (name: string) => `Switched to: ${name}.`,
    switching: 'Switching city…',
    blockedByDownload: 'Timetable download in progress. You can switch city once it finishes.',
    needDownload:
      'This city has no timetable on the phone yet. Download it under Timetable and maps.',
    changeAction: 'Change',
    selectTitle: 'Select city',
    selectSub: 'Choose the transit area you want to travel in.',
    searchPlaceholder: 'City or operator',
    noSearchResults: (q: string) => `No cities found for "${q}"`,
    searchEmptyHint: 'Check the spelling or try searching for another metropolitan area.',
    searchClearA11y: 'Clear search',
    closeSheetA11y: 'Close city selection',
    cityActiveBadge: 'Active',
  },
  personalization: {
    colors: 'App colors',
    system: 'From wallpaper',
    systemDescription: 'Default Material You colors',
    wallpaperUnavailable: 'Wallpaper colors unavailable. Using the default palette.',
    teal: 'Teal',
    blue: 'Blue',
    green: 'Green',
    violet: 'Purple',
    rose: 'Pink',
    orange: 'Orange',
    saving: 'Saving color…',
    saveError: 'Could not save the color. Try selecting it again.',
  },
  settings: {
    planningTitle: 'Journey planning',
    offlineTitle: 'Timetable and maps',
    notificationsSummary: 'Journey tracking and alerts',
    backupSummary: 'Saved places, history and settings',
    planningSummary: (style: string, pace: string) => `${style} · ${pace}`,
    appSummary: (language: string, color: string) => `${language} · ${color}`,
    resetRoutes: 'Reset journey preferences',
    resetRoutesBody: 'This restores the default journey planning settings.',
    decrease: (label: string) => `Decrease: ${label}`,
    increase: (label: string) => `Increase: ${label}`,
    langPolish: 'Polski',
    langEnglish: 'English',
    langGerman: 'Deutsch',
    langUkrainian: 'Українська',
    title: 'Settings',
    resetA11y: 'Restore defaults',
    sectionSupport: 'Support',
    supportTitle: 'Support the project',
    supportHint: 'Kilometr is free. A coffee on Ko-fi helps keep development going.',
    supportButton: 'Open Ko-fi',
    supportA11y: 'Open the Ko-fi page in your browser',
    sectionOffline: 'Offline',
    sectionApp: 'App',
    sectionRoute: 'Route',
    sectionTransport: 'Transport',
    sectionData: 'Your data',
    advancedShow: 'Advanced',
    advancedHide: 'Hide advanced',
    notificationsSection: 'Notifications',
    notificationsFoot: 'Notifications work in a development build. Expo Go does not support them.',
    offlineMapTitle: (name: string) => `Offline map (${name})`,
    offlineMapHint: (name: string, mb: number) =>
      `Download ${name} map tiles (about ${mb} MB) so routes work without internet.`,
    offlineMapReady: (name: string) =>
      `The ${name} map is on your phone. Routes work without internet.`,
    offlineMapDownload: 'Download map',
    offlineMapDownloadA11y: (name: string) => `Download the ${name} map for offline use`,
    offlineMapDownloading: (pct: number) => `Downloading… ${pct}%`,
    offlineMapStepTiles: (name: string) => `tiles for ${name}`,
    offlineMapStepDone: 'done',
    offlineMapDelete: 'Delete',
    offlineMapDeleteA11y: 'Delete the offline map',
    offlineMapDeleteTitle: 'Delete the offline map?',
    offlineMapDeleteBody: (mb: number) =>
      `This frees about ${mb} MB. The map will still work online. You can download it again only after a month.`,
    offlineMapFailTitle: 'Could not download the map',
    offlineMapFailBody: 'Check your connection and try again. The rest of the app works normally.',
    offlineMapCooldownTitle: 'Map already downloaded',
    offlineMapCooldownBody: (days: number) =>
      days <= 1
        ? 'You can download the map again tomorrow. One copy lasts a long time.'
        : `You can download the map again in ${days} days. One copy lasts a long time.`,
    backupTitle: 'Your data',
    backupHint:
      'Saved places, recent trips and settings in one file. Export before switching phones, or just to be safe.',
    backupExcludeHint: 'The timetable, caches and live trip tracking stay on the device.',
    backupExport: 'Export to file',
    backupImport: 'Import from file',
    backupExportA11y: 'Export your data to a file',
    backupImportA11y: 'Import data from a file',
    backupEmpty: 'There is nothing to back up yet.',
    backupCurrent: (places: number, routes: number, trips: number) =>
      `${places} ${places === 1 ? 'place' : 'places'} • ${routes} saved ${routes === 1 ? 'route' : 'routes'} • ${trips} ${trips === 1 ? 'trip' : 'trips'}`,
    backupExportDoneTitle: 'Done',
    backupExportDoneBody: (path: string) => `File saved to ${path}`,
    backupExportFailTitle: 'Could not save the file',
    backupExportFailBody: (reason: string) => `${reason}. Check free space and try again.`,
    backupExportFailFallback: 'Please try again in a moment.',
    backupImportConfirmTitle: 'Import this data?',
    backupImportConfirmBody: (summary: string) =>
      `${summary}\n\nSaved places and trips are merged with what you already have. Nothing is lost. Settings are overwritten.`,
    backupImportAction: 'Import',
    backupImportCancel: 'Cancel',
    backupImportDoneTitle: 'Data imported',
    backupImportDoneBody: (summary: string) => `Merged: ${summary}`,
    backupImportNothing: 'This backup contains no data of yours.',
    backupFailNoFile: 'No file found.',
    backupFailUnreadable: 'Could not read the file.',
    backupFailNotBackup: 'This is not a Kilometr backup.',
    backupFailSchemaTooNew: 'This backup comes from a newer version of the app.',
    dataTitle: (operator: string) => `${operator} timetable`,
    dataHint: (feeds: string) =>
      `${feeds} timetables from the Kilometr server. Download once, then offline.`,
    dataEmpty: 'No offline data.',
    dataDownloading: (p: number) => `Downloading… ${p}%`,
    dataStep: (step: string, p: number) => `${step} ${p}%`,
    dataReady: (stops: number, trips: number) => `Full timetable: ${stops} stops, ${trips} trips`,
    dataError: (msg: string) => `Error: ${msg}`,
    downloadA11y: 'Download timetable',
    downloadCheckA11y: 'Check for a newer timetable',
    downloadReady: 'Check for updates',
    downloadEmpty: 'Download full timetable',
    downloadFailTitle: 'Could not download the timetable',
    downloadFailBody: (reason: string) =>
      `${reason}. The app fetches a ready database from the Kilometr server, or the classic way from the city’s open data.`,
    downloadFailFallback: 'Try again in a moment.',
    downloadDone: 'Timetable refreshed.',
    downloadUpToDate: 'The timetable is already up to date.',
    downloadKeptLocal: 'Could not download the new version. Keeping the one already on the phone.',
    downloadCooldown: (hours: number) =>
      hours <= 1
        ? 'The timetable was downloaded recently. Another full download will be available in about an hour.'
        : `The timetable was downloaded recently. Another full download will be available in ${hours} h.`,
    diagTitle: 'Data diagnostics',
    diagHint:
      'Checks the timetable database on the phone. Copy the result when reporting a problem.',
    diagRun: 'Check data',
    diagRerun: 'Check again',
    diagRunning: 'Checking…',
    diagRunA11y: 'Run data diagnostics',
    diagOk: 'OK',
    diagWarn: 'Warning',
    diagError: 'Error',
    diagDb: 'SQLite database',
    diagDbDamaged: 'Database is damaged',
    diagDbSize: (mb: string) => `Database size: ${mb} MB`,
    diagDbOrphan: (name: string) => `Leftover temp file: ${name}`,
    diagDbWal: (mb: string) => `WAL: ${mb} MB`,
    diagDbNoAccess: 'No access to the database file',
    diagCounts: 'Timetable counters',
    diagCountsLine: (stops: number, routes: number, trips: number, times: number) =>
      `${stops} stops • ${routes} lines • ${trips} trips • ${times} departures`,
    diagCountsEmpty: 'Database is empty. Download the timetable below.',
    diagCountsNoRoutes: 'No lines in the database',
    diagTrains: 'Regional trains',
    diagTrainsLine: (n: number) => (n === 1 ? '1 rail line' : `${n} rail lines`),
    diagTrainsNone: 'No rail lines. Download a newer timetable.',
    diagTrainsNotSupported: 'Not applicable for this city (transit without rail)',
    diagCalendar: 'GTFS calendar',
    diagCalendarLine: (from: string, to: string) => `Timetable valid ${from} to ${to}`,
    diagCalendarEmpty: 'No calendar in the database',
    diagCalendarOutside: 'Today falls outside the timetable',
    diagCalendarExpiring: (days: number) =>
      days <= 1 ? 'Timetable expires tomorrow' : `Timetable expires in ${days} days`,
    diagCalendarServices: (n: number) => `Active services today: ${n}`,
    diagSearch: 'Search',
    diagSearchOk: (weighted: number, pois: number) =>
      `Ranking ready (${weighted} stops) • POIs: ${pois}`,
    diagSearchWeights: 'Suggestion ranking not computed',
    diagSearchPois: 'No POI points. Addresses need internet.',
    diagCopy: 'Copy report',
    diagCopyA11y: 'Copy diagnostics report to clipboard',
    diagCopied: 'Report copied to clipboard',
    diagCopyFail: 'Could not copy the report',
    diagFix: 'Download timetable again',
    diagFixA11y: 'Force timetable download again',
    diagReportCity: 'City',
    diagReportTimetable: 'Timetable',
    diagReportImported: 'Downloaded',
    diagReportDb: 'Database',
    diagReportUnknown: 'unknown',
    routeStyleTitle: 'Route style',
    routeStyleHint:
      'Decides what wins when routes differ by a few minutes: earlier arrival, shorter walk or fewer transfers. The limits below apply to every style.',
    styleFastest: 'Fastest',
    styleFastestDesc: 'Earliest arrival',
    styleBalanced: 'Balanced',
    styleBalancedDesc: 'A minute for less walking',
    styleLessWalking: 'Less walking',
    styleLessWalkingDesc: 'Short walks and transfers',
    styleFewerTransfers: 'Fewer transfers',
    styleFewerTransfersDesc: 'Direct, even if slower',
    transfersTitle: 'Max transfers',
    transfersHint:
      'The most transfers one route may have. The route style sets the penalty for each transfer, so a 300 m walk to a stop with a direct line usually beats changing from the nearest pole.',
    transfersHintShort: 'Upper limit on one route.',
    directValue: 'Direct only',
    allowTransferTitle: 'Allow transfers to:',
    allowTransferHint: 'A switched-off vehicle never shows up in results.',
    modeTram: 'Tram',
    modeBus: 'Bus',
    modeTrolleybus: 'Trolleybus',
    modeSubway: 'Metro',
    modeTrain: 'Train',
    modeCable: 'Cable car',
    transferTimeTitle: 'Min. transfer time',
    transferTimeHint:
      'How much time we reserve between getting off and the next departure. Higher values reject risky one-minute transfers.',
    transferTimeHintShort: 'Buffer between getting off and the next departure.',
    trainTitle: 'Regional trains',
    trainHint:
      'Transfers to regional trains. Only in “All” mode, the tram/bus quick filter never touches them.',
    trainHintShort: 'Regional train transfers. Only in “All” mode.',
    trainBufferTitle: 'Train buffer',
    trainBufferHint:
      'Minimum time to reach the platform after a transfer. Railway stations are not plain stops, the walk from the stop to the platform usually goes through the hall.',
    trainBufferHintShort: 'Time to reach the platform after a transfer.',
    trainNoData:
      'The downloaded timetable has no trains. Check for updates above to enable train transfers.',
    cableTitle: 'Polinka',
    cableHint:
      'The Wrocław University of Science and Technology cable car over the Odra, between Wyspiański embankment and Na Grobli street. Runs on weekdays 7:00–21:00, with a 13:30–14:00 break, every 5 minutes. Closed at weekends. Only in “All” mode.',
    cableHintShort: 'Cable car over the Odra. Only in “All” mode.',
    walkTitle: 'Max walk',
    walkHint:
      'How far you can walk to the first stop and from the last one to your destination. A farther stop with a direct tram often beats the nearest pole.',
    walkHintShort: 'Walk to the first stop and from the last to your destination.',
    speedTitle: 'Walking speed',
    speedHint: 'Your choice shapes walking times, transfers and the estimated arrival.',
    paceSlow: 'Slow',
    paceNormal: 'Normal',
    paceFast: 'Fast',
    paceSlowDesc: 'Easy stroll',
    paceNormalDesc: 'Everyday city walk',
    paceFastDesc: 'Brisk pace',
    anchorTitle: 'Anchor radius',
    anchorHint:
      'When you are within this radius of a saved place (e.g. Home), navigation automatically anchors the start to its stop, smoothing out GPS inaccuracies.',
    anchorHintShort: 'Auto-anchor start near a saved place.',
    foot: 'Settings save automatically and apply to subsequent searches.',
    walkTime: (n: number) => (n === 1 ? '1 minute on foot' : `${n} minutes on foot`),
    langTitle: 'Language',
    langSystem: 'System',
  },
  onboarding: {
    stepCount: (n: number, total: number) => `${n} / ${total}`,
    intro: 'Choose your city and download a timetable. You can plan journeys offline too.',
    openSettings: 'Open settings',
    permissionDenied: 'You can continue without this permission and change it later in your phone settings.',
    steps: ['Welcome', 'Permissions', 'City', 'Timetable', 'Places'],
    granted: 'On',
    denied: 'Off',
    toEnable: 'To enable',
    slotHome: 'Home',
    slotHomeHint: (id: string) =>
      id === 'krakow'
        ? 'e.g. Krowoderska 12'
        : id === 'warszawa'
          ? 'e.g. Marszałkowska 12'
          : id === 'poznan'
            ? 'e.g. Głogowska 12'
            : id === 'trojmiasto'
              ? 'e.g. Długa 12'
: id === 'lodz'
                ? 'e.g. Piotrkowska 12'
                : id === 'szczecin'
                  ? 'e.g. Wojska Polskiego 12'
                  : id === 'kielce'
                    ? 'e.g. Sienkiewicza 12'
                    : id === 'olsztyn'
                      ? 'e.g. Partyzantów 12'
                      : id === 'bialystok'
                        ? 'e.g. Lipowa 12'
                        : id === 'opole'
                          ? 'e.g. Ozimska 12'
                          : id === 'rzeszow'
                            ? 'e.g. 3 Maja 12'
                              : id === 'lublin'
                                ? 'e.g. Krakowskie Przedmieście 12'
                              : id === 'radom'
                                ? 'e.g. Żeromskiego 12'
                            : 'e.g. Swojczycka 41',
    slotWork: 'Work',
    slotWorkHint: (id: string) =>
      id === 'krakow'
        ? 'e.g. Galeria Krakowska'
        : id === 'warszawa'
          ? 'e.g. Złote Tarasy'
          : id === 'poznan'
            ? 'e.g. Stary Browar'
            : id === 'trojmiasto'
              ? 'e.g. Galeria Bałtycka'
: id === 'lodz'
                ? 'e.g. Manufaktura'
                : id === 'szczecin'
                  ? 'e.g. Galeria Kaskada'
                  : id === 'kielce'
                    ? 'e.g. Galeria Echo'
                    : id === 'olsztyn'
                      ? 'e.g. Galeria Warmińska'
                      : id === 'bialystok'
                        ? 'e.g. Galeria Jurowiecka'
                        : id === 'opole'
                          ? 'e.g. Solaris Center'
                          : id === 'rzeszow'
                            ? 'e.g. Galeria Rzeszów'
                              : id === 'lublin'
                                ? 'e.g. Felicity'
                              : id === 'radom'
                                ? 'e.g. Galeria Słoneczna'
                            : 'e.g. Sky Tower',
    slotUni: 'University',
    slotUniHint: (id: string) =>
      id === 'krakow'
        ? 'e.g. AGH'
        : id === 'warszawa'
          ? 'e.g. Uniwersytet'
          : id === 'poznan'
            ? 'e.g. UAM'
            : id === 'trojmiasto'
              ? 'e.g. UG'
: id === 'lodz'
                ? 'e.g. UŁ'
                : id === 'szczecin'
                  ? 'e.g. US'
                  : id === 'kielce'
                    ? 'e.g. UJK'
                    : id === 'olsztyn'
                      ? 'e.g. UWM'
                      : id === 'bialystok'
                        ? 'e.g. UwB'
                        : id === 'opole'
                          ? 'e.g. UO'
                          : id === 'rzeszow'
                            ? 'e.g. PRz'
                              : id === 'lublin'
                                ? 'e.g. UMCS'
                              : id === 'radom'
                                ? 'e.g. UTH'
                            : 'e.g. Politechnika',
    backA11y: 'Back',
    stepOf: (n: number, len: number, name: string) => `Step ${n} of ${len} • ${name}`,
    brand: 'Kilometr',
    tagline: 'This time you’ll make it.',
    fast: 'Offline journey planning',
    noAds: 'No ads',
    noPay: 'No micropayments',
    permTitle: 'App access',
    permSub: 'Location and notifications. Both optional.',
    locTitle: 'Location',
    locBody:
      'Finds nearby stops and follows your active journey. Coordinates are sent to OpenStreetMap Nominatim to look up an address. GPS may stay active with the screen off during a journey.',
    locOn: 'Location enabled.',
    locAllow: 'Allow location',
    notifTitle: 'Notifications',
    notifBody: 'Show your pinned journey and reminders for a selected departure or stop.',
    notifOn: 'Notifications enabled.',
    notifExpoGo:
      'Expo Go preview: notifications (pinned connection) work in the development build.',
    notifAllow: 'Enable notifications',
    cityTitle: 'Which city do you ride in?',
    cityBody:
      'Timetable, map and news follow your choice. You can change the city later in settings.',
    citySuggested: (name: string) => `Your GPS says: ${name}.`,
    cityNoGps: 'Without GPS access, pick a city from the list.',
    cityLocating: 'Finding your GPS position…',
    cityNoMatch: 'GPS did not land in a supported city. Pick one from the list.',
    cityPickA11y: (name: string) => `Choose city: ${name}`,
    citySuggestedA11y: (name: string) => `Suggested city from GPS: ${name}`,
    dlTitle: (gen: string) => `Download the ${gen} timetable`,
    dlBody: (feeds: string) =>
      `Ready database: ${feeds} from the Kilometr server. Download once, then offline.`,
    dlEmpty: 'No offline data.',
    dlSize: 'One download • a few minutes • then offline',
    dlProgress: (p: number) => `Downloading… ${p}%`,
    dlStep: (step: string, p: number) => `${step} ${p}%`,
    dlKeepOpen: 'Keep the app open while downloading.',
    dlDone: 'Timetable ready.',
    dlDoneSub: (stops: number, trips: number) => `${stops} stops • ${trips} trips.`,
    dlFail: 'Something went wrong',
    dlFailBody: (msg: string) => `${msg}. Check your connection and try again.`,
    saveFail: 'Could not save the place',
    saveFailBody: 'Please try again.',
    placesTitle: 'Where do you go most often?',
    placesBody: 'Saved places speed up searching. You can skip this step.',
    added: 'Added',
    removeSlotA11y: (name: string) => `Remove ${name}`,
    closeAction: 'Close',
    addAction: '+ Add',
    addressFor: (name: string) => `Address for: ${name}…`,
    noResults: (q: string) =>
      `No results for “${q}”. Stops are searched offline, addresses need internet.`,
    start: 'Set up Kilometr',
    next: 'Next',
    later: 'Later',
    footerRetry: 'Try again',
    footerDownloading: 'Downloading…',
    footerDownload: 'Download timetable',
    needTimetable: 'Without a timetable you can’t search connections.',
    doneCount: (n: number) => `Done (${n})`,
    donePlain: 'Done',
    skip: 'Skip for now',
    skipTimetable: 'Skip, I will download the timetable later',
  },
  news: {
    chip: 'Disruptions',
    fetchFail: 'Could not fetch news. Check your connection and try again.',
    title: 'News',
    sourceLoading: (feeds: string) => feeds,
    sourceEmpty: (combined: string) => combined,
    count: (n: number, urgent: number) => `${n} ${n === 1 ? 'item' : 'items'}${urgent > 0 ? ` • ${urgent} urgent` : ''}`,
    refreshA11y: 'Refresh news',
    loading: 'Fetching announcements…',
    noConnection: 'No connection',
    emptyTitle: 'No announcements',
    emptyBody: (name: string) =>
      `${name} has published no disruptions right now. Pull down to check again.`,
    sectionChanges: 'Line changes',
    sectionCity: 'News',
    sourceMpk: (operator: string) => operator,
    sourceCity: (portal: string) => portal,
    linesLabel: (lines: string) => `Lines ${lines}`,
    openBrowser: 'Open in browser',
    articleFail: 'Could not load this page.',
    articleEmpty: 'This page has no text the app can show.',
    filterAll: 'All',
    filterMyLines: 'My lines',
    filterMyLinesA11y: 'Show only updates for lines from your recent trips',
    filterEmptyTitle: 'Nothing on your lines',
    filterEmptyBody: 'No updates match the lines from trips you checked in the last two weeks.',
    filterNoHistoryTitle: 'No lines yet',
    filterNoHistoryBody:
      'Look up a connection in the app, then you will see updates for those lines here.',
  },
  newsSvc: {
    justNow: 'just now',
    minsAgo: (m: number) => `${m} min ago`,
    hoursAgo: (h: number) => (h === 1 ? '1 hour ago' : `${h} hours ago`),
    yesterday: 'yesterday',
    daysAgo: (d: number) => (d === 1 ? '1 day ago' : `${d} days ago`),
    untitled: '(untitled)',
  },
  map: {
    title: 'Route map',
    stagesTitle: 'Journey stages',
    showWholeRoute: 'Whole route',
    loadFail: 'Could not load the connection',
    loadFailBody:
      'The map shows a specific connection, so it must be available in memory or cache.',
    backToDetails: 'Back to details',
    assembling: 'Assembling connection…',
    offlineTitle: 'Map unavailable. Check your network connection.',
    offlineSub: 'Tiles are not loading',
    backA11y: 'Back',
    transfersSuffix: (n: number) => (n === 1 ? ' • 1 transfer.' : ` • ${n} transfers.`),
    delaySuffix: (d: number) => ` • ${d > 0 ? '+' : ''}${d} min`,
    walkPrefix: 'Walk ',
    walkStageA11y: (dist: string) => `Walking stage ${dist}`,
    lineStageA11y: (line: string, dir: string) => `Line ${line} towards ${dir}`,
    lineLabel: (line: string) => `Line ${line}`,
    legStops: (n: number) => (n === 1 ? '1 stop' : `${n} stops`),
    board: 'Board',
    alight: 'Alight',
    mapLoadFail: 'Could not load the map',
    maneuver: {
      depart: 'Head to the stop',
      straight: 'Go straight on',
      slightLeft: 'Bear left',
      left: 'Turn left',
      sharpLeft: 'Turn sharp left',
      slightRight: 'Bear right',
      right: 'Turn right',
      sharpRight: 'Turn sharp right',
      uturn: 'Turn back',
      board: 'Get on',
      alight: 'Get off',
      arrive: 'You have arrived',
      then: 'then',
      in: 'in',
      onStop: 'at the stop',
      detailA11y: (what: string, dist: string) => `${what}, ${dist}`,
    },
  },
  routes: {
    gpsAddress: 'Use current position',
    destFallback: 'Destination',
    trackUnsupportedTitle: 'Tracking unavailable',
    trackUnsupportedBody:
      'Notifications require a development build. Expo Go does not support them.',
    noConnectionsTitle: 'No connections',
    noConnectionsBody: 'Wait for a departure to appear on this route.',
    stopTrackingTripA11y: 'Stop tracking the trip',
    trackTrip: 'Track trip',
    stopTrackTrip: 'Stop',
    trackTripA11y: 'Track this trip',
    pinUnsupportedTitle: 'Pin unavailable',
    pinUnsupportedBody:
      'Pinned notifications require a development build. Expo Go does not support notifications.',
    notifOffTitle: 'Notifications off',
    notifOffBody: 'Allow notifications in system settings to pin a connection.',
    gpsFailTitle: 'Location error',
    gpsFailBody:
      'Could not get the current GPS position. Make sure location is enabled on your phone.',
    now: 'Now',
    title: (operator: string) => `${operator} connections`,
    sortFastestA11y: 'Sorting: arrival. Tap to switch to departure.',
    sortEarliestA11y: 'Sorting: departure. Tap to switch to arrival.',
    sortFastest: 'arrival',
    sortEarliest: 'departure',
    unpinA11y: 'Unpin connection',
    pinA11y: 'Pin the nearest connection',
    changeFromA11y: (t: string) => `Change start, currently ${t}`,
    changeFromAnchorA11y: (t: string, stop: string) =>
      `Change start, currently ${t}, departing from stop ${stop}`,
    dismissAnchorA11y: 'Remove stop anchoring and search from GPS',
    swapA11y: 'Reverse route: swap start and destination',
    changeToA11y: (t: string) => `Change destination, currently ${t}`,
    searching: 'Searching connections…',
    calcFail: 'Could not compute connections',
    noTimetable: 'No timetable',
    calcFailBody:
      'The planner computes routes on your phone. Try again. If it keeps failing, refresh the timetable in settings.',
    noTimetableBody:
      'The app computes routes on your phone from the full timetable. Without it there are no connections. Download it once, then it works offline.',
    downloadA11y: 'Download timetable',
    downloading: (p: number) => `Downloading… ${p}%`,
    downloadingStep: (step: string, p: number) => `${step} ${p}%`,
    downloadingPlain: 'Downloading…',
    downloadAction: 'Download timetable',
    countNearest: 'upcoming departures',
    countDepart: (label: string) => `departure ${label}`,
    countDirect: ' • direct only',
    countTram: ' • trams',
    countBus: ' • buses',
    earlierAction: 'Earlier connections',
    earlierLoading: 'Loading earlier connections…',
    earlierEmpty: 'No earlier connections for this day',
    earlierRetry: 'Could not load connections. Try again',
    offlineTapA11y: 'Latest cached data. Tap to refresh.',
    offlineChip: 'offline',
    noLiveChip: 'no live data',
    moreFail: 'Could not load more connections.',
    moreRetryA11y: 'Try loading more connections',
    noMore: 'These are all departures for this route.',
    noMoreArrival: 'No earlier connections in this window. Choose an earlier arrival time.',
    emptyArrival: 'No connections before the selected time. Try a later arrival time or another destination.',
    emptyFiltered: 'No connections for the selected filters',
    emptyNone: 'No connections found',
    emptyModeDirect: (veh: string) =>
      `There is no ${veh} service on this route right now without transfers. Loosen the filters or check another time.`,
    emptyDirect:
      'There is no direct service on this route right now. Turn off the “Direct only” filter to see connections with transfers, or check another time.',
    emptyMode: (veh: string) =>
      `There is no ${veh} service on this route right now. Switch to “All” to see the rest.`,
    emptyPlain: 'Try a different destination or check another departure time.',
    vehicleTramGen: 'by tram',
    vehicleBusGen: 'by bus',
    vehicleTrolleyGen: 'by trolleybus',
    vehicleTrainGen: 'by train',
    vehicleSubwayGen: 'by metro',
    vehicleCableGen: 'by cable car',
    showWithChangesA11y: 'Show connections with transfers',
    showWithChanges: 'Show with transfers',
    showAllVehiclesA11y: 'Show all vehicles',
    showAllVehicles: 'Show all vehicles',
  },
  routeDetails: {
    departure: 'Departure',
    vehicleDeparture: 'Vehicle departure',
    scheduledTime: (time: string) => `Scheduled ${time}`,
    estimatedDelay: (n: number) => `About +${n} min, estimated from other buses`,
    untrackedVehicle: 'No current position. Delays are possible.',
    uncertainTransfer: 'Short transfer. This bus has no confirmed delay.',
    walkDeparture: (time: string, place: string) => `Start walking at ${time}: ${place}`,
    arrival: 'Arrival',
    origin: 'From',
    destination: 'To',
    late: (n: number) => `${n} min late`,
    early: (n: number) => `${n} min early`,
    title: 'Connection details',
    loadFail: 'Could not load the connection.',
    backToList: 'Back to list',
    offlineNote: 'Saved offline. Timetable times, no live data.',
    noLiveNote: 'Timetable times. No live data.',
    onTime: 'On time',
    scheduleCache: 'Cached timetable',
    schedule: 'Timetable',
    noTrip: 'No route geometry',
    noTripBody:
      'This connection has no saved stops, so the route can’t be drawn and the nearest stop can’t be shown. Go back and pick another connection.',
    lineAlertsTitle: 'Updates on your lines',
    lineAlertsAll: 'All news',
    lineAlertsEmpty: 'No updates for the lines on this trip.',
    lineAlertsCount: (n: number) => (n === 1 ? '1 update' : `${n} updates`),
  },
  search: {
    suggestedPlaces: 'Suggested places',
    emptyTitle: 'Where to?',
    emptyHint: 'Enter a stop, address or place. Your choices will appear here.',
    errorTitle: 'Search failed',
    errorHint: 'Change your query and try again. Check that the city timetable is downloaded.',
    defaultPlaceholder: (city: string) => `Search in ${city}…`,
    originA11y: (t: string) => `Start: ${t}. Tap to change.`,
    fromPrefix: 'From:',
    change: 'Change',
    closeA11y: 'Close search',
    clearA11y: 'Clear query',
    resultsFor: (q: string, n: number) => `Results for “${q}” (${n})`,
    recentTrips: 'Recent trips',
    savedA11y: (t: string) => `Saved place: ${t}`,
    searching: (city: string) => `Searching ${city}…`,
    noResults: 'No results',
    noResultsHint: (id: string) =>
      `Try: ${id === 'krakow' ? '“rynek”, “grodzka”, “wawel”, “balice”' : id === 'gzm' ? '“katowice”, “gliwice”, “rynek”, “tychy”' : id === 'warszawa' ? '“metro”, “młociny”, “centralny”, “śródmieście”' : id === 'poznan' ? '“rynek”, “garbary”, “rondo”, “malta”' : id === 'trojmiasto' ? '“oliwa”, “wrzeszcz”, “orłowo”, “przymorze”' : id === 'lodz' ? '“piotrkowska”, “manufaktura”, “fabryczna”, “kaliska”' : id === 'szczecin' ? '“brama portowa”, “dąbie”, “police”, “pogodno”' : id === 'kielce' ? '“sienkiewicza”, “rynek”, “kadzielnia”, “herby”' : id === 'olsztyn' ? '“stare miasto”, “dworzec”, “jaroty”, “barczewo”' : id === 'bialystok' ? '“rynek kościuszki”, “lipowa”, “branicki”, “opera”' : id === 'opole' ? '“rynek”, “ozimska”, “solaris”, “dworzec”' : id === 'rzeszow' ? '“rynek”, “dworzec”, “rejtana”, “3 maja”' : id === 'lublin' ? '“krakowskie”, “zamek”, “felicity”, “świdnik”' : id === 'radom' ? '“żeromskiego”, “południe”, “gołębiów”, “idalin”' : '“arkady”, “biskupin”, “zoo”, “swojczycka”'}. Works without Polish characters and with typos too.`,
    noResultsFor: (q: string) => `Nothing matches “${q}”`,
    yourPlaces: 'Your places',
    gpsOutsideNotice: 'GPS is outside the city, pick a point manually.',
  },
  places: {
    editAction: 'Edit',
    editA11y: (name: string) => `Edit place: ${name}`,
    removeA11y: (name: string) => `Remove place: ${name}`,
    clearAnchorA11y: 'Remove assigned stop',
    manageTitle: 'Saved places',
    manageSub: 'Manage your quick trip destinations',
    emptyTitle: 'No saved places',
    emptyBody: 'Add home, work or favourite spots to check connections with one tap.',
    addNew: 'Add a new place',
    removeTitle: (name: string) => `Remove “${name}”?`,
    removeGeneric: 'Remove this place?',
    removeConfirm: 'Remove',
    iconCategories: {
      all: 'All',
      frequent: 'Frequent',
      transit: 'Travel',
      food: 'Food',
      health: 'Health',
      culture: 'Culture',
      sport: 'Sport',
      services: 'Services',
    },
    iconName: {
      home: 'Home',
      work: 'Work',
      school: 'School',
      university: 'University',
      gym: 'Gym',
      coffee: 'Café',
      shopping: 'Shop',
      star: 'Favourites',
      heart: 'Important',
      friends: 'Friends',
      train: 'Railway station',
      tram: 'Tram',
      bus: 'Bus',
      plane: 'Airport',
      bike: 'Bike',
      car: 'Car',
      fuel: 'Petrol station',
      ship: 'Ferry / Port',
      compass: 'Compass',
      restaurant: 'Restaurant',
      pizza: 'Pizzeria',
      sandwich: 'Bistro',
      beer: 'Pub / Beer',
      wine: 'Bar / Wine',
      market: 'Market',
      cart: 'Supermarket',
      pharmacy: 'Pharmacy',
      hospital: 'Hospital',
      doctor: 'Clinic',
      scissors: 'Hairdresser',
      sparkles: 'Beauty / Spa',
      cinema: 'Cinema',
      theater: 'Theatre',
      culture: 'Museum',
      library: 'Library',
      music: 'Music',
      ticket: 'Event',
      gamepad: 'Entertainment',
      park: 'Park',
      mountain: 'Mountains',
      tent: 'Camping',
      trophy: 'Stadium',
      swimming: 'Pool / Beach',
      church: 'Church',
      baby: 'Kindergarten',
      pet: 'Pet',
      hotel: 'Hotel',
      bank: 'Bank / ATM',
      post: 'Post / Parcel',
      laptop: 'Coworking',
      mapPin: 'Other',
      plus: 'Other',
    },
    chooseIcon: 'Choose an icon',
    iconFor: (name: string) => `Icon for: ${name}`,
    iconForFallback: 'this place',
    searchIcon: 'Search icons (e.g. train, coffee, doctor)…',
    anchorTitle: 'Anchor stop',
    anchorFor: (name: string) => `Choose the departure stop for: ${name}`,
    searchStop: 'Search stops…',
    nearStops: 'Nearest stops around the selected address:',
    typeStopAbove: 'Type a stop name above to search.',
    metersAway: (m: number) => `${m} m from the selected place`,
    choose: 'Choose',
    editPlace: 'Edit place',
    newPlace: 'New saved place',
    chooseTarget: 'Choose a destination address or stop',
    editHint: 'Change the name, icon or address',
    newHint: 'Pick a destination and add it to quick routes',
    nameLabel: 'Place name',
    nameHint: 'e.g. Home, University, Work, Gym',
    moreIcons: (n: number) => `More icons (${n}) ›`,
    moreIconsShort: '+ More...',
    addressLabel: 'Destination address or stop',
    changeBtn: 'Change',
    queryHint: 'Type a street, stop or venue…',
    anchorOptional: 'Preferred stop (optional)',
    anchorHint: 'Departures from this stop when you’re nearby',
    assignAnchor: '+ Assign a departure stop',
    saveChanges: 'Save changes',
    savePlace: 'Save place',
  },
  timeSheet: {
    title: 'Journey time',
    modeDeparture: 'Depart at',
    modeArrival: 'Arrive by',
    selectedArrival: (day: string, hh: string, mm: string) => `Arrive by: ${day}, ${hh}:${mm}`,
    confirmAction: 'Show connections',
    selectedDeparture: (day: string, hh: string, mm: string) => `${day}, ${hh}:${mm}`,
    minutePreset: (mm: string) => `Set minute to ${mm}`,
    dayToday: 'Today',
    dayTomorrow: 'Tomorrow',
    hourLabel: 'hour',
    minuteLabel: 'minute',
    confirmNow: 'Search from now',
    confirmDepart: (day: string, hh: string, mm: string) => `Apply: ${day}, ${hh}:${mm}`,
    pastWarning: 'The selected time has already passed',
    switchTomorrow: 'Switch to tomorrow',
  },
  routesBar: {
    modeTram: 'Tram',
    modeBus: 'Bus',
    modeAll: 'Vehicles',
    modeTramA11y: 'Trams',
    modeBusA11y: 'Buses',
    modeAllA11y: 'All vehicles',
    reverse: 'Reverse',
    reverseA11y: 'Reverse route: swap start and destination',
    direct: 'Direct',
    directOnA11y: 'Direct-only filter: on. Tap to show all.',
    directOffA11y: 'Direct-only filter: off. Tap to turn on.',
    modeFilterA11y: (cur: string) => `Filter transport: currently ${cur}. Tap to change.`,
    timeA11y: (label: string) => `Departure time: ${label}. Tap to change.`,
    timeArrivalA11y: (label: string) => `Arrival time: ${label}. Tap to change.`,
    arrivalShort: (time: string) => `by ${time}`,
  },
  connection: {
    previewTitle: 'Journey preview',
    previewHint: 'Touch and hold to preview this journey.',
    previewSwipe: 'Slide up to open journey details',
    previewRelease: 'Release to open journey details',
    previewOpen: 'Open journey details',
    transfers: (n: number) => (n <= 0 ? 'direct' : n === 1 ? '1 transfer' : `${n} transfers`),
    connections: (n: number) => (n === 1 ? '1 connection' : `${n} connections`),
    walkAll: 'all on foot',
    walkLeg: 'on foot',
    cardA11y: (
      dep: string,
      dur: number,
      depAt: string,
      arrAt: string,
      via: string,
      lines: string,
    ) =>
      `${dep}, ride time ${dur} min, departure ${depAt}, arrival ${arrAt}, ${via}${lines ? `, lines ${lines}` : ''}`,
    walkRoute: 'walking route',
  },
  vehiclePos: {
    noRoute: 'No route data',
    liveBetween: (from: string, to: string) => `Vehicle: ${from} → ${to} • live`,
    liveBefore: (stop: string) => `Vehicle: before ${stop} • live`,
    liveAt: (stop: string) => `Vehicle: ${stop} • live`,
    liveNear: (stop: string) => `Vehicle: near ${stop} • live`,
    estRoute: (from: string, to: string) => `Estimated position: ${from} → ${to}`,
    estBefore: (at: string) => `Before departure (${at}) • estimated position`,
    estDone: 'Trip finished • estimated position',
    estBetween: (from: string, to: string) => `Vehicle (est.): ${from} → ${to}`,
  },
  leg: {
    fareBoundary: 'Fare zone boundary',
    fareBoundaryDetail: (areas: string, point: string) => point ? `${areas} · ${point}` : areas,
    noData: 'No route data',
    expandA11y: (line: string, dir: string, expanded: boolean) =>
      `${line} towards ${dir}. ${expanded ? 'Collapse' : 'Expand'} the stop list.`,
    vehicleBetween: (mode: string, from: string, to: string) => `${mode} between ${from} and ${to}`,
    vehicleFarBack: 'Vehicle is further back on the route',
    vehicleNotStarted: 'This run has not started yet',
    fromPrefix: 'from ',
    toPrefix: 'to ',
    stopsSummary: (n: number, mins: number, open: boolean) =>
      `${n} ${n === 1 ? 'stop' : 'stops'} • ~${mins} min • ${open ? 'collapse' : 'expand'} stops`,
  },
  compass: {
    fullscreen: 'Full screen navigation',
    closeFullscreen: 'Close full screen',
    recenter: 'Resume following',
    following: 'Following your position',
    northUp: 'Keep north at the top',
    compassUp: 'Rotate the map with your phone',
    routeOverview: 'Show this leg',
    compassAccuracyLow: 'Low compass accuracy',
    calibrationHelp: 'How to improve accuracy',
    calibrateCompass: 'Move your phone away from metal and magnets, such as a phone mount. Slowly move it in a figure eight a few times. This message will disappear when accuracy improves.',
    gpsWeak: 'Weak GPS signal. Your position may be inaccurate.',
    deviceGps: 'Your GPS position',
    prepareToAlight: 'Get ready to get off',
    boarded: 'I am on board',
    alighted: 'I got off. Show the way',
    undoAlight: 'Undo. I am still riding',
    rideProgress: 'Ride progress',
    journeyTitle: 'Journey navigation',
    riding: 'Ride to your alighting stop',
    transferWalk: 'Walk to your transfer',
    headToDestination: 'Walk to your destination',
    navToDestination: (dist: string) => `${dist} to your destination`,
    nextStopAt: (name: string) => `Next stop: ${name}`,
    rideTo: (name: string) => `Ride to: ${name}`,
    waitForDeparture: (time: string) => `Wait for departure at ${time}`,
    journeyArrived: 'You have arrived',
    vehicleGps: 'Vehicle GPS position',
    vehicleGpsMissing: 'No recent vehicle GPS position. The route is still visible.',
    alightAt: (name: string) => `Get off at: ${name}`,
    boardAt: (name: string) => `Board at: ${name}`,
    stopsRemaining: (n: number) => `${n} ${n === 1 ? 'stop' : 'stops'} until you get off`,
    mapLoading: 'Loading map…',
    mapFailed: 'Could not load the map. Try again or download an offline map in settings.',
    mapRetry: 'Reload map',
    openMap: 'Open the full route map',
    ahead: 'Straight ahead',
    slightRight: 'Slightly right',
    right: 'On your right',
    backRight: 'Behind you on the right',
    back: 'Behind you',
    backLeft: 'Behind you on the left',
    left: 'On your left',
    slightLeft: 'Slightly left',
    noCoords: 'This stop has no coordinates in the timetable.',
    locOff: 'Location is off. Without it I can’t show the direction to the stop.',
    locWaiting: 'No position yet. Wait for GPS or open the full map.',
    title: 'Stop navigation',
    followCompass: 'Step-by-step walking directions',
    directionPrefix: (d: string) => `towards ${d}`,
    straight: 'as the crow flies',
    distanceText: (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`),
    walkMins: (m: number) => `~${m} min on foot`,
    headToStop: 'Head toward the stop',
    nextStop: 'Next stop',
    navToStop: (dist: string) => `${dist} to the stop`,
    navA11y: (what: string, dist: string) => `${what}, ${dist}. Tap to open the full map.`,
    rerouting: 'Finding a new route',
    openSettingsA11y: 'Open app settings',
    enableLoc: 'Enable location in settings',
  },
  lastTrip: {
    backA11y: (from: string, to: string) => `Quick return: ${from} to ${to}. Release to search.`,
    lastA11y: (from: string, to: string) =>
      `Last connection: ${from} to ${to}. Pull further to reverse.`,
    pullHint: 'Last searched connection.\nRelease to search',
    pullHintBack: 'Way back.\nRelease to search',
  },
  suggestion: {
    stopFallback: 'Stop',
  },
  data: {
    stepUnpack: 'Unpacking…',
    stepStops: 'Stops…',
    stepLines: 'Lines…',
    stepCalendar: 'Calendar…',
    stepTrips: 'Trips…',
    stepTimes: 'Departure times…',
    stepTimesK: (k: number) => `Departure times… (${k}k)`,
    stepIndex: 'Building indexes…',
    stepWeights: 'Stop weights…',
    stepDb: 'Downloading database…',
    stepVerify: 'Verifying…',
    errStops: 'Missing stops.txt in GTFS archive',
    errTrips: 'Missing trips.txt in GTFS archive',
    errTimes: 'Missing stop_times.txt in GTFS archive',
    prepareFail: 'Could not prepare the timetable',
    retryHint: 'Tap to retry.',
  },
  downloader: {
    noNet: 'No internet connection',
    timeout: 'Download took too long',
    noSpace: 'Not enough space on the phone',
    unavailable: 'Timetable temporarily unavailable',
    failed: 'Could not download the timetable',
    hintRetry: 'Check your connection and tap to retry.',
    hintTouch: 'Tap to retry.',
    hintSpace: 'Free some space and tap to retry.',
    hintLater: 'Try again later.',
    noFile: 'GTFS download returned no file',
  },
  notification: {
    channelTracking: 'Trip tracking',
    channelTrackingDesc: 'Silent trip progress and countdown to departure or arrival.',
    channelAlerts: 'Trip updates',
    channelAlertsDesc: 'Delays, service changes and arrival.',
    permDenied:
      'Notifications are off. Enable them in your system settings for kilometr to track departures and trip progress.',
    actionStop: 'Stop',
    actionRoute: 'Route',
    showRoutes: 'Show route',
    actionOk: 'OK',
    modeWalk: 'Walk',
    modeTram: 'Tram',
    modeBus: 'Bus',
    modeTrain: 'Train',
    modeSubway: 'Metro',
    modeCable: 'Cable car',
    modeTrolleybus: 'Trolleybus',
    departTitle: (service: string, at: string) => `${service} • departs ${at}`,
    rideTitle: (service: string, at: string) => `${service} • arrives ${at}`,
    transferTitle: (service: string, at: string) => `Change • ${service} • departs ${at}`,
    arrivedTitle: "You're there",
    arrivedBody: (at: string, dur: string) => `Arrived ${at} • trip took ${dur}`,
    nextStop: (name: string) => `next ${name}`,
    estimatedNextStop: (name: string) => `Estimated next stop: ${name}`,
    stopHere: (name: string) => `stop ${name}`,
    alightAt: (name: string) => `Get off at ${name}`,
    directionTo: (dir: string) => `Towards ${dir}`,
    platform: (num: string) => `platform ${num}`,
    walkApproach: (min: number) => `~${min} min walk`,
    rideLength: (min: number) => `${min} min ride`,
    departAt: (at: string) => `departs ${at}`,
    arriveAt: (at: string) => `arrives ${at}`,
    delayLate: (min: number) => `delayed +${Math.round(min)} min`,
    delayEarly: (min: number) => `${Math.abs(Math.round(min))} min early`,
    stops: (n: number) => `${n} ${n === 1 ? 'stop' : 'stops'}`,
    transfers: (n: number) => `${n} ${n === 1 ? 'change' : 'changes'}`,
    newDeparture: (at: string) => `new departure ${at}`,
    delayTitle: (line: string, eta: string) => `Delayed • ${line} • ${eta}`,
  },
  ios: {
    departure: 'Departure',
    arrival: 'Arrival',
    alighting: 'Get off',
    walking: 'Walking',
    waiting: 'Waiting',
    riding: 'On the way',
    transfer: 'Transfer',
    nextStop: 'Next stop',
    startupTitle: 'App error',
    startupHint: 'Kilometr cannot continue. Share the report to help find the cause of the error.',
    startupShare: 'Share',
    locationPermission: 'Allow location access to find journeys from your position.',
    liveTitle: 'Live Activity',
    liveHint: 'Journey time on the Lock Screen and Dynamic Island. Data updates while the app is active.',
    liveDisabled: 'Enable Live Activities in the system settings for Kilometr.',
    stale: 'Scheduled time. Open Kilometr to update.',
    alarmHint: 'A reminder with a notification sound. Silent mode and Focus may silence it. It does not open a full-screen alarm.',
  },
  alarm: {
    title: 'Trip alarm',
    set: 'Set an alarm',
    edit: 'Edit alarm',
    hint: 'Sound, vibration and a full screen before you leave.',
    question: 'How much time do you need before leaving?',
    before: 'before leaving',
    minutes: (n: number) => n === 1 ? 'minute' : 'minutes',
    lead: (n: number) => `${n} ${n === 1 ? 'minute' : 'minutes'} before leaving`,
    less: 'One minute later',
    more: 'One minute earlier',
    ringsAt: (time: string) => `Rings at ${time}`,
    journeyAt: (time: string) => `Leave at ${time}`,
    boarding: (line: string, time: string, stop: string) => `${line} • ${time} • ${stop}`,
    save: 'Turn on alarm',
    saving: 'Setting alarm…',
    remove: 'Remove alarm',
    ringTitle: 'Time to get ready',
    dismiss: 'Dismiss alarm',
    showRoute: 'Show connection',
    channel: 'Trip alarms',
    channelDescription: 'Full-screen alarms set for a specific connection.',
    unavailable: 'Install the current Kilometr app to set a reminder.',
    tooLate: 'This time has passed. Choose fewer minutes before leaving.',
    past: 'This trip has already started.',
    error: 'Could not set the alarm. Please try again.',
    replace: 'This alarm will replace the one set for another trip.',
    exactHint: 'Allow alarms and reminders so your alarm rings at the chosen time.',
    exactAction: 'Allow alarms',
    fullScreenHint: 'Allow full-screen alarms to show the alarm on your locked phone.',
    fullScreenAction: 'Allow full screen',
    notificationHint: 'Enable alarm notifications so your phone can display the alarm.',
    notificationAction: 'Enable notifications',
    soundHint: 'Uses the alarm sound and volume from your phone settings.',
  },
  notificationPrefs: {
    title: 'Notifications',
    devBuildWarn: 'Requires a development build. Notifications do not work in Expo Go.',
    unsupportedTitle: 'Notifications unavailable',
    unsupportedBody:
      'Trip tracking needs a development build. Expo Go does not support notifications.',
    trackTitle: 'Trip tracking',
    trackHint: 'A notification with your current trip phase and connection details.',
    liveTitle: 'Progress and timer',
    liveHint: 'The system updates the route bar and timer while the app is closed.',
    liveHintBasic:
      'This build does not support live progress. The notification still shows your trip phase and connection details.',
    livePromoteHint:
      'The system is not showing this notification in Live Updates. Allow Live Updates in kilometr notification settings.',
    openNotificationSettings: 'Open notification settings',
    alertsTitle: 'Alerts',
    disruptionTitle: 'Delay warning',
    disruptionHint: 'When the service is running clearly later than it reported before.',
    on: 'On',
    off: 'Off',
  },
  pinned: {
    channel: 'Pinned connection',
    nowText: 'departing now',
    inMin: (m: number) => `in ${m} min`,
    tram: 'Tram',
    bus: 'Bus',
    titleLine: (mode: string, line: string, time: string) => `${mode} ${line} • ${time}`,
    titlePlain: (time: string) => `Connection • ${time}`,
  },
  widgets: {
    journeyTitle: 'Your destinations',
    journeyDescription: 'When to leave and which lines to take to saved and recent destinations',
    trackingTitle: 'Your trip',
    openApp: 'Find a route in Kilometr',
    addPlace: 'Add a place',
    refresh: 'Refresh in the app',
    fromOrigin: (name: string) => `From: ${name}`,
    picker: {
      tripDescription: 'Time until departure or arrival, progress and transfers',
      searchTitle: 'Where to?',
      searchDescription: 'Find a route or take a shortcut to a saved place',
      placesTitle: 'My places',
      placesDescription: 'Find a route from your current location with one tap',
    },
    preview: { home: 'Home', work: 'Work', gym: 'Gym', school: 'School', origin: 'City centre' },
    checkRoutes: 'Find connections',
    early: (n: string) => `-${n} min`,
    now: 'now',
    min: 'min',
    onTime: 'On time',
    timetable: 'Timetable',
    late: (n: string) => `+${n} min`,
    departAt: (t: string) => `leave ${t}`,
    departIn: (n: string) => `Leave in ${n} min`,
    departNow: 'Time to leave',
    arriveIn: (n: string) => `arrives in ${n} min`,
    arrived: 'Arrived',
    updated: (t: string) => `as of ${t}`,
    stale: 'Find the next connection',
    destEmpty: 'Search for a route to see it here.',
    tripEmptyTitle: 'No trip tracked',
    tripEmptyBody: 'Choose a connection and turn on tracking.',
    placesEmpty: 'Add your first place',
    search: 'Where to?',
  },
};
