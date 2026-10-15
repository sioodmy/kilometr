// Polski słownik — WZORZEC typów dla pozostałych języków.
// `Strings = typeof pl`: brak klucza w en/de/uk = błąd kompilacji.
// Zasady (patrz AGENTS.md): zero hardkodu PL w UI, liczby mnogie jako funkcje.
function isFew(n: number): boolean {
  const last = n % 10;
  const teen = n % 100;
  return last >= 2 && last <= 4 && (teen < 12 || teen > 14);
}

export const pl = {
  common: {
    retry: 'Spróbuj ponownie',
    cancel: 'Anuluj',
    close: 'Zamknij',
    no: 'Nie',
    yesRemove: 'Tak, usuń',
    now: 'Teraz',
    today: 'Dziś',
    tomorrow: 'Jutro',
    todayLong: 'Dzisiaj',
    tomorrowLong: 'Jutro',
    todayLower: 'dziś',
    tomorrowLower: 'jutro',
    durMin: (n: number) => `${n} min`,
    departIn: (n: number) => `za ${n} min`,
    departNow: 'za chwilę',
    departAgo: (n: number) => `${n} min temu`,
    departJustAgo: 'przed chwilą',
    lessThan10m: '< 10 m',
    kmh: (v: string) => `${v} km/h`,
    add15: '+15 min',
    add30: '+30 min',
    add60: '+1 godz.',
  },
  home: {
    title: 'Gdzie jedziemy?',
    newsA11y: 'Aktualności',
    newsAlertA11y: 'Aktualności: nowe utrudnienia',
    searchLabel: 'Dokąd jedziesz?',
    searchA11y: 'Szukaj adresu, przystanku lub miejsca',
    startCustomA11y: (t: string) => `Początek trasy: ${t}. Dotknij, aby zmienić.`,
    startGpsA11y: (t: string) => `Lokalizacja: ${t}. Dotknij, aby zmienić miejsce początkowe.`,
    startFrom: (t: string) => `z: ${t}`,
    resetStartA11y: 'Przywróć bieżącą lokalizację GPS',
    savedTitle: 'Zapisane miejsca',
    editSavedA11y: 'Edytuj zapisane miejsca',
    editCard: 'Edytuj',
    editCardSub: 'zapisane miejsca',
    historyTitle: 'Ostatnie miejsca',
    historyEmptyTitle: 'Brak ostatnich miejsc',
    historyEmptyBody: 'Wyszukaj połączenie, a zapisze się tutaj jako szybki cel.',
    historyEmptyAction: 'Szukaj połączenia',
    openConnA11y: (title: string, label: string) => `Otwórz połączenie do ${title}, ${label}`,
    gpsTitle: 'Moja lokalizacja (GPS)',
    locationFallback: 'Twoja lokalizacja',
    gpsAddressHome: 'Bieżąca pozycja urządzenia',
    importingTitle: (gen: string) => `Pobieranie rozkładu ${gen}…`,
    importErrorTitle: 'Błąd pobierania rozkładu',
    importErrorRetry: 'Dotknij, aby spróbować ponowić.',
    saveFailTitle: 'Brak połączenia z bazą',
    saveFailBody: 'Nie udało się zapisać miejsca. Spróbuj ponownie.',
    searchPlaceholderTo: 'Dokąd jedziesz?',
    searchPlaceholderFrom: 'Skąd wyruszasz?',
    unsupportedTitle: 'Nieobsługiwane miasto',
    unsupportedTitleOther: 'Inne miasto w aplikacji',
    unsupportedBody: (city: string, supported: string) =>
      `Twoja lokalizacja GPS wskazuje na ${city}. Aktualnie obsługujemy tylko: ${supported}.`,
    unsupportedBodyOther: (city: string, active: string) =>
      `Jesteś w ${city}, a aplikacja jest ustawiona na ${active}. Zmień miasto w Ustawieniach.`,
    unsupportedBodyUnknown: (supported: string) =>
      `Twoja lokalizacja GPS jest poza obsługiwanym obszarem. Aktualnie obsługujemy tylko: ${supported}.`,
    unsupportedHint: 'Wybierz punkt startowy manualnie, aby wyszukać połączenie.',
    unsupportedAction: 'Wybierz punkt startowy',
    pickStart: 'Wybierz punkt startowy',
    gpsBlockedTitle: 'Start z GPS niedostępny',
    gpsBlockedBody: (city: string, supported: string) =>
      `Jesteś poza strefą ${supported} (${city}), więc trasy z GPS nie zadziałają. Wybierz punkt startowy manualnie.`,
    gpsBlockedBodyUnknown: (supported: string) =>
      `Jesteś poza strefą ${supported}, więc trasy z GPS nie zadziałają. Wybierz punkt startowy manualnie.`,
  },
  city: {
    section: 'Miasto',
    settingsTitle: 'Miasto',
    settingsHint:
      'Rozkład, mapa offline i aktualności idą za miastem. Dane drugiego miasta zostają na telefonie.',
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
                    : 'Wrocław',
    gen: (id: string): string =>
      id === 'krakow'
        ? 'Krakowa'
        : id === 'gzm'
          ? 'GZM'
          : id === 'warszawa'
            ? 'Warszawy'
            : id === 'poznan'
              ? 'Poznania'
              : id === 'trojmiasto'
                ? 'Trójmiasta'
                : id === 'lodz'
                  ? 'Łodzi'
                  : id === 'szczecin'
                    ? 'Szczecina'
                    : 'Wrocławia',
    loc: (id: string): string =>
      id === 'krakow'
        ? 'Krakowie'
        : id === 'gzm'
          ? 'GZM'
          : id === 'warszawa'
            ? 'Warszawie'
            : id === 'poznan'
              ? 'Poznaniu'
              : id === 'trojmiasto'
                ? 'Trójmieście'
                : id === 'lodz'
                  ? 'Łodzi'
                  : id === 'szczecin'
                    ? 'Szczecinie'
                    : 'Wrocławiu',
    feeds: (id: string): string =>
      id === 'krakow'
        ? 'ZTP i Koleje Małopolskie'
        : id === 'gzm'
          ? 'ZTM, Koleje Śląskie, POLREGIO i PKP Intercity'
          : id === 'warszawa'
            ? 'WTP, SKA, Koleje Mazowieckie i WKD'
            : id === 'poznan'
              ? 'ZTM i Koleje Wielkopolskie'
              : id === 'trojmiasto'
                ? 'ZTM Gdańsk, ZKM Gdynia i SKM'
                : id === 'lodz'
                  ? 'MPK i Łódzka Kolej Aglomeracyjna'
                  : id === 'szczecin'
                    ? 'ZDiTM Szczecin'
                    : 'MPK i Koleje Dolnośląskie',
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
                    : 'wroclaw.pl',
    supportedList: 'Wrocław, Kraków, GZM, Warszawa, Poznań, Trójmiasto, Łódź, Szczecin',
    changed: (name: string) => `Przełączono na: ${name}.`,
    switching: 'Przełączam miasto…',
    blockedByDownload: 'Pobieranie rozkładu w toku. Miasto zmienisz po zakończeniu.',
    needDownload: 'To miasto nie ma jeszcze rozkładu na telefonie. Pobierz go poniżej.',
    changeAction: 'Zmień',
    selectTitle: 'Wybierz miasto',
    selectSub: 'Wybierz aglomerację, w której chcesz planować podróże.',
    searchPlaceholder: 'Szukaj miasta lub przewoźnika…',
    noSearchResults: (q: string) => `Brak miast dla „${q}”`,
    searchEmptyHint: 'Sprawdź pisownię lub spróbuj wyszukać inną aglomerację.',
    searchClearA11y: 'Wyczyść wyszukiwanie',
    closeSheetA11y: 'Zamknij wybór miasta',
    cityActiveBadge: 'Aktywne',
  },
  settings: {
    title: 'Ustawienia',
    resetA11y: 'Przywróć domyślne',
    sectionSupport: 'Wsparcie',
    supportTitle: 'Wesprzyj projekt',
    supportHint: 'Kilometr jest darmowy. Kawą na Ko-fi pomagasz w dalszym rozwoju.',
    supportButton: 'Otwórz Ko-fi',
    supportA11y: 'Otwórz stronę Ko-fi w przeglądarce',
    sectionOffline: 'Offline',
    sectionApp: 'Aplikacja',
    sectionRoute: 'Trasa',
    sectionTransport: 'Transport',
    sectionData: 'Twoje dane',
    advancedShow: 'Zaawansowane',
    advancedHide: 'Ukryj zaawansowane',
    notificationsSection: 'Powiadomienia',
    notificationsFoot:
      'Powiadomienia działają w buildzie deweloperskim. Expo Go ich nie obsługuje.',
    offlineMapTitle: (name: string) => `Mapa offline (${name})`,
    offlineMapHint: (name: string, mb: number) =>
      `Pobierz kafle mapy ${name} (ok. ${mb} MB), żeby trasa działała bez internetu.`,
    offlineMapReady: (name: string) =>
      `Mapa ${name} jest na telefonie. Trasa działa bez internetu.`,
    offlineMapDownload: 'Pobierz mapę',
    offlineMapDownloadA11y: (name: string) => `Pobierz mapę ${name} do trybu offline`,
    offlineMapDownloading: (pct: number) => `Pobieram… ${pct}%`,
    offlineMapStepTiles: (name: string) => `kafle ${name}`,
    offlineMapStepDone: 'gotowe',
    offlineMapDelete: 'Usuń',
    offlineMapDeleteA11y: 'Usuń mapę offline',
    offlineMapDeleteTitle: 'Usunąć mapę offline?',
    offlineMapDeleteBody: (mb: number) =>
      `Zwolni się około ${mb} MB. Mapa nadal będzie działać online. Ponowne pobranie będzie możliwe dopiero za miesiąc.`,
    offlineMapFailTitle: 'Nie udało się pobrać mapy',
    offlineMapFailBody: 'Sprawdź połączenie i spróbuj ponownie. Reszta aplikacji działa normalnie.',
    offlineMapCooldownTitle: 'Mapa już była pobierana',
    offlineMapCooldownBody: (days: number) =>
      days <= 1
        ? 'Ponowne pobranie mapy będzie możliwe jutro. Raz pobrana starczy na długo.'
        : `Ponowne pobranie mapy będzie możliwe za ${days} dni. Raz pobrana starczy na długo.`,
    backupTitle: 'Twoje dane',
    backupHint:
      'Zapisane miejsca, ostatnie przejazdy i ustawienia w jednym pliku. Wyeksportuj przed zmianą telefonu albo zrób kopię na wszelki wypadek.',
    backupExcludeHint: 'Rozkład, cache i dane o śledzeniu kursu pozostają na urządzeniu.',
    backupExport: 'Eksportuj do pliku',
    backupImport: 'Wczytaj z pliku',
    backupExportA11y: 'Eksportuj swoje dane do pliku',
    backupImportA11y: 'Wczytaj dane z pliku',
    backupEmpty: 'Nie ma jeszcze nic do zapisania.',
    backupCurrent: (places: number, routes: number, trips: number) =>
      `${places === 1 ? 'miejsce' : isFew(places) ? `${places} miejsca` : `${places} miejsc`} • ` +
      `${routes === 1 ? 'zapisana trasa' : isFew(routes) ? `${routes} zapisane trasy` : `${routes} zapisanych tras`} • ` +
      `${trips === 1 ? 'przejazd' : isFew(trips) ? `${trips} przejazdy` : `${trips} przejazdów`}`,
    backupExportDoneTitle: 'Gotowe',
    backupExportDoneBody: (path: string) => `Plik zapisany w ${path}`,
    backupExportFailTitle: 'Nie udało się zapisać pliku',
    backupExportFailBody: (reason: string) =>
      `${reason}. Sprawdź wolne miejsce i spróbuj ponownie.`,
    backupExportFailFallback: 'Spróbuj ponownie za chwilę.',
    backupImportConfirmTitle: 'Wczytać te dane?',
    backupImportConfirmBody: (summary: string) =>
      `${summary}\n\nZapisane miejsca i przejazdy zostaną scalone z obecnymi — nic nie zniknie. Ustawienia zostaną nadpisane.`,
    backupImportAction: 'Wczytaj',
    backupImportCancel: 'Anuluj',
    backupImportDoneTitle: 'Dane wczytane',
    backupImportDoneBody: (summary: string) => `Scalono: ${summary}`,
    backupImportNothing: 'Ta kopia nie zawiera Twoich danych.',
    backupFailNoFile: 'Nie znaleziono pliku.',
    backupFailUnreadable: 'Nie udało się odczytać pliku.',
    backupFailNotBackup: 'To nie jest kopia zapasowa Kilometr.',
    backupFailSchemaTooNew: 'Ta kopia jest z nowszej wersji aplikacji.',
    dataTitle: (operator: string) => `Rozkład ${operator}`,
    dataHint: (feeds: string) =>
      `Rozkłady z serwera Kilometr: ${feeds}. Jedno pobranie, potem offline.`,
    dataEmpty: 'Brak danych offline.',
    dataDownloading: (p: number) => `Pobieranie… ${p}%`,
    dataStep: (step: string, p: number) => `${step} ${p}%`,
    dataReady: (stops: number, trips: number) =>
      `Pełny rozkład: ${stops} przystanków, ${trips} kursów`,
    dataError: (msg: string) => `Błąd: ${msg}`,
    downloadA11y: 'Pobierz rozkład',
    downloadCheckA11y: 'Sprawdź, czy jest nowszy rozkład',
    downloadReady: 'Sprawdź aktualizacje',
    downloadEmpty: 'Pobierz pełny rozkład',
    downloadFailTitle: 'Nie udało się pobrać rozkładu',
    downloadFailBody: (reason: string) =>
      `${reason}. Aplikacja pobiera gotową bazę z serwera Kilometr albo klasycznie z otwartych danych miasta.`,
    downloadFailFallback: 'Spróbuj ponownie za chwilę.',
    downloadDone: 'Rozkład odświeżony.',
    downloadUpToDate: 'Rozkład jest już aktualny.',
    downloadKeptLocal:
      'Nie udało się pobrać nowej wersji. Zostaje ta, która już jest na telefonie.',
    downloadCooldown: (hours: number) =>
      hours <= 1
        ? 'Rozkład był niedawno pobrany. Kolejne pełne pobranie będzie możliwe za około godzinę.'
        : `Rozkład był niedawno pobrany. Kolejne pełne pobranie będzie możliwe za ${hours} h.`,
    diagTitle: 'Diagnostyka danych',
    diagHint: 'Sprawdza bazę rozkładu na telefonie. Skopiuj wynik, gdy zgłaszasz problem.',
    diagRun: 'Sprawdź dane',
    diagRerun: 'Sprawdź ponownie',
    diagRunning: 'Sprawdzam…',
    diagRunA11y: 'Uruchom diagnostykę danych',
    diagOk: 'OK',
    diagWarn: 'Ostrzeżenie',
    diagError: 'Błąd',
    diagDb: 'Baza SQLite',
    diagDbDamaged: 'Baza jest uszkodzona',
    diagDbSize: (mb: string) => `Rozmiar bazy: ${mb} MB`,
    diagDbOrphan: (name: string) => `Zalega plik tymczasowy: ${name}`,
    diagDbWal: (mb: string) => `WAL: ${mb} MB`,
    diagDbNoAccess: 'Brak dostępu do pliku bazy',
    diagCounts: 'Liczniki rozkładu',
    diagCountsLine: (stops: number, routes: number, trips: number, times: number) =>
      `${stops} przystanków • ${routes} linii • ${trips} kursów • ${times} odjazdów`,
    diagCountsEmpty: 'Baza jest pusta. Pobierz rozkład poniżej.',
    diagCountsNoRoutes: 'Brak linii w bazie',
    diagTrains: 'Pociągi regionalne',
    diagTrainsLine: (n: number) =>
      n === 1 ? '1 trasa kolejowa' : isFew(n) ? `${n} trasy kolejowe` : `${n} tras kolejowych`,
    diagTrainsNone: 'Brak tras kolejowych. Pobierz nowszy rozkład.',
    diagCalendar: 'Kalendarz GTFS',
    diagCalendarLine: (from: string, to: string) => `Rozkład ważny ${from} – ${to}`,
    diagCalendarEmpty: 'Brak kalendarza w bazie',
    diagCalendarOutside: 'Dzisiejsza data wypada poza rozkładem',
    diagCalendarExpiring: (days: number) =>
      days <= 1 ? 'Rozkład wygasa jutro' : `Rozkład wygasa za ${days} dni`,
    diagCalendarServices: (n: number) => `Aktywne serwisy dziś: ${n}`,
    diagSearch: 'Wyszukiwarka',
    diagSearchOk: (weighted: number, pois: number) =>
      `Ranking gotowy (${weighted} przystanków) • POI: ${pois}`,
    diagSearchWeights: 'Ranking podpowiedzi nieprzeliczony',
    diagSearchPois: 'Brak punktów POI. Adresy wymagają internetu.',
    diagCopy: 'Kopiuj raport',
    diagCopyA11y: 'Kopiuj raport diagnostyczny do schowka',
    diagCopied: 'Raport skopiowany do schowka',
    diagCopyFail: 'Nie udało się skopiować raportu',
    diagFix: 'Pobierz rozkład ponownie',
    diagFixA11y: 'Wymuś ponowne pobranie rozkładu',
    diagReportCity: 'Miasto',
    diagReportTimetable: 'Rozkład',
    diagReportImported: 'Pobrano',
    diagReportDb: 'Baza',
    diagReportUnknown: 'brak',
    routeStyleTitle: 'Styl trasy',
    routeStyleHint:
      'Decyduje, co wygrywa, gdy trasy różnią się o kilka minut: szybszy przyjazd, krótszy spacer czy mniej przesiadek. Limity poniżej obowiązują przy każdym stylu.',
    styleFastest: 'Najszybciej',
    styleFastestDesc: 'Najwcześniejszy przyjazd',
    styleBalanced: 'Zrównoważony',
    styleBalancedDesc: 'Minuta za mniej chodzenia',
    styleLessWalking: 'Mniej pieszo',
    styleLessWalkingDesc: 'Krótkie dojścia i przesiadki',
    styleFewerTransfers: 'Mniej przesiadek',
    styleFewerTransfersDesc: 'Bezpośrednio, nawet dłużej',
    transfersTitle: 'Maks. przesiadek',
    transfersHint:
      'Górny limit przesiadek w jednej trasie. Karę za każdą przesiadkę ustawia styl trasy, więc spacer 300 m do przystanku z bezpośrednim kursem zwykle wygrywa z przesiadkami z najbliższego słupka.',
    transfersHintShort: 'Górny limit w jednej trasie.',
    directValue: 'Bezpośrednie',
    transferTimeTitle: 'Min. czas na przesiadkę',
    transferTimeHint:
      'Ile czasu rezerwujemy między wysiadką a kolejnym odjazdem. Większa wartość odrzuca ryzykowne, minutowe przesiadki.',
    transferTimeHintShort: 'Rezerwa między wysiadką a kolejnym odjazdem.',
    trainTitle: 'Pociągi regionalne',
    trainHint:
      'Przesiadki na pociągi regionalne. Działają tylko w trybie „Wszystkie”, szybki filtr tramwaj/autobus ich nie rusza.',
    trainHintShort: 'Przesiadki na pociągi. Tylko w trybie „Wszystkie”.',
    trainBufferTitle: 'Zapas na pociąg',
    trainBufferHint:
      'Minimalny czas na dojście na peron po przesiadce. Stacje kolejowe to nie słupki, droga z przystanku na peron idzie zwykle przez halę.',
    trainBufferHintShort: 'Czas na dojście na peron po przesiadce.',
    trainNoData:
      'Pobrany rozkład nie ma pociągów. Sprawdź aktualizacje powyżej, żeby włączyć przesiadki na pociągi.',
    cableTitle: 'Polinka',
    cableHint:
      'Kolejka linowa Politechniki Wrocławskiej nad Odrą, między wybrzeżem Wyspiańskiego a ulicą Na Grobli. Kursuje w dni robocze 7:00–21:00, z przerwą 13:30–14:00, co 5 minut. W weekendy nie jeździ. Działa tylko w trybie „Wszystkie”.',
    cableHintShort: 'Kolejka linowa nad Odrą. Tylko w trybie „Wszystkie”.',
    walkTitle: 'Maks. pieszo',
    walkHint:
      'Jak daleko możesz podejść na przystanek początkowy i z końcowego do celu. Dalszy przystanek z bezpośrednim tramwajem często bije najbliższy słupek.',
    walkHintShort: 'Dojście na start i z końca do celu.',
    speedTitle: 'Tempo chodzenia',
    speedHint: 'Twój wybór wpływa na czas dojść pieszych, przesiadek i szacowany przyjazd.',
    paceSlow: 'Wolno',
    paceNormal: 'Normalnie',
    paceFast: 'Szybko',
    paceSlowDesc: 'Spokojny spacer',
    paceNormalDesc: 'Zwykły chód miejski',
    paceFastDesc: 'Żwawy krok',
    anchorTitle: 'Promień kotwiczenia',
    anchorHint:
      'Gdy jesteś w tym promieniu od zapisanego miejsca (np. Dom), nawigacja automatycznie zakotwiczy punkt startowy do przypisanego przystanku, niwelując niedokładności GPS.',
    anchorHintShort: 'Automatyczne kotwiczenie startu przy zapisanym miejscu.',
    foot: 'Ustawienia zapisują się automatycznie i dotyczą kolejnych wyszukiwań połączeń.',
    walkTime: (n: number) =>
      n === 1 ? '1 minuta pieszo' : isFew(n) ? `${n} minuty pieszo` : `${n} minut pieszo`,
    langTitle: 'Język',
    langSystem: 'Systemowy',
  },
  onboarding: {
    steps: ['Witaj', 'Uprawnienia', 'Miasto', 'Rozkład', 'Miejsca'] as string[],
    granted: 'Włączone',
    denied: 'Wyłączone',
    toEnable: 'Do włączenia',
    slotHome: 'Dom',
    slotHomeHint: (id: string): string =>
      id === 'krakow'
        ? 'np. Krowoderska 12'
        : id === 'warszawa'
          ? 'np. Marszałkowska 12'
          : id === 'poznan'
            ? 'np. Głogowska 12'
            : id === 'trojmiasto'
              ? 'np. Długa 12'
              : id === 'lodz'
                ? 'np. Piotrkowska 12'
                : id === 'szczecin'
                  ? 'np. Wojska Polskiego 12'
                  : 'np. Swojczycka 41',
    slotWork: 'Praca',
    slotWorkHint: (id: string): string =>
      id === 'krakow'
        ? 'np. Galeria Krakowska'
        : id === 'warszawa'
          ? 'np. Złote Tarasy'
          : id === 'poznan'
            ? 'np. Stary Browar'
            : id === 'trojmiasto'
              ? 'np. Galeria Bałtycka'
              : id === 'lodz'
                ? 'np. Manufaktura'
                : id === 'szczecin'
                  ? 'np. Galeria Kaskada'
                  : 'np. Sky Tower',
    slotUni: 'Uczelnia',
    slotUniHint: (id: string): string =>
      id === 'krakow'
        ? 'np. AGH'
        : id === 'warszawa'
          ? 'np. Uniwersytet'
          : id === 'poznan'
            ? 'np. UAM'
            : id === 'trojmiasto'
              ? 'np. UG'
              : id === 'lodz'
                ? 'np. UŁ'
                : id === 'szczecin'
                  ? 'np. US'
                  : 'np. Politechnika',
    backA11y: 'Wstecz',
    stepOf: (n: number, len: number, name: string) => `Krok ${n} z ${len} • ${name}`,
    brand: 'Kilometr',
    tagline: 'Tym razem dojedziesz.',
    fast: 'Szybko',
    noAds: 'Bez reklam',
    noPay: 'Bez mikropłatności',
    permTitle: 'Uprawnienia',
    permSub: 'Lokalizacja i powiadomienia. Oba opcjonalne.',
    locTitle: 'Lokalizacja',
    locBody:
      'Służy do ustawienia punktu startowego i sortowania przystanków według odległości. Przetwarzana lokalnie na urządzeniu.',
    locOn: 'Lokalizacja włączona.',
    locAllow: 'Zezwól na lokalizację',
    notifTitle: 'Powiadomienia',
    notifBody: 'Służą do wyświetlania przypiętego połączenia i alertów o utrudnieniach.',
    notifOn: 'Powiadomienia włączone.',
    notifExpoGo:
      'Podgląd w Expo Go — powiadomienia (przypięte połączenie) działają w buildzie deweloperskim.',
    notifAllow: 'Włącz powiadomienia',
    cityTitle: 'W którym mieście\njeździsz?',
    cityBody:
      'Rozkład, mapa i aktualności dopasują się do wyboru. Miasto zmienisz później w ustawieniach.',
    citySuggested: (name: string) => `Według GPS jesteś w ${name}.`,
    cityNoGps: 'Bez dostępu do GPS wybierz miasto z listy.',
    cityLocating: 'Szukam pozycji GPS…',
    cityNoMatch: 'Nie znalazłem Cię w obsługiwanym mieście. Wybierz z listy.',
    cityPickA11y: (name: string) => `Wybierz miasto: ${name}`,
    citySuggestedA11y: (name: string) => `Proponowane miasto według GPS: ${name}`,
    dlTitle: (gen: string) => `Pobierz rozkład\n${gen}`,
    dlBody: (feeds: string) =>
      `Gotowa baza: ${feeds} z serwera Kilometr. Jedno pobranie, potem offline.`,
    dlEmpty: 'Brak danych offline.',
    dlSize: 'Jedno pobranie • kilka minut • potem offline',
    dlProgress: (p: number) => `Pobieranie… ${p}%`,
    dlStep: (step: string, p: number) => `${step} ${p}%`,
    dlKeepOpen: 'Nie zamykaj aplikacji w trakcie pobierania.',
    dlDone: 'Rozkład gotowy.',
    dlDoneSub: (stops: number, trips: number) => `${stops} przystanków • ${trips} kursów.`,
    dlFail: 'Coś poszło nie tak',
    dlFailBody: (msg: string) => `${msg}. Sprawdź internet i spróbuj ponownie.`,
    saveFail: 'Nie udało się zapisać miejsca',
    saveFailBody: 'Spróbuj ponownie.',
    placesTitle: 'Gdzie bywasz\nnajczęściej?',
    placesBody: 'Zapisane miejsca przyspieszają wyszukiwanie. Ten krok można pominąć.',
    added: 'Dodane',
    removeSlotA11y: (name: string) => `Usuń ${name}`,
    closeAction: 'Zamknij',
    addAction: '+ Dodaj',
    addressFor: (name: string) => `Adres dla: ${name}…`,
    noResults: (q: string) =>
      `Brak wyników dla „${q}”. Przystanki szukamy offline, adresy wymagają internetu.`,
    start: 'Zaczynamy',
    next: 'Dalej',
    later: 'Później',
    footerRetry: 'Spróbuj ponownie',
    footerDownloading: 'Pobieranie…',
    footerDownload: 'Pobierz rozkład',
    needTimetable: 'Bez rozkładu nie da się wyszukać połączeń.',
    doneCount: (n: number) => `Gotowe (${n})`,
    donePlain: 'Gotowe',
    skip: 'Pomiń na razie',
    skipTimetable: 'Pomiń, pobiorę rozkład później',
  },
  news: {
    chip: 'Utrudnienia',
    fetchFail: 'Nie udało się pobrać aktualności. Sprawdź internet i spróbuj ponownie.',
    title: 'Aktualności',
    sourceLoading: (feeds: string) => feeds,
    sourceEmpty: (combined: string) => combined,
    count: (n: number, urgent: number) =>
      `${n} wiadomości${urgent > 0 ? ` • ${urgent} pilne` : ''}`,
    refreshA11y: 'Odśwież aktualności',
    loading: 'Pobieranie komunikatów…',
    noConnection: 'Brak połączenia',
    emptyTitle: 'Brak komunikatów',
    emptyBody: (name: string) =>
      `${name} nie opublikował teraz żadnego utrudnienia. Przeciągnij w dół, żeby sprawdzić ponownie.`,
    sectionChanges: 'Zmiany na liniach',
    sectionCity: 'Wiadomości',
    sourceMpk: (operator: string) => operator,
    sourceCity: (portal: string) => portal,
    linesLabel: (lines: string) => `Linie ${lines}`,
    openBrowser: 'Otwórz w przeglądarce',
    articleFail: 'Nie udało się wczytać treści tej strony.',
    articleEmpty: 'Na tej stronie nie ma treści, którą da się pokazać w aplikacji.',
    filterAll: 'Wszystkie',
    filterMyLines: 'Moje linie',
    filterMyLinesA11y: 'Pokaż tylko komunikaty o liniach z Twoich ostatnich tras',
    filterEmptyTitle: 'Nic na Twoich liniach',
    filterEmptyBody:
      'Brak komunikatów o liniach z tras, które sprawdzałeś w ostatnich dwóch tygodniach.',
    filterNoHistoryTitle: 'Brak Twoich linii',
    filterNoHistoryBody:
      'Sprawdź połączenie w aplikacji, a tu zobaczysz komunikaty o liniach z tej trasy.',
  },
  newsSvc: {
    justNow: 'przed chwilą',
    minsAgo: (m: number) => `${m} min temu`,
    hoursAgo: (h: number) => `${h} godz. temu`,
    yesterday: 'wczoraj',
    daysAgo: (d: number) => `${d} dni temu`,
    untitled: '(bez tytułu)',
  },
  map: {
    title: 'Mapa trasy',
    loadFail: 'Nie udało się wczytać połączenia',
    loadFailBody:
      'Mapa pokazuje konkretne połączenie, więc musi być dostępne w pamięci lub w cache.',
    backToDetails: 'Wróć do szczegółów',
    assembling: 'Składam połączenie…',
    offlineTitle: 'Mapa niedostępna — brak sieci',
    offlineSub: 'Kafelki się nie ładują',
    backA11y: 'Wróć',
    transfersSuffix: (n: number) =>
      n === 1 ? ' • 1 przesiadka.' : isFew(n) ? ` • ${n} przesiadki.` : ` • ${n} przesiadek.`,
    delaySuffix: (d: number) => ` • ${d > 0 ? '+' : ''}${d} min`,
    walkPrefix: 'Spacer ',
    walkStageA11y: (dist: string) => `Etap pieszy ${dist}`,
    lineStageA11y: (line: string, dir: string) => `Linia ${line} kierunek ${dir}`,
    lineLabel: (line: string) => `Linia ${line}`,
    legStops: (n: number) => (n === 1 ? '1 przyst.' : isFew(n) ? `${n} przyst.` : `${n} przyst.`),
    board: 'Wsiadaj',
    alight: 'Wysiadaj',
    mapLoadFail: 'Nie udało się załadować mapy',
    maneuver: {
      depart: 'Idź do przystanku',
      straight: 'Idź prosto',
      slightLeft: 'Skręć lekko w lewo',
      left: 'Skręć w lewo',
      sharpLeft: 'Skręć ostro w lewo',
      slightRight: 'Skręć lekko w prawo',
      right: 'Skręć w prawo',
      sharpRight: 'Skręć ostro w prawo',
      uturn: 'Zawróć',
      board: 'Wsiadaj',
      alight: 'Wysiadaj',
      arrive: 'Jesteś na miejscu',
      then: 'potem',
      in: 'za',
      onStop: 'na przystanku',
      detailA11y: (what: string, dist: string) => `${what}, ${dist}`,
    },
  },
  routes: {
    gpsAddress: 'Użyj aktualnej pozycji',
    destFallback: 'Cel',
    trackUnsupportedTitle: 'Śledzenie niedostępne',
    trackUnsupportedBody: 'Powiadomienia wymagają builda deweloperskiego. Expo Go ich nie wspiera.',
    noConnectionsTitle: 'Brak połączeń',
    noConnectionsBody: 'Poczekaj aż pojawi się kurs na tej trasie.',
    stopTrackingTripA11y: 'Zatrzymaj śledzenie podróży',
    trackNearestA11y: 'Śledź najbliższe połączenie',
    pinUnsupportedTitle: 'Pinezka niedostępna',
    pinUnsupportedBody:
      'Przypięte powiadomienie wymaga builda deweloperskiego — Expo Go nie wspiera powiadomień.',
    notifOffTitle: 'Powiadomienia wyłączone',
    notifOffBody: 'Zezwól na powiadomienia w ustawieniach systemu, żeby przypiąć połączenie.',
    gpsFailTitle: 'Błąd lokalizacji',
    gpsFailBody:
      'Nie udało się pobrać aktualnej pozycji GPS. Upewnij się, że lokalizacja w telefonie jest włączona.',
    now: 'Teraz',
    title: (operator: string) => `Połączenia ${operator}`,
    sortFastestA11y: 'Sortowanie: przyjazd. Dotknij, aby przełączyć na odjazd.',
    sortEarliestA11y: 'Sortowanie: odjazd. Dotknij, aby przełączyć na przyjazd.',
    sortFastest: 'przyjazd',
    sortEarliest: 'odjazd',
    unpinA11y: 'Odepnij połączenie',
    pinA11y: 'Przypnij najbliższe połączenie',
    changeFromA11y: (t: string) => `Zmień miejsce startowe, obecnie ${t}`,
    changeFromAnchorA11y: (t: string, stop: string) =>
      `Zmień miejsce startowe, obecnie ${t}, odjazd z przystanku ${stop}`,
    dismissAnchorA11y: 'Usuń zakotwiczenie przystanku i szukaj z GPS',
    swapA11y: 'Odwróć trasę: zamień punkt startowy z docelowym',
    changeToA11y: (t: string) => `Zmień cel, obecnie ${t}`,
    searching: 'Szukam połączeń…',
    calcFail: 'Nie udało się policzyć połączeń',
    noTimetable: 'Brak rozkładu',
    calcFailBody:
      'Planer liczy trasy na telefonie. Spróbuj ponownie — jeśli powtarza się to zawsze, odśwież rozkład w ustawieniach.',
    noTimetableBody:
      'Aplikacja liczy trasy na telefonie z pełnego rozkładu. Bez niego nie ma połączeń. Pobierz go raz, potem działa offline.',
    downloadA11y: 'Pobierz rozkład',
    downloading: (p: number) => `Pobieranie… ${p}%`,
    downloadingStep: (step: string, p: number) => `${step} ${p}%`,
    downloadingPlain: 'Pobieranie…',
    downloadAction: 'Pobierz rozkład',
    countNearest: 'najbliższe odjazdy',
    countDepart: (label: string) => `odjazd ${label}`,
    countArrive: (label: string) => `przyjazd ${label}`,
    countDirect: ' • tylko bezpośrednie',
    countTram: ' • tramwaje',
    countBus: ' • autobusy',
    countEarlier: ' • wczytuję wcześniejsze…',
    offlineTapA11y: 'Ostatnie dane z cache. Dotknij, aby odświeżyć.',
    offlineChip: 'offline',
    noLiveChip: 'brak danych live',
    moreFail: 'Nie udało się dociągnąć dalszych połączeń.',
    moreRetryA11y: 'Spróbuj dociągnąć dalsze połączenia',
    noMore: 'To wszystkie odjazdy z tej trasy.',
    emptyFiltered: 'Brak połączeń dla wybranych filtrów',
    emptyNone: 'Nie znaleziono połączeń',
    emptyModeDirect: (veh: string) =>
      `Na tej trasie nie ma teraz kursu ${veh} bez przesiadek. Poluzuj filtry albo sprawdź inną godzinę.`,
    emptyDirect:
      'Na tej trasie nie ma teraz kursu bez przesiadek. Wyłącz filtr „Tylko bezpośrednie”, aby zobaczyć połączenia z przesiadkami, albo sprawdź inną godzinę.',
    emptyMode: (veh: string) =>
      `Na tej trasie nie ma teraz kursu ${veh}. Przełącz na „Wszystkie”, aby zobaczyć resztę połączeń.`,
    emptyPlain: 'Spróbuj wybrać inny cel lub sprawdź inną godzinę odjazdu.',
    vehicleTramGen: 'tramwajem',
    vehicleBusGen: 'autobusem',
    vehicleTrolleyGen: 'trolejbusem',
    vehicleTrainGen: 'pociągiem',
    vehicleSubwayGen: 'metrem',
    vehicleCableGen: 'koleją linową',
    showWithChangesA11y: 'Pokaż połączenia z przesiadkami',
    showWithChanges: 'Pokaż z przesiadkami',
    showAllVehiclesA11y: 'Pokaż wszystkie pojazdy',
    showAllVehicles: 'Pokaż wszystkie pojazdy',
  },
  routeDetails: {
    title: 'Szczegóły połączenia',
    loadFail: 'Nie udało się wczytać połączenia.',
    backToList: 'Wróć do listy',
    offlineNote: 'Z pamięci offline — czasy według rozkładu, bez danych live',
    noLiveNote: 'Brak danych live — czasy według rozkładu',
    onTime: 'Na czas',
    scheduleCache: 'Rozkład z cache',
    schedule: 'Rozkład',
    noTrip: 'Brak przebiegu trasy',
    noTripBody:
      'To połączenie nie ma zapisanych przystanków, więc nie da się narysować trasy ani wskazać najbliższego przystanku. Wróć do listy i wybierz inne połączenie.',
    lineAlertsTitle: 'Zmiany na Twoich liniach',
    lineAlertsAll: 'Wszystkie aktualności',
    lineAlertsEmpty: 'Brak komunikatów o liniach z tej trasy.',
    lineAlertsCount: (n: number) =>
      n === 1 ? '1 komunikat' : isFew(n) ? `${n} komunikaty` : `${n} komunikatów`,
  },
  search: {
    defaultPlaceholder: (city: string) => `Szukaj w ${city}…`,
    originA11y: (t: string) => `Punkt startowy: ${t}. Dotknij, aby zmienić.`,
    fromPrefix: 'Z:',
    change: 'Zmień',
    closeA11y: 'Zamknij wyszukiwarkę',
    clearA11y: 'Wyczyść zapytanie',
    resultsFor: (q: string, n: number) => `Wyniki dla „${q}” (${n})`,
    recentTrips: 'Ostatnie przejazdy',
    savedA11y: (t: string) => `Zapisane miejsce: ${t}`,
    searching: (city: string) => `Szukam w ${city}…`,
    noResults: 'Brak wyników',
    noResultsHint: (id: string) =>
      `Spróbuj: ${id === 'krakow' ? '„rynek”, „grodzka”, „wawel”, „balice”' : id === 'gzm' ? '„katowice”, „gliwice”, „rynek”, „tychy”' : id === 'warszawa' ? '„metro”, „młociny”, „centralny”, „śródmieście”' : id === 'poznan' ? '„rynek”, „garbary”, „rondo”, „malta”' : id === 'trojmiasto' ? '„oliwa”, „wrzeszcz”, „orłowo”, „przymorze”' : id === 'lodz' ? '„piotrkowska”, „manufaktura”, „fabryczna”, „kaliska”' : id === 'szczecin' ? '„brama portowa”, „dąbie”, „police”, „pogodno”' : '„arkady”, „biskupin”, „zoo”, „swojczycka”'}. Działa też bez polskich znaków i z literówkami.`,
    noResultsFor: (q: string) => `Nic nie pasuje do „${q}”`,
    yourPlaces: 'Twoje miejsca',
    gpsOutsideNotice: 'GPS poza obsługiwanym miastem, wybierz punkt manualnie.',
  },
  places: {
    manageTitle: 'Zapisane miejsca',
    manageSub: 'Zarządzaj swoimi szybkimi celami podróży',
    emptyTitle: 'Brak zapisanych miejsc',
    emptyBody: 'Dodaj dom, pracę lub ulubione punkty, aby jednym dotknięciem sprawdzać połączenia.',
    addNew: 'Dodaj nowe miejsce',
    removeTitle: (name: string) => `Usunąć „${name}”?`,
    removeGeneric: 'Usunąć to miejsce?',
    removeConfirm: 'Usuń',
    iconCategories: {
      all: 'Wszystkie',
      frequent: 'Częste',
      transit: 'Podróż',
      food: 'Jedzenie',
      health: 'Zdrowie',
      culture: 'Kultura',
      sport: 'Sport',
      services: 'Usługi',
    },
    iconName: {
      home: 'Dom',
      work: 'Praca',
      school: 'Szkoła',
      university: 'Uczelnia',
      gym: 'Siłownia',
      coffee: 'Kawiarnia',
      shopping: 'Sklep',
      star: 'Ulubione',
      heart: 'Ważne',
      friends: 'Znajomi',
      train: 'Dworzec PKP',
      tram: 'Tramwaj',
      bus: 'Autobus',
      plane: 'Lotnisko',
      bike: 'Rower',
      car: 'Samochód',
      fuel: 'Stacja paliw',
      ship: 'Prom / Port',
      compass: 'Orientacja',
      restaurant: 'Restauracja',
      pizza: 'Pizzeria',
      sandwich: 'Bistro',
      beer: 'Pub / Piwo',
      wine: 'Bar / Wino',
      market: 'Rynek / Targ',
      cart: 'Supermarket',
      pharmacy: 'Apteka',
      hospital: 'Szpital',
      doctor: 'Przychodnia',
      scissors: 'Fryzjer',
      sparkles: 'Uroda / Spa',
      cinema: 'Kino',
      theater: 'Teatr',
      culture: 'Muzeum',
      library: 'Biblioteka',
      music: 'Muzyka',
      ticket: 'Wydarzenie',
      gamepad: 'Rozrywka',
      park: 'Park',
      mountain: 'Góry',
      tent: 'Kemping',
      trophy: 'Stadion',
      swimming: 'Basen / Plaża',
      church: 'Kościół',
      baby: 'Przedszkole',
      pet: 'Zwierzak',
      hotel: 'Hotel',
      bank: 'Bank / Bankomat',
      post: 'Poczta / Paczka',
      laptop: 'Coworking',
      mapPin: 'Inne',
      plus: 'Inne',
    } as Record<string, string>,
    chooseIcon: 'Wybierz ikonę',
    iconFor: (name: string) => `Symbol dla: ${name}`,
    iconForFallback: 'tego miejsca',
    searchIcon: 'Szukaj ikony (np. pociąg, kawa, lekarz)…',
    anchorTitle: 'Przystanek kotwiczenia',
    anchorFor: (name: string) => `Wybierz przystanek odjazdu dla: ${name}`,
    searchStop: 'Szukaj przystanku…',
    nearStops: 'Najbliższe przystanki wokół wybranego adresu:',
    typeStopAbove: 'Wpisz nazwę przystanku powyżej, aby wyszukać.',
    metersAway: (m: number) => `${m} m od wybranego miejsca`,
    choose: 'Wybierz',
    editPlace: 'Edytuj miejsce',
    newPlace: 'Nowe zapisane miejsce',
    chooseTarget: 'Wybierz adres lub przystanek docelowy',
    editHint: 'Zmień nazwę, ikonę lub adres',
    newHint: 'Wybierz cel i dodaj do szybkich tras',
    nameLabel: 'Nazwa miejsca',
    nameHint: 'np. Dom, Uczelnia, Praca, Siłownia',
    moreIcons: (n: number) => `Więcej ikon (${n}) ›`,
    moreIconsShort: '+ Więcej...',
    addressLabel: 'Adres lub przystanek docelowy',
    changeBtn: 'Zmień',
    queryHint: 'Wpisz ulicę, przystanek lub obiekt…',
    anchorOptional: 'Przystanek kotwiczenia (opcjonalnie)',
    anchorHint: 'Odjazdy z tego przystanku, gdy jesteś blisko',
    assignAnchor: '+ Przypisz przystanek odjazdu',
    saveChanges: 'Zapisz zmiany',
    savePlace: 'Zapisz miejsce',
  },
  timeSheet: {
    titleDepart: 'Czas odjazdu',
    titleArrive: 'Czas przyjazdu',
    modeDepart: 'Odjazd',
    modeDepartA11y: 'Szukaj od podanej godziny',
    modeArrive: 'Przyjazd',
    modeArriveA11y: 'Bądź na miejscu o podanej godzinie',
    dayToday: 'Dzisiaj',
    dayTomorrow: 'Jutro',
    hourLabel: 'godzina',
    minuteLabel: 'minuta',
    confirmNow: 'Wyszukaj od teraz',
    confirmDepart: (day: string, hh: string, mm: string) => `Zastosuj: ${day}, ${hh}:${mm}`,
    confirmArrive: (day: string, hh: string, mm: string) => `Bądź na: ${day}, ${hh}:${mm}`,
  },
  routesBar: {
    modeTram: 'Tram',
    modeBus: 'Bus',
    modeAll: 'Pojazdy',
    modeTramA11y: 'Tramwaje',
    modeBusA11y: 'Autobusy',
    modeAllA11y: 'Wszystkie pojazdy',
    reverse: 'Odwróć',
    reverseA11y: 'Odwróć trasę: zamień punkt startowy z docelowym',
    direct: 'Bezpośr.',
    directOnA11y: 'Filtr połączeń bezpośrednich: aktywny. Dotknij, aby pokazać wszystkie.',
    directOffA11y: 'Filtr połączeń bezpośrednich: nieaktywny. Dotknij, aby włączyć.',
    modeFilterA11y: (cur: string) =>
      `Filtruj środek transportu: aktualnie ${cur}. Dotknij, aby zmienić.`,
    timeA11y: (label: string) => `Czas odjazdu: ${label}. Dotknij, aby zmienić.`,
  },
  connection: {
    transfers: (n: number) =>
      n <= 0
        ? 'bezpośrednio'
        : n === 1
          ? '1 przesiadka'
          : isFew(n)
            ? `${n} przesiadki`
            : `${n} przesiadek`,
    connections: (n: number) =>
      n === 1 ? '1 połączenie' : isFew(n) ? `${n} połączenia` : `${n} połączeń`,
    walkAll: 'całość pieszo',
    walkLeg: 'pieszo',
    cardA11y: (
      dep: string,
      dur: number,
      depAt: string,
      arrAt: string,
      via: string,
      lines: string,
    ) =>
      `${dep}, czas jazdy ${dur} min, odjazd ${depAt}, przyjazd ${arrAt}, ${via}${lines ? `, linie ${lines}` : ''}`,
    walkRoute: 'trasa piesza',
  },
  vehiclePos: {
    noRoute: 'Brak danych o trasie',
    liveBetween: (from: string, to: string) => `Pojazd: ${from} → ${to} • na żywo`,
    liveBefore: (stop: string) => `Pojazd: przed ${stop} • na żywo`,
    liveAt: (stop: string) => `Pojazd: ${stop} • na żywo`,
    liveNear: (stop: string) => `Pojazd: okolice ${stop} • na żywo`,
    estRoute: (from: string, to: string) => `Pozycja szacowana: ${from} → ${to}`,
    estBefore: (at: string) => `Przed odjazdem (${at}) • pozycja szacowana`,
    estDone: 'Kurs zakończony • pozycja szacowana',
    estBetween: (from: string, to: string) => `Pojazd (szac.): ${from} → ${to}`,
  },
  leg: {
    noData: 'Brak danych o trasie',
    expandA11y: (line: string, dir: string, expanded: boolean) =>
      `${line} kierunek ${dir}. ${expanded ? 'Zwiń' : 'Rozwiń'} listę przystanków.`,
    vehicleBetween: (mode: string, from: string, to: string) => `${mode} między ${from} a ${to}`,
    vehicleFarBack: 'Pojazd jest dalej na trasie',
    vehicleNotStarted: 'Kurs jeszcze nie ruszył',
    fromPrefix: 'z ',
    toPrefix: 'do ',
    stopsSummary: (n: number, mins: number, open: boolean) =>
      `${n} przystanki • ~${mins} min • ${open ? 'zwiń' : 'rozwiń'} przystanki`,
  },
  compass: {
    ahead: 'Prosto przed Tobą',
    slightRight: 'Lekko w prawo',
    right: 'Po Twojej prawej',
    backRight: 'Za Tobą z prawej',
    back: 'Za Twoimi plecami',
    backLeft: 'Za Tobą z lewej',
    left: 'Po Twojej lewej',
    slightLeft: 'Lekko w lewo',
    noCoords: 'Ten przystanek nie ma współrzędnych w rozkładzie.',
    locOff: 'Lokalizacja jest wyłączona. Bez niej nie pokażę kierunku do przystanku.',
    locWaiting:
      'Nie mam jeszcze Twojej pozycji. Poczekaj na sygnał GPS albo skorzystaj z pełnej mapy.',
    title: 'Lokalizacja przystanku',
    followCompass: 'Kieruj się według kompasu',
    directionPrefix: (d: string) => `kierunek ${d}`,
    straight: 'w linii prostej',
    distanceText: (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`),
    walkMins: (m: number) => `~${m} min pieszo`,
    headToStop: 'Idź w stronę przystanku',
    nextStop: 'Następny przystanek',
    navToStop: (dist: string) => `${dist} do przystanku`,
    navA11y: (what: string, dist: string) => `${what}, ${dist}. Dotknij, aby otworzyć pełną mapę.`,
    rerouting: 'Wyznaczam nową trasę',
    openSettingsA11y: 'Otwórz ustawienia aplikacji',
    enableLoc: 'Włącz lokalizację w ustawieniach',
  },
  lastTrip: {
    backA11y: (from: string, to: string) => `Szybki powrót: ${from} do ${to}. Puść, aby wyszukać.`,
    lastA11y: (from: string, to: string) =>
      `Ostatnie połączenie: ${from} do ${to}. Ciągnij dalej, aby odwrócić.`,
    pullHint: 'Ostatnio wyszukiwane połączenie.\nPuść, by wyszukać',
    pullHintBack: 'Droga powrotna.\nPuść, by wyszukać',
  },
  suggestion: {
    stopFallback: 'Przystanek',
  },
  data: {
    stepUnpack: 'Rozpakowywanie…',
    stepStops: 'Przystanki…',
    stepLines: 'Linie…',
    stepCalendar: 'Kalendarz…',
    stepTrips: 'Kursy…',
    stepTimes: 'Czasy odjazdów…',
    stepTimesK: (k: number) => `Czasy odjazdów… (${k}k)`,
    stepIndex: 'Budowanie indeksów…',
    stepWeights: 'Wagi przystanków…',
    stepDb: 'Pobieranie bazy…',
    stepVerify: 'Weryfikacja…',
    errStops: 'Brak stops.txt w archiwum GTFS',
    errTrips: 'Brak trips.txt w archiwum GTFS',
    errTimes: 'Brak stop_times.txt w archiwum GTFS',
    prepareFail: 'Nie udało się przygotować rozkładu',
    retryHint: 'Dotknij, aby spróbować ponowić.',
  },
  downloader: {
    noNet: 'Brak połączenia z internetem',
    timeout: 'Pobieranie trwało zbyt długo',
    noSpace: 'Za mało miejsca na telefonie',
    unavailable: 'Rozkład chwilowo niedostępny',
    failed: 'Nie udało się pobrać rozkładu',
    hintRetry: 'Sprawdź internet i dotknij, aby ponowić.',
    hintTouch: 'Dotknij, aby spróbować ponowić.',
    hintSpace: 'Zwolnij trochę miejsca i dotknij, aby ponowić.',
    hintLater: 'Spróbuj ponownie za jakiś czas.',
    noFile: 'Pobieranie GTFS nie zwróciło pliku',
  },
  notification: {
    // Kanały powiadomień — nazwy widoczne w ustawieniach systemu.
    channelTracking: 'Śledzenie podróży',
    channelTrackingDesc: 'Ciche powiadomienie z postępem i licznikiem do odjazdu lub przyjazdu.',
    channelAlerts: 'Alerty odjazdu',
    channelAlertsDesc: '„Wyjdź teraz”, opóźnienia i zmiany kursu. Z dźwiękiem.',
    permDenied:
      'Powiadomienia są wyłączone. Włącz je w ustawieniach systemu dla kilometr, żeby śledzić odjazd i postęp podróży.',
    // Przyciski pod powiadomieniem. „Zakończ” jest krótkie celowo — Android
    // pokazuje najwyżej trzy przyciski i skraca dłuższe tytuły.
    actionStop: 'Zakończ',
    actionRoute: 'Trasa',
    showRoutes: 'Pokaż trasę',
    actionOk: 'OK',
    modeWalk: 'Pieszo',
    modeTram: 'Tramwaj',
    modeBus: 'Autobus',
    modeTrain: 'Pociąg',
    modeSubway: 'Metro',
    modeCable: 'Kolej linowa',
    modeTrolleybus: 'Trolejbus',
    // Tytuł niesie linię, kierunek i BEZWZGLĘDNĄ godzinę w jednej linii —
    // zegar systemowy tyka w nagłówku i sam z siebie nie wie, do czego liczy.
    // Względne „za 4 min” w treści zestarzałoby się przy pierwszym
    // odświeżeniu, więc go tu nie ma w ogóle.
    departTitle: (service: string, at: string) => `${service} • odjazd ${at}`,
    rideTitle: (service: string, at: string) => `${service} • na miejscu ${at}`,
    transferTitle: (service: string, at: string) => `Przesiadka • ${service} • odjazd ${at}`,
    arrivedTitle: 'Jesteś na miejscu',
    arrivedBody: (at: string, dur: string) => `Na miejscu ${at} • podróż trwała ${dur}`,
    nextStop: (name: string) => `następny ${name}`,
    estimatedNextStop: (name: string) => `Szacowany następny: ${name}`,
    stopHere: (name: string) => `przystanek ${name}`,
    // Najważniejsze pytanie w trakcie jazdy: gdzie wysiadam. Bez tego
    // użytkownik musiał zaglądać do aplikacji, żeby nie przegapić przystanku.
    alightAt: (name: string) => `Wysiądź na: ${name}`,
    directionTo: (dir: string) => `Do ${dir}`,
    platform: (num: string) => `słup ${num}`,
    walkApproach: (min: number) => `dojście ~${min} min`,
    rideLength: (min: number) => `przejazd ${min} min`,
    departAt: (at: string) => `odjazd ${at}`,
    arriveAt: (at: string) => `na miejscu ${at}`,
    delayLate: (min: number) => `opóźnienie +${Math.round(min)} min`,
    delayEarly: (min: number) => `spieszy ${Math.abs(Math.round(min))} min`,
    stops: (n: number) =>
      n === 1 ? '1 przystanek' : isFew(n) ? `${n} przystanki` : `${n} przystanków`,
    transfers: (n: number) =>
      n === 1 ? '1 przesiadka' : isFew(n) ? `${n} przesiadki` : `${n} przesiadek`,
    // Alerty odjazdu — osobne, głośne powiadomienia przed podróżą.
    leaveNow: (service: string, at: string) => `Wyjdź teraz • ${service} ${at}`,
    leaveIn: (min: number, service: string, at: string) =>
      `Wyjdź za ${min} ${min === 1 ? 'minutę' : isFew(min) ? 'minuty' : 'minut'} • ${service} ${at}`,
    walkToStop: (dist: string) => `${dist} do przystanku`,
    newDeparture: (at: string) => `nowy odjazd ${at}`,
    delayTitle: (line: string, eta: string) => `Opóźnienie • ${line} • ${eta}`,
  },
  notificationPrefs: {
    title: 'Powiadomienia',
    devBuildWarn: 'Wymaga builda deweloperskiego. W Expo Go powiadomienia nie działają.',
    unsupportedTitle: 'Powiadomienia niedostępne',
    unsupportedBody:
      'Śledzenie podróży wymaga builda deweloperskiego. Expo Go nie obsługuje powiadomień.',
    trackTitle: 'Śledzenie podróży',
    trackHint: 'Powiadomienie pokazujące bieżący etap podróży i dane kursu.',
    liveTitle: 'Postęp i licznik',
    liveHint: 'System aktualizuje pasek trasy i licznik także po zamknięciu aplikacji.',
    liveHintBasic:
      'Ta wersja nie obsługuje paska live. Powiadomienie nadal pokazuje etap podróży i dane kursu.',
    livePromoteHint:
      'System nie pokazuje powiadomienia w sekcji Live Updates. Włącz Live Updates w ustawieniach powiadomień Kilometra.',
    openNotificationSettings: 'Otwórz ustawienia powiadomień',
    leaveTitle: 'Alert „wyjdź”',
    leaveHint:
      'Głośne przypomnienie przed odjazdem. Planowane z wyprzedzeniem, więc działa też w tle.',
    leadTitle: 'Ile wcześniej ostrzec',
    leadHint: 'Ile minut przed odjazdem zadzwoni przypomnienie.',
    leadLessA11y: 'Mniej minut ostrzeżenia',
    leadMoreA11y: 'Więcej minut ostrzeżenia',
    alertsTitle: 'Alerty',
    disruptionTitle: 'Ostrzeżenie o opóźnieniu',
    disruptionHint: 'Gdy kurs spóźnia się wyraźnie ponad to, co pokazywał poprzednio.',
    on: 'Wł.',
    off: 'Wył.',
  },
  pinned: {
    channel: 'Przypięte połączenie',
    nowText: 'odjazd teraz',
    inMin: (m: number) => `za ${m} min`,
    tram: 'Tramwaj',
    bus: 'Autobus',
    titleLine: (mode: string, line: string, time: string) => `${mode} ${line} • ${time}`,
    titlePlain: (time: string) => `Połączenie • ${time}`,
  },
  // Widgety z ekranu głównego. Interpolacje dostają placeholder ('{n}', '{t}'),
  // bo minuty liczy widget natywnie przy każdym tyknięciu.
  widgets: {
    now: 'teraz',
    min: 'min',
    onTime: 'Na czas',
    timetable: 'Rozkład',
    late: (n: string) => `+${n} min`,
    departAt: (t: string) => `odjazd ${t}`,
    departIn: (n: string) => `odjazd za ${n} min`,
    departNow: 'odjazd teraz',
    arriveIn: (n: string) => `przyjazd za ${n} min`,
    arrived: 'Na miejscu',
    updated: (t: string) => `stan z ${t}`,
    stale: 'Kurs odjechał. Dotknij, żeby sprawdzić następny.',
    nextEmpty: 'Brak odjazdów do Twoich celów. Otwórz Kilometr, żeby je wczytać.',
    destEmpty: 'Tu pojawią się cele, do których jeździsz najczęściej. Wyszukaj trasę w Kilometrze.',
    tripEmptyTitle: 'Nie śledzisz podróży',
    tripEmptyBody: 'Włącz śledzenie przy połączeniu, a tu pojawi się odliczanie i przesiadki.',
    placesEmpty: 'Zapisz miejsce w Kilometrze, żeby dodać tu skrót.',
    search: 'Dokąd jedziesz?',
  },
};

export type Strings = typeof pl;
