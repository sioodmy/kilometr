export const pl = {
  title: 'Udostępnij połączenie',
  subtitle: 'Daj znać, czym jedziesz i o której będziesz.',
  brand: 'Kilometr',
  arrival: 'Na miejscu',
  departure: 'Wyjazd',
  from: 'Skąd',
  to: 'Dokąd',
  duration: (n: number) => `${n} min`,
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
  sms: 'Wyślij SMS',
  copy: 'Kopiuj link',
  copied: 'Link skopiowany',
  preparing: 'Przygotowuję kartę…',
  error: 'Nie udało się udostępnić. Spróbuj ponownie lub skopiuj link.',
  smsError: 'Nie udało się otworzyć SMS-a. Skopiuj link i wklej go do wiadomości.',
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
