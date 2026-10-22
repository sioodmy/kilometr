# Ochrona przesiadek: weryfikacja

Karta jest pod listą przystanków, przed alarmem i mapą. Pojawia się tylko przy co najmniej dwóch odcinkach pojazdem. Dojście piesze nie jest przesiadką. Ten sam warunek blokuje uruchomienie ochrony w monitorze i po wznowieniu podróży.

Panel decyzji otwiera się przy zagrożeniu także poza mapą. Zwinięty alert pozostaje na ekranie. Propozycja nie podmienia trasy bez potwierdzenia. Zbyt późne i nieaktualne propozycje są blokowane.

Android z aktualnym modułem obsługuje ochronę w tle. iOS, Expo Go i starszy moduł Androida używają ochrony przy otwartej aplikacji. Zakres działania jest widoczny w panelu. W Expo Go istniejący silnik RAPTOR nie działa bez WebAssembly, więc zrzuty UI korzystają z oznaczonych scenariuszy testowych.

## Sprawdzone

- Pixel 7a, Android 17, Expo Go: karta pod przystankami, brak karty dla połączenia bezpośredniego.
- „Zostaję przy swoim planie” zamyka panel i pozostawia linię 10.
- „Wybieram tę trasę” zamyka panel; scenariusz pokazuje linię 12 i nowy przystanek.
- Nieaktualna propozycja: widoczna przyczyna i nieaktywny przycisk potwierdzenia.
- `npx tsc --noEmit` i ESLint zmienionych plików.
- `npm run check:transfers`: GPS, potwierdzenie jazdy, północ, ryzyko, propozycja bez autopodmiany, limit zapytań, trasy bezpośrednie i dojście piesze.
- `npm run check:notification-runtime`: potwierdzenie zmienia plan i dane mapy; przeterminowane i obce propozycje są odrzucane; jeden pojazd nie uruchamia ochrony.
- `npm run check:ios`: dane Live Activity, ostrzeżenie o przesiadce, tłumaczenia i istniejące powiadomienia.
- Bundle JS dla iOS przez Metro.
- Kompilacja klas ochrony w Kotlinie i 8 testów `TransferEstimatorTest`, bez budowania APK.
- 91 par kolorów w domyślnej palecie i sześciu wariantach motywu: minimum 7,18:1.

## Delivery Gate

### 1. Hard Gate: PASS w sprawdzonym zakresie

Teksty pochodzą z czterech słowników. Trasa bezpośrednia nie pokazuje karty. Przyciski mają minimum 48 px, stan oczekiwania, błędu i wygaśnięcia jest widoczny. Zrzuty przedstawiają oznaczone dane testowe. Kontrast policzony; dodane teksty bez em dash.

### 2. Purpose Gate: PASS

Osobny panel służy podjęciu decyzji. Bursztyn oznacza zagrożenie, kolor główny wyróżnia potwierdzenie. Tarcza oznacza ochronę, zegar źródło godzin, pinezka miejsce przesiadki. Duża godzina ułatwia porównanie przyjazdu. Ruch przy naciśnięciu potwierdza dotyk i respektuje ograniczenie animacji. Kierunek: [Material 3 Expressive](https://m3.material.io/styles/motion).

### 3. Liveliness: PASS

ENERGY 2 / RHYTHM 2 / MOTION 2. Najważniejsza jest decyzja o trasie. Zróżnicowane zaokrąglenia, tonalne powierzchnie i czytelne oznaczenia linii korzystają z istniejącego języka aplikacji.

### 4. Craftsmanship i Quality Locks: FAIL, pozostała weryfikacja

Test tekstu 200% zatrzymał się na restarcie Expo Go. Po dwóch próbach zakończono ten test i przywrócono `font_scale=1.0`. Nie potwierdzono układu przy 200%, działania na fizycznym iPhonie ani nowego serwisu Androida w tle na urządzeniu. Przed wydaniem potrzebna jest ta weryfikacja w aktualnym buildzie natywnym. APK nie był budowany.

## Zrzuty do PR

- [Karta pod przystankami](start.png)
- [Połączenie bezpośrednie bez karty](direct.png)
- [Zagrożona przesiadka](risk.png)
- [Propozycja innej trasy](alternative.png)
- [Nieaktualna propozycja](expired.png)

Scenariusze są dostępne tylko w trybie deweloperskim pod `/dev/transfer`, z parametrami `state`, `expired=1` i `direct=1`. W buildzie produkcyjnym ten adres przekierowuje do ekranu głównego.
