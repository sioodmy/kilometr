---
name: stop-hints
description: "Use when generating, updating, or validating 1-sentence stop location hints (spatial micro-guidance) for transit stops using OSM and GTFS data with Gemini in T3 Code."
---

# Stop Hints (Mikrowskazówki lokalizacji przystanków)

Ten skill definiuje twardy proces generowania 1-zdaniowych wskazówek przestrzennych dla przystanków (np. we Wrocławiu). Wskazówka ma pomóc pasażerowi znaleźć właściwy słupek w dużym węźle przesiadkowym.

Generatorem jest Gemini 3.8 Flash. To słaby model: zmyśla sklepy i lał wodę. Dlatego wszystkie reguły niżej są wymuszone procesem i walidacją, nie stylistyką. Kolejność kroków jest obowiązkowa.

## Workflow (obowiązkowy, kolejność twarda)

```
1. Zbierz kontekst:   GTFS + Overpass (skrypt stop-hints-context.mjs)
2. Wygeneruj:         Gemini 3.8 Flash na prompt template (niżej)
3. Zweryfikuj:        build-stop-hints.mjs (walidacja anti-slop + budowa JSON)
4. Opublikuj:         R2 + fallback offline w aplikacji
```

Nie pisz wskazówek "z głowy" ani na oko z mapy. Wskazówka bez raportu kontekstowego to fabrykacja.

## Format danych

Wskazówki per-miasto: `cloudflare/data/stop-hints-<city>.json`. Po buildzie: `cloudflare/dist/<city>/stop-hints.json`.

```json
{
  "schemaVersion": 1,
  "city": "wroclaw",
  "generatedAt": "2026-10-30T12:00:00Z",
  "stops": {
    "20820": "Wyspa centralna Ronda Reagana, peron 1 od strony Pasażu Grunwaldzkiego w stronę Centrum i Leśnicy."
  },
  "clusters": {
    "pl_grunwaldzki": "Wyspa centralna z peronami 1-4 w środku ronda (zejście podziemne); perony 1-2 od Pasażu, 3-4 od Politechniki."
  }
}
```

Klucze: kody słupków GTFS (`"20820"`) oraz znormalizowane nazwy zespołów (`snake_case`, bez diakrytyków). To zwykłe `Record<string, string>`. Nie twórz obiektów `{ "code": ..., "text": ... }` i nie powielaj kodu wewnątrz wartości.

Fallback w aplikacji: `stops[code]` (5-cyfrowy kod dzienny lub 6-cyfrowy nocny), potem `stops[stop_id]`, potem `clusters[nazwa]`.

## Grounding (anty-halucynacja)

Jedynym źródłem prawdy jest raport ze skryptu `stop-hints-context.mjs`. Wygeneruj kontekst, a Gemini daj TYLKO jego treść:

```bash
node cloudflare/scripts/stop-hints-context.mjs --city=wroclaw --pole=20820              # jeden słupek
node cloudflare/scripts/stop-hints-context.mjs --city=wroclaw --cluster="grunwaldzki"   # cały zespół
node cloudflare/scripts/stop-hints-context.mjs --city=wroclaw --limit=20                # top węzły
node cloudflare/scripts/stop-hints-context.mjs --city=wroclaw --all --output=ctx.json    # pełny zbiór do pliku
```

Skrypt podaje dla każdego słupka: linie i kierunki z GTFS, ulice obok, perony OSM (ref, wiata, poziom) oraz ZWERYFIKOWANE POI z odległością w metrach.

Twarde reguły grounding:

1. **POI:** wskazówka może wymienić wyłącznie punkty z sekcji `ZWERYFIKOWANE PUNKTY ORIENTACYJNE`. Gdy raport mówi `BRAK bezpośrednio przylegających (ZAKAZ wymyślania sklepów/sieciówek!)`, wskazówka nie może zawierać żadnej marki ani sklepu. Zero wyjątków.
2. **Geometria:** opisuj tylko to, co w raporcie: typ peronu, ulice, perony OSM. Typ przystanku (tramwajowy/autobusowy) wywiedz z linii w raporcie, nie z wyobraźni.
3. **Liczby:** używaj odległości tylko takich, które raport podaje. Nie wymyślaj numerów peronów ani odległości.
4. **Kierunki:** tylko z pola `Główne kierunki` (są z GTFS, wiarygodne).
5. **Nazwy:** przepisuj ulice i POI dokładnie znak po znaku.

Jeśli raport nie daje wystarczająco danych, wskazówka opiera się na geometrii, ulicach i kierunkach. Głupsza wskazówka jest lepsza niż zmyślona.

## Zasady redagowania (anty-slop)

1. Dokładnie 1 zdanie, maksimum 20 słów.
2. Zero waty słownej (walidator odrzuca te wzorce):
   - ❌ „Ten przystanek komunikacji miejskiej to peron, na którym zatrzymują się tramwaje.”
   - ❌ „Pasażerowie mogą skorzystać z bezpiecznego dojścia.”
   - ✅ „Wyspa tramwajowa na ul. Świdnickiej, dojście pasami od strony DH Renoma i Biedronki.”
   - ✅ „Zatoka autobusowa za skrzyżowaniem w stronę Dworca, słupek przed wejściem do Lidla.”
3. Landmarki z raportu mają priorytet: ludzie rozpoznają Biedronkę, Orlena czy Lidla natychmiast. Użyj ich tylko wtedy, gdy raport je pokazuje.
4. Gdy POI brak, użyj elementów geometrycznych: wyspa centralna, zatoka autobusowa, torowisko, peron wiedeński, przejście podziemne.

## Prompt template dla Gemini 3.8 Flash

Wywołania Gemini implementuj w kodzie (system prompt + user prompt), nie dopiskami ręcznymi. Template:

```text
SYSTEM:
Generujesz jedną krótką wskazówkę lokalizacyjną dla przystanku.
TWARDE ZASADY:
1. Wyjście: wyłącznie poprawny JSON: {"hint": "<zdanie>"}. Bez markdown, bez komentarzów.
2. Dokładnie jedno zdanie, maksimum 20 słów, po polsku.
3. Używasz wyłącznie informacji z sekcji "KONTEKST". Nie znasz tej lokalizacji.
4. Zakaz wymyślania: żadnego sklepu, marki, galerii, instytucji, której nie ma w KONTEKŚCIE.
5. Gdy POI brak: opisz geometrię, ulice i kierunki. Głupsza wskazówka jest lepsza niż zmyślona.
6. Zakaz ustępów: "ten przystanek", "znajduje się", "można skorzystać", "komunikacja miejska", "dogodna lokalizacja".
7. Gdy kontekst nie wystarcza, zwróć {"hint": null}.

USER:
KONTEKST:
<raport kontekstowy ze skryptu>
```

Nazwy POI przepisuj dokładnie z raportu. Nie poprawiaj ich po swojemu.

## Narzędzia CLI

| Co | Komenda |
|----|---------|
| Kontekst dla Gemini | `node cloudflare/scripts/stop-hints-context.mjs --city=wroclaw [--pole=X] [--cluster="nazwa"] [--limit=N] [--all] [--json] [--output=f]` |
| Walidacja anti-slop + budowa JSON dla R2 | `node cloudflare/scripts/build-stop-hints.mjs --city=wroclaw` |
| Canary pokrycia (węzły > 2 słupki) | `node cloudflare/scripts/check-stop-hints.mjs --city=wroclaw [--create-issue]` |
| Masowe uzupełnianie węzłów (ręczna baza) | `node cloudflare/scripts/generate-all-wroclaw-hubs.mjs` |

Walidator w `build-stop-hints.mjs` odrzuca watę słowną (m.in. "ten przystanek", "można skorzystać", "komunikacja miejska") i wskazówki krótsze niż 10 znaków. Fail walidacji sygnalizuje słabą wskazówkę: przepisz ją, nie omijaj walidatora.

## Publikacja i fallback offline

Build + upload robi workflow `.github/workflows/stop-hints.yml` (trigger: zmiana `cloudflare/data/stop-hints-*.json` albo skryptów). Ręcznie:

```bash
npx wrangler r2 object put "kilometr-timetable/wroclaw/stop-hints.json" \
  --file=cloudflare/dist/wroclaw/stop-hints.json --content-type=application/json
```

Offline fallback: `src/data/stopHintsWroclaw.ts`, generowany przez `generate-all-wroclaw-hubs.mjs`. Po każdej zmianie bazy odśwież ten plik.

## Specyfika miast

Przed edycją wskazówek dla danego miasta przeczytaj `references/<city>.md`:

- **Wrocław**: [references/wroclaw.md](references/wroclaw.md)
  - Nazwa zespołu w GTFS: `PL. GRUNWALDZKI` (nie Rondo Reagana).
  - Wyspa centralna ma 4 perony: 1 i 2 od strony Pasażu, 3 i 4 od strony Politechniki.
  - Kody słupków wyspy: Peron 1 = `20820`, Peron 2 = `20823`, Peron 3 = `20824`, Peron 4 = `20815`.
  - Tramwaje omijające wyspę (np. linia 1): `20855`, `20816` na ul. Curie-Skłodowskiej.


