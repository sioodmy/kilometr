import { cityNames } from './cities';
import { previewRoute } from './journey';

export const pl = {
  meta: {
    title: 'Kilometr. Twoje miasto. Twój rytm.',
    description:
      'Komunikacja miejska w miastach w całej Polsce. Planuj trasy, sprawdzaj odjazdy i korzystaj z rozkładów offline. Bezpłatnie na Androidzie.',
  },
  skip: 'Przejdź do treści',
  nav: {
    features: 'Możliwości',
    coverage: 'Zasięg',
    download: 'Pobierz',
    menu: 'Menu',
    close: 'Zamknij menu',
    label: 'Nawigacja główna',
  },
  language: 'Język strony',
  hero: {
    eyebrow: 'Kilometr na Androida',
    title: 'Twój',
    accent: 'open-source',
    titleEnd: 'planer podróży',
    body: 'Zaplanuj trasę, sprawdź odjazdy i ruszaj w miasto. Komunikacja miejska w całej Polsce, także offline. Bez reklam i bez konta.',
    play: 'Pobierz z Google Play',
    secondary: 'Zobacz, jak działa',
  },
  journeyDemo: {
    choose: 'Wybierasz',
    ride: '...i jedziesz',
    mock: 'Przykładowa podróż. Godziny według zegara urządzenia.',
    route: previewRoute,
    departIn: (n: number) => `za ${n} min`,
    duration: (n: number) => `${n} min`,
    transfers: (n: number) =>
      n <= 0
        ? 'bezpośrednio'
        : n === 1
          ? '1 przesiadka'
          : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14)
            ? `${n} przesiadki`
            : `${n} przesiadek`,
    fromPrefix: 'z ',
    toPrefix: 'do ',
    stopsSummary: (n: number, mins: number, open: boolean) =>
      `${n} ${n === 1 ? 'przystanek' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'przystanki' : 'przystanków'} • ~${mins} min • ${open ? 'zwiń' : 'rozwiń'} przystanki`,
    expandA11y: (line: string, dir: string, expanded: boolean) =>
      `${line} kierunek ${dir}. ${expanded ? 'Zwiń' : 'Rozwiń'} listę przystanków.`,
  },
  promise: {
    ads: 'Bez reklam.',
    free: 'Za darmo.',
    forever: 'Na zawsze.',
  },
  closing: {
    title: 'Zasługujesz na więcej niż jakdojade',
    body: 'Planuj podróże i sprawdzaj odjazdy, także offline. Pobierz Kilometr, a jeśli Ci się przyda, wesprzyj jego rozwój.',
    support: 'Wesprzyj rozwój',
  },
  features: {
    label: 'Możliwości aplikacji',
    plan: 'Zaplanuj',
    saved: 'Wracaj',
    ride: 'Jedź',
    planTitle: 'Cel jest Twój.\nTrasa już nasza.',
    planBody:
      'Wpisz adres lub przystanek. Porównaj połączenia, wybierz środek transportu i dopasuj przesiadki do siebie.',
    planDetail:
      'Autobusy, tramwaje i dostępna w danym mieście kolej. Z dojściem na przystanek i do celu.',
    savedTitle: 'Twoje miejsca.\nBliżej niż myślisz.',
    savedBody:
      'Dom, praca, ulubiona kawiarnia. Zapisz miejsca, do których wracasz, i sprawdzaj najbliższe odjazdy od razu na ekranie głównym.',
    savedDetail:
      'Ostatnie wyszukiwania są pod ręką. Punkt startowy możesz zmienić niezależnie od GPS.',
    rideTitle: 'Wiesz, gdzie jesteś.\nI co dalej.',
    rideBody:
      'Otwórz trasę na mapie, sprawdź przystanki po drodze i śledź wybrane połączenie. Powiadomienie przypomni Ci o wyjściu.',
    rideDetail: 'Pozycje pojazdów i opóźnienia pojawiają się tam, gdzie udostępnia je przewoźnik.',
  },
  offline: {
    eyebrow: 'Zaprojektowany do drogi',
    title: 'Zasięg znika.\nTwoja trasa zostaje.',
    body: 'Pobierz rozkład i mapę swojego miasta. Kilometr wyznacza połączenia na telefonie, więc możesz planować podróż także bez internetu.',
    note: 'Internet jest potrzebny do pobrania i aktualizacji danych oraz informacji na żywo.',
    local: 'Trasy liczone na telefonie',
    timetable: 'Rozkłady offline',
    maps: 'Pobrana mapa pod ręką',
    airplane: 'Tryb samolotowy',
    ready: 'Możesz ruszać.',
  },
  coverage: {
    cities: cityNames,
    eyebrow: 'Teraz w całej Polsce',
    title: 'Inne miasto.\nTen sam Kilometr.',
    body: 'Na co dzień u siebie, w weekend gdzie indziej. Wybierz miasto i jedź z aplikacją, którą już znasz.',
    count: (n: number) => `${n} miast i aglomeracji`,
    label: 'Wybierz miasto',
    map: 'Mapa obsługiwanych miast w Polsce',
    selected: (name: string) => `Wybrane miasto: ${name}`,
    timetable: 'Rozkład jazdy',
    offline: 'Mapa offline',
    rail: 'Kolej regionalna',
    note: 'Dostępne środki transportu i dane na żywo różnią się między miastami. W aplikacji miasto zmienisz w Ustawieniach.',
    metro: 'Górnośląsko-Zagłębiowska Metropolia',
  },
  principles: {
    title: 'Po prostu wsiadasz.',
    free: 'Bezpłatnie.',
    freeBody: 'Planowanie podróży bez abonamentu i opłat za funkcje.',
    ads: 'Bez reklam.',
    adsBody: 'Na ekranie jest miejsce na Twoją trasę.',
    account: 'Bez konta.',
    accountBody: 'Otwierasz aplikację i wybierasz, dokąd jedziesz.',
    open: 'Otwarty kod.',
    openBody: 'Kilometr rozwijamy publicznie. Kod możesz sprawdzić na GitHubie.',
    source: 'Zobacz kod na GitHubie',
  },
  donation: {
    title: 'Pomóż rozwijać Kilometr.',
    body: 'Kilometr jest darmowy i open source. Jeśli przydaje Ci się w drodze, możesz wesprzeć jego rozwój na Ko-fi.',
    cta: 'Wesprzyj na Ko-fi',
  },
  download: {
    title: 'Następny przystanek?\nTwój.',
    body: 'Zabierz Kilometr na swoją następną trasę.',
    android: 'Na telefony z Androidem. Bezpłatnie.',
    apk: 'APK na GitHubie',
    github: 'Wydanie stabilne z GitHuba',
    alternatives: 'Instalujesz po swojemu?',
    nightly: 'Wersje testowe',
    obtainium: 'Dodaj do Obtainium',
    obtainiumHelp: 'Wymaga zainstalowanego Obtainium.',
  },
  footer: {
    tagline: 'Do zobaczenia w drodze.',
    privacy: 'Prywatność',
    report: 'Benchmark',
    github: 'GitHub',
    license: 'Wolne oprogramowanie. GPL-3.0.',
    back: 'Wróć na stronę główną',
  },
  preview: {
    home: 'Ekran główny aplikacji',
    routes: 'Lista połączeń',
    trip: 'Szczegóły podróży',
    placeholder: 'Miejsce na zrzut ekranu',
    device: 'Pixel 7a / 1080 × 2400',
    placeholderLabel: (screen: string) =>
      `${screen}. Miejsce na autentyczny zrzut ekranu z Pixela 7a.`,
  },
  privacy: {
    title: 'Polityka prywatności Kilometr',
    linkLabel: 'Polityka prywatności',
    linkError: 'Nie udało się otworzyć GitHuba. Spróbuj ponownie po sprawdzeniu połączenia.',
    intro:
      'Dotyczy aplikacji Kilometr na Androida (app.kilometr) i strony projektu. Aktualizacja: 20 października 2026 r. Kilometr jest projektem open source rozwijanym przez sioodmy na GitHubie. Aplikacja nie wymaga konta i nie zawiera reklam ani narzędzi analitycznych.',
    localTitle: 'Dane na urządzeniu',
    localBody:
      'Zapisane miejsca wraz z nazwami i współrzędnymi, historia wyszukiwania, ustawienia, kopie zapasowe i pobrane rozkłady pozostają w pamięci aplikacji na telefonie. Planowanie połączeń na pobranym rozkładzie odbywa się na urządzeniu. Kilometr nie synchronizuje tych danych z kontem na serwerze.',
    locationTitle: 'Lokalizacja i powiadomienia',
    locationBody:
      'Lokalizacja jest opcjonalna. Służy do wyszukiwania pobliskich przystanków, ustalania początku trasy i monitorowania aktywnej podróży. Podróż uruchomiona przez Ciebie może korzystać z GPS także przy zgaszonym ekranie, z widocznym powiadomieniem usługi. Aplikacja nie żąda stałego dostępu do lokalizacji w tle. Powiadomienia obejmują przypiętą podróż, alarm odjazdu i przypomnienia o wysiadaniu. Możesz zatrzymać podróż lub wycofać zgody w ustawieniach Androida. Bez zgód nadal wybierzesz początek trasy ręcznie.',
    networkTitle: 'Zapytania do usług zewnętrznych',
    networkBody:
      'Rozkłady pobieramy z infrastruktury Kilometr, a komunikaty i pozycje pojazdów z usług operatorów i dostawców danych transportowych. OpenStreetMap Nominatim otrzymuje tekst wyszukiwanego adresu i obszar miasta, a przy zamianie pozycji GPS na adres również współrzędne. OpenFreeMap otrzymuje żądania kafelków obszaru mapy. Publiczny serwer OSRM otrzymuje współrzędne punktów trasy, gdy aplikacja pobiera jej geometrię. Dostawcy otrzymują też adres IP i parametry żądania; mogą zapisywać logi zgodnie z własnymi zasadami. Te połączenia służą realizacji wybranych funkcji.',
    exportTitle: 'Eksport danych',
    exportBody:
      'Eksport kopii zapasowej tworzy plik z zapisanymi miejscami, historią i ustawieniami. Udostępnione połączenie może zawierać nazwy i współrzędne początku oraz celu, przystanki i godziny podróży. Link przechowuje te informacje w części po znaku #, którą strona odczytuje w przeglądarce. Każdy odbiorca pliku, obrazu lub linku może poznać jego treść i przekazać go dalej. Udostępnianie uruchamiasz samodzielnie.',
    retentionTitle: 'Przechowywanie i usuwanie',
    retentionBody:
      'Dane lokalne pozostają na urządzeniu, dopóki ich nie usuniesz lub aplikacja nie zastąpi ich nowszą pamięcią podręczną. Zapisane miejsca i historię usuniesz w aplikacji. Wszystkie dane lokalne usuniesz przez Ustawienia Androida → Aplikacje → Kilometr → Pamięć → Wyczyść dane. Wyeksportowane pliki i kopie u odbiorców usuwa się osobno. Okres przechowywania logów usług zewnętrznych określają ich operatorzy.',
    securityTitle: 'Przesyłanie danych',
    securityBody:
      'Domyślne publiczne usługi rozkładów, map, adresów i geometrii tras używają HTTPS. Dane lokalne są przechowywane w prywatnej pamięci aplikacji chronionej przez Androida. Wyeksportowane pliki i linki do podróży nie są zabezpieczone hasłem. Nie udostępniaj ich, jeśli zawierają adres, którego nie chcesz ujawniać.',
    webTitle: 'Ta strona',
    webBody:
      'Strona zapamiętuje wyłącznie wybrany język w pamięci przeglądarki. Nie ładuje narzędzi analitycznych ani reklam. Hosting GitHub Pages i zewnętrzne strony, które otworzysz przez linki, podlegają zasadom ich operatorów.',
    contactTitle: 'Kontakt w sprawie prywatności',
    contactBody:
      'Za projekt Kilometr odpowiada sioodmy (github.com/sioodmy). Pytania o prywatność i prośby dotyczące danych możesz zgłaszać przez Issues w repozytorium github.com/sioodmy/kilometr. Zgłoszenia są publiczne, dlatego nie umieszczaj w nich adresu domowego ani innych wrażliwych danych. Zmiany sposobu przetwarzania danych będą opisane w tej polityce z nową datą aktualizacji.',
    contact: 'Otwórz zgłoszenie',
  },
  report: {
    title: 'Benchmark planera',
    intro:
      'Historyczne porównanie dla Wrocławia. Wyniki dotyczą badanego zestawu tras, a nie całej Polski ani bieżących warunków podróży.',
    sample: '72 trasy. Dni robocze i weekend.',
    body: 'Porównanie z jakdojade obejmuje 72 trasy w dni robocze i weekend, z oknem startów do 120 minut. Kilometr znalazł wcześniejszy przyjazd w 46 przypadkach, taki sam w 24, późniejszy w 2.',
    methodology: 'Kod i metodologia porównania',
  },
};

export type Strings = typeof pl;
