---
name: stop-hints
description: "Use when generating, updating, or validating 1-sentence stop location hints (spatial micro-guidance) for transit stops using OSM and GTFS data with Gemini in T3 Code."
---

# Stop Hints (Mikrowskazówki lokalizacji przystanków)

Ten skill definiuje twardy proces generowania 1-zdaniowych wskazówek przestrzennych dla przystanków (Wrocław, Warszawa, GZM, Kraków, Poznań). Wskazówka ma pomóc pasażerowi bezbłędnie znaleźć właściwy słupek w terenie lub w dużym węźle przesiadkowym.

## GŁÓWNA ZASADA: FIZYCZNY PUNKT ODNIESIENIA ALBO NIC

Wskazówka ma wartość dla pasażera **WYŁĄCZNIE WTEDY**, gdy posiada **fizyczny, jednoznaczny punkt odniesienia w terenie**:
- **Landmark / POI**: `obok restauracji „U Kingi”`, `obok sklepu spożywczego „U Kingi”`, `obok stacji Shell`, `obok Żabki`, `obok apteki`, `przed Teatrem Capitol`, `przed wejściem do szpitala`, `obok Biedronki`, `obok KFC`,
- **Element krajobrazu / topografii**: `po stronie Parku Południowego`, `przy fosie miejskiej`, `pod wiaduktem kolejowym`, `obok mostu Zwierzynieckiego`,
- **Specyficzny układ peronów na węźle**: `wyspa centralna Ronda Reagana, peron 1 od strony Pasażu`, `dolny peron tramwajowy w wykopie pod placem`.

> [!CAUTION]
> **ZAKAZ GENEROWANIA OPISÓW ZŁOŻONYCH TYLKO Z ULICY I KIERUNKU!**
> Tekst w stylu: *„Peron tramwajowy na ul. Grabiszyńska, słupek w stronę Oporów”* to bezwartościowy szum (anty-slop). Ulicę i kierunek pasażer ma już podaną na karcie kursu i mapie.
> **Jeśli słupek NIE MA zweryfikowanego punktu odniesienia ani specyficznej geometrii peronów -> NIE GENERUJ DLA NIEGO WSKAZÓWKI!** Brak wpisu w bazie (`null`) jest nieporównywalnie lepszy niż generowanie pustosłowia. UI aplikacji po prostu nie wyświetli wówczas zbędnego paska.

---

## TWARDA ZASADA JEDNOZNACZNOŚCI POI (STOP ENIGMATYCZNYM NAZWOM)

Pasażer czytający wskazówkę musi od razu rozumieć, czym jest punkt orientacyjny:
1. **Ogólnokrajowe, powszechnie rozpoznawalne marki i sieci** (`Żabka`, `Biedronka`, `Lidl`, `Kaufland`, `Netto`, `Dino`, `Carrefour`, `Auchan`, `Rossmann`, `KFC`, `McDonald's`, `Burger King`, `Subway`, `Orlen`, `BP`, `Shell`, `Circle K`, `Moya`, `Mol`, `Amic`, `Castorama`, `Leroy Merlin`, `IKEA`, `OBI`, `Decathlon`, `Media Markt`, `Empik`, `Hebe`, `Pepco`, `Action`, `Dealz`, `Duży Ben`, `Aldi`) oraz powszechnie znane centra handlowe i gmachy (`Złote Tarasy`, `Wroclavia`, `Posnania`, `Bałtyk`, `Spodek`, `Sukiennice`) są powszechnie zrozumiałe bez dodatkowego opisu. Dopuszczalne: `obok Żabki`, `obok KFC`, `obok stacji Shell`, `obok Biedronki`.
2. **Dla WSZYSTKICH POZOSTAŁYCH obiektów, lokalnych biznesów, sklepów, lokali i usług:**
   **BEZWZGLĘDNY NAKAZ podawania rodzaju/kategorii działalności przed nazwą własną!**
   Nazwę własną ujmujemy w cudzysłów (np. `„Nazwa”`):
   - `obok restauracji „... ”`
   - `obok sklepu spożywczego „... ”` / `obok sklepu „... ”`
   - `obok kawiarni „... ”`
   - `obok pizzerii „... ”`
   - `obok piekarni „... ”`
   - `obok cukierni „... ”`
   - `obok baru „... ”` / `obok pubu „... ”`
   - `obok salonu fryzjerskiego „... ”` / `obok salonu urody „... ”`
   - `obok kwiaciarni „... ”`
   - `obok gabinetu stomatologicznego „... ”` / `obok przychodni „... ”`
   - `obok apteki „... ”`
   - `obok hotelu „... ”` / `obok hostelu „... ”`
   - `obok warsztatu samochodowego „... ”` / `obok serwisu „... ”`
   - `obok kwiaciarni „... ”`
   - `obok salonu meblowego „... ”`
   - `obok placówki banku ...`
3. **ZAKAZ enigmatycznych, nieznanych nazw własnych bez określenia czym są:**
   - ❌ `Słupek 01 • Zatoka autobusowa obok u Kingi.` (Czym jest „u Kingi”? Pasażer nie wie! To niedopuszczalny slop.)
   - ❌ `Zatoka autobusowa obok Puchary.`
   - ❌ `Peron tramwajowy obok U Kasi.`
   - ❌ `Zatoka autobusowa obok to tu.`
   - ❌ `Stanowisko 1 • Zatoka autobusowa obok Familijna.`
   - ❌ `Słupek 02 • Zatoka autobusowa obok Kim Ngan.`
   - ❌ `Zatoka autobusowa obok Stylówka.`
   - ❌ `Zatoka autobusowa obok 303 Rodzaje Piwa.`
   - ✅ `Słupek 01 • Zatoka autobusowa obok sklepu spożywczego „U Kingi”.`
   - ✅ `Zatoka autobusowa obok sklepu „Puchary”.`
   - ✅ `Peron tramwajowy obok sklepu „U Kasi”.`
   - ✅ `Stanowisko 1 • Zatoka autobusowa obok piekarni „Familijna”.`
   - ✅ `Słupek 02 • Zatoka autobusowa obok baru azjatyckiego „Kim Ngan”.`
   - ✅ `Zatoka autobusowa obok salonu fryzjerskiego „Stylówka”.`
   - ✅ `Zatoka autobusowa obok sklepu z alkoholami „303 Rodzaje Piwa”.`

---

## Workflow (obowiązkowy, kolejność twarda)

```
1. Zbierz kontekst:   GTFS + Overpass (skrypt stop-hints-context.mjs)
2. Wygeneruj:         Gemini 3.8 Flash na prompt template (niżej)
3. Zweryfikuj:        build-stop-hints.mjs (walidacja anti-slop + budowa JSON)
4. Opublikuj:         R2 + fallback offline w aplikacji
```

Nie pisz wskazówek „z głowy” ani na oko z mapy. Wskazówka bez zweryfikowanego punktu odniesienia to fabrykacja.

## Format danych

Wskazówki per-miasto: `cloudflare/data/stop-hints-<city>.json`. Po buildzie: `cloudflare/dist/<city>/stop-hints.json`.

```json
{
  "schemaVersion": 1,
  "city": "wroclaw",
  "generatedAt": "2026-10-30T12:00:00Z",
  "stops": {
    "20820": "Wyspa centralna Ronda Reagana, peron 1 od strony Pasażu Grunwaldzkiego.",
    "11345": "Peron tramwajowy na ul. Powstańców Śląskich obok lokalu z kebabem „K2 PK Kebab”.",
    "26314": "Zatoka autobusowa na ul. Ołtaszyńskiej po stronie Parku Południowego obok stacji Shell."
  },
  "clusters": {
    "pl_grunwaldzki": "Wyspa centralna z peronami 1–4 w środku ronda (zejście podziemne); perony linii 1 na Curie-Skłodowskiej.",
    "fat": "Węzeł przesiadkowy u zbiegu ul. Grabiszyńskiej i Hallera przy dawnej fabryce FAT i Tarasach Grabiszyńskich."
  }
}
```

Klucze: kody słupków GTFS (`"20820"`) oraz opcjonalnie znormalizowane nazwy kluczowych węzłów (`snake_case`, bez diakrytyków). To zwykłe `Record<string, string>`. Nie twórz obiektów `{ "code": ..., "text": ... }` i nie powielaj kodu wewnątrz wartości.

## Grounding (anty-halucynacja i eliminacja pustosłowia)

1. **POI:** wskazówka może wymienić wyłącznie punkty ze zweryfikowanego OSM (promień $\le 35\text{ m}$ dla sklepów/lokali lub $\le 75\text{ m}$ dla dworców/parków/szpitali).
2. **Gdy POI brak i brak specyficznej wyspy/poziomu:** **ZWRÓĆ NULL / POMIŃ SŁUPEK**. Nigdy nie generuj zdania z samą ulicą i kierunkiem.
3. **Kierunki:** służą wyłącznie do doprecyzowania peronów na skomplikowanych węzłach (np. peron 1 vs peron 2), nigdy jako jedyna treść wskazówki.
4. **Nazwy:** przepisuj ulice i POI dokładnie znak po znaku.

## Zasady redagowania (anty-slop)

1. Dokładnie 1 zdanie, maksimum 20 słów.
2. Zero waty słownej (walidator odrzuca te wzorce):
   - ❌ „Ten przystanek komunikacji miejskiej to peron, na którym zatrzymują się tramwaje.”
   - ❌ „Peron tramwajowy na ul. Grabiszyńska w stronę Oporowa.” (brak punktu odniesienia!)
   - ❌ „Pasażerowie mogą skorzystać z bezpiecznego dojścia.”
   - ❌ „Zatoka autobusowa obok u Kingi.” (brak kategorii punktu orientacyjnego!)
   - ✅ „Wyspa tramwajowa na ul. Świdnickiej obok Teatru Capitol.”
   - ✅ „Zatoka autobusowa na ul. Borowskiej obok stacji Shell.”
   - ✅ „Zatoka autobusowa na ul. Falistej obok sklepu spożywczego „U Kingi”.”
   - ✅ „Peron tramwajowy po stronie Parku Południowego.”
   - ✅ „Zatoka autobusowa pod wiaduktem kolejowym na ul. Grabiszyńskiej.”

## Prompt template dla Gemini 3.8 Flash

```text
SYSTEM:
Generujesz jedną krótką wskazówkę lokalizacyjną dla przystanku.
TWARDE ZASADY:
1. Wyjście: wyłącznie poprawny JSON: {"hint": "<zdanie>" lub null}. Bez markdown, bez komentarzy.
2. Dokładnie jedno zdanie, maksimum 20 słów, po polsku.
3. Wskazówka MUSI zawierać fizyczny punkt odniesienia (POI, park, kebab, sklep, wiadukt, kościół, szpital, wyspa centralna peron 1-4).
4. Jeśli punktem odniesienia jest lokal, sklep, punkt usługowy lub firma, która NIE jest ogólnokrajową, oczywistą dla każdego siecią (jak Żabka, Biedronka, Lidl, KFC, McDonald's, Orlen itp.), BEZWZGLĘDNIE podaj rodzaj/kategorię obiektu w cudzysłowie, np. 'obok restauracji „Nazwa”', 'obok sklepu spożywczego „Nazwa”', 'obok kawiarni „Nazwa”', 'obok salonu fryzjerskiego „Nazwa”', 'obok kwiaciarni „Nazwa”'.
   BEZWZGLĘDNY ZAKAZ enigmatycznych nazw własnych bez określenia czym są (anty-przykład: ZAKAZ 'obok u Kingi' -> poprawnie: 'obok restauracji „U Kingi”' lub 'obok sklepu „U Kingi”').
5. Jeśli w KONTEKŚCIE NIE MA żadnego fizycznego punktu odniesienia -> ZWRÓĆ {"hint": null}.
   ZAKAZ pisania bezwartościowych zdań składających się wyłącznie z ulicy i kierunku!
6. Zakaz wymyślania obiektów spoza KONTEKSTU.
7. Zakaz ustępów: "ten przystanek", "znajduje się", "można skorzystać", "komunikacja miejska", "dogodna lokalizacja".

USER:
KONTEKST:
<raport kontekstowy ze skryptu>
```

## Narzędzia CLI

| Co | Komenda |
|----|---------|
| Kontekst dla Gemini | `node cloudflare/scripts/stop-hints-context.mjs --city=wroclaw [--pole=X] [--cluster="nazwa"]` |
| Generator uziemionych wskazówek | `node cloudflare/scripts/generate-grounded-stop-hints.mjs [--city=poznan] [--all]` |
| Walidacja anti-slop + budowa JSON dla R2 | `node cloudflare/scripts/build-stop-hints.mjs --city=wroclaw` |
| Canary test pokrycia | `node cloudflare/scripts/check-stop-hints.mjs --city=wroclaw` |

## Publikacja i fallback offline

Build + upload robi workflow `.github/workflows/stop-hints.yml`.
Offline fallback w aplikacji: `src/data/stopHints<City>.ts`.
