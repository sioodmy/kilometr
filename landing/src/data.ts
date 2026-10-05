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
  // Ostatnie miejsca z pr-45-szybkie-cele-bez-duplikatu.png.
  // Czas odjazdu z tego samego screena; badge linii nie jest znany, więc
  // wiersz renderuje się bez niego — dokładnie jak stan, gdy planer jeszcze
  // nie dogrzał połączenia (pusty badgeSlot 28 px).
  recent: [
    { name: 'DWORZEC GŁÓWNY', dep: 'za 5 min' },
    { name: 'Hala Targowa', dep: 'za chwilę' },
    { name: 'Rynek', dep: 'za chwilę' },
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
