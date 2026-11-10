# vagonweb: udogodnienia składu

Scraper [vagonWEB.cz](https://www.vagonweb.cz/razeni/) (sekcja *Řazení vlaků*).
Pobiera planowane składy pociągów w Polsce i wyciąga z nich udogodnienia
pokazywane w karcie połączenia: klimatyzacja, gniazdka 230 V, USB, Wi-Fi,
wagon restauracyjny, bar, przewóz rowerów, dostępność dla wózków, miejsca
leżące i sypialne, strefa ciszy.

Uruchamiane **ręcznie na laptopie**, raz na pół roku. Nie ma tego w CI: źródło
blokuje (429/403, Cloudflare) przy ~15 zapytaniach na minutę, a pełny skrap
trwa ~2,5 h.

## Uruchomienie

```bash
cd scripts/vagonweb

# pełny skrap (rok bieżący), wynik -> cloudflare/data/rail-amenities.json
python3 scrape_vagonweb.py --udogodnienia

# próbka na 25 pociągach (sprawdzenie, czy parser działa)
python3 scrape_vagonweb.py --udogodnienia --limit 25

# kontynuacja po przerwaniu (Ctrl+C, zerwane łącze, uśpiony laptop)
python3 scrape_vagonweb.py --udogodnienia --wznow

# sam postęp, bez pobierania
python3 scrape_vagonweb.py --udogodnienia --stan

# złóż plik wynikowy z tego, co już jest w cache (bez sieci)
python3 scrape_vagonweb.py --udogodnienia --zloz
```

Zależności: wyłącznie standardowa biblioteka Pythona 3.8+.

## Stan pobierania i wznawianie

Każdy pociąg jest zapisywany od razu, linia po linii, do
`cache/udogodnienia_<rok>.jsonl`. Przerwanie nic nie traci: przy `--wznow`
skrypt czyta plik i pomija to, co już jest.

Stan:

```bash
python3 scrape_vagonweb.py --udogodnienia --stan
# plik:     cache/udogodnienia_2026.jsonl
# pociągów: 8019
# pobrane:  412 (5.1%)
# zostało:  7607
# ostatni:  DB 903
```

Wznowienie to ta sama komenda co start: `--udogodnienia --wznow`. Uruchomiona
bez `--wznow` zaczyna od nowa i dopisuje duplikaty do pliku (skrypt tego nie
czyści), więc zawsze używaj `--wznow` po przerwaniu.

## Wyjście

`cloudflare/data/rail-amenities.json` (commit do repo):

```jsonc
{
  "schemaVersion": 1,
  "rok": "2026",
  "pociagi": [
    {
      "agency": "IC",              // agency_id feedu PLK, nie kod vagonweb
      "numer": "113/41006/7",      // numer pociągu z vagonweb
      "nazwa": "Silesia",
      "udogodnienia": ["klimatyzacja", "gniazdka_230V", "wifi", "przewoz_rowerow"],
      "liczby": { "przewoz_rowerow": 8 }   // tylko gdy vagonweb podaje licznik
    }
  ]
}
```

Bierze się wariant składu obowiązujący w dniu uruchomienia (albo oznaczony
jako aktualny), a udogodnienia tylko z pojazdów z miejscami: lokomotywa nie
ma gniazdek.

## Co dalej z plikiem

`cloudflare/scripts/build-polska.mjs` czyta ten plik i wypełnia tabelę
`trip_amenities` w bazie `kilometr-gtfs-polska.db` (dopasowanie po
`agency` + numerze pociągu). Aplikacja czyta ją przez
`src/services/railAmenities.ts`.

Klucze udogodnień muszą się zgadzać w trzech miejscach:

- `UDOGODNIENIA_UI` w `scrape_vagonweb.py`,
- `AMENITY_ORDER` w `cloudflare/scripts/build-polska.mjs`,
- `RAIL_AMENITY_ORDER` w `src/services/railAmenities.ts` (plus sekcja
  `railAmenities` w `src/i18n`).

Mapa przewoźników (`VAGONWEB_AGENCY`) jest w skrypcie i w buildzie: zmiana
tylko w jednym miejscu rozjeżdża dopasowanie.

## Ograniczenia

- vagonweb nie ma składów dla części pociągów (zwłaszcza regionalnych `Os`),
  takie pociągi po prostu nie trafiają do pliku.
- `cache/` jest w `.gitignore` (kilka MB na rok).
- Plik z poprzedniego roku nie pasuje do nowego rozkładu: numeracja pociągów
  się zmienia, więc po zmianie rozkładu uruchom skrap ponownie z nowym `--rok`.
