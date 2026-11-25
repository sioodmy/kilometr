# Zasady pracy agenta (Kilometr)

Reguły są domyślne. Polecenie usera w wątku ma zawsze pierwszeństwo.

## 1. Komunikacja i styl odpowiedzi

- **Język**: rozmawiaj wyłącznie po polsku (także komunikaty pośrednie w trakcie pracy). Krótko, wprost, bez korpo-waty, bez pochwał ("świetne pytanie") i bez tłumaczenia podstaw.
- **Koniec pracy (OBOWIĄZKOWE)**: zawsze podaj konkretne podsumowanie co się zmieniło:
  1. **Wynik** w 1-2 zdaniach (co zrobiono / co naprawiono, hash commita lub link do PR).
  2. **Zmienione pliki** jako klikalne linki (`[Plik.tsx](file:///ścieżka/Plik.tsx#L10-L20)`) z 1 zdaniem co dokładnie w nich zmieniono.
  3. **Weryfikacja**: jedno zdanie co uruchomiono (`typecheck`, `eslint`, `knip`, testy).
- **ZAKAZ raportów Anti-Slop**: NIGDY nie wypisuj w odpowiedzi `antislop active`, `Design Read`, `Hard Gate: PASS`, `Purpose-Gate`, `Quality Locks` ani tabel kontrolnych. Reguły jakości stosuj po cichu, a userowi pokaż wyłącznie realne zmiany w kodzie.
- **Błędy i blokery**: pokaż w pierwszej linii odpowiedzi, jednym zdaniem czego brakuje.

## 2. Projekt i architektura

- **Kilometr**: planer podróży komunikacją miejską (132 miasta) i koleją w Polsce.
- **Stack**: Expo / React Native (Android, iOS, Web PWA na `web.kilometr.app`), lokalny SQLite z GTFS, silnik routingu Range RAPTOR w Rust (`modules/kilometr-raptor`), MapLibre, Cloudflare Workers + R2 (`cloudflare/`), strona w `landing/` (budowana do `docs/`).
- **Środowisko shell**: `node`, `npm`, `tsc` nie są w globalnym `PATH`. Każdą komendę uruchamiaj przez `nix develop .#ci -c '<cmd>'`.
- **Nienaruszalne filary**: działanie offline, niski pobór baterii, szybkość na słabszych telefonach, zero zmyślonych danych.
- **Prywatność**: nigdy nie umieszczaj w kodzie, testach ani zrzutach ekranu prywatnej lokalizacji usera. Na zrzutach ekranu z telefonu zawsze zamaskuj górny pasek statusu (powiadomienia, ikony systemowe) i ustaw godzinę `13:31`.
- **Zrzuty ekranu UI na żywo**: aplikacja działa jako Web PWA (`npm run web` / `web.kilometr.app`). Gdy user prosi o pokazanie wyglądu ekranu lub elementu UI, użyj skilla `.agents/skills/pwa-screenshot/SKILL.md` i osadź zrzut w czacie.

## 3. Jak pracować (Oszczędność tokenów i czasu)

- **Bez zbędnych pytań i planów**: jeśli zadanie jest jasne, od razu koduj. Pytaj tylko gdy brak decyzji zmienia architekturę. Pytanie od usera = tryb read-only (nie edytuj plików, dopóki nie poprosi).
- **Czytanie kodu**: najpierw `rg -n`, potem `read_file` z `StartLine`/`EndLine`. Nie czytaj całych plików >300 linii ani dwa razy tego samego zakresu.
- **Cięcie outputu**: duże wyjścia w terminalu ograniczaj (`| head -50`, `| tail -30`, `git diff --stat`). Zakaz `git log -p` i `cat` dużych plików.
- **Root cause**: przy bugach najpierw znajdź wszystkich callerów (`rg`), napraw źródło problemu raz we wspólnym kodzie. Nie dokładaj obejść na wierzchu.
- **Weryfikacja jednym passem**: zbierz edycje i uruchom na końcu `nix develop .#ci -c 'npm run typecheck && npx eslint <zmienione_pliki>'`. Jeśli usuwasz eksporty lub komponenty, sprawdź `npm run check:dead-code` (Knip w CI odrzuca martwy kod). Jeśli ten sam błąd kompilacji wraca 2 razy, zatrzymaj się i pokaż go userowi.
- **Czekanie na CI**: zakaz `sleep` w pętli i `gh run watch`. Używaj `watch_pull_request` i kończ turę.

## 4. UI, Design i Teksty (Zero Slopu)

- **Design system aplikacji**: Material 3 Expressive (`src/theme/`). Używaj tokenów kolorów z `scheme` (`primary`, `surfaceContainer`, `onSurfaceVariant`, `outlineVariant`). Tap targety minimum `44x44px`.
- **Konteks domenowy**: każda ikona, animacja czy ilustracja w aplikacji musi wiązać się z transportem publicznym (tramwaj, autobus, pociąg, torowisko, przystanek, trasa), nigdy z abstrakcyjnymi gwiazdkami, koniczynkami czy ciastkami.
- **Czysty interfejs (bez AI-slopu)**:
  - Nie dodawaj nad nagłówkami sztucznych nadtytułów (`eyebrow` / `kicker` typu `NOWOŚĆ`, `FUNKCJA`, `01 // ROZKŁAD`), zbędnych pigułek (`Live GPS`), dekoracyjnych tagów ani opisów powtarzających to, co widać obok.
  - Na kartach i ekranach wyróżniaj tylko pierwszoplanową informację (np. godziny odjazdu/przyjazdu, numer linii). Akcje pomocnicze (np. `Wcześniejszy` / `Późniejszy`) muszą być wyraźnie podporządkowane wizualnie.
  - Kontrast tekstu: minimum WCAG AA (4.5:1 dla zwykłego tekstu, 3:1 dla dużego tekstu i obrysów kontrolek).
  - Na Web/PWA i mobile pilnuj `visualViewport` przy otwartej klawiaturze, bezpiecznych stref (`safe-area-inset`) i braku poziomego scrolla. Na mobile wyłączaj ciężkie maski CSS (`mask-image`) na animowanych elementach (np. marquee), bo zrzucają animację z GPU.
- **Zakaz myślników zdaniowych (Em Dash Ban)**:
  - NIGDY nie używaj znaku em dash (`U+2014`), spacjonowanej półpauzy (`U+2013`) ani łącznika ` - ` lub `--` do łączenia części zdania. Dotyczy to UI, i18n, landingu, README, opisów PR, commitów, komentarzy w kodzie i Twoich odpowiedzi na czacie.
  - Zamiast myślnika w zdaniu użyj kropki, przecinka, dwukropka albo nawiasu. Przed commitem sprawdź zmienione pliki pod kątem `U+2014`.
- **Styl tekstów**: zero marketingowych wydmuszek ("rewolucyjny", "nowa era", "bezproblemowy", "odkryj potencjał"), zero zmyślonych statystyk. Pisz konkretnie co funkcja robi dla pasażera.

## 5. Tłumaczenia (i18n) i Komentarze

- **Wszystkie teksty widoczne dla usera** (UI, alerty, powiadomienia, `accessibilityLabel`) muszą iść ze słownika `src/i18n` (`pl.ts`, `en.ts`, `de.ts`, `uk.ts`). Zero zahardkodowanych napisów w komponentach i serwisach.
- `pl.ts` definiuje typ `Strings`. Po dodaniu klucza uzupełnij wszystkie 4 języki. Liczby mnogie i interpolacje pisz jako funkcje w słowniku.
- Komponenty React używają `useStrings()`, serwisy synchroniczne `tr()` lub `getLocaleSync()`.
- **Komentarze w kodzie**: krótkie (1-2 linie), po polsku, tylko gdy wyjaśniają "dlaczego" (obejście buga platformy, nietypowy kontrakt API, regułę domenową). Zero komentarzy powtarzających kod, zero banerów `// === SECTION ===` i zero emoji w komentarzach. Świadome uproszczenie oznaczaj `// shortcut: <limit>, <kiedy rozbudować>`.

## 6. Git, Branche, PR i Buildy

- **Praca lokalna**: commituj logicznymi kawałkami (`fix(zakres): opis po polsku`, `feat(zakres): opis po polsku`). Przed commitem sprawdź `git status --short` i `git diff --stat`. Nie commituj sekretów ani lokalnych baz GTFS.
- **Kiedy push i PR**: nie pushuj i nie otwieraj PR z własnej inicjatywy, chyba że user wyraźnie o to poprosi w prompcie (np. "zrób PR", "merguj do dev").
- **Przepływ gałęzi**: `feature/*` (lub `t3/*`, `fix/*`) -> `dev` -> `main` -> `nightly` -> `prod`. Wszystkie 4 główne gałęzie są chronione (zmiany wchodzą wyłącznie przez PR).
  - `dev`: gałąź integracyjna. Testowe APK buduje Azure Pipelines (wyzwalane komentarzem `build machen !!!` pod otwartym PR `dev -> main`).
  - `main`: trzyma otwarty PR `dev -> main` z listą kontrolną (`- [ ]`) zmian do przetestowania. Push na `main` publikuje landing na GitHub Pages (`docs/`).
  - `nightly` i `prod`: uruchamiają buildy release APK/AAB/IPA na GitHub Actions oraz deploy Web PWA (`deploy-web.yml` idzie z `prod`). Nigdy nie merguj do `nightly` ani `prod` bez wyraźnego polecenia usera w bieżącym wątku.
- **Format PR**:
  - Tytuł krótki, po polsku, mówi DLACZEGO (np. `fix(mapy): mapa nie znika po powrocie ze szczegółów`).
  - Opis: pierwsze zdanie opisuje problem, kolejne rozwiązanie. Na dole dopisz jedną linię z nazwą swojego modelu.
- **Buildy i telefon**:
  - NIGDY nie uruchamiaj lokalnie `gradle`, `assembleDebug`, `expo run:android` ani `npm run start` w pętli.
  - Gdy user pisze, że podłączył telefon przez `adb`, możesz używać `adb logcat`, `adb shell uiautomator dump` i instalować gotowe APK pobrane z Azure, ale nie kompiluj APK na maszynie lokalnej.
