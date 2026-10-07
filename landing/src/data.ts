// Dane do mocków UI: TYLKO rzeczy potwierdzone screenami z prawdziwego
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
  // Ostatnie miejsca z pr-45-szykkie-cele-bez-duplikatu.png, czasy odjazdu
  // z tego samego screena.
  //
  // `kind` decyduje o ikonce wiersza, tak samo jak w aplikacji, gdzie
  // `getSuggestionIconMeta` patrzy na rodzaj wyniku wyszukiwarki:
  // `stop` -> BusFront, `address` -> MapPin (niebieski tertiaryContainer).
  //
  // `line` to badge pierwszej linii z `lineBadges`. Linie są prawdziwe:
  // tramwaj 23 do Nowego Dworu widać na ekranach aplikacji, a 5 i 3 stawiają
  // na tych przystankach w rozkładach MPK. Kolory pochodzą z deterministycznego
  // hasza w `getLineColors` (src/services/lineIdentity.ts), więc wiersz ma
  // dokładnie ten sam kolor co badge w aplikacji.
  recent: [
    { name: 'DWORZEC GŁÓWNY', dep: 'za 5 min', kind: 'stop', line: '23', color: '#E64A19' },
    { name: 'Hala Targowa', dep: 'za chwilę', kind: 'stop', line: '5', color: '#BF360C' },
    { name: 'Rynek', dep: 'za chwilę', kind: 'address', line: '3', color: '#0288D1' },
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

// ─────────────────────────────────────────────────────────────────────────────
// Benchmark RAPTOR vs jakdojade vs mobilempk: WSZYSTKIE liczby z realnych
// przebiegów harnessa (server/scripts/compare-jakdojade.ts, pliki r4_*.txt,
// 72 trasy: wt 07.10 / sob 10.10 / niedz 11.10.2026, okno startów +120 min).
// Agregaty policzone z wierszy deltaBest (46/24/2, śr. wygrana −6.9, max −36).
// mobilempk: 12 tych samych tras przez rozkladzik.pl (parametry time+busStopId).
// ─────────────────────────────────────────────────────────────────────────────
export const BENCHMARK = {
  sample: {
    n: 72,
    wins: 46,
    ties: 24,
    losses: 2,
    /** śr. deltaBest po wygranych */
    avgWinMin: -6.9,
    maxWinMin: -36,
    /** (wins+ties)/n */
    notWorsePct: 97.2,
  },
  // Pojedynek ze strony głównej: najbardziej oczywista wygrana.
  // Oba warianty z realnego outputu (r3_4.txt): my 253 bezpośrednio
  // 03:54 → 04:10, jd dopiero 245 o 04:20 → 04:46. Delta −36 min.
  duel: {
    from: 'Kozanów',
    to: 'Rynek',
    queryTime: '03:40',
    queryDay: 'sobota',
    ours: { dep: '03:54', arr: '04:10', lines: ['253'], changes: 0, durationMin: 16 },
    jd: { dep: '04:20', arr: '04:46', lines: ['245'], changes: 0, durationMin: 26 },
    deltaMin: -36,
  },
  /** Pełna pierwsza dwunastka wygranych ≤ −10 (deltaBest, trasa, termin). */
  topWins: [
    { delta: -36, route: 'Kozanów → Rynek', when: 'sob 03:40' },
    { delta: -26, route: 'Kozanów → Tarnogaj', when: 'sob 23:40' },
    { delta: -25, route: 'Tarnogaj → Leśnica', when: 'sob 00:50' },
    { delta: -15, route: 'Psie Pole → Galeria Dominikańska', when: 'wt 21:45' },
    { delta: -14, route: 'Tarnogaj → Psie Pole', when: 'wt 15:00' },
    { delta: -13, route: 'Sępolno → Dworzec Nadodrze', when: 'niedz 08:30' },
    { delta: -13, route: 'Sępolno → Sky Tower', when: 'wt 08:15' },
    { delta: -12, route: 'Żerniki → Klecina', when: 'wt 11:30' },
    { delta: -10, route: 'Leśnica → Dworzec Główny', when: 'wt 23:30' },
    { delta: -10, route: 'Żerniki → Rynek', when: 'niedz 01:00' },
    { delta: -10, route: 'Żerniki → Rynek', when: 'niedz 02:30' },
    { delta: -10, route: 'Nowy Dwór P+R → Hala Stulecia', when: 'sob 12:00' },
  ],
  /** Tabela trójstronna (12 tras, najlepszy przyjazd w oknie). */
  threeWay: [
    { route: 'Kozanów → Rynek', when: 'sob 03:40', ours: '04:10', jd: '04:46', mmpk: '04:08', dJd: -36, dMmpk: 2 },
    { route: 'Kozanów → Tarnogaj', when: 'sob 23:40', ours: '00:44', jd: '01:10', mmpk: '00:48', dJd: -26, dMmpk: -4 },
    { route: 'Tarnogaj → Leśnica', when: 'sob 00:50', ours: '02:19', jd: '02:44', mmpk: '02:45', dJd: -25, dMmpk: -26 },
    { route: 'Psie Pole → Galeria', when: 'wt 21:45', ours: '22:10', jd: '22:25', mmpk: '22:10', dJd: -15, dMmpk: 0 },
    { route: 'Tarnogaj → Psie Pole', when: 'wt 15:00', ours: '15:42', jd: '15:56', mmpk: '15:54', dJd: -14, dMmpk: -12 },
    { route: 'Leśnica → Dworzec Gł.', when: 'wt 23:30', ours: '00:11', jd: '00:20', mmpk: '00:13', dJd: -9, dMmpk: -2 },
    { route: 'Jagodno → Biskupin', when: 'sob 15:30', ours: '16:16', jd: '16:13', mmpk: '16:24', dJd: 3, dMmpk: -8 },
    { route: 'Leśnica → Dworzec Gł.', when: 'wt 05:15', ours: '06:00', jd: '05:52', mmpk: '06:04', dJd: 8, dMmpk: -4 },
    { route: 'Żerniki → Galeria', when: 'niedz 11:00', ours: '11:32', jd: '11:32', mmpk: '11:32', dJd: 0, dMmpk: 0 },
    { route: 'Wojszyce → Sępolno', when: 'wt 13:15', ours: '13:47', jd: '13:47', mmpk: '13:47', dJd: 0, dMmpk: 0 },
    { route: 'Sępolno → Dworzec Gł.', when: 'sob 11:00', ours: '11:24', jd: '11:25', mmpk: '11:23', dJd: -1, dMmpk: 1 },
    { route: 'Klecina → Rynek', when: 'wt 04:45', ours: '05:19', jd: '05:20', mmpk: '05:17', dJd: -1, dMmpk: 2 },
  ],
} as const;
