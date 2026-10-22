Te reguły są domyślne (good defaults), nie święte prawo. User może je nadpisać w wątku.

## User

- Rozmowy po polsku, krótko i wprost; tak samo zwracaj się do niego.
- Autystyczny, ADHD, krótki zakres uwagi: odpowiedzi maksymalnie krótkie, listy zamiast akapitów, najpierw wynik, potem szczegóły. Zero ozdobników, zero "great question".
- Nie jest native speakerem angielskiego: po angielsku krótkie zdania, bez idiomów.
- Nie traktuj jak nowicjusza, nie tłumacz podstaw, chyba że o to poprosi.
- Nie ma Claude Pro ani Codex, nie sugeruj ich narzędzi. Harness: OpenCode.
- Chce setup w duchu Theo (t3.gg / T3 Code): małe zmiany, krótkie reguły, dobre praktyki, shipowanie działającego kodu. Trzymaj się tego.

## Ten plik

- To plik dla Ciebie (agenta), nie README. README opisuje projekt ludziom; tu są zasady zmieniania kodu.
- "user" = sioodmy (człowiek za ekranem), "Ty" = agent czytający ten plik, "my" = user + Ty.
- kilometr = aplikacja Expo/React Native: rozkłady jazdy, mapa offline, powiadomienia o odjazdach. GTFS i baza na urządzeniu, offline-first, Android.
- Czego nie łamiesz: nie zmyślasz danych, offline działa, wydajność i bateria, mały rozmiar, czytelne UI. Zmiana, która to psuje, nie wychodzi z wątku.

## Praca w wątku

- Nie rozpisuj się: krótkie komunikaty, po prostu rób. Nie wypisuj planów ani opisów działań.
- Pytanie od usera = read-only. Nie edytuj, dopóki tak napisał.
- Jak robota może pójść dalej bez usera, jedź do końca. Zatrzymuj się tylko gdy: (a) user poprosił "stop przed X", (b) przed akcją destrukcyjną, (c) druga próba naprawy też pada.
- Błąd pokaż od razu, w jednej linii, nie ukrywaj go w opisie. Blocker: jedno zdanie, czego dokładnie potrzebujesz.
- Podsumowanie: co zrobione / co nie / co dalej. Maksymalnie kilka linii.

## Codowanie

- Minimalizm: measure twice, cut once, YAGNI. Nie zachowuj złożoności dlatego, że już istnieje. Nie dodawaj machinerii, bo wygląda imponująco.
- Zanim zaczniesz, sprawdź, czy istnieje "stupid simple solution" i rób tak, jeśli działa.
- Nie rozszerzaj zakresu. Pre-existing bugi: nie naprawiaj w tej samej robocie, wpisz follow-up w podsumowaniu.
- Działania destrukcyjne (usuwanie danych, force push, kill procesów, migracje) tylko na wyraźną prośbę. Killuj tylko procesy, które sam uruchomiłeś.

## Weryfikacja

- Celowana najpierw: `npx tsc --noEmit`, lint na zmienionych plikach, skupione testy. Full build tylko na pozwolenie (patrz Build).
- Testy: celowe, nie slop. Regression test na małą poprawkę to overkill.
- Duży diff: najpierw przeczytaj własne podsumowanie i sprawdź, czy nic nie uciekło.

## TypeScript i komentarze

- `any` to wróg; casting one-linery to zły TS.
- Komentarze: krótkie, po polsku; opisują "jak tego się używa" nad funkcją/klasą; aktualizuj przy zmianie. Zero komentarzy wiersz po wierszu.
- Wszystko user-facing przez `src/i18n` (patrz Tłumaczenia).

## Pull requesty

- Przed zrobieniem PR: sprawdź, czy PR z tego brancha już istnieje; diff sprawdź lokalnie przeciw origin.
- Tytuł: krótki, po polsku, wyjaśnia DLACZEGO (bad: `fix: refactor map`, good: `fix(mapy): mapa nie znika przy powrocie`).
- Opis: pierwsze zdanie = problem, dopiero potem rozwiązanie. Żadnego leadu w stylu "usunięto plik X, dodano plik Y".
- Jedna linia na dole opisu: model + "wykonane przez agenta OpenCode".

## Em dash ban (OBOWIĄZKOWE)

- NIGDY PRZENIGDY nie używaj em dash (U+2014) w czegokolwiek, co zobaczy człowiek: UI, landing, docs, README, PR, commit message, komentarze w kodzie, odpowiedzi do usera. Zamiast tego: kropka, przecinek, dwukropek, nawias, pełne zdania.
- Spacjonowany myślnik ("x - y") i podwójny łącznik ("x -- y") jako łącznik zdania też pomijaj; pisz pełne zdania.
- Przed oddaniem: sprawdź swój tekst pod kątem `—`. Zero trafień albo wróć i napraw.

## Tłumaczenia (i18n) - OBOWIĄZKOWE

- Każdy tekst usera (UI, alerty, powiadomienia, a11y labels) MUSI pochodzić ze słownika `src/i18n`. Zero hardcode PL/EN w komponentach/ekranach/serwisach.
- Języki: pl / en / de / uk. `pl.ts` jest wzorcem typów (`Strings = typeof pl`); brak klucza w en/de/uk = błąd kompilacji.
- Komponenty: `useStrings()` z `src/i18n`. Serwisy synchroniczne: `tr()` albo `getLocaleSync()` + statyczne importy słowników. Bez `require()`, bez cache słownika na module.
- Interpolacje i liczby mnogie to FUNKCJE w słowniku (pl/uk: 1 / 2-4 / 5+; en/de: 1 / reszta). Nie pisz własnych reguł mnożenia w komponentach.
- Dodanie stringa: klucz do `pl.ts` → tłumaczenia w `en/de/uk.ts` → użycie w UI. `npx tsc --noEmit` wyłapie braki.

## Anti-Slop (UI / teksty / docs) - OBOWIĄZKOWE

- Zanim edytujesz cokolwiek widocznego dla ludzi: przeczytaj core `.agents/skills/antislop/SKILL.md` + pasujące skille z mapy poniżej. Stosuj zasady W TRAKCIE pisania, na koniec raport PASS/FAIL z Delivery Gate w 4 blokach.
- Mapowanie:
  - UI / visual (kolor, layout, komponenty, motion): `antislop-ui`
  - copy / tekst (nagłówki, CTA, landing, PR, docs, i18n): `antislop-copywriting`
  - dostępność (kontrast, klawiatura, focus): `antislop-human`
  - mobile / responsive (breakpointy, grid, tap targety): `antislop-layoutmobile`
  - komentarze w kodzie: `antislop-code`
- Anti-slop to filtr, nie style guide. Kierunek wizualny podaje brief usera; bez kierunku oznacz jako "draft". Nie wymyślaj faktów, liczb ani testimoniali.
- Live badges (migająca kropka, pill) tylko na wyraźną prośbę.

## Skille: zasady (metoda Theo)

- Description w SKILL.md = trigger ("Use when user asks X, Y, Z"), nie opis zawartości. Description jest zawsze w kontekście; treść ładuje się dopiero przy użyciu.
- Powtarzalny błąd agenta dwa razy → najpierw napraw architekturą/linterem/CI, potem jedna linia w tym pliku, dopiero potem skill.
- Skille `.agents/skills/*` są werbowane 1:1 z upstream Anti-Slop (core v3.2.20, MIT: https://github.com/miqdadbadjuber/Anti-Slop); lokalnie wycięte em dashes, description działa jak trigger. Update = przekopiuj `skills/*` z release, podbij wersję.
- Inne skille: `react-modernization`, `react-native-architecture`, `transit-benchmark`, `typescript-pro`, `ui-ux-designer`, `ui-visual-validator`.

## Branchy (OBOWIĄZKOWE)

- Flow: `feature/*` lub `fix/*` -> `dev` -> `main` -> `nightly` -> `prod`. Każdy krok PR-em, nigdy direct push. Branch `t3/*` z T3 Code też działa jako feature branch.
- Feature branch bazuje na `dev`; PR do `dev` otwierasz od razu.
- Wszystkie cztery (dev, main, nightly, prod) chronione: push tylko przez PR.
- Buildy GitHub startują WYŁĄCZNIE na push do `nightly` i `prod` (`.github/workflows/build-apk.yml`). Push do dev/main ich nie uruchamia; dev testuje się przez APK z Azure Pipelines.
- `nightly`: tag `nightly-YYYYMMDD-HHMM-<sha>`, prerelease, APK `kilometr-nightly.apk`.
- `prod`: tag `vX.Y.Z` (auto-semver z commitów), normalny release: APK `kilometr-prod.apk`, AAB na Google Play, niepodpisane IPA do sideloadu. Release notes z conventional commitów.
- iOS build wyłącznie z `prod` (`.github/workflows/build-ipa.yml`).
- Landing: GitHub Pages z `main` (`.github/workflows/deploy-pages.yml`), celuje w `releases/latest`.
- Trzymaj otwarty PR `dev` -> `main` z todo listą (`- [ ]`) feature'ów: jeden element = jedna testowalna rzecz, tylko co wymaga manualnych testów, link do feature PR w elemencie. Nie zamykaj go i nie merguj automatycznie.
- NIGDY nie merguj automatycznie do `nightly`/`prod`; merge robi człowiek ręcznie.

## Buildy

- Nie buduj APK lokalnie bez pozwolenia usera.
- Wszystkie AAB korzystają ze wspólnego licznika workflow Play; nie twórz osobnych pasm versionCode dla testów i produkcji.

## Commity

- Commituj na bieżąco, małymi logicznymi kawałkami, conventional commits po polsku.
- Przed commitem: `git status --short`, `git diff`, `git log --oneline -10`; stage'uj tylko zamierzone pliki; nigdy sekrety.
- NIGDY nie commituj wprost na dev/main/nightly/prod. Nie amenduj po nieudanych hookach: napraw i zrób nowy commit.
- Nie pushuj, nie twórz PR i nie zmieniaj remote bez wyraźnej prośby usera.

## Utrzymywanie tego pliku

- Ten plik żyje: nadpisuj regułę, gdy nie działa albo świat się zmienił.
- Twój powtarzalny błąd: po drugim razie dopisz jedną linię do właściwej sekcji, zamiast tłumaczyć się na nowo w każdym wątku.
