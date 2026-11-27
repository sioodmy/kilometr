import { DatabaseSync } from 'node:sqlite';
import { unlinkSync } from 'node:fs';
import { cleanPoiName, formatRichPoiAddress, poiGridCells } from '../../src/services/poiClassify.ts';

const VIRTUAL_KITCHEN_RE = /(wirtualn|virtual|dark\s*kitchen|tylko\s+dostaw)/i;
const BANNED_NAME_RE = /^(brak|nieznan[ae]?|bez\s+nazwy|test|placeholder|n\/a|null|undefined)$/i;

const GENERIC_CORE_WORDS = new Set([
  'restauracja',
  'restaurant',
  'pizzeria',
  'kawiarnia',
  'cafe',
  'kafe',
  'coffee',
  'bar',
  'pub',
  'bistro',
  'hotel',
  'hostel',
  'motel',
  'apartamenty',
  'apartments',
  'pensjonat',
  'sklep',
  'shop',
  'store',
  'market',
  'supermarket',
  'apteka',
  'pharmacy',
  'galeria',
  'centrum',
  'salon',
  'studio',
  'biuro',
  'kancelaria',
  'przychodnia',
  'klinika',
  'gabinet',
  'ul',
  'ulica',
  'pl',
  'plac',
  'sp',
  'zoo',
  'wroclaw',
  'krakow',
  'warszawa',
  'katowice',
  'gliwice',
  'sosnowiec',
  'bytom',
  'zabrze',
  'tychy',
  'chorzow',
]);

const GZM_CITY_CENTERS = [
  { name: 'Katowice', lat: 50.2599, lon: 19.0216, maxM: 9000 },
  { name: 'Gliwice', lat: 50.2945, lon: 18.6714, maxM: 8000 },
  { name: 'Sosnowiec', lat: 50.2863, lon: 19.1041, maxM: 7500 },
  { name: 'Bytom', lat: 50.3484, lon: 18.9157, maxM: 7000 },
  { name: 'Zabrze', lat: 50.3249, lon: 18.7857, maxM: 7000 },
  { name: 'Ruda Śląska', lat: 50.2584, lon: 18.8563, maxM: 6500 },
  { name: 'Tychy', lat: 50.1372, lon: 18.9664, maxM: 7000 },
  { name: 'Dąbrowa Górnicza', lat: 50.3217, lon: 19.1949, maxM: 8000 },
  { name: 'Chorzów', lat: 50.2975, lon: 18.9545, maxM: 4500 },
  { name: 'Mysłowice', lat: 50.24, lon: 19.138, maxM: 6000 },
  { name: 'Siemianowice Śląskie', lat: 50.3056, lon: 19.0358, maxM: 4500 },
  { name: 'Będzin', lat: 50.3239, lon: 19.1292, maxM: 4500 },
  { name: 'Tarnowskie Góry', lat: 50.4445, lon: 18.8576, maxM: 6500 },
  { name: 'Piekary Śląskie', lat: 50.3781, lon: 18.9472, maxM: 5000 },
  { name: 'Świętochłowice', lat: 50.2917, lon: 18.9178, maxM: 3500 },
  { name: 'Czeladź', lat: 50.3175, lon: 19.0706, maxM: 3500 },
  { name: 'Mikołów', lat: 50.1667, lon: 18.9025, maxM: 5500 },
  { name: 'Jaworzno', lat: 50.2053, lon: 19.275, maxM: 7500 },
  { name: 'Knurów', lat: 50.2219, lon: 18.6725, maxM: 5000 },
];

const RELATED_CATEGORIES = new Set([
  'restaurant:cafe',
  'cafe:restaurant',
  'restaurant:bar',
  'bar:restaurant',
  'cafe:bar',
  'bar:cafe',
  'shop:business',
  'business:shop',
  'culture:nature',
  'nature:culture',
  'culture:education',
  'education:culture',
  'business:finance',
  'finance:business',
  'business:civic',
  'civic:business',
]);

const TERM_SYNONYMS = {
  pl: ['plac'],
  plac: ['pl'],
  dw: ['dworzec'],
  dworzec: ['dw'],
  al: ['aleja', 'aleje'],
  aleja: ['al'],
  os: ['osiedle'],
  osiedle: ['os'],
  sw: ['swiety', 'swietego', 'swietej'],
  swiety: ['sw'],
  gal: ['galeria'],
  galeria: ['gal'],
  pkp: ['dworzec', 'kolej', 'stacja'],
  rd: ['rondo'],
  rondo: ['rd'],
  ul: ['ulica'],
};

export function normalizePolish(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ł/g, 'l')
    .replace(/Ł/g, 'l')
    .trim();
}

export function distanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6_371_000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
}

function coreTokens(name) {
  const tokens = normalizePolish(name)
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !GENERIC_CORE_WORDS.has(t));
  return tokens;
}

function namesMatch(aName, bName, distM) {
  const na = normalizePolish(aName).replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const nb = normalizePolish(bName).replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!na || !nb) return false;
  if (na === nb) return true;

  const ta = coreTokens(aName);
  const tb = coreTokens(bName);
  const ca = ta.join('');
  const cb = tb.join('');
  if (ca && cb) {
    if (ca === cb) return true;
    if (ca.length >= 4 && cb.length >= 4 && (ca.includes(cb) || cb.includes(ca))) {
      const ratio = Math.min(ca.length, cb.length) / Math.max(ca.length, cb.length);
      if (ratio >= 0.55 || distM <= 45) return true;
    }
  }
  if (!ta.length || !tb.length) return false;
  const setA = new Set(ta);
  const setB = new Set(tb);
  let inter = 0;
  for (const t of setA) if (setB.has(t)) inter++;
  const union = setA.size + setB.size - inter;
  const jaccard = union > 0 ? inter / union : 0;
  if (jaccard >= 0.65) return true;
  if (distM <= 35 && inter >= 1 && jaccard >= 0.45) return true;
  return false;
}

function categoriesCompatible(a, b) {
  if (a === b) return true;
  return RELATED_CATEGORIES.has(`${a}:${b}`);
}

function inferGzmCity(lat, lon) {
  let best = null;
  let bestDist = Infinity;
  for (const c of GZM_CITY_CENTERS) {
    const d = distanceMeters(lat, lon, c.lat, c.lon);
    if (d <= c.maxM && d < bestDist) {
      bestDist = d;
      best = c.name;
    }
  }
  return best;
}

function normalizeWebsite(raw) {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) return s;
  if (/^[a-z0-9.-]+\.[a-z]{2,}/i.test(s)) return `https://${s}`;
  return null;
}

function cleanStreet(raw) {
  if (typeof raw !== 'string') return null;
  const s = raw
    .replace(/[\p{Cc}\p{Cf}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s || VIRTUAL_KITCHEN_RE.test(s)) return null;
  return s.replace(/^ul\.?\s+/i, '').trim() || null;
}

const SOURCE_COORD_PRIORITY = { osm: 4, cwoh: 3, wolt: 2, overture: 1 };
const SOURCE_NAME_PRIORITY = { osm: 4, wolt: 3, cwoh: 2, overture: 1 };

function pickName(items) {
  const sorted = [...items].sort((a, b) => {
    const aUpper = a.name === a.name.toUpperCase() && a.name.length >= 4 ? -1 : 0;
    const bUpper = b.name === b.name.toUpperCase() && b.name.length >= 4 ? -1 : 0;
    if (aUpper !== bUpper) return bUpper - aUpper;
    return (SOURCE_NAME_PRIORITY[b.source] || 0) - (SOURCE_NAME_PRIORITY[a.source] || 0);
  });
  return sorted[0].name;
}

function pickSubtype(items, fallback) {
  const genericSubtypes = new Set(['Sklep', 'Usługi', 'Usługi i biznes', 'Miejsce', 'Edukacja', 'Kultura']);
  const sorted = [...items].sort((a, b) => {
    const ag = genericSubtypes.has(a.subtype) ? 0 : 1;
    const bg = genericSubtypes.has(b.subtype) ? 0 : 1;
    if (ag !== bg) return bg - ag;
    return (SOURCE_NAME_PRIORITY[b.source] || 0) - (SOURCE_NAME_PRIORITY[a.source] || 0);
  });
  return sorted[0]?.subtype || fallback;
}

function computeRank(cluster, city, sitelinks) {
  let rank = cluster.baseRank || 170;
  const sourceCount = cluster.sources.length;
  if (sourceCount === 2) rank += 180;
  else if (sourceCount >= 3) rank += 280;

  if (cluster.overture) {
    const ov = cluster.overture;
    rank += Math.round((ov.confidence || 0.5) * 60);
    rank += Math.min(70, Math.max(0, (ov.sourceCount || 1) - 1) * 35);
    if (ov.hasSocials) rank += 15;
  }
  if (cluster.wolt) {
    const w = cluster.wolt;
    rank += 90;
    rank += Math.min(110, Math.round(Math.log2(1 + (w.ratingVolume || 0)) * 14));
    if ((w.rating || 0) >= 8.0) rank += 20;
  }
  if (cluster.cwoh) {
    rank += 100 + Math.min(75, (cluster.cwoh.stars || 0) * 15);
  }
  if (cluster.osm) {
    if (cluster.osm.hours) rank += 25;
    if (cluster.osm.website) rank += 25;
    if (cluster.osm.street) rank += 20;
  }

  if (cluster.website) rank += 35;
  if (cluster.phone) rank += 20;
  if (sitelinks > 0) {
    rank += Math.min(250, Math.round(Math.log2(1 + sitelinks) * 45));
  }

  if (sourceCount === 1 && !cluster.street && !cluster.website && !cluster.phone && !cluster.wolt && !cluster.cwoh) {
    rank -= 60;
  }

  // Lekki bonus dla centrum miasta (w GZM względem najbliższego centrum miasta aglomeracji).
  let centerDistM = distanceMeters(cluster.lat, cluster.lon, city.center.lat, city.center.lon);
  if (city.id === 'gzm') {
    for (const c of GZM_CITY_CENTERS) {
      const d = distanceMeters(cluster.lat, cluster.lon, c.lat, c.lon);
      if (d < centerDistM) centerDistM = d;
    }
  }
  if (centerDistM < 3000) {
    rank += Math.round(((3000 - centerDistM) / 3000) * 35);
  }

  return Math.max(1, Math.min(1000, Math.round(rank)));
}

/**
 * Scala kandydatów z wielu źródeł (Overture, OSM, Wolt, CWOH), wzbogaca o Wikidata,
 * odsiewa martwy szum i przydziela ranking oraz gęstościowy `min_zoom` dla mapy.
 */
export function conflatePois(candidates, city, wikidataItems = []) {
  const bounds = city.bounds;
  const multiCity = city.id === 'gzm' || city.id === 'trojmiasto';
  const valid = [];

  for (const raw of candidates) {
    if (!raw) continue;
    const lat = Number(raw.lat);
    const lon = Number(raw.lon);
    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lon) ||
      lat < bounds.minLat ||
      lat > bounds.maxLat ||
      lon < bounds.minLon ||
      lon > bounds.maxLon
    ) {
      continue;
    }
    const name = cleanPoiName(raw.name);
    if (!name || name.length < 2 || BANNED_NAME_RE.test(name)) continue;
    if (VIRTUAL_KITCHEN_RE.test(name) || VIRTUAL_KITCHEN_RE.test(raw.street || '')) continue;
    if (!raw.category || !raw.subtype) continue;

    valid.push({
      ...raw,
      name,
      lat,
      lon,
      street: cleanStreet(raw.street),
      district: raw.district ? cleanPoiName(raw.district) : null,
      city: raw.city ? cleanPoiName(raw.city) : null,
      website: normalizeWebsite(raw.website),
      phone: typeof raw.phone === 'string' && raw.phone.trim() ? raw.phone.trim() : null,
      hours: typeof raw.hours === 'string' && raw.hours.trim() ? raw.hours.trim() : null,
      tags: Array.isArray(raw.tags) ? raw.tags.filter(Boolean) : [],
    });
  }

  // Sortujemy: źródła o najlepszych współrzędnych i dokładności najpierw, żeby klaster zakotwiczyć na dokładnym punkcie.
  valid.sort((a, b) => (SOURCE_COORD_PRIORITY[b.source] || 0) - (SOURCE_COORD_PRIORITY[a.source] || 0));

  const grid = new Map();
  const clusters = [];
  const GRID_SCALE = 1000; // ~111 m lat x ~71 m lon

  for (const item of valid) {
    const gx = Math.floor(item.lat * GRID_SCALE);
    const gy = Math.floor(item.lon * GRID_SCALE);
    const wide =
      item.category === 'hotel' ||
      item.category === 'education' ||
      item.category === 'culture' ||
      item.category === 'nature' ||
      item.category === 'sport' ||
      item.category === 'train' ||
      item.subtype === 'Galeria handlowa' ||
      item.subtype === 'Supermarket';
    const maxDistM = wide ? 160 : 80;
    const cellDelta = wide ? 2 : 1;

    let matchCluster = null;
    let bestDist = Infinity;

    for (let dx = -cellDelta; dx <= cellDelta; dx++) {
      for (let dy = -cellDelta; dy <= cellDelta; dy++) {
        const bucket = grid.get(`${gx + dx},${gy + dy}`);
        if (!bucket) continue;
        for (const cIdx of bucket) {
          const cluster = clusters[cIdx];
          if (!categoriesCompatible(cluster.category, item.category)) continue;
          const dist = distanceMeters(cluster.lat, cluster.lon, item.lat, item.lon);
          if (dist > maxDistM || dist >= bestDist) continue;
          if (namesMatch(cluster.name, item.name, dist)) {
            bestDist = dist;
            matchCluster = cluster;
          }
        }
      }
    }

    if (matchCluster) {
      matchCluster.items.push(item);
      if (!matchCluster.sources.includes(item.source)) matchCluster.sources.push(item.source);
      if (item.source === 'osm' && !matchCluster.osm) matchCluster.osm = item;
      if (item.source === 'wolt' && (!matchCluster.wolt || (item.ratingVolume || 0) > (matchCluster.wolt.ratingVolume || 0))) {
        matchCluster.wolt = item;
      }
      if (item.source === 'cwoh' && !matchCluster.cwoh) matchCluster.cwoh = item;
      if (item.source === 'overture') {
        if (!matchCluster.overture || (item.confidence || 0) > (matchCluster.overture.confidence || 0)) {
          matchCluster.overture = item;
        }
      }
      if ((SOURCE_COORD_PRIORITY[item.source] || 0) > (SOURCE_COORD_PRIORITY[matchCluster.coordSource] || 0)) {
        matchCluster.lat = item.lat;
        matchCluster.lon = item.lon;
        matchCluster.coordSource = item.source;
      }
      if (!matchCluster.street && item.street) matchCluster.street = item.street;
      if (!matchCluster.district && item.district) matchCluster.district = item.district;
      if (!matchCluster.city && item.city) matchCluster.city = item.city;
      if (!matchCluster.website && item.website) matchCluster.website = item.website;
      if (!matchCluster.phone && item.phone) matchCluster.phone = item.phone;
      if (!matchCluster.hours && item.hours) matchCluster.hours = item.hours;
      if (!matchCluster.wikidataId && item.wikidataId) matchCluster.wikidataId = item.wikidataId;
      if (item.rating != null && (matchCluster.rating == null || (item.ratingVolume || 0) > (matchCluster.ratingVolume || 0))) {
        matchCluster.rating = item.rating;
        matchCluster.ratingVolume = item.ratingVolume || 0;
      }
      matchCluster.baseRank = Math.max(matchCluster.baseRank, item.baseRank || 170);
      for (const t of item.tags) matchCluster.tagsSet.add(normalizePolish(t));
      matchCluster.name = pickName(matchCluster.items);
      matchCluster.subtype = pickSubtype(matchCluster.items, matchCluster.subtype);
    } else {
      const idx = clusters.length;
      const cluster = {
        extId: item.extId,
        name: item.name,
        lat: item.lat,
        lon: item.lon,
        coordSource: item.source,
        category: item.category,
        subtype: item.subtype,
        baseRank: item.baseRank || 170,
        street: item.street,
        district: item.district,
        city: item.city,
        website: item.website,
        phone: item.phone,
        hours: item.hours,
        wikidataId: item.wikidataId || null,
        rating: item.rating ?? null,
        ratingVolume: item.ratingVolume ?? 0,
        sources: [item.source],
        items: [item],
        osm: item.source === 'osm' ? item : null,
        wolt: item.source === 'wolt' ? item : null,
        cwoh: item.source === 'cwoh' ? item : null,
        overture: item.source === 'overture' ? item : null,
        tagsSet: new Set(item.tags.map((t) => normalizePolish(t)).filter(Boolean)),
      };
      clusters.push(cluster);
      const key = `${gx},${gy}`;
      const bucket = grid.get(key);
      if (bucket) bucket.push(idx);
      else grid.set(key, [idx]);
    }
  }

  // Indeks Wikidata (tylko do wzbogacenia istniejących POI).
  const wdByQid = new Map();
  const wdGrid = new Map();
  for (const w of wikidataItems) {
    if (!w || !w.qid) continue;
    const sitelinks = Number(w.sitelinks) || 0;
    if (sitelinks <= 0) continue;
    wdByQid.set(w.qid, sitelinks);
    if (Number.isFinite(w.lat) && Number.isFinite(w.lon)) {
      const key = `${Math.floor(w.lat * 500)},${Math.floor(w.lon * 500)}`;
      const bucket = wdGrid.get(key);
      if (bucket) bucket.push(w);
      else wdGrid.set(key, [w]);
    }
  }

  const results = [];
  for (const c of clusters) {
    // Odsiew szumu: samotne, słabo potwierdzone wpisy z Overture (szczególnie w biznesie).
    if (c.sources.length === 1 && c.overture) {
      const ov = c.overture;
      const conf = ov.confidence ?? 0;
      const singleSrc = (ov.sourceCount ?? 1) <= 1;
      const noContact = !c.website && !c.phone;
      if (singleSrc && noContact && !c.street && conf < 0.68) continue;
      if (c.category === 'business' && singleSrc && noContact && conf < 0.72) continue;
    }

    let sitelinks = c.wikidataId ? wdByQid.get(c.wikidataId) || 0 : 0;
    if (!sitelinks && wdGrid.size > 0) {
      const gx = Math.floor(c.lat * 500);
      const gy = Math.floor(c.lon * 500);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const bucket = wdGrid.get(`${gx + dx},${gy + dy}`);
          if (!bucket) continue;
          for (const w of bucket) {
            const d = distanceMeters(c.lat, c.lon, w.lat, w.lon);
            if (d <= 140 && namesMatch(c.name, w.label, d)) {
              sitelinks = Math.max(sitelinks, Number(w.sitelinks) || 0);
            }
          }
        }
      }
    }

    const resolvedCity = c.city || (city.id === 'gzm' ? inferGzmCity(c.lat, c.lon) : null);
    const address = formatRichPoiAddress({
      subtype: c.subtype,
      street: c.street,
      district: c.district,
      city: resolvedCity,
      multiCity,
    });
    const rank = computeRank(c, city, sitelinks);
    const cells = poiGridCells(c.lat, c.lon);

    results.push({
      ext_id: c.extId,
      name: c.name,
      norm_name: normalizePolish(c.name),
      category: c.category,
      subtype: c.subtype,
      address,
      street: c.street || null,
      district: c.district || null,
      city: resolvedCity || null,
      lat: c.lat,
      lon: c.lon,
      rank,
      min_zoom: 16,
      cell_coarse: cells.coarse,
      cell_fine: cells.fine,
      tags: [...c.tagsSet].slice(0, 12).join(','),
      sources: [...c.sources].sort().join(','),
      website: c.website || null,
      phone: c.phone || null,
      hours: c.hours || null,
      rating: c.rating != null ? Math.round(c.rating * 10) / 10 : null,
      _sitelinks: sitelinks,
    });
  }

  // Przestrzenny thinning dla warstw mapy: topowe landmarki od z12, główne lokale z14-15, reszta z16.
  results.sort((a, b) => b.rank - a.rank || a.name.localeCompare(b.name));
  const coarseZ12 = new Map();
  const coarseZ13 = new Map();
  const coarseZ14 = new Map();
  const fineZ14 = new Map();
  const fineZ15 = new Map();

  for (let i = 0; i < results.length; i++) {
    const p = results[i];
    p.id = i + 1;
    const cKey = p.cell_coarse;
    const fKey = p.cell_fine;
    const c12 = coarseZ12.get(cKey) || 0;
    const c13 = coarseZ13.get(cKey) || 0;
    const c14 = coarseZ14.get(cKey) || 0;
    const f14 = fineZ14.get(fKey) || 0;
    const f15 = fineZ15.get(fKey) || 0;

    const isLandmark = p._sitelinks >= 15 || p.rank >= 680 || p.subtype === 'Lotnisko' || p.subtype === 'Galeria handlowa' || p.subtype === 'Stacja kolejowa';
    if ((isLandmark && c12 < 2) || (p.rank >= 560 && c12 === 0)) {
      p.min_zoom = 12;
      coarseZ12.set(cKey, c12 + 1);
      coarseZ13.set(cKey, c13 + 1);
      coarseZ14.set(cKey, c14 + 1);
      fineZ14.set(fKey, f14 + 1);
      fineZ15.set(fKey, f15 + 1);
    } else if (p.rank >= 420 && c13 < 4) {
      p.min_zoom = 13;
      coarseZ13.set(cKey, c13 + 1);
      coarseZ14.set(cKey, c14 + 1);
      fineZ14.set(fKey, f14 + 1);
      fineZ15.set(fKey, f15 + 1);
    } else if (p.rank >= 260 && c14 < 12 && f14 < 4) {
      p.min_zoom = 14;
      coarseZ14.set(cKey, c14 + 1);
      fineZ14.set(fKey, f14 + 1);
      fineZ15.set(fKey, f15 + 1);
    } else if (p.rank >= 180 && f15 < 10) {
      p.min_zoom = 15;
      fineZ15.set(fKey, f15 + 1);
    } else {
      p.min_zoom = 16;
    }
    delete p._sitelinks;
  }

  return results;
}

/** Wyciąga znormalizowane tokeny do odwróconego indeksu prefiksowego `poi_terms`. */
export function extractSearchTerms(poi) {
  const terms = new Set();
  const addWords = (text, withCompound = false) => {
    const norm = normalizePolish(text).replace(/[^a-z0-9\s]/g, ' ').trim();
    if (!norm) return;
    const words = norm.split(/\s+/).filter((w) => w.length >= 2 && w.length <= 40);
    for (const w of words) {
      terms.add(w);
      const syns = TERM_SYNONYMS[w];
      if (syns) for (const s of syns) terms.add(s);
    }
    if (withCompound && words.length >= 2) {
      const joined = words.join('');
      if (joined.length >= 5 && joined.length <= 48) terms.add(joined);
    }
  };

  addWords(poi.name, true);
  addWords(poi.subtype, false);
  if (poi.tags) {
    for (const t of String(poi.tags).split(',')) addWords(t, false);
  }
  if (poi.street) addWords(poi.street, false);
  if (poi.district) addWords(poi.district, false);
  if (poi.city) addWords(poi.city, false);

  return [...terms];
}

/** Buduje zoptymalizowany plik SQLite z POI, indeksami przestrzennymi i `poi_terms`. */
export function buildPoiSqlite(dbPath, pois, metadata = {}) {
  try {
    unlinkSync(dbPath);
  } catch {
    // brak poprzedniego pliku
  }
  const db = new DatabaseSync(dbPath);
  try {
    db.exec(`
      PRAGMA page_size = 4096;
      PRAGMA journal_mode = DELETE;
      PRAGMA synchronous = OFF;
      PRAGMA temp_store = MEMORY;
      CREATE TABLE meta (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
      CREATE TABLE pois (
        id INTEGER PRIMARY KEY NOT NULL,
        ext_id TEXT NOT NULL,
        name TEXT NOT NULL,
        norm_name TEXT NOT NULL,
        category TEXT NOT NULL,
        subtype TEXT NOT NULL,
        address TEXT NOT NULL,
        street TEXT,
        district TEXT,
        city TEXT,
        lat REAL NOT NULL,
        lon REAL NOT NULL,
        rank INTEGER NOT NULL,
        min_zoom INTEGER NOT NULL,
        cell_coarse INTEGER NOT NULL,
        cell_fine INTEGER NOT NULL,
        tags TEXT NOT NULL DEFAULT '',
        sources TEXT NOT NULL,
        website TEXT,
        phone TEXT,
        hours TEXT,
        rating REAL
      );
      CREATE TABLE poi_terms (
        term TEXT NOT NULL,
        poi_id INTEGER NOT NULL,
        PRIMARY KEY (term, poi_id)
      ) WITHOUT ROWID;
    `);

    const insPoi = db.prepare(`
      INSERT INTO pois (
        id, ext_id, name, norm_name, category, subtype, address, street, district, city,
        lat, lon, rank, min_zoom, cell_coarse, cell_fine, tags, sources, website, phone, hours, rating
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insTerm = db.prepare('INSERT OR IGNORE INTO poi_terms (term, poi_id) VALUES (?, ?)');
    const insMeta = db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)');

    db.exec('BEGIN');
    const byCategory = {};
    const bySource = {};
    let termCount = 0;

    for (const p of pois) {
      insPoi.run(
        p.id,
        p.ext_id,
        p.name,
        p.norm_name,
        p.category,
        p.subtype,
        p.address,
        p.street,
        p.district,
        p.city,
        p.lat,
        p.lon,
        p.rank,
        p.min_zoom,
        p.cell_coarse,
        p.cell_fine,
        p.tags,
        p.sources,
        p.website,
        p.phone,
        p.hours,
        p.rating,
      );
      byCategory[p.category] = (byCategory[p.category] || 0) + 1;
      for (const s of p.sources.split(',')) {
        if (s) bySource[s] = (bySource[s] || 0) + 1;
      }
      const terms = extractSearchTerms(p);
      for (const term of terms) {
        insTerm.run(term, p.id);
        termCount++;
      }
    }

    for (const [k, v] of Object.entries(metadata)) {
      if (v != null) insMeta.run(k, String(v));
    }
    insMeta.run('poi_count', String(pois.length));
    insMeta.run('term_count', String(termCount));
    db.exec('COMMIT');

    db.exec(`
      CREATE INDEX idx_pois_cell_coarse ON pois (cell_coarse, min_zoom, rank DESC);
      CREATE INDEX idx_pois_cell_fine ON pois (cell_fine, min_zoom, rank DESC);
      CREATE INDEX idx_pois_norm ON pois (norm_name);
      ANALYZE;
      VACUUM;
    `);

    return { total: pois.length, termCount, byCategory, bySource };
  } finally {
    db.close();
  }
}
