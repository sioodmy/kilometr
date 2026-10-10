# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

## Buildy

- Nie builduj apk lokalnie o ile nie dostaniesz na to pozwolenia

## Model branchy i promocja kodu (OBOWIĄZKOWE)

- Przepływ: `feature/*` lub `fix/*` -> `dev` -> `main` -> `nightly` -> `prod`. Każdy krok to PR, nigdy direct push.
- `dev` - integracja/experimental: nowe feature branche bazujesz na `dev` i PR-ujesz do `dev`. Automatycznie twórz PR nowych features do tego brancha
- `main` - scalony, jeszcze nie sprawdzony na urządzeniu kod.
- `nightly` - buildy używalne jako daily driver, mogą być niestabilne; nie są prod ready.
- `prod` - przetestowane manualnie na realnym urządzeniu, gotowe dla end userów; czeka na feedback testerów.
- Wszystkie cztery (`dev`, `main`, `nightly`, `prod`) są chronione (ruleset): zakaz direct pushy, tylko PR.
- APK buduje się WYŁĄCZNIE na push do `nightly` i `prod` (`.github/workflows/build-apk.yml`). Push do `dev`/`main` nie triggeruje builda.
- Każdy build `nightly`/`prod` od razu tworzy nowy GitHub Release z notkami z conventional commitów (bez ręcznego szukania artefaktów).
  - `prod`: tag `vX.Y.Z` (auto-semver z commitów), nie-prerelease, asset `kilometr-prod.apk`.
  - `nightly`: tag `nightly-YYYYMMDD-HHMM-<sha>`, oznaczony jako prerelease, asset `kilometr-nightly.apk`.
  - Landing filtruje kanały po fladze prerelease / prefiksie tagu i może dać dwie opcje pobierania.
- Landing deployuje się na GitHub Pages z `main` (`.github/workflows/deploy-pages.yml`); landing celuje w `releases/latest` (prod).
- Zawsze utrzymuj otwarty PR z `dev` do `main`. Nie zamykaj go i nie merguj automatycznie. Jeśli dev jest do przodu ze zmianami w stosunku do main, a PR nie istnieje, to utwórz PR z tą todo listą
- W treści tego PR trzymaj klikalną todo listę (`- [ ]`) z featurami z feature branchy, jeden element na feature.
- Zmergowanie feature brancha do `dev` dopisuje nowy element `- [ ]` do tej listy TYLKO jeśli feature wymaga manualnych testów (UI, funkcjonalność, landing, aplikacja). Drobnostek bez funkcjonalności (np. aktualizacja README, docs, komentarze) nie dopisuj.
- PR `dev` -> `main` służy do manualnych testów tylko przez człowieka
- NIGDY nie merguj automatycznie żadnego PR do `nightly` ani `prod`. Merge do `nightly`/`prod` wykonuje wyłącznie człowiek, ręcznie.

## CRITICAL: NIE OVERTHINKUJ

- Nie rozpisuj się, po prostu rób
- Nie wypisuj planów, kroków postępowania, ani nie opisuj swoich działań
- Używaj prostych rozwiązań, który doprowadzają do celu. Nie rozmyślaj o edge caseach jeżeli cie o to nie proszę
- Jeżeli dostałeś proste zadanie to nie pytaj o szczegóły, po prostu rób.

## Tłumaczenia (i18n) - OBOWIĄZKOWE

- Każdy tekst widoczny dla użytkownika (UI, alerty, powiadomienia, accessibility labels) MUSI pochodzić ze słownika `src/i18n`. Zero hardcodu PL w komponentach/ekranach/serwisach.
- Wspierane języki: polski, angielski, niemiecki, ukraiński (`pl` / `en` / `de` / `uk`). `pl.ts` jest WZORCEM typów (`Strings = typeof pl`): brak klucza w en/de/uk to błąd kompilacji, nie pusty label.
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
- NIGDY PRZENIGDY NIE COMMITUJ NA BRANCHACH dev, main, nightly i prod bezpośrednio.
- Nie amenduj nieudanych commitów po hookach, napraw problem i zrób nowy commit.
- Nie pushuj, nie twórz PR-ów i nie zmieniaj remote'ów, chyba że użytkownik wyraźnie o to poprosi.
