# Landing Kilometra: weryfikacja

19 października 2026. Kierunek z briefu: premiera produktu w stylu Apple, aplikacja na Androida i zasięg ogólnopolski. Bez nowych zależności produkcyjnych.

## 1. Hard Gate: PASS

- R-02, R-03: teksty bez pauz em; PL/EN/DE/UK sprawdzone przy 320, 360, 390, 640, 768, 1024 i 1440 px. Brak poziomego przewijania.
- R-17, R-18, R-23, R-36, R-38: liczba 15 pochodzi z `src/cities.ts`. Bez opinii, ocen i deklaracji wydajności aplikacji. Ikona pochodzi z `assets/icon.png`. Podglądy interfejsu są oznaczonymi przykładami, nie zrzutami ekranu ani danymi na żywo.
- R-24, R-26, R-35: sprawdzone odnośniki wewnętrzne, wszystkie przyciski i elementy z tabeli poniżej. Brak błędów JavaScript. Produkcyjny katalog działa pod `/kilometr/`.
- R-25, R-32, R-34: axe bez naruszeń WCAG A/AA przy 390 i 1440 px w obu motywach. Kontrast przycisku wynosi 5,46:1 w jasnym motywie i 9,34:1 w ciemnym. Najsłabsza sprawdzona para tekstu wynosi 4,58:1. Widoczny focus, skrót do treści, obsługa klawiatury i cele dotykowe od 44 px.
- R-27, R-28, R-33: treść statyczna, bez pobierania danych z API i stanów oczekiwania na serwer. Brak FAQ. Zablokowany localStorage nie blokuje strony ani zmiany języka i motywu. Jest wariant bez JavaScriptu z linkiem do sklepu. Kod edytowany bez skryptów przepisujących pliki źródłowe.
- R-37: kierunek pochodzi bezpośrednio z briefu użytkownika.

| Element                                        | Sprawdzone zachowanie                                                                                                                                                       |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Logo i powrót z podstrony                      | Przejście do `#top` i przywrócenie landingu                                                                                                                                 |
| Możliwości, zasięg, pobieranie                 | Przejście do istniejących sekcji, również z menu mobilnego                                                                                                                  |
| Google Play, oba przyciski                     | Nawigacja pod adres pakietu `my.siood.kilometr`, potwierdzony przez użytkownika. Karta sklepu zwraca jeszcze 404 przed premierą                                             |
| Zaplanuj, Wracaj, Jedź                         | Zmiana treści i podglądu; działają strzałki, Home, End i kolejność fokusu                                                                                                   |
| Wszystkie 15 miast                             | Zmiana zaznaczenia na mapie i informacji o mieście                                                                                                                          |
| Wybór języka                                   | Zmiana całej treści, tytułu, opisu i `html.lang`; wybór zostaje po odświeżeniu                                                                                              |
| Motyw                                          | Jasny i ciemny wygląd; wybór zostaje po odświeżeniu; domyślnie preferencja systemu                                                                                          |
| Menu mobilne                                   | Otwieranie, zamykanie, zamknięcie po nawigacji i Escape; po Escape focus wraca do przycisku. Menu nie zostaje widoczne na desktopie                                         |
| Prywatność i benchmark                         | Bezpośrednie wejście przez `#polityka` i `#raport`, działający powrót                                                                                                       |
| GitHub, kod, zgłoszenia, metodologia, licencja | Nawigacja po kliknięciu i odpowiedzi HTTP 200 z docelowych stron                                                                                                            |
| APK na GitHubie                                | Nawigacja do `releases/latest` z odpowiedzią HTTP 200. Obecny release ma plik `app-release.apk`; po zmianie nazwy na `kilometr-prod.apk` link do wydania pozostaje poprawny |
| Wersje testowe                                 | Nawigacja do listy wydań GitHuba                                                                                                                                            |
| Obtainium                                      | Zachowany protokół `obtainium://app/https://github.com/sioodmy/kilometr`; otwarcie aplikacji wymaga zainstalowanego klienta                                                 |

## 2. Purpose-Gate: PASS

- R-01, R-06, R-07, R-31: zieleń wynika z ikony aplikacji. Krój systemowy nawiązuje do natywnych interfejsów i nie wymaga pobierania fontów. Jasna przestrzeń eksponuje produkt; elipsa pod telefonami grupuje trzy widoki na jednej podstawie.
- R-04, R-08, R-09: zachowana biblioteka Lucide, zgodna z aplikacją. Ikony oznaczają transport, pobieranie, motyw lub konkretną akcję. Strzałki wskazują nawigację. Brak ozdobnych statusów, migających kropek i pigułek.
- R-10, R-12, R-13, R-14: rozmycie tylko w nagłówku. Cienie oddzielają urządzenia i ilustrację biletu od tła. Funkcje mają wspólny przełączany widok zamiast szeregu jednakowych kart.
- R-19, R-22: wejście telefonów kieruje uwagę na produkt; krótkie ujawnianie sekcji wspiera rytm czytania. Bez zapętlonych animacji i przechwytywania przewijania. `prefers-reduced-motion` wyłącza ruch. Ilustracja trybu samolotowego objaśnia pracę offline.

## 3. Liveliness: PASS

- ENERGY 2 / RHYTHM 3 / MOTION 2. Odpowiednik skali taste: DESIGN_VARIANCE 7 / MOTION_INTENSITY 5 / VISUAL_DENSITY 3.
- Jeden główny akcent w każdym widoku: nagłówek i telefony, aktywna funkcja, ilustracja offline, mapa, pobieranie.
- Zmienny rytm: centralny hero, prezentacja funkcji, ilustracja z opisem, wybór miasta z mapą, otwarty układ zasad, końcowe pobieranie.
- Powtarzany motyw to komunikacja miejska: ikona aplikacji, urządzenia, trasa i punkty rzeczywistych miast.

## 4. Craftsmanship i Quality Locks: PASS

- C-1 do C-5: decyzje i źródła wymieniono powyżej; bez nieaktywnych atrap kontrolek i niepotwierdzonych statystyk produktu.
- R-05, R-11, R-15, R-16, R-20: struktura wynika z planowania podróży. CTA opisują pobieranie i instalację. Przyciski akcji są zaokrąglone, sekcje mają promień 24/32 px, panele informacji 16 px. Brak domyślnych sloganów o rewolucji lub AI.
- R-21, R-29, R-30, R-31: jeden motyw kolorystyczny w każdym trybie, jedna zieleń akcentowa, istniejąca tożsamość Kilometra. Inspiracja premierami Apple wynika z prośby użytkownika.
- `npm run typecheck`, `npm run lint` oraz `npm --prefix landing run build`: PASS.
- Osobny build po `npm ci` wyłącznie w `landing/`, bez głównego `node_modules`: PASS. Współdzielone słowniki nie wciągają Expo ani React Native do strony.
- Chromium 155, produkcyjne pliki pod `/kilometr/`, lokalny serwer z gzip: Lighthouse mobile 100 performance / 100 accessibility / 100 best practices / 100 SEO. LCP 1,5 s, TBT 60 ms, CLS 0. To pomiar laboratoryjny, nie wynik z wdrożonego GitHub Pages. Bez gzip ten sam lokalny build uzyskał 93 performance.

## Utrzymanie

- Uruchomienie: `npm --prefix landing ci`, potem `npm --prefix landing run dev`.
- Build: `npm --prefix landing run build` zapisuje stronę do `docs/`; archiwalne `docs/screenshots/` pozostają na miejscu.
- Adresy pobierania: `landing/src/data.ts`.
- Teksty: `src/i18n/landing/`, dołączone również do typowanego słownika aplikacji. Nazwy miast zachowują polską pisownię we wszystkich wersjach językowych.
- Zasięg i środki transportu: `src/cities.ts`. Nazwy w słowniku mają kontrolę kompletności typu `CityId`.
- Makiety: `landing/src/components/Phone.tsx`, oparte na kodzie ekranów i tokenach aplikacji. `social-preview.png` to render tej prezentacji, bez generowania nowej identyfikacji.
- Granica Polski: [Natural Earth 1:110m](https://github.com/nvkelso/natural-earth-vector/blob/master/geojson/ne_110m_admin_0_countries.geojson), dane w domenie publicznej.
- Strona nie ładuje dotychczasowego Google Analytics. Przechowuje tylko ustawienia języka i motywu, zgodnie z opisem pod `#polityka`.
- Workflow nadal wdraża GitHub Pages wyłącznie z `main`. Zmiany współdzielonych słowników lub rejestru miast również wyzwalają przebudowę. Link APK prowadzi do stabilnego wydania GitHuba, niezależnie od nazwy załącznika.
