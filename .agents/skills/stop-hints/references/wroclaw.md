# Specyfika węzłów i przystanków we Wrocławiu (Wrocław Transit Reference)

Dokument referencyjny dla agentów generujących wskazówki przestrzenne (`stop-hints`) dla aglomeracji wrocławskiej.
**NIE MODYFIKUJ ANI NIE NADPISUJ TYCH DANYCH BEZ WERYFIKACJI W RAW GTFS I SCHEMACIE MPK.**

---

## 1. Rondo Reagana / Plac Grunwaldzki

### Kluczowe fakty:
- **Oficjalna nazwa w GTFS**: `PL. GRUNWALDZKI` (wyszukiwanie `Rondo Reagana` w GTFS nie zwróci przystanku, to nazwa potoczna/zespołu).
- **Format kodów**: 5-cyfrowe kody dzienne (`208xx`, `209xx`) oraz 6-cyfrowe kody nocne (`1208xx`).

### Układ peronów na wyspie centralnej:
Wyspa centralna ma **4 zintegrowane perony tramwajowo-autobusowe** wewnątrz ronda (dostęp wyłącznie przejściem podziemnym z windami lub pochylniami):

```text
                        ↑ Pasaż Grunwaldzki / ul. Piastowska (Północ)
   ═════════════════════════════════════════════════════════════════════════
          [ PERON 2 ]  ──►  kier. Most Szczytnicki / Psie Pole / Piastowska
   ─────────────────────────────────────────────────────────────────────────
          [ PERON 1 ]  ◄──  kier. Most Grunwaldzki / pl. Dominikański / Centrum
   ═════════════════════════════════════════════════════════════════════════
                         (zejście podziemne / windy / kiosk)
   ═════════════════════════════════════════════════════════════════════════
          [ PERON 3 ]  ◄──  kier. Most Grunwaldzki / Dworzec Główny / Krzyki
   ─────────────────────────────────────────────────────────────────────────
          [ PERON 4 ]  ──►  kier. Biskupin / Sępolno / ZOO (Curie-Skłodowskiej)
   ═════════════════════════════════════════════════════════════════════════
                        ↓ Politechnika (C-13) / Most Grunwaldzki (Południe)
```

### Mapowanie słupków:
1. **Peron 1** (słupek `20820`, nocny `120820`):
   - Północna część wyspy (bliżej Pasażu Grunwaldzkiego).
   - Ruch w kierunku zachodnim i południowo-zachodnim: **Centrum, pl. Dominikański, Rynek, Dworzec Główny, Leśnica, Krzyki**.
   - Linie dzienne: tramwaje 2, 10; autobusy D, 111, 121, 131, 151 ku centrum.

2. **Peron 2** (słupek `20823`, nocny `120823`):
   - Północna część wyspy (bliżej Pasażu Grunwaldzkiego).
   - Ruch w kierunku północnym i wschodnim: **Most Szczytnicki, Psie Pole, Kiełczowska, Litewska, Osobowice, ul. Piastowska**.
   - Linie dzienne: tramwaj 16; autobusy D, 111, 121, 131, 151, 241 na północ.

3. **Peron 3** (słupek `20824`, nocny `120824`):
   - Południowa część wyspy (bliżej Politechniki / Serowca C-13).
   - Ruch przez Most Grunwaldzki w stronę centrum: **Dworzec Główny, Oporów, Gaj, Tarnogaj, Krzyki**.
   - Linie dzienne: tramwaje 4, 16, 17, 19; autobusy 145, 146, 149 ku centrum.

4. **Peron 4** (słupek `20815`, nocny `120815`):
   - Południowa część wyspy (bliżej Politechniki / Serowca C-13).
   - Jedyny tor z wjazdem w ul. Curie-Skłodowskiej na Wielką Wyspę: **Biskupin, Sępolno, Bartoszowice, ZOO / Hala Stulecia**.
   - Linie dzienne: tramwaje 2, 4, 10, 17, 19; autobusy 115, 145, 146, 315.

### Słupki poza wyspą centralną:
- **`20855`**: ul. Curie-Skłodowskiej przed wjazdem na rondo, kierunek *Biskupin / ZOO* (np. tramwaj 1 omijający wyspę).
- **`20816`**: ul. Curie-Skłodowskiej za zjazdem z ronda, kierunek *Poświętne / Kozanów* (np. tramwaj 1 omijający wyspę).
- **`20916`**: zatoka autobusowa wzdłuż jezdni przy Pasażu Grunwaldzkim (obok wejścia do galerii).
- **`20920`**: zatoka autobusowa przy ul. Curie-Skłodowskiej w stronę Bartoszowic / Chrząstawy.
- **`20921` / `20922` / `20923`**: zatoki wzdłuż osi placu Grunwaldzkiego przy budynkach biurowych Grunwaldzki Center.

---

## 2. Inne kluczowe węzły przesiadkowe we Wrocławiu

### Galeria Dominikańska:
- **Poziom -1 (w wykopie / tunelu)**: słupek `10501` – peron tramwajowy w kierunku Mostu Grunwaldzkiego i Hali Stulecia.
- **Poziom 0**: słupek `10502` – perony tramwajowe na ul. Oławskiej / Kazimierza Wielkiego w kierunku Rynku; słupek `10503` – zatoka autobusowa pod elewacją centrum handlowego Galeria Dominikańska.

### Dworzec Główny:
- **Słupek `10101`**: Peron tramwajowy bezpośrednio przed frontem zabytkowego dworca PKP (ul. Piłsudskiego) w stronę Arkad / Świdnickiej.
- **Słupek `10102`**: Peron tramwajowy po przeciwnej stronie ul. Piłsudskiego w stronę pl. Wróblewskiego i ul. Pułaskiego.
- **Słupek `10103`**: Przystanek autobusowy na ul. Peronowej (przy dawnym dworcu nocnym / Poczcie Polskiej).

### Arkady (Capitol):
- **Słupek `10301`**: Wyspa tramwajowa pośrodku ul. Świdnickiej naprzeciwko Teatru Muzycznego Capitol.
- **Słupek `10302`**: Wyspa tramwajowa na początku ul. Powstańców Śląskich (za skrzyżowaniem z ul. Piłsudskiego) w stronę Krzyków.

### Plac Bema:
- Węzeł rozjazdowy u zbiegu ul. Drobnera, Bema i Sienkiewicza. Perony tramwajowe w wydzielonym pasie na środku skrzyżowania.

### Kwiska:
- Zintegrowany przystanek tramwajowo-autobusowy (TAT) w pasie dzielącym ul. Legnicką, na wysokości CH Magnolia Park / Kaufland.
