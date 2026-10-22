# Hero: redesign z 21 października 2026

Zakres: nagłówek i opis, jeden telefon, tło tras, sześć znaków obsługiwanych miast, usunięcie navbara. Język i motyw przeniesione do stopki. Kierunek z briefu: inspiracja [t3.codes](https://t3.codes), zieleń Kilometra, subtelny ruch. ENERGY 2 / RHYTHM 3 / MOTION 2.

## 1. Hard Gate: PASS w zakresie zmian

- R-02, R-03: brak pauz em w zmienionych tekstach. Sprawdzone 48 wariantów: 320, 390, 768, 1024, 1280 i 1440 px, cztery języki, dwa motywy. Bez poziomego przewijania i kolizji znaków miast z tekstem.
- R-17, R-18, R-23, R-36, R-38: autentyczny screenshot `routes.png`, istniejąca ikona Kilometra i znaki z oficjalnych portali. Miasta zgodne z `src/cities.ts`. Bez statystyk, opinii i deklaracji partnerstwa. Tło jest ilustracyjnym schematem, ukrytym przed czytnikami ekranu.
- R-24, R-26, R-32, R-35: sprawdzony klik i Enter na odnośniku do funkcji, Tab przez akcje hero, widoczny focus 3 px, przełączanie motywu i wszystkich języków. Motyw i język zostają po odświeżeniu. Ponownie sprawdzone zakładki funkcji, strzałki klawiatury i wybór wszystkich 15 miast.
- R-25, R-34: kontrast nagłówka 15,40:1 i 16,30:1; zielonego słowa 5,26:1 i 10,98:1; opisu i podpisów 5,87:1 i 9,50:1; CTA 5,46:1 i 9,34:1. Kolejność: jasny i ciemny motyw.
- R-27, R-28, R-33, R-37: statyczne zasoby lokalne, istniejący fallback błędnego screena, brak nowego pobierania danych i FAQ. Edycje bez skryptów przepisujących źródła. Kierunek pochodzi z briefu.
- Zastane ograniczenia poza zakresem: klik Google Play prowadzi do istniejącego adresu `app.kilometr`, który nadal zwraca „Not Found”. Przy powiększeniu tekstu do 200% istniejący ozdobny napis „Zaplanuj” w sekcji funkcji powoduje overflow. Hero mieści tekst. Te dwa problemy wymagają osobnego follow-upu.

## 2. Purpose-Gate: PASS

- R-01, R-06, R-07, R-31: zieleń z tożsamości aplikacji; systemowy font zachowuje związek z interfejsem telefonu bez dodatkowego pobierania. Schemat tras objaśnia temat planera. Maska wygasza tło przy krawędziach sekcji.
- R-04, R-08, R-09: istniejące ikony oznaczają pobieranie i motyw, strzałka prowadzi do funkcji. Bez ozdobnych statusów i badge'y.
- R-10, R-12, R-13, R-14, R-22: brak rozmycia i poświat. Małe cienie oddzielają znaki miast i telefon od schematu. Jeden autentyczny widok produktu zastępuje trzy telefony.
- R-19: ruch po trasach i dryf znaków są wskazane w briefie. Parallax potwierdzony ruchem myszy, aktualizacja przez `requestAnimationFrame`. Animacje pauzują poza ekranem i przy ukrytej karcie. Reguły ograniczonego ruchu wyłączają animacje; sprawdzone przez wymuszenie ich aktywności w CSSOM. Zmiana preferencji zeruje parallax.

## 3. Liveliness: PASS

- ENERGY 2 / RHYTHM 3 / MOTION 2, zadeklarowane przed implementacją.
- Nagłówek pozostaje głównym punktem uwagi. Miasta są na obrzeżach; na telefonie układają się nad i pod tekstem. Pozostałe sekcje zachowują dotychczasowy zróżnicowany układ.
- Motyw własny: schemat połączeń, ekran planera i rzeczywiste obsługiwane miasta. Zielony akcent wskazuje otwarty kod i pobranie aplikacji.

## 4. Craftsmanship i Quality Locks: PASS w zakresie zmian

- C-1 do C-5, R-05, R-11, R-15, R-16, R-20, R-21, R-29, R-30, R-31: kompozycja i ruch wynikają z briefu. Zachowana tożsamość Kilometra. CTA opisuje pobranie; kolory znaków pozostają zgodne z oryginałami.
- `npx tsc --noEmit`, TypeScript landingu, ESLint zmienionych plików, Prettier i `git diff --check`: PASS. Uruchomiono Vite i sprawdzono widoki w przeglądarce. Bez nowych zależności produkcyjnych.
- Brak nowego pełnego buildu i przebudowy `docs/`. Wdrożenie pozostaje w istniejącym workflow GitHub Pages.

Źródła znaków: [Wrocław](https://commons.wikimedia.org/wiki/File:Herb_wroclaw.svg), [Kraków](https://commons.wikimedia.org/wiki/File:POL_Krak%C3%B3w_COA.svg), [Warszawa](https://commons.wikimedia.org/wiki/File:Warsaw_logo_2022.svg), [Poznań](https://commons.wikimedia.org/wiki/File:POL_Pozna%C5%84_COA.svg), [GZM](https://commons.wikimedia.org/wiki/File:G%C3%B3rno%C5%9Bl%C4%85sko-Zag%C5%82%C4%99biowskiej_Metropolii_03.svg), [Łódź](https://commons.wikimedia.org/wiki/File:POL_%C5%81%C3%B3d%C5%BA_COA.svg). Pliki WebP w `landing/public/cities/` (przycięte, przezroczyste tło, wysokość 256 px), bez żądań do Wikimedia podczas korzystania ze strony. Warszawa i GZM bez napisu z nazwą pod herbem.
