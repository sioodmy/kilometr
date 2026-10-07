# Kilometr — rozkłady na Cloudflare (darmowy tier)

Serwerownia rozkładów jazdy dla aplikacji Kilometr. Telefon pobiera gotową,
lekką bazę SQLite zamiast parsować 12 MB ZIP-a GTFS w pamięci (to powodowało
OOM na słabszych urządzeniach).

## Architektura

```
┌─ GitHub Actions (cron 1× dziennie, darmowy) ──────────────┐
│  cloudflare/scripts/build-timetable.mjs (Node ≥ 22, 0 deps)│
│   1. HEAD na Open Data Wrocław → effectiveDate MPK         │
│   2. PDP API: /data-version → czy rozkład KD się zmienił   │
│   3. Jeśli nic nowego → koniec (2–4 requesty, ~1 min)      │
│   4. Pobiera ZIP MPK + schedules KD (Wrocław, przewoźnik   │
│      KD, okno 14 dni) → buduje kilometr-gtfs.db            │
│      (node:sqlite, VACUUM, wagi przystanków, meta)         │
│   5. Upload do R2: db/kilometr-gtfs.db + manifest.json     │
└───────────────────────────┬───────────────────────────────┘
                            ▼
┌─ Cloudflare (free tier) ──────────────────────────────────┐
│  R2 bucket `kilometr-timetable` (~60–120 MB, < 10 GB)      │
│  Worker `kilometr-timetable` (100k req/dzień — wystarczy,  │
│  bo aplikacja pyta o 500-bajtowy manifest, a bazę pobiera  │
│  tylko przy nowej wersji):                                │
│   GET /manifest.json        → manifest z R2 (cache 5 min)  │
│   GET /db/kilometr-gtfs.db  → baza z R2 (Range, cache 5min)│
│   GET /api/kd/departures    → PDP /operations, cache 120 s │
│   GET /api/kd/schedule      → PDP /schedules, cache 1 h    │
│   GET /health                                              │
└───────────────────────────┬───────────────────────────────┘
                            ▼ telefon pobiera .db → podmiana
                              pliku (bez parsowania, bez OOM)
```

### Dlaczego parsowanie NIE jest w Workerze

Workers Free ma **10 ms CPU i 128 MB RAM na żądanie** — sparsowanie
46 MB `stop_times.txt` jest tam fizycznie niewykonalne. Dlatego ciężką
robotę robi GitHub Actions (też darmowy: ~5 min dziennie z puli 2000 min),
a Cloudflare trzyma gotowe pliki (R2: 10 GB i 10M odczytów/mies. gratis)
i serwuje je z cache. To jest „parsuj na Cloudflare co jakiś czas”
w wersji, która nie wybucha na limitach.

### Budżet free tier (miesięcznie, szacunki)

| Usługa              | Zużycie                | Limit darmowy |
|---------------------|------------------------|---------------|
| Actions (build)     | ~150 min               | 2000 min      |
| PDP API (Basic)     | ~120 req (build) + 0*  | 1000/dzień    |
| R2 storage          | < 1 GB                 | 10 GB         |
| R2 odczyty          | tysiące                | 10M (klasa B) |
| Worker requests     | tysiące                | 100k/dzień    |
| R2 egress           | darmowy bez limitu     | —             |

\* `/api/kd/*` woła PDP **tylko na żądanie** (cache 120 s / 1 h).
Aplikacja na razie tego nie używa (gotowość na przyszłość) → 0 req/dzień.

## Setup krok po kroku (reproducible)

Wszystkie sekrety trzymamy **poza repo**: ani klucz PDP, ani tokeny
Cloudflare nie mogą trafić do gita. Przed commitem: `git grep -i apikey`.

### 1. Włącz R2 na koncie

Cloudflare Dashboard → **R2 Object Storage** → włącz (Pay-as-you-go,
ale zużycie mieści się w free tier → $0). Bez tego API zwraca błąd 10042.

### 2. Bucket + deploy Workera

```bash
cd cloudflare
npm install                 # tylko wrangler (devDependency)
npx wrangler login
npx wrangler r2 bucket create kilometr-timetable
npx wrangler deploy         # → https://kilometr-timetable.<sub>.workers.dev
```

### 3. Sekret PDP w Workerze (NIE do repo, NIE do kodu aplikacji!)

```bash
npx wrangler secret put PDP_API_KEY   # wklej klucz, Enter
```

Aplikacja mobilna **nigdy** nie widzi tego klucza — woła `/api/kd/*`
Workera, a Worker dokleja klucz po stronie serwera.

### 4. Sekrety GitHub Actions (repo → Settings → Secrets → Actions)

| Secret                  | Skąd                                              |
|-------------------------|---------------------------------------------------|
| `PDP_API_KEY`           | klucz z https://pdp-api.plk-sa.pl (ten sam)       |
| `CLOUDFLARE_API_TOKEN`  | Dashboard → My Profile → API Tokens → template „Workers R2” na bucket `kilometr-timetable` (min. uprawnienia: R2 write na ten bucket) |
| `CLOUDFLARE_ACCOUNT_ID` | Dashboard → adres w URL / `wrangler whoami`       |
| `TIMETABLE_PUBLIC_URL`  | URL Workera z kroku 2 (do pomijania buildów bez zmian) |

Bez `PDP_API_KEY` build działa dalej, ale **bez danych KD** (ostrzeżenie
w logu). Bez tokenów Cloudflare workflow kończy się po zbudowaniu bazy
(artefakt do pobrania z Actions).

### 5. Podpięcie aplikacji

```bash
# .env (lokalnie / w EAS — nigdy do gita)
EXPO_PUBLIC_TIMETABLE_URL=https://kilometr-timetable.<sub>.workers.dev
```

Aplikacja pobiera `${EXPO_PUBLIC_TIMETABLE_URL}/manifest.json`, porównuje
`version` z lokalną metą `timetable_version` i ściąga bazę tylko przy
zmianie. Gdy zmienna pusta albo manifest nieosiągalny — wraca do starego
importu z ZIP-a (kod w `src/services/gtfsDownloader.ts` zostaje jako fallback).

### 6. Harmonogram

`.github/workflows/timetable.yml`: cron codziennie **03:17 UTC**
(celowo nie o pełnej godzinie — mniejsze kolejki Actions), plus
`workflow_dispatch` do ręcznego odpalenia.

## Dane KD (Koleje Dolnośląskie) — zakres Wrocław

- Stacje: resolve przez `GET /dictionaries/cities?search=WROC` →
  miasto `WROCŁAW` → jego `stationIds` (dynamicznie, bez hardkodu ID).
- Rozkład: `GET /schedules/shortened?stations=<ids>&carriersInclude=KD
  &dateFrom=<dziś>&dateTo=<dziś+13>`, `dictionaries=true` (nazwy stacji).
- PDP **nie zwraca współrzędnych stacji**, więc build dociąga je
  z Nominatim (viewbox Wrocławia, cache w `data/kd-station-coords.json`):
  ```bash
  PDP_API_KEY=... node scripts/build-timetable.mjs --write-coords
  ```
  Uruchom lokalnie raz, **przejrzyj diffa** (`git diff data/…`) i commituj.
  W CI flaga jest wyłączona — brak współrzędnych = stacja pominięta
  z ostrzeżeniem (rozkład dalej się buduje).
- W bazie KD ląduje w tych samych tabelach co MPK, z prefiksami ID:
  przystanki `KD:S:<id>`, trasy `KD:R:<sid>:<oid>`,
  kursy `KD:T:<sid>:<oid>:<YYYYMMDD>`, serwisy `KD:svc:<sid>:<oid>`
  (wiersz kalendarza same zera + `calendar_dates` per data kursowania —
  `getActiveServices()` w aplikacji to rozumie).
  `route_type = 2` (kolej). Klasyfikator tramwaj/autobus w RAPTOR-ze
  pokaże pociągi jako „bus” (znane uproszczenie v1, bez zmian w UI).
- Okno 14 dni: jeden request na build (limit `dateTo ≤ dateFrom+31d`).
  Przy ~100 pociągach KD dziennie we Wrocławiu to kilka tysięcy kursów —
  ułamek 1,5M wierszy MPK.

## Opóźnienia KD (gotowość, BEZ implementacji w aplikacji)

Worker ma gotowe, cache'owane passthrough:
`GET /api/kd/departures?stations=<ids>&withPlanned=true`
(PDP `/operations/shortened`, cache 120 s — wielu użytkowników dzieli
jeden request do PDP). Aplikacja tego **nie woła** — dopóki nie będzie
ekranu/tablicy odjazdów KD, koszt PDP = 0.

## Pliki

```
cloudflare/
  wrangler.toml          Worker + binding R2 (bez sekretów!)
  package.json           tylko wrangler jako devDep
  src/index.ts           Worker: manifest, baza, /api/kd/*, health
  scripts/build-timetable.mjs  build bazy (Node ≥ 22, zero deps)
  data/kd-station-coords.json  cache współrzędnych stacji KD
  dist/                  artefakty buildu (gitignore)
```

## Weryfikacja buildu

Skrypt kończy się `PRAGMA integrity_check` + wypisuje statystyki
(przystanki/trasy/kursy/czasy MPK vs KD). Pusta któraś z sekcji MPK =
błąd i brak uploadu. Puste KD = tylko warning (np. brak klucza).
