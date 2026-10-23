# Przyjazd na wybraną godzinę

- W oknie wyboru czasu jest przełącznik „Odjazd o / Przyjazd na”. Zapamiętuje wybór podczas przeglądania połączeń. Działa dla dzisiaj i jutra, z tłumaczeniami PL, EN, DE i UK.
- „Przyjazd na” szuka wstecz w RAPTOR-ze. Termin obejmuje dotarcie do celu pieszo. Wyniki uwzględniają nocne kursy poprzedniego dnia, przesiadki i dostępne opóźnienia. Przewijanie dociąga wcześniejsze przyjazdy.
- Ranking uwzględnia marsz i przesiadki, także na ekranie wyników. Przy takim samym koszcie preferuje prostszy przejazd; duży zysk czasu może uzasadniać przesiadkę. Najszybszy znaleziony przyjazd pozostaje na liście odjazdów.
- W profilu zrównoważonym kara za przesiadkę wynosi 5 minut zamiast 10. Profile najszybszy, mniej chodzenia i mniej przesiadek mają odpowiednio kary 2, 5 i 15 minut. Domyślny zapas na przesiadkę to 120 sekund; dla pociągu nadal 300 sekund.
- Dojście nie może zaczynać się przed wybraną godziną odjazdu. Przy przyszłym terminie przyjazdu odrzucane są kursy wymagające wyjścia w przeszłości. Historyczne terminy nadal pozwalają przeglądać rozkład.
- Planowanie nadal działa na lokalnym GTFS. Odwrócona sieć powstaje dopiero przy pierwszym zapytaniu o przyjazd i jest używana ponownie. Horyzont podróży wynosi do 3 godzin przed terminem.

Inspiracją są [opcje czasu, marszu i przesiadek Google Maps](https://developers.google.com/maps/documentation/javascript/routes/route-transit) oraz [koszt przesiadek i zapas czasu w OpenTripPlanner](https://docs.opentripplanner.org/en/v2.6.0/RouteRequest/). Wagi są ustawieniami Kilometra, nie odtworzeniem algorytmu Google.

## Weryfikacja

- TypeScript i lint zmienionych plików.
- `npm run check:routing`: 35 asercji dotychczasowych scenariuszy.
- `npm run check:arrival`: termin co do sekundy, krótkie dojścia, późniejsze wyjście, kierunkowe przejścia, zapas na pociąg po właściwej stronie, filtry, opóźnienia, północ, jutro, wyniki progresywne i odjechane kursy. Test dodany do CI.
- `npm run check:connections`: deduplikacja, identyfikatory i łączenie wyników.
- Dodatkowo przechodzą testy ochrony przesiadek, Polinki (62 asercje) i cache offline.
- `cargo test`: 14 testów Rust. Zaktualizowany także moduł WASM.
- Osiem relacji na archiwalnym GTFS Wrocławia z 15.10.2026, ważnym do 18.10.2026. Wszystkie wyniki wstecz dotrzymały terminu. Zapytania na komputerze trwały od 2,3 do 19,5 ms; to pomiar silnika na załadowanej sieci, nie całego wyszukiwania na telefonie.
- Podgląd rzeczywistego komponentu przez React Native Web: oba tryby, dziś/jutro, skróty czasu, wybór godzin i minut, zatwierdzanie, anulowanie, ponowne otwarcie i Enter. Sprawdzone szerokości 320, 360 i 390 px oraz ukraiński tekst w skali 200%. Natywny bottom sheet i moduły urządzenia były zastąpione atrapami.

## Delivery Gate

### 1. Hard Gate: PASS w podglądzie

Nowe teksty są w i18n, bez em dash. Przełącznik ma role zakładek i stan zaznaczenia. Oba pola dotyku mają co najmniej 48 px. Kontrast tekstu wynosi 7,31:1 dla aktywnej opcji i 8,49:1 dla pozostałej. Podgląd nie wykazał poziomego przepełnienia komponentu.

### 2. Purpose Gate: PASS

Wspólny przełącznik pokazuje dwa wzajemnie wykluczające się znaczenia godziny. Kolory, typografia i promienie pochodzą z motywu aplikacji. Znacznik wyboru rozróżnia stan również bez polegania wyłącznie na kolorze.

### 3. Liveliness: PASS

ENERGY 1 / RHYTHM 1 / MOTION 1. Głównym punktem pozostaje zegar, a kolor akcentu wskazuje wybór i zatwierdzenie. Układ kontynuuje obecny ekran wyboru czasu.

### 4. Craftsmanship: PASS w sprawdzonym zakresie

Testy silnika i podgląd komponentu przechodzą. Dłuższe etykiety układają się pionowo, zawartość można przewijać, a zatwierdzenie pozostaje dostępne. Nie wykonano testu na fizycznym telefonie ani lokalnego buildu APK. Zmieniony moduł Rust wymaga nowego APK do sprawdzenia ścieżki natywnej.
