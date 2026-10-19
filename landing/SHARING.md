# Udostępnianie połączeń

W szczegółach połączenia przycisk udostępniania otwiera dolny arkusz M3 Expressive. Pokazuje kartę z godziną przyjazdu, celem, początkiem, datą i liniami. Dostępne są karta PNG z linkiem, SMS, kopiowanie linku oraz systemowe udostępnianie samego tekstu.

Link ma postać `https://kilometr.app/#trip=<deflate-base64url>&lang=pl`. Przeglądarka odczytuje dane lokalnie. Fragment zawiera podsumowanie podróży, więc zmiana rozkładu nie usuwa udostępnionych godzin. To snapshot, bez aktualizacji GPS i opóźnień. Wiadomość i interfejs mają słowniki PL, EN, DE i UK w `src/i18n/share`.

## Rozkłady na GitHub Pages

`npm --prefix landing run build:timetables` pobiera publiczne bazy z `data.kilometr.app`, sprawdza SHA-256 i eksportuje przystanki kursów do kompresowanych plików JSON. Wymaga Node 22 i zależności projektu głównego. Potem `npm --prefix landing run build` dołącza pliki do artefaktu Pages. Eksport ma również opcje `--city=wroclaw --db=/ścieżka/rozklad.db` do lokalnej weryfikacji.

Przeglądarka pobiera wyłącznie statyczny manifest i potrzebne części rozkładu z tego samego hosta co strona. Nie pobiera SQLite ani nie łączy się z API. Szczegóły pokazuje po dopasowaniu identyfikatora kursu, przystanków i godzin. Przy braku pasującego rozkładu pozostają podsumowanie oraz możliwość ponownego wczytania przystanków.

Workflow Pages eksportuje rozkłady przy deployu z `main` oraz codziennie o 06:23 UTC. Pliki wynikowe są ignorowane przez Git. Eksport wszystkich 15 miast z 19 października 2026 zajmuje około 166 MB. Promocja do `main` uruchamia publikację tej funkcji na stronie.

## Weryfikacja z 19 października 2026

- `npm run check:sharing`: format URL, polskie znaki, daty, północ, uszkodzone dane, limit rozpakowania, wszystkie słowniki i dopasowanie przystanków, także dla opóźnionego połączenia z zachowanymi godzinami rozkładowymi.
- `npx tsc --noEmit`, `npm run lint`, `npm --prefix landing run build`: poprawne.
- `npx expo export --platform android`: poprawny bundle JavaScriptu. Autolinking rozpoznaje `RNShare` i `RNViewShot`.
- Eksport rzeczywistych rozkładów wszystkich 15 miast: poprawny. Build strony sprawdzony także pod ścieżką `/kilometr/`, z surowym gzip oraz automatycznym rozpakowaniem przez hosting.
- Chromium: rozwinięcie przystanków myszą i Enterem, zapis URL do schowka, payload Web Share, SMS z podsumowaniem i linkiem, uszkodzony link, powrót do landing, błąd rozkładu i ponowna próba. Testy Web Share i SMS sprawdzają dane przekazywane do systemu, bez wysyłania wiadomości.
- PL/EN/DE/UK, oba motywy, szerokości 320, 390, 640, 900 i 1440 px: bez poziomego overflow. Tekst strony przy 200%: bez overflow. Axe WCAG AA: bez naruszeń w nowym widoku na telefonie i desktopie, w obu motywach. Fokus sprawdzony klawiaturą. Brak błędów JavaScriptu i zewnętrznych żądań w widoku podróży.
- Rzeczywisty komponent karty wyrenderowany przez React Native Web: PL/EN/DE/UK, szerokości 320 i 390 px, skala tekstu 200%. To kontrola układu, nie test urządzenia.

Nie budowano lokalnego APK. Nie było podłączonego telefonu, więc natywny arkusz, zamykanie gestem i przyciskiem Wstecz, rasteryzacja PNG oraz odbiór grafiki i linku w komunikatorze wymagają testu na urządzeniu. Obsługę tych akcji sprawdzono w kodzie; wyników testu urządzenia nie deklarujemy.

## Delivery Gate

### 1. Hard Gate: PASS

- R-02, R-17, R-18, R-23, R-36, R-38: brak em dash, fikcyjnych liczb, opinii i nowych elementów marki. Karta jest zamówionym przez użytkownika podsumowaniem danych połączenia.
- R-03, R-25, R-32, R-34: macierz szerokości i języków, oba motywy, axe AA i widoczny fokus klawiatury.
- R-24, R-26: link powrotny otwiera landing; przystanki reagują na klik i Enter; kopiowanie zapisuje URL; SMS i Web Share otrzymują treść połączenia; ponowna próba pobiera rozkład.
- R-27: uszkodzony lub pusty link ma komunikat, pobieranie ma stan ładowania, brak rozkładu ma komunikat i ponowną próbę. Podsumowanie pozostaje dostępne.
- R-28, R-33: brak nowego FAQ i mechanizmu podmiany plików źródłowych.
- R-35: wykonano buildy, eksport i testy przeglądarkowe powyżej; zakres kontroli natywnej oraz brak testu urządzenia opisano jawnie.
- R-37: kierunek z briefu, M3 Expressive w istniejącej tożsamości Kilometra.

### 2. Purpose-Gate: PASS

- R-01, R-06: turkusowe role M3 i systemowa typografia kontynuują aplikację; duża godzina przyjazdu odpowiada na pytanie odbiorcy, kiedy podróż się skończy.
- R-04, R-08, R-09: istniejące ikony pojazdów identyfikują etapy, strzałka łączy początek z celem, oznaczenia linii niosą dane. Brak dekoracyjnych badge'ów i migających kropek.
- R-07, R-10, R-12, R-13, R-22: brak nowych wzorów tła, szkła, cieni, poświat i ilustracji.
- R-14, R-19: karta podsumowuje całą podróż, kolejne wiersze opisują jej etapy; ruch dolnego arkusza pokazuje zmianę kontekstu i respektuje ustawienie ograniczonego ruchu biblioteki.

### 3. Liveliness: PASS

- Energia 2, rytm 2, ruch 2. Fokalnym punktem jest przyjazd, a motywem tożsamości jest sekwencja linii i godzin.
- Duże odstępy oddzielają podsumowanie od działań, mniejsze łączą przystanki danego etapu. Turkus wyróżnia przyjazd i główne działanie.

### 4. Craftsmanship i Quality Locks: PASS

- C-1 do C-5: widok służy przekazaniu konkretnej podróży, akcje mają obsługę sukcesu i błędu, dane pochodzą z połączenia i rozkładu. Granice weryfikacji natywnej opisano powyżej.
- R-05, R-11: jedna kolumna na telefonie, dwie na desktopie; promienie różnicują kartę, etap i działanie. Brak sekcji marketingowych dodanych dla wypełnienia.
- R-15, R-16, R-20, R-21: konkretne etykiety działań, bez marketingowych obietnic; zachowane istniejące motywy i tożsamość aplikacji.
- R-29, R-30, R-31: neutralne powierzchnie i turkus M3; kolory linii pochodzą z istniejącego systemu. Układ wynika z danych podróży oraz briefu.
