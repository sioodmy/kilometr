<p align="center">
  <img src="docs/favicon.svg" width="120" alt="Logo Kilometr" />
</p>

<h1 align="center">Kilometr</h1>

<p align="center"><strong>Tym razem dojedziesz.</strong><br />Wrocławskie połączenia MPK liczone na telefonie. Offline, bez reklam, bez konta.</p>

<p align="center">
  <a href="https://github.com/sioodmy/kilometr/actions/workflows/ci.yml"><img src="https://github.com/sioodmy/kilometr/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://github.com/sioodmy/kilometr/actions/workflows/build-apk.yml"><img src="https://github.com/sioodmy/kilometr/actions/workflows/build-apk.yml/badge.svg" alt="Build APK" /></a>
  <a href="https://github.com/sioodmy/kilometr/releases/latest"><img src="https://img.shields.io/github/v/release/sioodmy/kilometr?label=prod" alt="Aktualne wydanie prod" /></a>
  <a href="https://github.com/sioodmy/kilometr/releases"><img src="https://img.shields.io/github/release-date-pre/sioodmy/kilometr?label=nightly" alt="Nightly" /></a>
  <img src="https://img.shields.io/badge/Expo-57-00a884" alt="Expo 57" />
  <img src="https://img.shields.io/badge/Android-7.0%2B-3DDC84" alt="Android 7.0+" />
  <a href="LICENSE"><img src="https://img.shields.io/github/license/sioodmy/kilometr" alt="Licencja" /></a>
</p>

<p align="center">
  <a href="https://github.com/sioodmy/kilometr/releases/latest/download/kilometr-prod.apk"><strong>Pobierz APK (prod)</strong></a>
  ·
  <a href="https://github.com/sioodmy/kilometr/releases">Nightly</a>
  ·
  <a href="https://sioodmy.github.io/kilometr/">Strona projektu</a>
  ·
  <a href="obtainium://app/https://github.com/sioodmy/kilometr">Dodaj do Obtainium</a>
</p>

## Co to robi

Kilometr planuje trasy po Wrocławiu na telefonie, z pełnego rozkładu MPK i Kolei Dolnośląskich. Jedno pobranie danych, potem działa offline.

- Planer RAPTOR na urządzeniu: odjazdy, przyjazdy, przesiadki, filtry tramwaj/autobus/bezpośrednie
- Dane live i śledzenie kursu z powiadomieniem (odliczanie, pasek postępu, alert „wyjdź”)
- Mapa trasy, kompas do przystanku, kotwiczenie startu do zapisanych miejsc
- Aktualności MPK, zapisane miejsca, historia, backup do pliku
- Języki: polski, angielski, niemiecki, ukraiński

## Wyniki na tle jakdojade

Harness w `server/scripts/compare-jakdojade.ts`, 72 trasy (wt/sob/niedz, okno startów +120 min):

| Kilometr | Remisy | Jakdojade |
| -------- | ------ | --------- |
| 46       | 24     | 2         |

Średnia wygrana: 6,9 min. Największa: 36 min (Kozanów → Rynek, sob 03:40).

## Start dla dewelopera

```bash
npm install
npx expo start
npm --prefix server run setup   # baza rozkładu do pobrania przez aplikację
```

Wymagane: Node 22.13 lub nowszy, Expo SDK 57. Powiadomienia i śledzenie działają w buildzie deweloperskim, Expo Go ich nie wspiera.

## iOS: IPA do sideloadowania

Wymagany iOS 16.4 lub nowszy. GitHub Actions kompiluje aplikację na macOS z Xcode. IPA jest **niepodpisane**: podpisujesz je swoim kontem Apple, poza GitHubem. Repozytorium nie potrzebuje certyfikatu, profilu provisioning ani hasła do Apple.

### Pobranie

- IPA powstaje tylko na gałęzi `prod`: push do `prod` buduje ją po APK i AAB i dołącza do tego samego [GitHub Release](https://github.com/sioodmy/kilometr/releases). Nie powstaje osobny tag iOS. Błąd kompilacji iOS pozostawia dostępne APK; IPA pojawia się dopiero po udanym buildzie.
- Build testowy: otwórz [Build IPA](https://github.com/sioodmy/kilometr/actions/workflows/build-ipa.yml), wybierz `Run workflow` na gałęzi `prod`. Po udanym buildzie pobierz artefakt `kilometr-ios-unsigned`, rozpakuj ZIP i znajdź `kilometr-unsigned.ipa`.
- `dev` testuje wyłącznie APK z Azure Pipelines; GitHub nie buduje tam iOS.
- Obok IPA znajduje się plik SHA-256. Po rozpakowaniu możesz sprawdzić go poleceniem `shasum -a 256 -c kilometr-unsigned.ipa.sha256`.

### Podpisanie i instalacja

Przykład z [Sideloadly](https://sideloadly.io/) na macOS lub Windows:

1. Zainstaluj Sideloadly według instrukcji producenta. Na Windows przygotuj również wymagane przez niego komponenty Apple.
2. Podłącz iPhone kablem, odblokuj go i zatwierdź zaufanie do komputera.
3. Wybierz urządzenie w Sideloadly, przeciągnij `kilometr-unsigned.ipa` do okna i podaj własne konto Apple.
4. Zachowaj rozszerzenie `KilometrLiveActivity`. Zawiera widgety i Live Activity. Aplikacja oraz rozszerzenie muszą zostać podpisane razem. Widgety wymagają również wspólnego App Group `group.app.kilometr.widgets` w obu profilach podpisujących. Jeśli narzędzie zmienia identyfikatory, musi zachować zgodność App Group i klucza `KilometrWidgetAppGroup` w obu plikach Info.plist.
5. Uruchom instalację. Jeśli iOS tego wymaga, zaufaj profilowi w **Ustawienia → Ogólne → VPN i zarządzanie urządzeniem** oraz włącz **Tryb dewelopera** w **Prywatność i ochrona**. Postępuj według komunikatów telefonu.
6. Otwórz Kilometr, pobierz dane miasta i zezwól na powiadomienia przy pierwszym przypięciu trasy lub ustawieniu przypomnienia.

Bezpłatny podpis Apple zwykle wygasa po 7 dniach. Odnawiaj go w narzędziu do sideloadowania; Sideloadly obsługuje automatyczne odnawianie. Przy aktualizacji używaj tego samego konta i identyfikatora aplikacji, aby zachować dane. Możesz użyć innego narzędzia podpisującego IPA, jeśli obsługuje również dołączone rozszerzenie.

### Co działa inaczej na iOS

Silnik tras Rust i mapy offline działają natywnie. Live Activity pokazuje podróż na ekranie blokady, a na obsługiwanych iPhone'ach także w Dynamic Island. Dotknięcie otwiera trasę. Live Activity nie wymaga powiadomień push. Widgety korzystają z App Group do odczytu danych zapisanych przez aplikację.

iOS usypia aplikację w tle. Licznik rysuje system, ale nowe dane o pojazdach i opóźnieniach docierają podczas działania aplikacji. Po upływie ważności danych aktywność prosi o otwarcie Kilometr. Nie obiecujemy ciągłego śledzenia GPS po zamknięciu aplikacji. Alert przed wysiadaniem i komunikat o przyjeździe są planowane według ostatniego znanego rozkładu; zmiana trasy lub zakończenie śledzenia aktualizuje albo usuwa oczekujące alerty.

Budzik przed wyjściem jest lokalnym przypomnieniem z dźwiękiem. Tryb cichy, Skupienie i ustawienia powiadomień mogą go wyciszyć. Nie zastępuje budzika systemowego i nie otwiera pełnego ekranu.

Widgety „Twoje kierunki”, „Moje miejsca”, „Twoja podróż” i „Dokąd jedziemy?” korzystają z natywnych układów WidgetKit. Pokazują ostatni snapshot aplikacji i otwierają odpowiednią trasę lub wyszukiwanie. Widget „Czas wyjść” został usunięty na obu platformach.

### Sprawdzenie na urządzeniu

Po własnym podpisaniu sprawdź pobranie rozkładu, wyszukanie trasy bez internetu, mapę offline, lokalizację, import/eksport kopii i udostępnianie. Przypnij trasę, zablokuj ekran, otwórz ją z Live Activity, usuń aktywność i sprawdź, czy nie wraca. Ustaw oraz anuluj przypomnienie przed wyjściem. Sprawdź odmowę powiadomień i wszystkie cztery języki.

CI sprawdza kompilację, silnik Rust, logikę powiadomień i zawartość IPA. Podpisanie oraz zachowanie na fizycznym iPhonie wymagają testu użytkownika przed promocją do `prod`.

## Wydania

Kod płynie `feature/*` → `dev` → `main` → `nightly` → `prod`, każdy krok jako PR. Push do `nightly` buduje APK (`kilometr-nightly.apk`, prerelease). Push do `prod` buduje APK (`kilometr-prod.apk`), AAB dla Google Play (`kilometr-prod.aab`) i niepodpisane IPA, wszystko pod tagiem `vX.Y.Z`. Strona ląduje na GitHub Pages z `main`. Dev testuje tylko Azure Pipelines (`azure-pipelines.yml`): preview build APK jako prerelease `dev-...`, a link trafia do komentarza w PR `dev` → `main`. Wymaga zmiennej sekretnej `GITHUB_TOKEN` w Azure DevOps; ręcznie ten sam plik obsługuje tryby `release` i `artifact-only`.

W manifeście nie ma zgód lokalizacji w tle na żadnym kanale (aplikacja zbiera Lokację tylko na pierwszym planie przy śledzeniu podróży), dzięki czemu Play nie wymaga deklaracji Location permissions. Bramki `build-aab.yml` i `build-apk.yml` pilnują tego na wygenerowanych artefaktach.

## Licencja

Kilometr jest wolnym oprogramowaniem na licencji GPL-3.0-or-later.
Copyright (C) sioodmy, pełny tekst w [LICENSE](LICENSE).
