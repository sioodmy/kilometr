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
| --- | --- | --- |
| 46 | 24 | 2 |

Średnia wygrana: 6,9 min. Największa: 36 min (Kozanów → Rynek, sob 03:40). Pełny raport jest na stronie projektu (`#raport`).

## Start dla dewelopera

```bash
npm install
npx expo start
npm --prefix server run setup   # baza rozkładu do pobrania przez aplikację
```

Wymagane: Node 20, Expo SDK 57. Powiadomienia i śledzenie działają w buildzie deweloperskim, Expo Go ich nie wspiera.

## Wydania

Kod płynie `feature/*` → `dev` → `main` → `nightly` → `prod`, każdy krok jako PR. APK buduje się tylko na push do `nightly` (`kilometr-nightly.apk`, prerelease) i `prod` (`kilometr-prod.apk`, tag `vX.Y.Z`). Strona ląduje na GitHub Pages z `main`.

## Licencja

MIT, szczegóły w [LICENSE](LICENSE).
