# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

## Testowanie PR na prawdziwym urządzeniu

- Zawsze testuj PR na prawdziwym urządzeniu (symulator/emulator to za mało): zbuduj apk z gałęzi PR, zainstaluj i sprawdź kluczowe ścieżki.
- Każda zmiana UI musi zostać udokumentowana screenshotami z prawdziwego urządzenia, dołączonymi do opisu PR (before/after).
- Nie oznaczaj PR jako gotowy do merge bez realnego uruchomienia na urządzeniu i bez screenshotów dla zmian UI.

## Tłumaczenia (i18n) — OBOWIĄZKOWE

- Każdy tekst widoczny dla użytkownika (UI, alerty, powiadomienia, accessibility labels) MUSI pochodzić ze słownika `src/i18n`. Zero hardcodu PL w komponentach/ekranach/serwisach.
- Wspierane języki: polski, angielski, niemiecki, ukraiński (`pl` / `en` / `de` / `uk`). `pl.ts` jest WZORCEM typów (`Strings = typeof pl`) — brak klucza w en/de/uk to błąd kompilacji, nie pusty label.
- Komponenty: `const s = useStrings()` z `src/i18n` (re-render przy zmianie języka za darmo). Synchroniczne helpery/serwisy: `tr()` (wewnątrz funkcji!) albo `getLocaleSync()` + statyczny import słowników. Nigdy `require()` i nigdy cache'owanie słownika na module.
- Liczby mnogie i interpolacje to FUNKCJE w słowniku (pl/uk: 1 / 2–4 / 5+, en/de: 1 / reszta). Nie pisz własnych reguł mnogości w komponentach.
- Język: `expo-localization` (locale systemowe Androida) + nadpisanie per-app w Ustawieniach → Język (Systemowy/PL/EN/DE/UK), persist w kv-store (`initLocale()` w `_layout`).
- Dodając string: dopisz klucz do `pl.ts`, przetłumacz w `en/de/uk.ts`, użyj w UI. `npx tsc --noEmit` wyłapie braki.

## Commity na bieżąco

- Commituj zmiany na bieżąco, w małych logicznych porcjach, zamiast odkładać wszystko na koniec sesji.
- Przed commitem sprawdź `git status --short`, `git diff` oraz `git log --oneline -10`, stage'uj tylko zamierzone pliki, nigdy nie commituj sekretów.
- Pisz dobre, zwięzłe commit messages w stylu repo (krótki tytuł + ewentualnie `Co:` / `Dlaczego:` w opisie). Nie używaj wulgarnych ani pustych wiadomości.
- Nie amenduj nieudanych commitów po hookach — napraw problem i zrób nowy commit.
- Nie pushuj, nie twórz PR-ów i nie zmieniaj remote'ów, chyba że użytkownik wyraźnie o to poprosi.
