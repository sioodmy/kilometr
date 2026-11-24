# Kilometr API (`api.kilometr.app`)

Lekki backend w Rust (Axum + Tokio + SQLite WAL) zaprojektowany pod VPS **Mikrus 3.5** (4 GB RAM, 40 GB dysku).
Aplikacja mobilna, Web PWA i strona udostepnionego polaczenia korzystaja z niego z pelnym bezpiecznym fallbackiem: wylaczenie serwera nie blokuje zadnej funkcji pasazera.

## Co robi backend

1. **Adaptacyjny polling zrodel realtime** (120 miast live: `zbiorkom.live`, 59 miast `kiedyprzyjedzie.pl`, fallback `mpk.wroc.pl`, kolej ogolnopolska PKP PLK `updates.json` z ETag oraz kolej regionalna).
   - **Demand-driven boost**: miasto aktualnie przegladane na mapie przez uzytkownika automatycznie przyspiesza polling do 4 s przez 75 s.
   - **Circuit breaker per zrodlo**: chroni API przewoznikow przed zalewaniem przy awariach.
2. **Silnik Data Science i estymacji bez GPS**:
   - Przesuwne okno live (10 + 10 min) z agregacja per **linia**, **wezel komunikacyjny** (z normalizacja numerow slupkow) oraz **siatka przestrzenna ~350 m**.
   - Trwale profile historyczne w SQLite `(day_type, hour_bucket)` z inkrementalna srednia, EMA i p90.
   - Szacowanie opoznien pojazdow bez nadajnika GPS przez fuzje: inne pojazdy tej samej linii, zator na wezle/korytarzu oraz profil historyczny z bayesowskim wygladzeniem (shrinkage).
   - Ochrona dysku 40 GB: surowe obserwacje sa automatycznie czyszczone po 48 h, z twardym limitem rozmiaru bazy i `incremental_vacuum`.
3. **Viewport filtering na mapie live** (`GET /v1/vehicles?city=...&bbox=...`): telefon pobiera tylko pojazdy z widocznego kadru mapy zamiast calego miasta.
4. **Live opoznien dla udostepnionych polaczen** (`POST /v1/shared/live`): zwraca biezace opoznienia GPS/PLK, peron/tor oraz estymacje dla strony `kilometr.app/t#...`.

## Endpointy HTTP

| Metoda | Sciezka | Opis |
| --- | --- | --- |
| `GET` | `/health` | Prosty healthcheck (200 OK) |
| `GET` | `/v1/status` | Stan silnika, aktywne miasta, rozmiar SQLite, zdrowie zrodel |
| `GET` | `/v1/cities` | Lista 132 miast z rejestru |
| `GET` | `/v1/vehicles?city=wroclaw&bbox=minLon,minLat,maxLon,maxLat` | Pojazdy w kadrze (ETag, demand boost) |
| `GET` | `/v1/delays/heatmap?city=wroclaw&bbox=...` | Strefy opoznien i gorace wezly pod mape M3 Expressive |
| `GET` | `/v1/delays/lines?city=wroclaw&lines=4,D` | Statystyki per linia (avg, p50, p90, trend, estymacja bez GPS) |
| `GET` | `/v1/delays/hubs?city=wroclaw&limit=20` | Ranking najbardziej opoznionych wezlow komunikacyjnych |
| `POST` | `/v1/delays/estimate` | Batchowe szacowanie opoznien dla odcinkow trasy |
| `POST` | `/v1/shared/live` | Live opoznien i estymacji dla udostepnionego polaczenia |
| `GET` | `/v1/rail/delays?trips=...&numbers=...` | Opoznienia i perony PKP PLK (kompatybilne z Workerem) |
| `GET` | `/metrics` | Metryki Prometheus |

## Szybkie wdrozenie na Mikrus 3.5

### Opcja A: bezposrednio na VPS (z wlasnym Caddy i HTTPS)

```bash
cd /opt/kilometr/backend
cp .env.example .env
# Ustaw API_DOMAIN=api.kilometr.app w .env
chmod +x deploy.sh backup.sh
./deploy.sh --with-caddy
```

### Opcja B: przez Cloudflare Tunnel lub wbudowane proxy Mikrusa (IPv6-only)

1. Zostaw domyslne `KILOMETR_PUBLISH_ADDR=127.0.0.1:8080` w `.env`.
2. Uruchom `./deploy.sh` (bez Caddy).
3. Skieruj `cloudflared` (lub reverse proxy Mikrusa) na `http://127.0.0.1:8080` i podepnij rekord DNS `api.kilometr.app`.

### Opcja C: zdalny deploy z komputera lokalnego

```bash
DEPLOY_HOST=root@srvXX.mikr.us DEPLOY_PORT=10222 ./backend/deploy.sh
```

## Synchronizacja listy miast

Po dodaniu nowego miasta do `src/cities.ts` zaktualizuj rejestr backendu:

```bash
nix develop .#ci -c npx tsx scripts/sync-backend-cities.ts
```

## Zuzycie zasobow (Mikrus 3.5)

- **RAM**: ok. 50 do 120 MB podczas normalnej pracy (limit kontenera 1.5 GB).
- **Dysk**: ok. 150 MB obraz Docker + 50 do 500 MB baza SQLite (twardy limit 4 GB + rotacja logow 3 x 10 MB).
- **Backup**: dodaj do crona `0 4 * * * /opt/kilometr-api/backup.sh`.
