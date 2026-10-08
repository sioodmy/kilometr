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

## Anti-Slop - OBOWIĄZKOWE (UI / teksty / docs / git messages)

- NIGDY PRZENIGDY NIE UŻYWAJ EM DASHES
- NIE UŻYWAJ LIVE BADGES TYPU MIGAJĄCA KROPECZKA I PILL CHYBA ŻE CIE O TO POPROSZE
- Lokalne skille (werbowane 1:1 z upstream): `.agents/skills/antislop/` (core, v3.2.20) + `antislop-ui`, `antislop-copywriting`, `antislop-human`, `antislop-layoutmobile`, `antislop-code`. Upstream MIT: `https://github.com/miqdadbadjuber/Anti-Slop`. Update = przekopiuj foldery `skills/*` z release i podbij wersję tutaj.
- KIEDY: ZAWSZE, gdy dotykasz CZEGOKOLWIEK co widzi użytkownik/inni ludzie - bez wyjątków i bez pytania o tryb:
  - UI aplikacji (`app/`, `src/components/`, style, animacje, stany puste/błędy/loading),
  - landing (`landing/`),
  - docs (`docs/`, `*.md`, komentarze w kodzie widoczne w review),
  - teksty user-facing: `src/i18n/*`, alerty, powiadomienia, accessibility labels,
  - git messages, opisy PR, review comments.
- CO (tryb ZAWSZE `during`, nie pytaj `during/after`): przed edytą przeczytaj przez Read tool core `.agents/skills/antislop/SKILL.md` + skill(e) z mapowania poniżej, stosuj zasady W TRAKCIE pisania, przed oddaniem przejdź Delivery Gate z core (raport PASS/FAIL w 4 blokach).
- Mapowanie (ładuj core + każdy pasujący):
  - UI / visual (kolor, layout, komponenty, dekoracje, motion): `antislop-ui`,
  - copy / tekst (nagłówki, CTA, tone, landing, PR/opis, docs): `antislop-copywriting`,
  - dostępność (kontrast, klawiatura, focus, stany): `antislop-human`,
  - mobile / responsive (breakpointy, grid, overflow, tap targety): `antislop-layoutmobile`,
  - komentarze w kodzie: `antislop-code` (czyści tylko komentarze, nigdy kodu).
- Relacja z resztą AGENTS.md: anti-slop to FILTR, nie style guide (R-37). Kierunek wizualny/kopia pochodzi z briefu użytkownika; bez kierunku UI oznacz jako draft. Teksty PL/EN/DE/UK dalej MUSZĄ iść przez `src/i18n` (pl.ts = wzorzec, `useStrings()` / `tr()` w serwisach) - copywriting-skill nie omija i18n. Nie wymyślaj faktów/liczb/testimoniali (R-17/R-18/R-36/R-38).

## Commity na bieżąco

- Commituj zmiany na bieżąco, w małych logicznych porcjach, zamiast odkładać wszystko na koniec sesji.
- Przed commitem sprawdź `git status --short`, `git diff` oraz `git log --oneline -10`, stage'uj tylko zamierzone pliki, nigdy nie commituj sekretów.
- używaj conventional commits po polsku
- NIGDY PRZENIGDY NIE COMMITUJ NA MAIN BRANCH.
- Nie amenduj nieudanych commitów po hookach — napraw problem i zrób nowy commit.
- Nie pushuj, nie twórz PR-ów i nie zmieniaj remote'ów, chyba że użytkownik wyraźnie o to poprosi.
