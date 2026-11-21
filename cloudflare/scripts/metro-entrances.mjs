import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { classifyOsmLandmark, formatStreetLocative } from './polish-grammar.mjs';

function parseCsvLine(line) {
  const cols = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQ = !inQ;
      }
    } else if (ch === ',' && !inQ) {
      cols.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  cols.push(cur);
  return cols;
}

function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toLocalMeters(lat, lon, refLat, refLon) {
  const mLat = 111320;
  const mLon = 111320 * Math.cos((refLat * Math.PI) / 180);
  return [(lon - refLon) * mLon, (lat - refLat) * mLat];
}

function pointToSegDist(ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-6) return { dist: Math.hypot(ax, ay), ux: 0, uy: 0, len: 0 };
  const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
  const px = ax + t * dx;
  const py = ay + t * dy;
  const len = Math.sqrt(len2);
  return { dist: Math.hypot(px, py), ux: dx / len, uy: dy / len, len };
}

function compassSidePhrase(dx, dy) {
  const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI; // 0=E, 90=N, 180=W, -90=S
  if (angleDeg >= -22.5 && angleDeg < 22.5) return 'Wschodnia strona stacji';
  if (angleDeg >= 22.5 && angleDeg < 67.5) return 'Północno-wschodnia strona stacji';
  if (angleDeg >= 67.5 && angleDeg < 112.5) return 'Północna strona stacji';
  if (angleDeg >= 112.5 && angleDeg < 157.5) return 'Północno-zachodnia strona stacji';
  if (angleDeg >= 157.5 || angleDeg < -157.5) return 'Zachodnia strona stacji';
  if (angleDeg >= -157.5 && angleDeg < -112.5) return 'Południowo-zachodnia strona stacji';
  if (angleDeg >= -112.5 && angleDeg < -67.5) return 'Południowa strona stacji';
  return 'Południowo-wschodnia strona stacji';
}

function toPrzyPhrase(locative) {
  if (!locative) return null;
  return locative.replace(/^(?:na|w)\s+/i, 'przy ').trim();
}

function stripPrzy(phrase) {
  return phrase.replace(/^przy\s+/i, '').trim();
}

function countWords(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function cleanSentence(parts) {
  let s = parts.filter(Boolean).join(' ').replace(/\s+/g, ' ').replace(/\s+,/g, ',').trim();
  if (!s.endsWith('.')) s += '.';
  return s;
}

/**
 * Generuje zweryfikowane, unikalne wskazówki lokalizacji dla wszystkich wejść metra w Warszawie
 * (GTFS `location_type=2`), oparte na OSM (ulice, POI) i GTFS (przystanki naziemne, windy).
 */
export function generateWarsawMetroEntrances({ zipPath, poisFile, roadsFile, osmEntrances }) {
  const res = spawnSync('unzip', ['-p', zipPath, 'stops.txt'], { maxBuffer: 64 * 1024 * 1024 });
  if (res.status !== 0) {
    throw new Error(`Nie udało się odczytać stops.txt z ${zipPath}`);
  }
  const lines = res.stdout.toString('utf8').split(/\r?\n/).filter(Boolean);
  const hdr = parseCsvLine(lines[0].replace(/^\uFEFF/, ''));
  const col = Object.fromEntries(hdr.map((h, i) => [h.trim(), i]));

  const stations = new Map();
  const entrances = [];
  const surfaceStops = [];

  for (let i = 1; i < lines.length; i++) {
    const c = parseCsvLine(lines[i]);
    const get = (k) => (col[k] != null ? (c[col[k]] || '').trim() : '');
    const lt = get('location_type');
    const id = get('stop_id');
    const name = get('stop_name');
    const code = get('stop_code');
    const parent = get('parent_station');
    const lat = Number(get('stop_lat'));
    const lon = Number(get('stop_lon'));
    const wc = get('wheelchair_boarding');
    if (!id || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;

    if (lt === '1') {
      stations.set(id, { id, name, lat, lon });
    } else if (lt === '2' && parent) {
      entrances.push({
        id,
        num: name || id.replace(/^.*:E/, ''),
        stationId: parent,
        lat,
        lon,
        gtfsWc: wc,
      });
    } else if (lt === '0' && !parent && name) {
      surfaceStops.push({ id, code, name, lat, lon });
    }
  }

  const rawPois = JSON.parse(fs.readFileSync(poisFile, 'utf8'));
  const rawRoads = JSON.parse(fs.readFileSync(roadsFile, 'utf8'));

  // Filtrujemy POI: bez wejść/stacji metra (żeby wejście nie wskazywało samego siebie)
  const landmarks = [];
  const osmSubwayNodes = [];
  for (const el of rawPois) {
    if (el.lat == null || el.lon == null) continue;
    if (el.tags?.railway === 'subway_entrance') {
      osmSubwayNodes.push(el);
      continue;
    }
    const cls = classifyOsmLandmark(el);
    if (!cls) continue;
    if (cls.key.startsWith('metro:') || cls.key.startsWith('subway:')) continue;
    landmarks.push({ lat: el.lat, lon: el.lon, ...cls });
  }

  const HW_PENALTY = {
    trunk: 0,
    primary: 0,
    secondary: 1,
    tertiary: 2,
    unclassified: 5,
    residential: 6,
    living_street: 10,
    pedestrian: 14,
  };

  // Zbuduj prosty indeks dróg z segmentami
  const roadSegs = [];
  for (const w of rawRoads) {
    if (!w.name || !Array.isArray(w.g) || w.g.length < 2) continue;
    const loc = formatStreetLocative(w.name);
    if (!loc) continue;
    const penalty = HW_PENALTY[w.hw] ?? 7;
    for (let i = 0; i < w.g.length - 1; i++) {
      const [lat1, lon1] = w.g[i];
      const [lat2, lon2] = w.g[i + 1];
      roadSegs.push({ name: w.name, loc, penalty, lat1, lon1, lat2, lon2 });
    }
  }

  const byStation = new Map();
  for (const e of entrances) {
    let arr = byStation.get(e.stationId);
    if (!arr) {
      arr = [];
      byStation.set(e.stationId, arr);
    }
    arr.push(e);
  }

  const results = [];

  for (const [stationId, list] of byStation) {
    const station = stations.get(stationId);
    const cLat = list.reduce((s, x) => s + x.lat, 0) / list.length;
    const cLon = list.reduce((s, x) => s + x.lon, 0) / list.length;

    // Zbierz kontekst dla każdego wejścia na stacji
    const enriched = list.map((e) => {
      // Dostępność: GTFS wheelchair_boarding=1 lub dopasowany węzeł OSM <=15m z wheelchair=yes
      let wheelchair = e.gtfsWc === '1';
      if (!wheelchair && e.gtfsWc !== '2') {
        for (const node of osmSubwayNodes) {
          if (haversineMeters(e.lat, e.lon, node.lat, node.lon) <= 15 && node.tags?.wheelchair === 'yes') {
            wheelchair = true;
            break;
          }
        }
      }

      const [dx, dy] = toLocalMeters(e.lat, e.lon, cLat, cLon);
      const compass = Math.hypot(dx, dy) >= 6 ? compassSidePhrase(dx, dy) : 'Przy wejściu na stację';

      // Drogi w promieniu 65m
      const roadMap = new Map();
      for (const seg of roadSegs) {
        if (Math.abs(seg.lat1 - e.lat) > 0.0011 && Math.abs(seg.lat2 - e.lat) > 0.0011) continue;
        if (Math.abs(seg.lon1 - e.lon) > 0.0017 && Math.abs(seg.lon2 - e.lon) > 0.0017) continue;
        const [ax, ay] = toLocalMeters(seg.lat1, seg.lon1, e.lat, e.lon);
        const [bx, by] = toLocalMeters(seg.lat2, seg.lon2, e.lat, e.lon);
        const m = pointToSegDist(ax, ay, bx, by);
        if (m.dist > 65) continue;
        const score = m.dist + seg.penalty * 1.8;
        const prev = roadMap.get(seg.loc);
        if (!prev || score < prev.score) {
          roadMap.set(seg.loc, {
            name: seg.name,
            loc: seg.loc,
            dist: m.dist,
            score,
            ux: m.ux,
            uy: m.uy,
            penalty: seg.penalty,
          });
        }
      }
      const roads = [...roadMap.values()].sort((a, b) => a.score - b.score);
      const primaryRoad = roads[0] || null;
      let crossRoad = null;
      if (primaryRoad) {
        for (let i = 1; i < roads.length; i++) {
          const r = roads[i];
          if (r.dist > 55) continue;
          const dot = Math.abs(primaryRoad.ux * r.ux + primaryRoad.uy * r.uy);
          if (dot < 0.85 || r.dist <= 35) {
            crossRoad = r;
            break;
          }
        }
      }

      // Najbliższe POI (do 110m)
      const pois = [];
      const seenPoiKey = new Set();
      for (const l of landmarks) {
        const d = haversineMeters(e.lat, e.lon, l.lat, l.lon);
        if (d > 110) continue;
        const tierPenalty = l.tier === 1 ? 0 : l.tier === 2 ? 22 : 45;
        pois.push({ ...l, dist: d, score: d + tierPenalty });
      }
      pois.sort((a, b) => a.score - b.score);
      const uniquePois = pois.filter((p) => {
        if (seenPoiKey.has(p.key)) return false;
        seenPoiKey.add(p.key);
        return true;
      });

      // Najbliższe przystanki naziemne GTFS (do 75m)
      const stops = [];
      const seenStopLabel = new Set();
      for (const s of surfaceStops) {
        const d = haversineMeters(e.lat, e.lon, s.lat, s.lon);
        if (d > 75) continue;
        const label = s.code && !s.name.endsWith(s.code) ? `${s.name} ${s.code}` : s.name;
        stops.push({ ...s, label, dist: d });
      }
      stops.sort((a, b) => a.dist - b.dist);
      const uniqueStops = stops.filter((s) => {
        if (seenStopLabel.has(s.label)) return false;
        seenStopLabel.add(s.label);
        return true;
      });

      return {
        ...e,
        stationName: station?.name || '',
        wheelchair,
        dx,
        dy,
        compass,
        primaryRoad,
        crossRoad,
        pois: uniquePois,
        stops: uniqueStops,
      };
    });

    // Przydziel najlepszy unikalny opis dla każdego wejścia (bez powtórek w obrębie tej samej stacji)
    const claimedPoiKeys = new Set();
    const claimedStopLabels = new Set();
    const draftHints = new Map();

    // Najpierw wejścia z najbliższym przystankiem lub POI mają pierwszeństwo do najbliższego kotwiczenia
    const order = [...enriched].sort((a, b) => {
      const aMin = Math.min(a.pois[0]?.dist ?? 999, a.stops[0]?.dist ?? 999);
      const bMin = Math.min(b.pois[0]?.dist ?? 999, b.stops[0]?.dist ?? 999);
      return aMin - bMin;
    });

    for (const item of order) {
      const r1 = item.primaryRoad ? toPrzyPhrase(item.primaryRoad.loc) : null;
      const r2 = item.crossRoad ? stripPrzy(toPrzyPhrase(item.crossRoad.loc)) : null;
      const streetPhrase = r1 && r2 ? `${r1} i ${r2}` : r1 || null;

      // Wybierz nieużyte jeszcze POI <= 95m albo nieużyty przystanek <= 65m
      const freePoi = item.pois.find((p) => !claimedPoiKeys.has(p.key) && p.dist <= 95) || null;
      const freeStop = item.stops.find((s) => !claimedStopLabels.has(s.label) && s.dist <= 65) || null;

      let anchorPhrase = null;
      if (freeStop && (!freePoi || freeStop.dist <= freePoi.dist + 12)) {
        anchorPhrase = `przy przystanku „${freeStop.label}”`;
        claimedStopLabels.add(freeStop.label);
      } else if (freePoi) {
        anchorPhrase = freePoi.nearPhrase;
        claimedPoiKeys.add(freePoi.key);
      } else if (item.pois[0] && item.pois[0].dist <= 75) {
        anchorPhrase = item.pois[0].nearPhrase;
      } else if (item.stops[0] && item.stops[0].dist <= 50 && !claimedStopLabels.has(item.stops[0].label)) {
        anchorPhrase = `przy przystanku „${item.stops[0].label}”`;
      }

      // Składanie zdania z kontrolą limitu 20 słów
      let hint = null;
      const attempts = [];
      if (streetPhrase && anchorPhrase) {
        // Nie powielaj "przy ... przy ..." jeśli anchor zaczyna się od "przy"
        const connector = /^przy\s/i.test(anchorPhrase) ? `${streetPhrase}, ${anchorPhrase}` : `${streetPhrase} ${anchorPhrase}`;
        attempts.push(cleanSentence([item.compass, connector]));
      }
      if (r1 && anchorPhrase) {
        const connector = /^przy\s/i.test(anchorPhrase) ? `${r1}, ${anchorPhrase}` : `${r1} ${anchorPhrase}`;
        attempts.push(cleanSentence([item.compass, connector]));
      }
      if (streetPhrase) {
        attempts.push(cleanSentence([item.compass, streetPhrase]));
      }
      if (anchorPhrase) {
        attempts.push(cleanSentence([item.compass, anchorPhrase]));
      }
      if (r1) {
        attempts.push(cleanSentence([item.compass, r1]));
      }

      for (const cand of attempts) {
        if (countWords(cand) <= 20 && cand.length <= 155) {
          hint = cand;
          break;
        }
      }
      if (!hint) {
        hint = attempts[attempts.length - 1] || cleanSentence([item.compass, r1 || anchorPhrase || 'przy wejściu do stacji']);
      }

      draftHints.set(item.id, hint);
    }

    // Rozwiązywanie ewentualnych duplikatów tekstowych w obrębie jednej stacji
    const byText = new Map();
    for (const item of enriched) {
      const txt = draftHints.get(item.id);
      let arr = byText.get(txt);
      if (!arr) {
        arr = [];
        byText.set(txt, arr);
      }
      arr.push(item);
    }

    for (const [dupTxt, group] of byText) {
      if (group.length <= 1) continue;
      // Posortuj grupę wzdłuż dominującej osi rozrzutu (N-S lub E-W)
      const latSpan = Math.max(...group.map((g) => g.lat)) - Math.min(...group.map((g) => g.lat));
      const lonSpan =
        (Math.max(...group.map((g) => g.lon)) - Math.min(...group.map((g) => g.lon))) *
        Math.cos((cLat * Math.PI) / 180);

      // Najpierw sprawdź czy część ma windę a część nie
      const hasWc = group.some((g) => g.wheelchair);
      const hasNoWc = group.some((g) => !g.wheelchair);

      const sorted = [...group].sort((a, b) =>
        latSpan >= lonSpan ? b.lat - a.lat : a.lon - b.lon,
      );

      for (let i = 0; i < sorted.length; i++) {
        const item = sorted[i];
        let base = dupTxt.replace(/\.$/, '');
        let suffix = '';

        // 1. Spróbuj osobnego przystanku naziemnego lub POI nieużytego w grupie
        const altStop = item.stops.find((s) => !group.every((o) => o.stops.some((os) => os.label === s.label)));
        const altPoi = item.pois.find((p) => !group.every((o) => o.pois.some((op) => op.key === p.key)));

        if (hasWc && hasNoWc && item.wheelchair && group.filter((g) => g.wheelchair).length === 1) {
          suffix = 'z windą';
        } else if (altStop && !base.includes(altStop.label)) {
          suffix = `bliżej przystanku „${altStop.label}”`;
        } else if (altPoi && !base.includes(altPoi.nearPhrase)) {
          suffix = altPoi.nearPhrase;
        } else if (latSpan >= lonSpan) {
          suffix = i === 0 ? 'bliżej północnego krańca' : i === sorted.length - 1 ? 'bliżej południowego krańca' : `wejście nr ${item.num}`;
        } else {
          suffix = i === 0 ? 'bliżej zachodniego krańca' : i === sorted.length - 1 ? 'bliżej wschodniego krańca' : `wejście nr ${item.num}`;
        }

        let updated = cleanSentence([`${base}, ${suffix}`]);
        if (countWords(updated) > 21) {
          // Skróć bez ulicy głównej jeśli trzeba
          const r1 = item.primaryRoad ? toPrzyPhrase(item.primaryRoad.loc) : null;
          updated = cleanSentence([item.compass, r1 || '', suffix]);
        }
        draftHints.set(item.id, updated);
      }
    }

    for (const item of enriched) {
      results.push({
        id: item.id,
        num: item.num,
        stationId: item.stationId,
        lat: Number(item.lat.toFixed(6)),
        lon: Number(item.lon.toFixed(6)),
        ...(item.wheelchair ? { wheelchair: true } : {}),
        hint: draftHints.get(item.id),
      });
    }
  }

  results.sort((a, b) => a.id.localeCompare(b.id));
  return results;
}
