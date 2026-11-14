export const pl = {
  title: 'Udostępnij połączenie',
  subtitle: 'Daj znać, czym jedziesz i o której będziesz.',
  brand: 'Kilometr',
  arrival: 'Na miejscu',
  departure: 'Wyjazd',
  from: 'Skąd',
  to: 'Dokąd',
  duration: (n: number) => (n >= 60 ? `${Math.floor(n / 60)}h${n % 60 > 0 ? ` ${n % 60}m` : ''}` : `${n} min`),
  transfers: (n: number) =>
    n === 0
      ? 'Bez przesiadek'
      : n === 1
        ? '1 przesiadka'
        : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14)
          ? `${n} przesiadki`
          : `${n} przesiadek`,
  walk: 'Pieszo',
  walkDistance: (n: number) => `${n} m pieszo`,
  modes: {
    walk: 'Pieszo',
    tram: 'Tramwaj',
    bus: 'Autobus',
    train: 'Pociąg',
    cable: 'Kolej linowa',
    trolleybus: 'Trolejbus',
    subway: 'Metro',
  },
  direction: (name: string) => `Kierunek: ${name}`,
  cardLabel: (from: string, to: string, at: string) =>
    `Połączenie z ${from} do ${to}, na miejscu o ${at}`,
  imageAndLink: 'Udostępnij kartę i link',
  linkOnly: 'Udostępnij link',
  download: 'Pobierz kartę',
  copy: 'Kopiuj link',
  copied: 'Link skopiowany',
  preparing: 'Przygotowuję kartę…',
  error: 'Nie udało się udostępnić. Spróbuj ponownie lub skopiuj link.',
  saveError: 'Nie udało się zapisać karty. Spróbuj ponownie.',
  close: 'Zamknij',
  message: (from: string, to: string, departure: string, arrival: string, lines: string) =>
    `Jadę z ${from} do ${to}${lines ? ` (${lines})` : ''}. Wyjazd ${departure}, na miejscu o ${arrival}.`,
  snapshot: 'Plan podróży z chwili udostępnienia. Opóźnienia nie aktualizują się.',
  estimatedPosition: 'Pozycja szacowana z rozkładu',
  positionNote: 'Ikonka przesuwa się według godzin rozkładu, bez danych GPS i bieżących opóźnień.',
  vehicleAt: (mode: string, stop: string) => `${mode}: ${stop}. Pozycja szacowana z rozkładu.`,
  vehicleBetween: (mode: string, from: string, to: string) =>
    `${mode}: między ${from} a ${to}. Pozycja szacowana z rozkładu.`,
  hideStops: 'Zwiń przystanki',
  privacy: 'Link zawiera trasę i godziny. Otworzy go każdy, komu go wyślesz.',
  pageTitle: 'Udostępnione połączenie',
  openApp: 'Otwórz w aplikacji',
  appHint: 'W aplikacji zobaczysz mapę i pozycję pojazdu, gdy są dostępne dane GPS.',
  nativeHint: 'Link otwiera połączenie w aplikacji. Bez aplikacji działa podgląd w przeglądarce.',
  follow: 'Przypnij do powiadomień',
  following: 'Zakończ obserwowanie',
  followHint: 'Przyjazd i przebieg podróży na ekranie blokady. Bez dostępu do Twojej lokalizacji.',
  vehicleLive: 'Pozycja pojazdu z GPS',
  noVehicle:
    'Brak aktualnej pozycji GPS. Mapa pokazuje trasę, a godziny pochodzą z udostępnionego planu.',
  vehicleOnly: 'Śledzisz pojazd. Link nie udostępnia lokalizacji osoby, która go wysłała.',
  finished: 'Podróż zakończona',
  planned: 'Plan podróży',
  map: 'Mapa podróży',
  fitMap: 'Pokaż całą trasę',
  mapUnavailable: 'Geometria trasy jest niedostępna. Spróbuj wczytać ją ponownie.',
  geometryLoading: 'Wczytuję przebieg trasy…',
  approximateGeometry: 'Przebieg przybliżony przez przystanki.',
  mapError: 'Nie udało się wczytać mapy. Przebieg podróży znajdziesz poniżej.',
  retryMap: 'Wczytaj mapę ponownie',
  switchCity: (city: string) => `Otwórz połączenie: ${city}`,
  switchCityHint: 'Połączenie jest z innego miasta. Przełączenie miasta zakończy obecne śledzenie.',
  replaceTitle: 'Obserwować to połączenie?',
  replaceBody: 'Obecne śledzenie zostanie zakończone. Powiadomienie pokaże udostępnioną podróż.',
  trackError: 'Nie udało się przypiąć połączenia. Spróbuj ponownie.',
  notificationTitle: (place: string, time: string) => `${place}, przyjazd ${time}`,
  notificationWalkingTitle: (place: string, time: string) => `Udostępnione • cel ${place} o ${time}`,
  notificationDepartTitle: (service: string, time: string) => `Udostępnione • ${service} odj. ${time}`,
  notificationRideTitle: (service: string, time: string) => `Udostępnione • ${service} przyj. ${time}`,
  notificationTransferTitle: (service: string, time: string) =>
    `Udostępnione • przesiadka ${service} o ${time}`,
  notificationBoardStop: (stop: string) => `Start odcinka: ${stop}`,
  notificationToStop: (stop: string) => `W stronę: ${stop}`,
  notificationArrived: 'Udostępniona podróż dotarła do celu',
  notificationArrivedBody: (place: string, time: string) => `${place} • planowo ${time}`,
  planYourOwn: 'Zaplanuj w wyszukiwarce',
  inProgress: 'W trasie',
  upcoming: 'Przed odjazdem',
  arrTime: (time: string) => `przyj. ${time}`,
  depTime: (time: string) => `odj. ${time}`,
  dwellMin: (min: number) => `postój ${min} min`,
  platformLabel: (platform?: string, track?: string) =>
    platform && track
      ? `Peron ${platform}, Tor ${track}`
      : platform
        ? `Peron ${platform}`
        : track
          ? `Tor ${track}`
          : '',
  liveDelay: (min: number) =>
    min > 0 ? `+${min} min opóźnienia` : min < 0 ? `${Math.abs(min)} min przed czasem` : 'Na czas',
  itinerary: 'Przebieg podróży',
  loading: 'Wczytuję przystanki z rozkładu…',
  stopsUnavailable:
    'Szczegóły przystanków są niedostępne. Powyżej znajdziesz udostępnione godziny i przesiadki.',
  retry: 'Wczytaj przystanki ponownie',
  showStops: (n: number) => `Pokaż przystanki (${n})`,
  timetable: 'Statyczny rozkład',
  invalidTitle: 'Nie można otworzyć połączenia',
  invalidBody: 'Link jest niepełny lub uszkodzony. Poproś o ponowne udostępnienie połączenia.',
  home: 'Strona Kilometra',
  dayLater: (n: number) => `+${n} d`,
};

export type ShareStrings = typeof pl;
