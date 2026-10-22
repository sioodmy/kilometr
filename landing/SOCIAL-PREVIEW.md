# Baner udostępniania

22 października 2026. PNG 1200 × 630 px, około 197 KiB. Kierunek: obecny landing Kilometra. ENERGY 2 / RHYTHM 2 / MOTION 1.

Źródło: `social-preview.html`. Uruchom `npm --prefix landing run dev`, otwórz `/social-preview.html` i zapisz zrzut przy obszarze strony 1200 × 630 px. Jeśli przeglądarka skaluje zrzut, przeskaluj eksport do tych wymiarów. Przed zapisem poczekaj na obrazy i fonty. Wynik trafia do `landing/public/social-preview.png` i identycznej kopii w `docs/social-preview.png`.

Osobny embed połączenia pominięty. Linki przechowują dane w `#trip`, odczytywanym przez aplikację w przeglądarce. Bot pobierający statyczny HTML otrzymuje metadane landingu. Osobny podgląd wymagałby adresu lub obsługi serwera rozróżniającej podróże.

## 1. Hard Gate: PASS w zakresie banera

- Istniejące komponenty `Hero`, `Phone` i `TransitBackdrop`, znaki miast oraz teksty ze słownika. Bez nowych danych demonstracyjnych, statystyk i opinii.
- PNG sprawdzony wizualnie w wymiarach 1200 × 630 px. Wszystkie obrazy źródłowe załadowane. Brak uciętych treści banera i nowych kontrolek.
- Kontrast nagłówka 16,30:1, opisu 9,50:1, podpisu platform 10,98:1. Opis alternatywny w słownikach PL/EN/DE/UK. Bez pauz em w nowych tekstach.
- Metadane OG/Twitter obecne w HTML po transformacji Vite, bez wykonywania aplikacji przez bota. Lokalny adres obrazu z `?v=2` zwraca HTTP 200 i `image/png`.

## 2. Purpose-Gate: PASS

- Ciemna zieleń i systemowa typografia pochodzą z obecnego landingu. Duży nagłówek pozwala rozpoznać produkt w miniaturze.
- Układ poziomy oddziela opis od ekranu telefonu. Marginesy zachowują czytelność w proporcjach embedu.
- Schemat tras i znaki miast kontynuują motyw komunikacji miejskiej. Ograniczenie do czterech znaków zostawia miejsce na podgląd aplikacji.
- Cień i metaliczna ramka pochodzą z istniejącego komponentu telefonu. Animacje wyłączone, kafelki miast bez rozmycia tła.

## 3. Liveliness: PASS

- ENERGY 2 / RHYTHM 2 / MOTION 1 zadeklarowane przed tworzeniem. Nagłówek jest głównym punktem uwagi, telefon pokazuje interfejs produktu.
- Zielony podpis platform, sieć tras i znaki miast zachowują tożsamość Kilometra. Odstępy rozdzielają markę, opis i platformy.

## 4. Craftsmanship i Quality Locks: PASS w zakresie banera

- Weryfikacja w działającym Vite, oględziny końcowego PNG, kontrola wymiarów i identyczności obu kopii. Po ponownym wczytaniu podgląd działa poprawnie.
- TypeScript aplikacji i landingu, ESLint zmienionych plików TypeScript, Prettier i `git diff --check`: PASS.
- Brak nowych zależności. Pełnego buildu nie uruchamiano. Produkcyjny HTML zaktualizuje istniejący workflow GitHub Pages.
