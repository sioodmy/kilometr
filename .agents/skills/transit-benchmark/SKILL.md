---
name: transit-benchmark
description: Benchmark the RAPTOR routing engine against jakdojade.pl and mobilempk (rozkladzik.pl) journey planners. Use when comparing route quality, building OD test batches, debugging arrival gaps, or extending the comparison harness.
---

# Transit Benchmark (RAPTOR vs jakdojade vs mobilempk)

Compare our RAPTOR engine's connections against two reference planners on identical OD queries (Wrocław MPK).

## Use this skill when

- Building OD test batches (from → to, weekday, hour) for route-quality comparison
- Debugging why our engine arrives later/earlier than jakdojade or mobilempk
- Adding a third engine column (mobilempk) to the comparison table
- Extending `server/scripts/compare-jakdojade.ts` or the jakdojade API client

## Do not use this skill when

- Changing routing logic itself (engine fixes live in `server/src/routing/` + `src/services/routing/`)
- The task needs rail/regional carriers (our GTFS is MPK buses/trams only — Koleje Dolnośląskie trains are out of scope)

## Instructions

### 1. Test cases

JSON file, one object per case:

```json
[
  {"name":"Kozanow -> Rynek (sob 03:40, nocka)","fromQuery":"KOZANÓW","toQuery":"RYNEK","dateTime":"2026-10-10T03:40:00+02:00"},
  {"name":"...","fromQuery":"...","toQuery":"...","dateTime":"...","maxTransfers":3}
]
```

- `fromQuery`/`toQuery` resolve via jakdojade location search (see §2). Prefer GTFS-style uppercase stop-group names (`KOZANÓW`, `Żerniki`, `DWORZEC GŁÓWNY`).
- `dateTime` is ISO with `+02:00`. **Day offsets are date-anchored**: the harness computes `dayOffset` from *today's* date, never hardcode `+N*86400` in throwaway scripts — after midnight the same script silently queries the wrong weekday.
- `maxTransfers` defaults to 3 in the harness (engine clamps 0..3).

### 2. jakdojade (API, reverse-engineered)

Client: `.agents/skills/transit-benchmark/jakdojade-client.mjs` (pure Node, no deps).

- Credentials: env `JD_CREDS` = path to JSON `{login, hash, device}`. **Never commit secrets** — keep the file outside the repo, never `git add` it.
- Flow per case:
  1. `searchLocation(query)` → `resolveLoc(locs, query)`: STOP_GROUP with `name === query.toUpperCase()`, else first STOP_GROUP, else `locations[0]`. Log non-exact matches.
  2. `queryRoutes(startLoc, destLoc, dateTimeIso)` — POST `api/jd/v3/routes`, engine DEFAULT, preference OPTIMAL, `REALTIME_ENABLED`, 7 routes.
  3. Parse `routeParts`: transit legs (`routeVehicle.routeStops[].lineStop.{stopPoint.stopName, lineStopDynamicId}` — line via regex `/lineName:"([^"]+)"/`), walk legs (`durationSeconds`, `routePartDistanceMeters`). Times are ISO (`startDeparture.dateTime` / `targetArrival.dateTime`) — compare at minute resolution (`HH:MM`), keep exact seconds for analysis.
- **Feed BOTH engines the identical jd STOP_GROUP coordinates** (`coordinate.y_lat` / `x_lon`) — otherwise stop-database geometry differences (often 100–800 m) pollute the comparison.
- jakdojade uses **realtime + OPTIMAL preference**: results vary between runs (±1–6 min, occasionally different routes). Re-run suspicious cases; retry on `ECONNRESET`/fetch failures (do not use long `sleep` retries in automation).
- Limitation: jd results may include trains (e.g. KD Mrozów → Wrocław Główny) — unwinnable with MPK-only GTFS; mark as out-of-scope, not as engine loss.

### 3. Our engine (harness input)

`planConnections({fromTitle, fromLat, fromLon, toTitle, toLat, toLon, departureTimeSec, maxTransfers})` from `server/src/routing/engine.ts`:

- `departureTimeSec` **includes the day offset** (`HH*3600 + MM*60 + dayOffsetDays*86400`); `dayOffsetDays` = calendar-date difference from today. RAPTOR itself runs on time-of-day; the engine re-adds the offset when mapping.
- Fairness notes: our engine is schedule-only for future dates (live `vehicleTracker` delays only apply to *today's* trips); access/egress ≤ 800 m × 12 stops; footpaths ≤ 800 m; `minTransferSec` default 60 s; boarding catch-slack 60 s; boarding horizon +2 h; overnight queries (< 07:00) use a unified today+yesterday index.

### 4. Harness + metric (`server/scripts/compare-jakdojade.ts`)

Run from `server/`: `CASES_FILE=/path/cases.json npx tsx scripts/compare-jakdojade.ts`.

- Window metric (both engines): departures with relative time in **[−5, +120] min** vs query. `first` = first route in window; `best` = earliest arrival in window (`rel()` wraps ±12 h for midnight crossings).
- `deltaBest = ourBest − jdBest` (minutes, negative = we win). One-sided empties: `-999` (jd nothing, we have) / `999` (reverse).
- Summary sorts by `deltaBest`; report `wins / losses / ties` + top-5 lists. Full per-case dumps stay in the output file for debugging.
- When a gap looks wrong, reproduce with GTFS stop coords (script under `/tmp`, absolute imports, `npx tsx` from `server/`): check trip existence in `getDayIndex(weekday,'YYYYMMDD')`, footpath edges/durations, transfer math `arr + walk + slack ≤ dep`, then Pareto/diversity/slice behavior.

### 5. mobilempk / rozkladzik.pl (third column, via t3 browser tab)

The planner is jQuery + server API `find.txt`. Fastest path is parametrized URLs (auto-search on load), no UI clicking:

- URL: `https://www.rozkladzik.pl/wroclaw/index.html?from=<enc(label)>|b|<busStopId>&to=<enc(label)>|b|<busStopId>&time=<minutes>`
  - `time` = minutes since midnight **+ 1440 × weekday**, weekday Mon=0 … Sun=6 (`settingsDay` values). Only the *current* schedule week is queryable.
  - `|` may stay literal; diacritics/space must be `encodeURIComponent`-ed.
- `busStopId`: page autocomplete is client-side — call `$('#searchFrom').autocomplete('search','QUERY')` in `t3-code_preview_evaluate`, wait ~500–700 ms (return a Promise; never pass unknown tool params), read `ul.ui-autocomplete li` data (`ui-autocomplete-item` or `item.autocomplete`), prefer exact label match **with** `busStopId`. No ascii-folding: query with diacritics (`SĘPOLNO`, `ŻERNIKI`). Stops and POIs/addresses mix in results — require `busStopId`; some destinations have no stop (e.g. Sky Tower mall) and must be dropped or substituted (document it).
- Readiness: `t3-code_preview_wait_for` on selector `#routes_summary .route_row`, then parse: `.ride_time_se` → `"H:MM - H:MM"` (no leading zeros; may cross midnight), `.line_name` spans in order (changes = lines − 1). 9 routes per page is enough for the window metric.
- mobilempk specifics: transfer cap ≈ 300 m / min 1 min (stricter than ours), profile `opt`, MPK-only (no trains — use it to confirm rail-scope losses), same live schedule as jd (both differ 1–6 min from a stale local GTFS feed — check `feed_info.txt` dates when chasing minute gaps).
- `t3-code_preview_snapshot` is unreliable — use `t3-code_preview_evaluate` for reads; keep each evaluate short (< ~8 s).

### 6. Known pitfalls (learned the hard way)

1. Day offsets must be date-anchored (midnight rollover silently shifts hardcoded `+N` queries to the wrong weekday).
2. Same coordinates to both engines, always; GTFS vs jd stop geometry differs by design.
3. jd results drift between runs (realtime) — verify big deltas twice.
4. Overnight trips live in the previous service day as `24:xx+`; there are no `00:xx` times in this feed.
5. Tight jd transfers (2–3 min) often need realtime; static engine needs walk + slack to fit.
6. jd "0 m" transfers routinely span 0.8–1.6 km in both databases' own coordinates (hub grouping) — usually unmatchable, occasionally indicates a missing interchange edge.
7. Minute-resolution displays hide ±1 min rounding across walk/duration/arrival fields — use exact seconds when diagnosing.

### 7. Report format

Three-way table sorted by our delta vs jd (best → worst): `Δ jd | Δ mmpk | OD + time | ours (lines) | jd (lines) | mmpk (lines)`. Below it: wins ≤ −10 with the mechanism (direct + long walk beats jd's transfer chain; night chains jd lacks), then data-scope losses (rail, feed drift, physically impossible jd transfers) with evidence.

## Verification

- `npx tsc --noEmit` in repo root and in `server/` after any engine/harness change.
- Never commit `creds.json`, tokens, or `server/data/extracted_gtfs/` (gitignored feed); stage only intended files, follow repo commit style. No commits/pushes without an explicit request.
- No user-visible strings are involved (engine + scripts only) — i18n rules do not apply.
