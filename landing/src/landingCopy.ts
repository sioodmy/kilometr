import type { Locale } from './i18n';

export type ReleaseCopy = {
  hero: {
    titleLine1: string;
    titleAccent: string;
    subtitle: string;
    mapOrigin: string;
    mapDestination: string;
    phoneMainAlt: string;
    phoneLeftAlt: string;
    phoneRightAlt: string;
  };
  story: {
    title: string;
    subtitle: string;
    chapters: readonly {
      id: string;
      number: string;
      tag: string;
      title: string;
      body: string;
      shot: string;
      alt: string;
      statusTime: string;
    }[];
  };
  transfers: {
    title: string;
    body: string;
    urbanLabel: string;
    urbanTitle: string;
    urbanBody: string;
    urbanAlts: readonly string[];
    railLabel: string;
    railTitle: string;
    railBody: string;
    railAlts: readonly string[];
  };
  disruptions: {
    title: string;
    body: string;
    phoneAlt: string;
  };
  donate: {
    title: string;
    body: string;
    points: readonly string[];
    ctaPrimary: string;
    ctaSecondary: string;
    note: string;
  };
};

const COPY: Record<Locale, ReleaseCopy> = {
  pl: {
    hero: {
      titleLine1: 'Tym razem dojedziesz',
      titleAccent: 'Czym chcesz, Jak chcesz',
      subtitle:
        'Open Source planer tras komunikacją miejską i koleją w całej Polsce',
      mapOrigin: 'Sky Tower',
      mapDestination: 'Katedra',
      phoneMainAlt: 'Kilometr: ekran szczegółów połączenia z informacją o pojeździe i czasie na żywo',
      phoneLeftAlt: 'Kilometr: lista połączeń Sky Tower do Katedry z czasami na żywo',
      phoneRightAlt: 'Kilometr: szczegóły połączenia kolejowego IC 8330 Ślązak z peronem, udogodnieniami i mapą trasy',
    },
    story: {
      title: 'Wszystko czego potrzebujesz',
      subtitle: 'Od wyjścia z domu, przez tramwaj, aż po pociąg.',
      chapters: [
        {
          id: 'connections',
          number: '01',
          tag: 'Lokalny silnik tras',
          title: 'Połączenia jakie już znasz, w lepszej odsłonie',
          body: 'Komunikacja miejska i kolej, połączona w jednej aplikacji. Trasy liczone offline na Twoim telefonie, ze wsparciem opóźnień i zmian w rozkładach',
          shot: './screenshots/routes-urban.webp',
          alt: 'Lista połączeń MPK Wrocław ze Sky Tower do Katedry',
          statusTime: '08:51',
        },
        {
          id: 'details',
          number: '02',
          tag: 'Szczegóły kursu',
          title: 'Szczegóły, które pokochasz',
          body: 'Zawsze wiesz czym i kiedy jedziesz. Bez wątpliwości z którego przystanku.',
          shot: './screenshots/details-urban.webp',
          alt: 'Szczegóły połączenia z numerem słupka, modelem tramwaju i świeżością GPS',
          statusTime: '08:54',
        },
        {
          id: 'intercity',
          number: '03',
          tag: 'PKP Intercity i kolej',
          title: 'Odstaw Portal Pasażera z powrotem do 2010',
          body: 'Sprawdzisz opóźnienie, peron i tor. Jak zgłodniejesz, to sprawdzisz, czy w składzie jest wagon restauracyjny lub Żabka na dworcu.',
          shot: './screenshots/details-ic.webp',
          alt: 'Szczegóły połączenia kolejowego PKP Intercity IC 8330 Ślązak z peronem, torem, udogodnieniami i mapą trasy',
          statusTime: '09:32',
        },
      ],
    },
    transfers: {
      title: 'Zanim przesiadka ucieknie, masz już plan B.',
      body: 'Jakdojade bez zawahania wystawi cię na ryzykowną przesiadkę. Kilometr po rozpoczęciu połączenia pilnuje Twoich przesiadek i zaproponuje alternatywę, gdy pojawi się opóźnienie. Jeśli pojazd nie posiada nadajnika GPS, użyje lokalizacji z Twojego telefonu.',
      urbanLabel: 'Komunikacja miejska',
      urbanTitle: 'Pilnuje minut na przesiadkę.',
      urbanBody:
        'Kiedy wszystko idzie zgodnie z planem, widzisz dokładny zapas czasu. Gdy pojawia się opóźnienie, dostajesz gotowe opcje objazdu z tego samego albo sąsiedniego przystanku.',
      urbanAlts: [
        'Ochrona przesiadek w Kilometrze: bezpieczny zapas 5 minut na przesiadkę',
        'Ochrona przesiadek w Kilometrze: opóźnienie i 2 gotowe alternatywne połączenia',
      ],
      railLabel: 'Kolej w całej Polsce',
      railTitle: 'Od tramwaju prosto na peron Intercity.',
      railBody:
        'Jedna aplikacja łączy miejski dojazd na dworzec z pociągami PKP Intercity i przewoźników regionalnych, pokazuje peron, skład i opóźnienie oraz ostrzega o zagrożonej przesiadce.',
      railAlts: [
        'Lista połączeń kolejowych Wrocław Główny do Warszawa Centralna',
        'Szczegóły połączenia kolejowego PKP Intercity IC 8330 Ślązak z udogodnieniami i mapą',
        'Ochrona przesiadek kolejowych z podpowiedzią następnego pociągu IC 6200',
      ],
    },
    disruptions: {
      title: 'Koniec czytania ściany urzędowego tekstu',
      body: 'Czytasz regularnie wszystkie komunikaty lokalnego przewoźnika? My też nie, dlatego Kilometr czyta je za ciebie, rozumie i przedstawia w czytelnej formie.',
      phoneAlt: 'Szczegóły dużego utrudnienia ZTM GZM w Chorzowie z liniami 6, 61 i komunikacją zastępczą T-6',
    },
    donate: {
      title: 'Niezależna aplikacja, rozwijana po godzinach.',
      body: 'Kilometr nie wyświetla reklam, nie sprzedaje danych i nie zamyka funkcji za abonamentem. Jeśli aplikacja oszczędza Ci czas w drodze, możesz dorzucić się do serwerów rozkładów i dalszego rozwoju.',
      points: [
        'Utrzymanie serwerów rozkładów GTFS i odczytów GPS na żywo',
        'Zero reklam, zero trackerów, zero płatnych planów',
        'Otwarty kod źródłowy rozwijany publicznie na GitHubie',
      ],
      ctaPrimary: 'Postaw kawę na BuyCoffee',
      ctaSecondary: 'Zobacz kod na GitHubie',
      note: 'Jednorazowe, dobrowolne wsparcie · bez rejestracji',
    },
  },

  en: {
    hero: {
      titleLine1: 'This time you get there',
      titleAccent: 'By whatever, however you want',
      subtitle:
        'Open source journey planner for public transport and rail across Poland',
      mapOrigin: 'Sky Tower',
      mapDestination: 'Katedra',
      phoneMainAlt: 'Kilometr trip details screen showing live vehicle model and telemetry',
      phoneLeftAlt: 'Kilometr route list from Sky Tower to Katedra with live departure times',
      phoneRightAlt: 'Kilometr PKP Intercity IC 8330 connection details with platform, onboard amenities, live delay, and route map',
    },
    story: {
      title: 'Everything you need',
      subtitle: 'From leaving home, through the tram, all the way to the train.',
      chapters: [
        {
          id: 'connections',
          number: '01',
          tag: 'On-device routing',
          title: 'Connections you already know, in a better version',
          body: 'Public transport and rail combined in one app. Routes calculated offline on your phone, with delays and timetable changes taken into account',
          shot: './screenshots/routes-urban.webp',
          alt: 'Kilometr urban connections list in Wroclaw',
          statusTime: '08:51',
        },
        {
          id: 'details',
          number: '02',
          tag: 'Trip details',
          title: 'Details you will love',
          body: 'You always know what you are riding and when. No doubt about which stop.',
          shot: './screenshots/details-urban.webp',
          alt: 'Kilometr connection details with boarding post, tram model, and GPS freshness',
          statusTime: '08:54',
        },
        {
          id: 'intercity',
          number: '03',
          tag: 'PKP Intercity & rail',
          title: 'Send Portal Pasażera back to 2010',
          body: 'Check the delay, platform and track. If you get hungry, check whether the train has a dining car or a Żabka at the station.',
          shot: './screenshots/details-ic.webp',
          alt: 'Kilometr PKP Intercity IC 8330 trip details with platform, amenities, live delay, and route map',
          statusTime: '09:32',
        },
      ],
    },
    transfers: {
      title: 'Have Plan B ready before the transfer slips away.',
      body: 'Jakdojade will send you into a risky transfer without hesitation. Once your journey starts, Kilometr watches your transfers and suggests an alternative when a delay appears. If a vehicle has no GPS transmitter, it uses your phone location.',
      urbanLabel: 'City transit',
      urbanTitle: 'Guards every minute between rides.',
      urbanBody:
        'When everything runs smoothly, you see your exact walking buffer. The moment a delay threatens the connection, ready-made alternatives appear immediately.',
      urbanAlts: [
        'Kilometr Transfer Protection showing a safe 5 minute transfer buffer',
        'Kilometr Transfer Protection showing a delay with 2 alternative routes',
      ],
      railLabel: 'Nationwide rail',
      railTitle: 'From city tram straight to the Intercity platform.',
      railBody:
        'Combine urban transit to the station with PKP Intercity and regional rail, check your platform and rolling stock amenities, and stay protected against tight station transfers.',
      railAlts: [
        'Kilometr rail connections from Wroclaw Glowny to Warszawa Centralna',
        'Kilometr PKP Intercity IC 8330 trip details with platform, amenities, and route map',
        'Kilometr rail transfer protection highlighting the next IC 6200 train',
      ],
    },
    disruptions: {
      title: 'No more reading walls of official text',
      body: 'Do you read every alert from your local operator? Neither do we, so Kilometr reads them for you, understands them and presents them in a clear form.',
      phoneAlt: 'Kilometr structured ZTM GZM disruption detail screen showing lines 6, 61, and replacement bus T-6',
    },
    donate: {
      title: 'An independent transit app, built after hours.',
      body: 'Kilometr has no ads, no data brokers, and no paywalls. If it saves you time on your daily commute, a coffee helps cover GTFS timetable servers, live GPS feeds, and ongoing development.',
      points: [
        'Covers GTFS timetable build pipelines and live GPS feeds',
        'No ads, no analytics trackers, no subscription tiers',
        'Open source and developed in the open on GitHub',
      ],
      ctaPrimary: 'Buy a coffee on BuyCoffee',
      ctaSecondary: 'View source on GitHub',
      note: 'One-time voluntary support · no account required',
    },
  },

  de: {
    hero: {
      titleLine1: 'Diesmal kommst du an',
      titleAccent: 'Womit du willst, wie du willst',
      subtitle:
        'Open-Source-Routenplaner für Nahverkehr und Bahn in ganz Polen',
      mapOrigin: 'Sky Tower',
      mapDestination: 'Katedra',
      phoneMainAlt: 'Kilometr Verbindungsdetails mit Fahrzeugmodell und Live-Status',
      phoneLeftAlt: 'Kilometr Verbindungsliste Sky Tower nach Katedra mit Live-Zeiten',
      phoneRightAlt: 'Kilometr PKP Intercity IC 8330 Verbindungsdetails mit Bahnsteig, Zugausstattung, Verspätung und Streckenkarte',
    },
    story: {
      title: 'Alles, was du brauchst',
      subtitle: 'Vom Verlassen des Hauses über die Straßenbahn bis zum Zug.',
      chapters: [
        {
          id: 'connections',
          number: '01',
          tag: 'Lokale Routen-Engine',
          title: 'Verbindungen, die du kennst, in besserer Form',
          body: 'Nahverkehr und Bahn in einer App. Routen offline auf deinem Handy berechnet, mit Verspätungen und Fahrplanänderungen',
          shot: './screenshots/routes-urban.webp',
          alt: 'Kilometr Verbindungsliste im Stadtverkehr',
          statusTime: '08:51',
        },
        {
          id: 'details',
          number: '02',
          tag: 'Fahrtendetails',
          title: 'Details, die du lieben wirst',
          body: 'Du weißt immer, womit und wann du fährst. Keine Zweifel, von welcher Haltestelle.',
          shot: './screenshots/details-urban.webp',
          alt: 'Kilometr Verbindungsdetails mit Haltepunkt und Fahrzeugdaten',
          statusTime: '08:54',
        },
        {
          id: 'intercity',
          number: '03',
          tag: 'PKP Intercity & Bahn',
          title: 'Schick Portal Pasażera zurück ins Jahr 2010',
          body: 'Du siehst Verspätung, Bahnsteig und Gleis. Wenn du Hunger bekommst, prüfst du, ob der Zug einen Speisewagen oder einen Żabka am Bahnhof hat.',
          shot: './screenshots/details-ic.webp',
          alt: 'Kilometr PKP Intercity IC 8330 Verbindungsdetails mit Bahnsteig, Ausstattung und Karte',
          statusTime: '09:32',
        },
      ],
    },
    transfers: {
      title: 'Plan B steht bereit, bevor der Anschluss weg ist.',
      body: 'Jakdojade schickt dich ohne Zögern in einen riskanten Umstieg. Nach dem Start der Verbindung überwacht Kilometr deine Umstiege und schlägt eine Alternative vor, wenn eine Verspätung auftritt. Hat ein Fahrzeug keinen GPS-Sender, nutzt die App den Standort deines Telefons.',
      urbanLabel: 'Stadtverkehr',
      urbanTitle: 'Wacht über jede Minute beim Umstieg.',
      urbanBody:
        'Läuft alles nach Plan, siehst du dein Zeitpolster. Sobald eine Verspätung droht, liegen geprüfte Ausweichrouten bereit.',
      urbanAlts: [
        'Kilometr Umstiegsschutz mit 5 Minuten Zeitreserve',
        'Kilometr Umstiegsschutz bei Verspätung mit 2 Alternativen',
      ],
      railLabel: 'Bahn in ganz Polen',
      railTitle: 'Von der Straßenbahn direkt zum Intercity-Gleis.',
      railBody:
        'Verbindet Stadtverkehr zum Bahnhof mit PKP Intercity und Regionalbahnen, zeigt Bahnsteig und Ausstattung und schützt knappe Anschlüsse.',
      railAlts: [
        'Kilometr Bahnverbindungen Breslau nach Warschau',
        'Kilometr PKP Intercity IC 8330 Verbindungsdetails mit Ausstattung und Streckenkarte',
        'Kilometr Bahn-Umstiegsschutz mit Hinweis auf IC 6200',
      ],
    },
    disruptions: {
      title: 'Schluss mit dem Lesen von Wänden aus Behördentext',
      body: 'Liest du regelmäßig alle Meldungen deines lokalen Verkehrsbetriebs? Wir auch nicht, deshalb liest Kilometr sie für dich, versteht sie und stellt sie verständlich dar.',
      phoneAlt: 'Kilometr Störungsdetails ZTM GZM mit betroffenen Linien 6, 61 und Ersatzbus T-6',
    },
    donate: {
      title: 'Unabhängig entwickelt, ohne Investoren.',
      body: 'Kilometr zeigt keine Werbung, sammelt keine Nutzerdaten und versteckt nichts hinter Abos. Wenn dir die App unterwegs hilft, unterstützt jeder Kaffee die Fahrplan-Server und die Weiterentwicklung.',
      points: [
        'Deckt GTFS-Fahrplanserver und Live-GPS-Feeds ab',
        'Keine Werbung, keine Tracker, keine Bezahlschranken',
        'Quelloffen und transparent auf GitHub entwickelt',
      ],
      ctaPrimary: 'Kaffee auf BuyCoffee spendieren',
      ctaSecondary: 'Quellcode auf GitHub',
      note: 'Freiwillige, einmalige Unterstützung · ohne Konto',
    },
  },

  uk: {
    hero: {
      titleLine1: 'Цього разу доїдеш',
      titleAccent: 'Чим хочеш, як хочеш',
      subtitle:
        'Open Source планер маршрутів громадським транспортом і залізницею по всій Польщі',
      mapOrigin: 'Sky Tower',
      mapDestination: 'Katedra',
      phoneMainAlt: 'Kilometr: екран деталей маршруту з моделлю транспорту та часом наживо',
      phoneLeftAlt: 'Kilometr: список маршрутів зі Sky Tower до Katedra з часом наживо',
      phoneRightAlt: 'Kilometr: деталі поїзда PKP Intercity IC 8330 із пероном, зручностями, запізненням і картою маршруту',
    },
    story: {
      title: 'Все, що потрібно',
      subtitle: 'Від виходу з дому, через трамвай, аж до потяга.',
      chapters: [
        {
          id: 'connections',
          number: '01',
          tag: 'Локальний рушій',
          title: 'Звичні з’єднання в кращому вигляді',
          body: 'Громадський транспорт і залізниця в одному застосунку. Маршрути рахуються офлайн на твоєму телефоні, з урахуванням запізнень і змін у розкладі',
          shot: './screenshots/routes-urban.webp',
          alt: 'Список міських маршрутів у Kilometr',
          statusTime: '08:51',
        },
        {
          id: 'details',
          number: '02',
          tag: 'Деталі рейсу',
          title: 'Деталі, які ти полюбиш',
          body: 'Ти завжди знаєш, чим і коли їдеш. Без сумнівів, з якої зупинки.',
          shot: './screenshots/details-urban.webp',
          alt: 'Деталі маршруту з номером стовпчика, моделлю трамвая та часом GPS',
          statusTime: '08:54',
        },
        {
          id: 'intercity',
          number: '03',
          tag: 'PKP Intercity і залізниця',
          title: 'Поверни Portal Pasażera у 2010 рік',
          body: 'Перевіриш запізнення, перон і колію. Якщо зголоднієш, перевіриш, чи є у поїзді вагон-ресторан або Żabka на вокзалі.',
          shot: './screenshots/details-ic.webp',
          alt: 'Деталі поїзда PKP Intercity IC 8330 із пероном, зручностями, запізненням і картою',
          statusTime: '09:32',
        },
      ],
    },
    transfers: {
      title: 'План Б готовий ще до того, як рейс утікає.',
      body: 'Jakdojade без вагань відправить тебе на ризиковану пересадку. Після початку поїздки Kilometr стежить за твоїми пересадками й запропонує альтернативу, коли з’явиться запізнення. Якщо транспорт не має GPS-передавача, застосунок використає місцеположення твого телефона.',
      urbanLabel: 'Міський транспорт',
      urbanTitle: 'Пильнує кожну хвилину пересадки.',
      urbanBody:
        'Коли все йде за планом, бачиш точний запас часу. Щойно запізнення загрожує пересадці, одразу отримуєш готові варіанти обʼїзду.',
      urbanAlts: [
        'Захист пересадок у Kilometr: безпечний запас 5 хвилин',
        'Захист пересадок у Kilometr: запізнення і 2 готові альтернативи',
      ],
      railLabel: 'Залізниця по всій Польщі',
      railTitle: 'Із міського трамвая просто на перон Intercity.',
      railBody:
        'Один застосунок поєднує міський доїзд до вокзалу з поїздами PKP Intercity та регіональних перевізників, показує перон, зручності та попереджає про ризиковану пересадку.',
      railAlts: [
        'Залізничні маршрути Вроцлав Головний до Варшави Центральної',
        'Деталі поїзда PKP Intercity IC 8330 із пероном, зручностями та картою маршруту',
        'Захист залізничних пересадок із підказкою наступного поїзда IC 6200',
      ],
    },
    disruptions: {
      title: 'Кінець читанню стіни офіційного тексту',
      body: 'Ти регулярно читаєш усі повідомлення місцевого перевізника? Ми теж ні, тому Kilometr читає їх за тебе, розуміє й подає у зрозумілій формі.',
      phoneAlt: 'Деталі значного ускладнення ZTM GZM у Хожуві з лініями 6, 61 і замінним автобусом T-6',
    },
    donate: {
      title: 'Незалежний застосунок, створений після роботи.',
      body: 'У Kilometr немає реклами, трекерів і платних підписок. Якщо застосунок економить твій час у дорозі, кава на BuyCoffee допоможе оплатити сервери розкладів GTFS і подальший розвиток.',
      points: [
        'Оплата серверів розкладів GTFS і живих даних GPS',
        'Жодної реклами, трекерів чи платних тарифів',
        'Відкритий вихідний код на GitHub',
      ],
      ctaPrimary: 'Пригостити кавою на BuyCoffee',
      ctaSecondary: 'Код на GitHub',
      note: 'Добровільна разова підтримка · без реєстрації',
    },
  },
};

export function useReleaseCopy(locale: Locale): ReleaseCopy {
  return COPY[locale] ?? COPY.pl;
}
