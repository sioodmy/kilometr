# Follow-up do audytu 001

Zakres: numery 1-8 z `audit-001-2026-10-29.md` oraz pass M3 Expressive na ekranach feedu.
Tryb: AFTER (session override).

## Wdrożone

1. **[R-03] Cel dotyku "Zobacz wszystkie": PASS.** Stopka ma `minHeight: 48`.
2. **[R-27] Stany karty alertów: PASS.** Ładowanie (spinner z tekstem) i błąd (tekst + tonalny przycisk "Spróbuj ponownie", 48 px). Brak utrudnień nadal ukrywa kartę. Decyzja opisana w komentarzu w kodzie.
3. **[R-04] Emoji usunięte: PASS.** Rozwiązanie ma etykietę "Rozwiązanie" (i18n, 4 języki).
4. **[R-14] Hierarchia kart: PASS.** Pilne: kontener ostrzegawczy. Wznowione: najciemniejsza powierzchnia, wyciszony tytuł. Zwykłe: standard.
5. **[R-06] Rozwiązanie: PASS.** Zwykły krój, 14 px, bez kursywy, w osobnym bloku.
6. **[R-12] Cień usunięty: PASS.** Karta alertów bez `elev`.
7. **[R-04] Ikony: PASS.** Lucide zastąpiony Material Icons w 43 plikach. Jeden moduł `src/components/icons.tsx`, te same nazwy, więc ekrany nie zmieniły się poza importem. `@expo/vector-icons` dodany, `lucide-react-native` usunięty.
8. **[R-31] Pasek 3 px usunięty: PASS.** Stan niesie chip z tekstem i ikoną.

## M3 Expressive na feedzie

- **Typografia:** tytuł ekranu 34/600 z ujemnym trackingiem, tytuły sekcji 16/600, tytuł artykułu 24/600.
- **Kształty:** karty 28, rozwiązanie 16, przyciski ikon i retry jako pill, segmentowany filtr jako pill.
- **Ruch:** press na kartach newsów z springiem i morphingiem promienia 28 -> 20 (wzorzec z `TransferProtectionCard`), respektuje `ReduceMotion.System`. Bez pętli i bez animacji w tle.
- **Filtr:** segmentowany przycisk z check na wybranej opcji, 44 px.
- **Stany:** wznowione ma ikonę check w chipie, pilne ma ikonę ostrzeżenia.

## Poza antislop (i18n i typy)

- `"Ruch przywrócony"` przeniesione do `src/i18n` (pl/en/de/uk).
- `ConnectionLineAlerts`: nieistniejący klucz `lineAlertsViewAll` zamieniony na `lineAlertsAll`.
- `mpkNews.ts`: `alert` w `fetchDisruptionsFromWorker` dostał typ `DisruptionAlert`.

## Bramka dostawy

- R-02 (em dash): PASS. Zero U+2014 w zmienionych plikach.
- R-03 (mobile): PASS w kodzie. Cele dotyku 44-48 px, brak sztywnych szerokości.
- R-25 (kontrast): PASS. Zmierzone skryptem: 10.07, 6.09, 7.25, 7.26, 7.31, 7.26, 13.22, 10.87, 5.44. Wszystkie powyżej 4.5:1.
- R-27 (stany): PASS.
- R-35 (uruchomienie): FAIL. Nie uruchomiono na urządzeniu ani w emulatorze. Podgląd HTML sprawdzony w headless, nie zastępuje testu na Androidzie.
- TypeScript: PASS (`npx tsc --noEmit`).
- ESLint na zmienionych plikach: PASS.

## Do sprawdzenia na urządzeniu

- Wygląd Material Icons przy 11-13 px w `LineBadge`.
- Czy font ikon nie miga przy starcie (ładowanie przez `@expo/vector-icons`).
- Trzy stany karty alertów, obie tonacje kart, długie tytuły, font 200%.
- Rozmiar APK po dodaniu `MaterialIcons.ttf` (ok. 350 KB).
