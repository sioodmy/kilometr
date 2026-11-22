# Baner udostępniania

22 listopada 2026. PNG 1200 × 630 px, około 485 KiB. Kierunek: hero po redesignie landingu (mapa z trasą, wyśrodkowany nagłówek, trzy telefony).

Źródło: `social-preview.html` renderuje komponent `Hero` w języku polskim, bez animacji i bez przycisków. Uruchom `npm --prefix landing run dev`, otwórz `/social-preview.html` w oknie 1200 × 630 px i zapisz zrzut. Mapa jest animowana na canvasie, więc wybierz klatkę, w której etykiety trasy nie nachodzą na nagłówek. Jeśli przeglądarka skaluje zrzut, przeskaluj do 1200 × 630 px. Wynik trafia do `landing/public/social-preview.png` i identycznej kopii w `docs/social-preview.png`. Po zmianie podbij `?v=` w `og:image` i `twitter:image` (`landing/index.html`, `docs/index.html`).

Opis alternatywny: `meta.imageAlt` w `src/i18n/landing/{pl,en,de,uk}.ts`.

Osobny embed połączenia pominięty. Linki przechowują dane w `#trip`, odczytywanym przez aplikację w przeglądarce. Bot pobierający statyczny HTML otrzymuje metadane landingu.

## Delivery Gate

- Hard Gate: PASS. Tylko istniejące komponenty, zrzuty i teksty ze słownika. Bez nowych danych, statystyk i kontrolek. Brak uciętego tekstu.
- Purpose-Gate: PASS. Ten sam nagłówek, kolory i mapa co hero strony, więc embed i strona wyglądają jak jedno.
- Liveliness: PASS. Nagłówek jest głównym punktem, telefony pokazują produkt, trasa na mapie prowadzi wzrok.
- Craftsmanship: PASS. Zrzut z działającego Vite, wymiary i identyczność obu kopii sprawdzone.
