Linki podróży mają postać `https://kilometr.app/trip/#trip=…`. Dane pozostają we fragmencie URL. Android otwiera aplikację, a przeglądarka przekierowuje do podglądu na stronie głównej.

Konfiguracja publikacji:

- `landing/public/.well-known/assetlinks.json` zawiera odcisk certyfikatu APK zainstalowanego na telefonie testowym (`dev-20261026-2122-a102a25`).
- Zmienna repozytorium `ANDROID_APP_LINK_FINGERPRINTS` dodaje certyfikaty innych kanałów. Podaj odciski SHA-256 oddzielone przecinkami, także certyfikat App Signing z Google Play, jeśli jest inny.
- `APPLE_TEAM_ID` generuje plik `apple-app-site-association` dla podpisanego `app.kilometr`. Bez Team ID działa przycisk otwarcia przez `kilometr://`.
- Workflow Pages publikuje pliki powiązań oraz geometrię GTFS. Aplikacja wymaga nowego wydania z filtrami linków. Sama publikacja strony nie aktualizuje APK.

Geometria pochodzi z `shapes.txt` źródłowego GTFS. Eksporter zapisuje ją raz na kształt, a odcinki podróży odwołują się do tych plików. Aplikacja dołącza wycięty przebieg do linku i zachowuje osiem ostatnich planów offline. Brak geometrii nie tworzy prostej między końcami przejazdu. Przebieg przez same przystanki jest oznaczony jako przybliżony.

Kontrola na Androidzie po publikacji:

```sh
adb shell pm verify-app-links --re-verify app.kilometr
adb shell pm get-app-links app.kilometr
```

Następnie otwórz rzeczywisty link z wiadomości. Sprawdź start zamkniętej aplikacji, kolejne otwarcie, przypięcie, powrót z powiadomienia i zakończenie obserwowania. Obserwowanie pojazdu nie wymaga lokalizacji odbiorcy.
