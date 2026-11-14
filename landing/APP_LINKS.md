Linki podróży mają postać `https://kilometr.app/t#…`. Dane pozostają we fragmencie URL (skompresowany binarny snapshot). Android otwiera aplikację, a przeglądarka przekierowuje do podglądu na stronie głównej (`/#t=…`).

Konfiguracja publikacji:

- `landing/public/.well-known/assetlinks.json` nie zawiera żadnego odcisku. Debug keystore jest publiczny, więc nie może tu wracać.
- Zmienna repozytorium `ANDROID_APP_LINK_FINGERPRINTS` publikuje certyfikaty release (APK i App Signing z Google Play, jeśli jest inny). Podaj odciski SHA-256 oddzielone przecinkami. Bez tej zmiennej App Links nie ufają żadnemu podpisowi.
- `APPLE_TEAM_ID` generuje plik `apple-app-site-association` dla podpisanego `app.kilometr`. Bez Team ID działa przycisk otwarcia przez `kilometr://`.
- Workflow Pages publikuje pliki powiązań oraz geometrię GTFS. Aplikacja wymaga nowego wydania z filtrami linków. Sama publikacja strony nie aktualizuje APK.

Geometria pochodzi z `shapes.txt` źródłowego GTFS. Eksporter zapisuje ją raz na kształt, a odcinki podróży odwołują się do tych plików. Link nie niesie geometrii: aplikacja i strona dociągają przebieg ze shardów. Brak geometrii nie tworzy prostej między końcami przejazdu. Przebieg przez same przystanki jest oznaczony jako przybliżony.

Kontrola na Androidzie po publikacji:

```sh
adb shell pm verify-app-links --re-verify app.kilometr
adb shell pm get-app-links app.kilometr
```

Następnie otwórz rzeczywisty link z wiadomości. Sprawdź start zamkniętej aplikacji, kolejne otwarcie, przypięcie, powrót z powiadomienia i zakończenie obserwowania. Obserwowanie pojazdu nie wymaga lokalizacji odbiorcy.
