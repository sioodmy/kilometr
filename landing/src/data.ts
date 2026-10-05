// Dane do mocków UI — TYLKO rzeczy potwierdzone screenami z prawdziwego
// telefonu (docs/screenshots/) albo stringami z src/i18n/pl.ts.
// Nie dopisuj tu nowych linii/przystanków bez dowodu z aplikacji.
export const CONFIRMED = {
  homeTitle: 'Gdzie jedziemy?',
  originLabel: 'Twoja lokalizacja',
  searchHint: 'Dokąd jedziesz?',
  savedTitle: 'Zapisane miejsca',
  recentTitle: 'Ostatnie miejsca',
  // Ostatnie miejsca z pr-45-szybkie-cele-bez-duplikatu.png
  recent: [
    { name: 'DWORZEC GŁÓWNY', sub: 'Przystanek', eta: '~18 min', dep: 'za 5 min' },
    { name: 'Hala Targowa', sub: 'Przystanek', eta: '~18 min', dep: 'za chwilę' },
    { name: 'Rynek', sub: 'Wrocław', eta: '~18 min', dep: 'za chwilę' },
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
