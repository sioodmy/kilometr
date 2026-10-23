# F-Droid

Receptura: [`metadata/app.kilometr.yml`](../metadata/app.kilometr.yml).
Opisy PL/EN, ikony i zrzuty: `fastlane/metadata/android/`.

## Co zawiera ten wariant

- Wszystkie moduły Expo kompilowane ze źródeł tylko przy `FDROID_BUILD=1`.
- GPS przez Android `LocationManager`, bez Google Play Services i microG.
- Niepodpisane APK z identyfikatorem `app.kilometr`.
- FCM i Install Referrer usunięte również ze zwykłych buildów. Powiadomienia lokalne zostają.
- MapLibre JS/CSS w paczce aplikacji, bez pobierania kodu z CDN. Kafelki i glify nadal można pobierać.

Adapter lokalizacji implementuje API używane przez Kilometr: uprawnienia w pierwszym planie,
stan usług, ostatnią i bieżącą pozycję oraz obserwowanie pozycji. Nie dodaje geofencingu,
rozpoznawania ruchu ani śledzenia lokalizacji w tle. Śledzenie podróży korzysta z dotychczasowego modułu aplikacji.

## Sprawdzenie projektu

Użyj oddzielnego checkoutu. Przygotowanie F-Droid zmienia `node_modules`
i wygenerowany katalog `android`. Nie uruchamiaj potem zwykłego buildu w tym samym katalogu.

```sh
npm ci
npm run check:fdroid
APP_VERSION=v1.5.4 npm run prebuild:fdroid
FDROID_BUILD=1 npm run check:fdroid
```

Bez `FDROID_BUILD=1` autolinking Androida kompiluje ze źródeł wyłącznie zmodyfikowane `expo-notifications`
i `expo-application`. Pozostałe moduły używają standardowych ustawień Expo. Przełącznik jest
obsługiwany przez poprawkę Android autolinkingu. Przygotowanie nie zmienia `package.json`.

`npm ci` nakłada poprawki z `patches/` i generuje `src/map/maplibreAssets.generated.ts`
z przypiętej wersji `maplibre-gl`, razem z jej licencją.

## APK do sprawdzenia

Ręcznie uruchom workflow **Build unsigned F-Droid APK** na gałęzi zawierającej te zmiany.
Podaj wersję `vX.Y.Z`. Artefakt `kilometr-fdroid-unsigned` zawiera APK bez podpisu.
Workflow sprawdza uprawnienia i brak zależności Firebase, Google Play Services i Install Referrer.
Nie publikuje wydania ani nie tworzy tagu. To build pomocniczy, nie zastępuje buildera F-Droid.
Do instalacji testowej podpisz kopię APK własnym kluczem. F-Droid podpisuje pakiet osobno.

## Zgłoszenie do fdroiddata

Receptura wskazuje roboczo `v1.5.4`. Ten wpis nie oznacza opublikowanego wydania.
Przed zgłoszeniem ustaw rzeczywisty tag zawierający te zmiany w `commit` oraz dopasuj
`versionName`, `versionCode`, `CurrentVersion` i `CurrentVersionCode`.
Pliki `changelogs/701050401.txt` w metadanych PL/EN nazwij kodem tego wydania.

Kod wersji to dotychczasowa numeracja APK: `700000000 + major*1000000 + minor*10000 + patch*100 + 1`.
Nie ustawiaj `ANDROID_VERSION_CODE` z Play ani innego `BUILD_NUMBER`.
Automatyczne aktualizacje są wyłączone, ponieważ wersja aplikacji pochodzi z tagu i zmiennych CI,
a nie ze statycznego manifestu. Kolejne wydania wymagają aktualizacji receptury.

W checkoutcie `fdroiddata`, po skopiowaniu receptury do `metadata/`:

```sh
fdroid lint app.kilometr
fdroid build --server --test --scan-binary app.kilometr:701050401
```

Przed MR sprawdź APK na telefonie bez GMS: uprawnienia dokładne i przybliżone, GPS,
wyszukiwanie połączeń offline, mapę offline, powiadomienia lokalne i budzik po restarcie.
F-Droid podpisuje gotowy pakiet swoim kluczem. Aktualizacja instalacji podpisanej innym kluczem
wymaga wcześniejszego eksportu danych i ponownej instalacji.

Receptura usuwa prekompilowane repozytoria Expo i wskazane nieużywane binaria.
`scanignore` obejmuje kompilator Hermes oraz konkretne pliki Gradle z lokalnymi repozytoriami Maven.
Nie pomija skanowania całego `node_modules`.

Wymagania: [polityka F-Droid](https://f-droid.org/docs/Inclusion_Policy/),
[format metadanych](https://f-droid.org/docs/Build_Metadata_Reference/),
[kompilacja modułów Expo](https://docs.expo.dev/guides/prebuilt-expo-modules/).
