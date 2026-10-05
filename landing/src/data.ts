// Dane do mocków UI — TYLKO rzeczy potwierdzone screenami z prawdziwego
// telefonu (docs/screenshots/) albo stringami z src/i18n/pl.ts.
// Nie dopisuj tu nowych linii/przystanków bez dowodu z aplikacji.
export const CONFIRMED = {
  // Napisy dokładnie ze słownika src/i18n/pl.ts (s.home.*), żeby mock nie
  // rozjechał się z aplikacją przy zmianie tłumaczenia.
  homeTitle: 'Gdzie jedziemy?', // s.home.title
  searchLabel: 'Dokąd jedziesz?', // s.home.searchLabel
  startFrom: 'z: Twoja lokalizacja', // s.home.startFrom('Twoja lokalizacja')
  savedTitle: 'Zapisane miejsca', // s.home.savedTitle
  recentTitle: 'Ostatnie miejsca', // s.home.historyTitle
  // Ostatnie miejsca z pr-45-szybkie-cele-bez-duplikatu.png, czasy odjazdu
  // z tego samego screena.
  //
  // `kind` decyduje o ikonce wiersza — tak samo jak w aplikacji, gdzie
  // `getSuggestionIconMeta` patrzy na rodzaj wyniku wyszukiwarki:
  // `stop` → BusFront, `address` → MapPin (niebieski tertiaryContainer).
  //
  // `line` to badge pierwszej linii z `lineBadges`. Uzupełniamy tylko tam,
  // gdzie kurs jest potwierdzony w ekranach aplikacji (tramwaj 23 do
  // Nowego Dworu); pozostałe wiersze zostawiają pusty slot, bo planer ich
  // jeszcze nie dogrzał.
  recent: [
    { name: 'DWORZEC GŁÓWNY', dep: 'za 5 min', kind: 'stop', line: '23' },
    { name: 'Hala Targowa', dep: 'za chwilę', kind: 'stop', line: undefined },
    { name: 'Rynek', dep: 'za chwilę', kind: 'address', line: undefined },
  ],
  // Połączenie z pr-43-lista-bez-regresji.png (tramwaj 23 istnieje w GTFS)
  connection: {
    departIn: 'za 8 min',
    time: '09:27 → 09:34',
    via: 'bezpośrednio',
    line: '23',
    headsign: 'Wrocław Nowy Dwór',
    duration: '7 min',
  },
} as const;

export const REPO = 'sioodmy/kilometr';
export const APK_FILE = 'app-release.apk';
export const APK_FALLBACK = `https://github.com/${REPO}/releases/latest/download/${APK_FILE}`;
export const OBTAINIUM_URL = `obtainium://app/https://github.com/${REPO}`;
export const RELEASES_URL = `https://github.com/${REPO}/releases`;
export const GITHUB_URL = `https://github.com/${REPO}`;
