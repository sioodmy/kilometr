import { previewRoute } from './journey';
import { previewHome } from './home';

export const pl = {
  meta: {
    title: 'Kilometr',
    imageAlt:
      'Kilometr. Twój planer podróży open source. Ekran aplikacji na iPhonie, herby miast i schemat sieci komunikacji.',
    description:
      'Komunikacja miejska w miastach w całej Polsce. Planuj trasy, sprawdzaj odjazdy i korzystaj z rozkładów offline. Bezpłatnie na Androidzie.',
  },
  skip: 'Przejdź do treści',
  nav: {
    label: 'Nawigacja główna',
  },
  language: 'Język strony',
  hero: {
    eyebrow: 'Kilometr na Androida',
    title: 'Twój',
    accent: 'open-source',
    titleEnd: 'planer podróży',
    body: 'Zaplanuj trasę, sprawdź odjazdy i ruszaj w miasto. Komunikacja miejska w całej Polsce, także offline. Bez reklam i bez konta.',
  },
  install: {
    android: 'Android',
    ios: 'iOS',
    platform: 'Wybierz system telefonu',
    newTab: '(otwiera się w nowej karcie)',
  },
  android: {
    title: 'Dołącz do bety Play Store',
    intro:
      'Kilometr jest w fazie testów. Aby pobrać aplikację na Androida, najpierw dołącz do grupy testerów, a potem zapisz się do bety w Google Play.',
    noteTitle: 'Jedno konto Google w obu krokach',
    noteBody:
      'Do grupy i do bety dołącz z tego samego konta Google. Używaj go też w Sklepie Play na telefonie.',
    group: {
      title: 'Dołącz do grupy testerów',
      body: 'Otwórz grupę Kilometr w Google Groups. Zaloguj się i wybierz „Dołącz do grupy”. Samo otwarcie strony nie wystarczy.',
      action: 'Dołącz do grupy Google',
    },
    testing: {
      title: 'Zapisz się do bety i pobierz aplikację',
      body: 'Po dołączeniu do grupy otwórz stronę testów. Potwierdź udział w programie, a następnie przejdź z niej do Google Play i zainstaluj Kilometr.',
      action: 'Dołącz do bety w Google Play',
    },
    helpTitle: 'Nie widzisz dostępu do testów?',
    helpBody:
      'Sprawdź, czy grupa, strona testów i Sklep Play używają tego samego konta Google. Jeśli dopiero dołączasz do grupy, odczekaj chwilę i odśwież stronę testów. To wersja testowa, więc możesz trafić na błędy.',
    alternative: {
      title: 'Bojkotujesz Google? Pobierz prosto ze źródła',
      body: 'Obtainium pobiera Kilometr i jego aktualizacje bezpośrednio z naszego GitHuba. Przycisk otworzy konfigurację w Obtainium lub pomoże Ci je zainstalować.',
      obtainium: 'Dodaj do Obtainium',
      fdroid: 'F-Droid',
      soon: 'Wkrótce',
      json: 'Pobierz konfigurację Obtainium (JSON)',
    },
  },
  ios: {
    title: 'Zainstaluj na iOS',
    intro:
      'Kilometr na iOS zainstalujesz samodzielnie z pliku IPA, poza App Store. Ten sposób instalacji nazywa się sideloadingiem. Poniżej instrukcja z użyciem Sideloadly.',
    noteTitle: 'Przygotuj telefon i komputer',
    noteBody:
      'Potrzebujesz iPhone’a z iOS 16.4 lub nowszym, komputera z macOS lub Windows, kabla USB i konta Apple. Wystarczy bezpłatne konto.',
    download: {
      title: 'Pobierz plik aplikacji',
      body: 'Zapisz plik kilometr-unsigned.ipa z najnowszego wydania na komputerze. Jest niepodpisany. Własnym kontem Apple podpiszesz go podczas instalacji.',
      action: 'Pobierz IPA',
    },
    tool: {
      title: 'Zainstaluj Sideloadly na komputerze',
      body: 'Pobierz wersję dla swojego systemu z oficjalnej strony. Na Windows zainstaluj też wskazane tam wersje iTunes i iCloud od Apple.',
      action: 'Pobierz Sideloadly',
    },
    sign: {
      title: 'Podłącz iPhone’a i zainstaluj Kilometr',
      body: 'Odblokuj telefon, podłącz go kablem i zatwierdź zaufanie do komputera. W Sideloadly wybierz iPhone’a, przeciągnij plik IPA i podaj konto Apple. Zachowaj rozszerzenie KilometrLiveActivity, aby działały Live Activity i Dynamic Island. Kliknij Start i postępuj według komunikatów.',
    },
    open: {
      title: 'Zaufaj aplikacji na telefonie',
      body: 'Jeśli iOS tego wymaga, otwórz Ustawienia → Ogólne → VPN i zarządzanie urządzeniem i zaufaj profilowi swojego konta Apple. W Ustawienia → Prywatność i ochrona włącz Tryb dewelopera, jeśli pojawi się taka prośba. Potem otwórz Kilometr i pobierz rozkład swojego miasta.',
    },
    helpTitle: 'Pamiętaj o odnawianiu podpisu',
    helpBody:
      'Przy bezpłatnym koncie Apple podpis wygasa po 7 dniach. Odnawiaj go przez Sideloadly, zanim aplikacja przestanie się otwierać. Narzędzie obsługuje automatyczne odnawianie, gdy komputer i telefon mogą się połączyć. Przy aktualizacjach używaj tego samego konta Apple i identyfikatora aplikacji, aby zachować dane.',
    appStore: {
      title: 'Dlaczego Kilometr nie ma w App Store?',
      body: 'Apple żąda 99 USD rocznie za konto deweloperskie, nawet jeśli aplikacja jest darmowa. To skandaliczne zasady dla małych projektów open source, które faworyzują korporacje ponad niezależnych twórców. Nie mamy na to budżetu, więc na razie udostępniamy plik IPA do samodzielnej instalacji.',
      supportBody:
        'Chcesz pomóc nam pokryć tę opłatę? Możesz wesprzeć projekt. Każda wpłata pomaga nam rozwijać Kilometr i finansować jego publikację.',
    },
  },
  homePreview: {
    screenLabel: 'Ekran główny Kilometr na iPhonie',
    statusTime: '21:36',
    places: previewHome,
    title: 'Gdzie jedziemy?',
    savedTitle: 'Zapisane miejsca',
    edit: 'Edytuj',
    historyTitle: 'Ostatnie miejsca',
    home: 'Dom',
    school: 'Uczelnia',
    gym: 'Siłownia',
    stop: 'Przystanek',
    searchLabel: 'Dokąd jedziesz?',
    startFrom: (title: string) => `z: ${title}`,
    departIn: (n: number) => `za ${n} min`,
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
  footer: {
    tagline: 'Do zobaczenia w drodze.',
    privacy: 'Prywatność',
    github: 'GitHub',
    license: 'Wolne oprogramowanie. GPL-3.0.',
    back: 'Wróć na stronę główną',
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
};

export type Strings = typeof pl;
