#!/usr/bin/env node
/**
 * Generator wskazówek przystankowych dla miast (Wrocław, Warszawa, GZM).
 * Zgodny ze skillem stop-hints (SKILL.md) i zasadami anti-slop.
 *
 * Twarde reguły grounding (anti-slop):
 * 1. Każda wskazówka słupka MUSI zawierać fizyczny punkt odniesienia:
 *    - Landmark / POI (sklep, kebab, burger, restauracja, stacja benzynowa, apteka, kościół, szpital, teatr),
 *    - Element krajobrazu (park, fosa miejska, most, rzeka),
 *    - Albo strukturę peronu/węzła (wyspa centralna peron 1-4, dolny peron w wykopie, podziemny terminal w tunelu).
 * 2. Jeśli słupek NIE POSIADA punktu odniesienia -> JEST POMIJANY (brak pustosłowia "ulica + kierunek").
 * 3. Kluczowe jest, by pasażer wiedział DOKŁADNIE z którego peronu/słupka odjeżdża.
 * 4. Płaski format JSON: Record<string, string>.
 * 5. Zwięzłe, 1-zdaniowe opisy (< 20 słów).
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const ROOT_DIR = path.resolve(import.meta.dirname, '../..');

function haversineDistanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function normalizeKey(v) {
  return String(v ?? '')
    .toLowerCase()
    .replace(
      /[ąćęłńóśźż]/g,
      (c) => ({ ą: 'a', ć: 'c', ę: 'e', ł: 'l', ń: 'n', ó: 'o', ś: 's', ź: 'z', ż: 'z' })[c] || c,
    )
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function formatStreet(street) {
  if (!street) return '';
  let s = street.trim();
  if (/^aleja\s+/i.test(s)) return `przy al. ${s.replace(/^aleja\s+/i, '')}`;
  if (/^al\.\s+/i.test(s)) return `przy ${s}`;
  if (/^plac\s+/i.test(s)) return `przy pl. ${s.replace(/^plac\s+/i, '')}`;
  if (/^pl\.\s+/i.test(s)) return `przy ${s}`;
  if (/^rondo\s+/i.test(s)) return `na ${s}`;
  return `na ul. ${s}`;
}

function categorizeLandmark(el) {
  const t = el.tags || {};
  if (t.public_transport || t.highway || t.railway) return null;

  const name = t.name || t.brand || t.operator;
  if (!name && !t.leisure && !t.cuisine && !t.bridge) return null;
  if (name && /^(Wrocław|Warszawa|Katowice|Gliwice|Sosnowiec|Zabrze|Bytom)\s+\d+$/i.test(name))
    return null;

  const isMajor =
    /train_station|hospital|commercial|retail|mall/i.test(JSON.stringify(t)) ||
    /galeria|dworzec|szpital|pasaż|renoma|wroclavia|capitol|opera|tarasy|park|kaufland|auchan|carrefour|arkadia|mokotow|zlote tarasy|silesia/i.test(
      name || '',
    );

  let phrase = '';
  if (t.leisure === 'park' || (name && /park\b/i.test(name))) {
    phrase = name ? `po stronie ${name}` : 'przy parku';
  } else if (t.cuisine === 'kebab' || (name && /kebab/i.test(name))) {
    phrase = name ? `obok ${name}` : 'obok lokalu z kebabem';
  } else if (t.cuisine === 'burger' || (name && /burger/i.test(name))) {
    phrase = name ? `obok ${name}` : 'obok lokalu z burgerami';
  } else if (t.cuisine === 'pizza' || (name && /pizza|pizzeria/i.test(name))) {
    phrase = name ? `obok ${name}` : 'obok pizzerii';
  } else if (
    t.amenity === 'fuel' ||
    t.brand === 'Orlen' ||
    t.brand === 'BP' ||
    t.brand === 'Shell' ||
    t.brand === 'Circle K' ||
    t.brand === 'Moya' ||
    t.brand === 'Mol' ||
    t.brand === 'Amic'
  ) {
    const brand = t.brand || name || 'benzynowej';
    phrase = `obok stacji ${brand}`;
  } else if (t.bridge || (name && /most|wiadukt/i.test(name))) {
    phrase =
      name && /most/i.test(name)
        ? `przy moście ${name.replace(/^most\s+/i, '')}`
        : 'pod wiaduktem kolejowym';
  } else if (name && /fosa/i.test(name)) {
    phrase = 'przy fosie miejskiej';
  } else if (name && /szpital/i.test(name)) {
    phrase = `przed wejściem do szpitala (${name})`;
  } else if (name && /kościół|katedra|bazylika/i.test(name)) {
    phrase = `obok ${name}`;
  } else if (t.amenity === 'theatre' || (name && /teatr|opera|filharmonia/i.test(name))) {
    phrase = `obok ${name}`;
  } else if (t.amenity === 'pharmacy' || (name && /apteka/i.test(name))) {
    phrase = `obok apteki ${name ? name.replace(/^apteka\s+/i, '') : ''}`.trim();
  } else if (
    name &&
    /żabka|biedronka|lidl|kaufland|netto|dino|carrefour|auchan|rossmann|delikatesy/i.test(name)
  ) {
    phrase = `obok ${name}`;
  } else if (name) {
    phrase = `obok ${name}`;
  }

  if (!phrase) return null;
  phrase = phrase
    .replace(/\.(?!\s*(?:pl|com|eu|org|net)\b)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!phrase || phrase.length < 5) return null;

  return {
    name: name || phrase,
    phrase,
    isMajor,
    lat: el.lat ?? el.center?.lat,
    lon: el.lon ?? el.center?.lon,
  };
}

async function processCity(city) {
  console.log(`\n======================================================`);
  console.log(`[i] Generowanie grounded stop hints dla: ${city.toUpperCase()}`);
  console.log(`======================================================`);

  const GTFS_ZIP = path.join(ROOT_DIR, `cloudflare/.cache/gtfs-${city}.zip`);
  const OSM_CACHE = path.join(ROOT_DIR, `cloudflare/.cache/${city}-osm-elements.json`);
  const OUTPUT_FILE = path.join(ROOT_DIR, `cloudflare/data/stop-hints-${city}.json`);

  if (!fs.existsSync(GTFS_ZIP)) {
    throw new Error(`Brak pliku GTFS w: ${GTFS_ZIP}`);
  }
  if (!fs.existsSync(OSM_CACHE)) {
    throw new Error(`Brak pliku OSM w: ${OSM_CACHE}`);
  }

  console.log('[1/4] Ładowanie danych GTFS...');
  const stopsCsv = execSync(`unzip -p "${GTFS_ZIP}" stops.txt`, {
    maxBuffer: 50 * 1024 * 1024,
  }).toString('utf8');

  // Parsowanie słupków
  const clusterMap = new Map();
  const allStops = [];

  for (const line of stopsCsv.split('\n').slice(1)) {
    if (!line.trim()) continue;
    const p = line.split(',');

    let id = '',
      code = '',
      name = '',
      lat = 0,
      lon = 0,
      street = '';

    if (city === 'warszawa') {
      const locType = p[6]?.trim();
      if (locType === '1' || locType === '2') continue; // pomijamy dworce zbiorcze i wejścia do metra
      id = p[0].trim();
      name = (p[1] || '').replace(/"/g, '').trim();
      code = (p[2] || '').trim();
      lat = parseFloat(p[4]);
      lon = parseFloat(p[5]);
      street = (p[12] || '').replace(/"/g, '').trim();
    } else if (city === 'gzm') {
      id = p[0].trim();
      code = (p[1] || '').trim();
      name = (p[2] || '').replace(/"/g, '').trim();
      lat = parseFloat(p[3]);
      lon = parseFloat(p[4]);
    } else {
      // Wrocław
      id = p[0].trim();
      code = (p[1] || '').trim();
      name = (p[2] || '').replace(/"/g, '').trim();
      lat = parseFloat(p[3]);
      lon = parseFloat(p[4]);
    }

    if (!name || isNaN(lat) || isNaN(lon)) continue;

    const stopObj = { id, code, name, lat, lon, street };
    allStops.push(stopObj);

    const list = clusterMap.get(name) || [];
    list.push(stopObj);
    clusterMap.set(name, list);
  }

  console.log(
    `[✓] Przeanalizowano GTFS: ${allStops.length} słupków w ${clusterMap.size} zespołach.`,
  );

  console.log('[2/4] Ładowanie i indeksowanie punktów OpenStreetMap...');
  const osmElements = JSON.parse(fs.readFileSync(OSM_CACHE, 'utf8'));

  const landmarks = [];
  for (const el of osmElements) {
    const cat = categorizeLandmark(el);
    if (cat && cat.lat != null && cat.lon != null) {
      landmarks.push(cat);
    }
  }

  // Przestrzenny grid (komórka ~0.005 stopnia, czyli ok. 400x550m)
  const landmarkGrid = new Map();
  for (const l of landmarks) {
    const cell = `${Math.floor(l.lat / 0.005)}:${Math.floor(l.lon / 0.005)}`;
    if (!landmarkGrid.has(cell)) landmarkGrid.set(cell, []);
    landmarkGrid.get(cell).push(l);
  }

  function findNearbyLandmark(lat, lon) {
    const y0 = Math.floor((lat - 0.002) / 0.005);
    const y1 = Math.floor((lat + 0.002) / 0.005);
    const x0 = Math.floor((lon - 0.003) / 0.005);
    const x1 = Math.floor((lon + 0.003) / 0.005);

    let best = null;
    let bestDist = 9999;

    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const list = landmarkGrid.get(`${y}:${x}`);
        if (!list) continue;
        for (const l of list) {
          const d = haversineDistanceMeters(lat, lon, l.lat, l.lon);
          const maxDist = l.isMajor ? 75 : 35;
          if (d <= maxDist && d < bestDist) {
            best = l;
            bestDist = d;
          }
        }
      }
    }
    return best ? { ...best, dist: bestDist } : null;
  }

  console.log(`[✓] Zaindeksowano ${landmarks.length} fizycznych punktów orientacyjnych OSM.`);

  console.log('[3/4] Generowanie zakotwiczonych wskazówek dla słupków...');
  const stopsOutput = {};

  // Ręcznie zweryfikowane, kluczowe węzły i platformy
  let SPECIFIC_POLE_HINTS = {};
  if (city === 'wroclaw') {
    SPECIFIC_POLE_HINTS = {
      20820: 'Peron 1 • Wyspa centralna Ronda Reagana od strony Pasażu Grunwaldzkiego.',
      20823: 'Peron 2 • Wyspa centralna Ronda Reagana od strony Pasażu Grunwaldzkiego.',
      20824: 'Peron 3 • Wyspa centralna Ronda Reagana od strony Politechniki.',
      20815: 'Peron 4 • Wyspa centralna Ronda Reagana od strony Politechniki.',
      20855: 'Słupek na ul. Curie-Skłodowskiej przed wjazdem na rondo obok Pasażu Grunwaldzkiego.',
      20816: 'Słupek na ul. Curie-Skłodowskiej za zjazdem z ronda obok Uniwersytetu Medycznego.',
      20916:
        'Zatoka autobusowa na pl. Grunwaldzkim przed głównym wejściem do Pasażu Grunwaldzkiego.',
      20915: 'Zatoka autobusowa na pl. Grunwaldzkim naprzeciwko Pasażu Grunwaldzkiego.',
      10101: 'Peron 1 • Wyspa tramwajowa przed frontem dworca PKP w stronę Arkad.',
      10102: 'Peron 2 • Wyspa tramwajowa na ul. Piłsudskiego naprzeciwko frontu dworca PKP.',
      10103: 'Słupek autobusowy na ul. Peronowej bezpośrednio przed wejściem na dworzec PKP.',
      10201: 'Przystanek na ul. Suchej przy wejściu do galerii Wroclavia.',
      10202: 'Przystanek na ul. Suchej naprzeciwko wejścia do dworca PKP.',
      10501: 'Dolny peron 1 w wykopie pod pl. Dominikańskim w stronę mostu Grunwaldzkiego.',
      10502: 'Dolny peron 2 w wykopie pod pl. Dominikańskim w stronę Rynku i Dworca Głównego.',
      10531: 'Górny peron na poziomie ulicy przy pl. Dominikańskim.',
      10532: 'Górny peron na poziomie ulicy przy wejściu do Galerii Dominikańskiej.',
      10511: 'Zatoka autobusowa przy fosie miejskiej przed Galerią Dominikańską.',
      10521: 'Zatoka autobusowa na ul. Kazimierza Wielkiego przy wyjściu z Galerii Dominikańskiej.',
      10301: 'Wyspa tramwajowa na ul. Świdnickiej, dojście bezpośrednio obok Teatru Capitol.',
      10302: 'Wyspa tramwajowa na ul. Świdnickiej naprzeciwko Capitolu w stronę Rynku.',
      10311: 'Przystanek na ul. Piłsudskiego przed Teatrem Muzycznym Capitol.',
      10401: 'Peron tramwajowy na ul. Podwale przy fosie miejskiej w stronę pl. Legionów.',
      10402: 'Peron tramwajowy na ul. Podwale przy fosie miejskiej w stronę mostów Mieszczańskich.',
      10451: 'Zatoka autobusowa na ul. Ruskiej przy fosie miejskiej.',
      10452: 'Zatoka autobusowa na ul. św. Mikołaja naprzeciwko kościoła.',
      10535: 'Zatoka autobusowa na ul. św. Mikołaja przy fosie miejskiej.',
      10533: 'Peron tramwajowy na ul. Legnickiej przy fosie miejskiej w stronę pl. Strzegomskiego.',
    };
  } else if (city === 'warszawa') {
    SPECIFIC_POLE_HINTS = {
      // Dw. Centralny
      700201: 'Słupek 01 • Al. Jerozolimskie, wyspa tramwajowa naprzeciwko CH Złote Tarasy.',
      700202:
        'Słupek 02 • Al. Jerozolimskie, wyspa tramwajowa naprzeciwko wejścia do Dworca Centralnego.',
      700203: 'Słupek 03 • al. Jana Pawła II, wyspa tramwajowa obok Dworca Centralnego.',
      700204: 'Słupek 04 • al. Jana Pawła II, wyspa tramwajowa naprzeciwko CH Złote Tarasy.',
      700205: 'Słupek 05 • ul. Chałubińskiego przed hotelem Marriott.',
      700206: 'Słupek 06 • Al. Jerozolimskie pod halą główną dworca.',
      700207: 'Słupek 07 • Al. Jerozolimskie w stronę Centrum naprzeciwko CH Złote Tarasy.',
      700208: 'Słupek 08 • Al. Jerozolimskie w stronę pl. Zawiszy przed Dworcem Centralnym.',
      700209: 'Słupek 09 • al. Jana Pawła II obok CH Złote Tarasy.',
      700210: 'Słupek 10 • al. Jana Pawła II obok Dworca Centralnego.',
      700211: 'Słupek 11 • ul. Emilii Plater naprzeciwko Pałacu Kultury i Nauki.',
      700212: 'Słupek 12 • ul. Emilii Plater przy wejściu do CH Złote Tarasy.',
      700216: 'Słupek 16 • ul. Emilii Plater przy Pałacu Kultury i Nauki.',
      700221: 'Słupek 21 • Pętla autobusowa Dworzec Centralny, peron 1 przy CH Złote Tarasy.',
      700223: 'Słupek 23 • Pętla autobusowa Dworzec Centralny, peron 2 obok CH Złote Tarasy.',
      700225: 'Słupek 25 • Pętla autobusowa Dworzec Centralny, peron 3 obok CH Złote Tarasy.',
      700227: 'Słupek 27 • Pętla autobusowa Dworzec Centralny, peron 4 pod zadaszeniem.',
      700229: 'Słupek 29 • Pętla autobusowa Dworzec Centralny, peron 5 pod zadaszeniem.',
      700272: 'Słupek 72 • ul. Emilii Plater naprzeciwko wejścia do Pałacu Kultury.',
      // Metro Młociny
      605901:
        'Słupek 01 • Pętla tramwajowa Metro Młociny, peron wysiadkowy przed wejściem do metra.',
      605902: 'Słupek 02 • Pętla tramwajowa Metro Młociny, peron odjazdowy przed stacją metra.',
      605903:
        'Słupek 03 • Pętla tramwajowa Metro Młociny przy stacji metra w stronę mostu Skłodowskiej-Curie.',
      605904: 'Słupek 04 • Pętla tramwajowa Metro Młociny przed wejściem do stacji metra.',
      605905: 'Słupek 05 • Pętla tramwajowa Metro Młociny przed wejściem do stacji metra.',
      605906: 'Słupek 06 • Pętla tramwajowa Metro Młociny przed wejściem do stacji metra.',
      605907: 'Słupek 07 • Pętla tramwajowa Metro Młociny przed wejściem do stacji metra.',
      605917: 'Słupek 17 • Zatoka autobusowa na ul. Kasprowicza obok wejścia do metra.',
      605921: 'Słupek 21 • Dworzec autobusowy P+R Metro Młociny, peron 1 przy wyjściu z metra.',
      605922: 'Słupek 22 • Dworzec autobusowy P+R Metro Młociny, peron 2 przy wyjściu z metra.',
      605923: 'Słupek 23 • Dworzec autobusowy P+R Metro Młociny, peron 3 przy wyjściu z metra.',
      605924: 'Słupek 24 • Dworzec autobusowy P+R Metro Młociny, peron 4 przy wyjściu z metra.',
      605925: 'Słupek 25 • Dworzec autobusowy P+R Metro Młociny, peron 5 przy wyjściu z metra.',
      605928: 'Słupek 28 • Dworzec autobusowy P+R Metro Młociny, peron wysiadkowy.',
      // Pl. Bankowy
      700101: 'Słupek 01 • Peron tramwajowy na ul. Marszałkowskiej przed Błękitnym Wieżowcem.',
      700102:
        'Słupek 02 • Peron tramwajowy na ul. Marszałkowskiej naprzeciwko Błękitnego Wieżowca.',
      700103: 'Słupek 03 • Zatoka autobusowa na al. Solidarności przed Urzędem Miasta.',
      700104: 'Słupek 04 • Zatoka autobusowa na al. Solidarności naprzeciwko Urzędu Miasta.',
      700105: 'Słupek 05 • Zatoka autobusowa na ul. Marszałkowskiej przed Błękitnym Wieżowcem.',
      700106:
        'Słupek 06 • Zatoka autobusowa na ul. Marszałkowskiej naprzeciwko Błękitnego Wieżowca.',
      // Rondo Daszyńskiego
      702601: 'Słupek 01 • Wyspa tramwajowa na ul. Prostej naprzeciwko wieżowca Warsaw Spire.',
      702602: 'Słupek 02 • Wyspa tramwajowa na ul. Towarowej obok kompleksu The Warsaw Hub.',
      702603: 'Słupek 03 • Wyspa tramwajowa na ul. Prostej obok wieżowca Skyliner.',
      702604: 'Słupek 04 • Wyspa tramwajowa na ul. Towarowej obok kompleksu The Warsaw Hub.',
      702605: 'Słupek 05 • Zatoka autobusowa na ul. Prostej przed Warsaw Spire.',
      702606: 'Słupek 06 • Zatoka autobusowa na ul. Towarowej przed The Warsaw Hub.',
      // Rondo ONZ
      701701: 'Słupek 01 • Wyspa tramwajowa na al. Jana Pawła II obok wieżowca Rondo 1.',
      701702: 'Słupek 02 • Wyspa tramwajowa na ul. Świętokrzyskiej obok wieżowca Rondo 1.',
    };
  } else if (city === 'gzm') {
    SPECIFIC_POLE_HINTS = {
      // Katowice Dworzec (podziemny terminal)
      5410: 'Stanowisko 01 • Podziemny terminal autobusowy w tunelu pod Galerią Katowicką (peron 1).',
      5409: 'Stanowisko 02 • Podziemny terminal autobusowy w tunelu pod Galerią Katowicką (peron 2).',
      5408: 'Stanowisko 03 • Podziemny terminal autobusowy w tunelu pod Galerią Katowicką (peron 3).',
      5407: 'Stanowisko 04 • Podziemny terminal autobusowy w tunelu pod Galerią Katowicką (peron 4).',
      3687: 'Stanowisko 05 • Podziemny terminal autobusowy w tunelu pod Galerią Katowicką (peron 5).',
      5411: 'Stanowisko 06 • Podziemny terminal autobusowy w tunelu pod Galerią Katowicką (peron 6).',
      5412: 'Stanowisko 07 • Podziemny terminal autobusowy w tunelu pod Galerią Katowicką (peron 7).',
      5413: 'Stanowisko 08 • Podziemny terminal autobusowy w tunelu pod Galerią Katowicką (peron 8).',
      9753: 'Stanowisko 09 • Podziemny terminal autobusowy w tunelu pod Galerią Katowicką (peron 9).',
      5415: 'Stanowisko 10 • Podziemny terminal autobusowy w tunelu pod Galerią Katowicką (peron 10).',
      7105: 'Peron tramwajowy • ul. 3 Maja przed wejściem do Galerii Katowickiej.',
      7106: 'Peron tramwajowy • ul. 3 Maja naprzeciwko Galerii Katowickiej.',
      // Kody słupków ZTM
      '2469011-00101':
        'Stanowisko 01 • Podziemny terminal autobusowy w tunelu pod Galerią Katowicką (peron 1).',
      '2469011-00102':
        'Stanowisko 02 • Podziemny terminal autobusowy w tunelu pod Galerią Katowicką (peron 2).',
      '2469011-00103':
        'Stanowisko 03 • Podziemny terminal autobusowy w tunelu pod Galerią Katowicką (peron 3).',
      '2469011-00104':
        'Stanowisko 04 • Podziemny terminal autobusowy w tunelu pod Galerią Katowicką (peron 4).',
      '2469011-00105':
        'Stanowisko 05 • Podziemny terminal autobusowy w tunelu pod Galerią Katowicką (peron 5).',
      '2469011-00106':
        'Stanowisko 06 • Podziemny terminal autobusowy w tunelu pod Galerią Katowicką (peron 6).',
      '2469011-00107':
        'Stanowisko 07 • Podziemny terminal autobusowy w tunelu pod Galerią Katowicką (peron 7).',
      '2469011-00108':
        'Stanowisko 08 • Podziemny terminal autobusowy w tunelu pod Galerią Katowicką (peron 8).',
      '2469011-00109':
        'Stanowisko 09 • Podziemny terminal autobusowy w tunelu pod Galerią Katowicką (peron 9).',
      '2469011-00110':
        'Stanowisko 10 • Podziemny terminal autobusowy w tunelu pod Galerią Katowicką (peron 10).',
      '2469011-00201t': 'Peron tramwajowy • ul. 3 Maja naprzeciwko Galerii Katowickiej.',
      '2469011-00202t': 'Peron tramwajowy • ul. 3 Maja przed wejściem do Galerii Katowickiej.',
    };
  }

  for (const [key, hint] of Object.entries(SPECIFIC_POLE_HINTS)) {
    stopsOutput[key] = hint;
  }

  let skippedCount = 0;

  for (const stop of allStops) {
    const key = city === 'warszawa' ? stop.id : stop.code || stop.id;
    if (stopsOutput[key]) continue;

    const landmark = findNearbyLandmark(stop.lat, stop.lon);

    // TWARDA ZASADA ANTI-SLOP: brak fizycznego punktu odniesienia = POMIJAMY SŁUPEK!
    if (!landmark) {
      skippedCount++;
      continue;
    }

    const typeStr =
      city === 'warszawa'
        ? stop.code && parseInt(stop.code, 10) >= 30
          ? 'Peron tramwajowy'
          : 'Zatoka autobusowa'
        : 'Zatoka autobusowa';

    const streetStr = formatStreet(stop.street);

    // Oznaczenie peronu / słupka dla pełnej jasności
    let polePrefix = '';
    if (city === 'warszawa' && stop.code) {
      polePrefix = `Słupek ${stop.code} • `;
    } else if (city === 'gzm') {
      const gzmMatch = stop.code?.match(/-(\d{3})(\d{2})([a-z]?)$/);
      if (gzmMatch) {
        polePrefix = `Stanowisko ${parseInt(gzmMatch[2], 10)} • `;
      }
    }

    let sentence = '';
    if (streetStr) {
      sentence = `${polePrefix}${typeStr} ${streetStr} ${landmark.phrase}.`;
    } else {
      sentence = `${polePrefix}${typeStr} ${landmark.phrase}.`;
    }

    sentence = sentence.replace(/\s+/g, ' ').replace(/\s+\./g, '.').trim();
    if (!sentence.endsWith('.')) sentence += '.';

    stopsOutput[key] = sentence;
    if (city === 'gzm' && stop.id && stop.id !== key) {
      stopsOutput[stop.id] = sentence;
    }
  }

  console.log(
    `[✓] Zapisano ${Object.keys(stopsOutput).length} słupków z autentycznym punktem odniesienia.`,
  );
  console.log(`[i] Pominięto ${skippedCount} słupków bez fizycznego punktu odniesienia.`);

  // UWAGA: Nie generujemy ogólnych opisów całych węzłów (clusters).
  // Użytkownik potrzebuje pewności z którego peronu/słupka jedzie,
  // a nie ogólnego eseju o węźle przesiadkowym.
  const clustersOutput = {};

  const finalDataset = {
    schemaVersion: 1,
    city,
    generatedAt: new Date().toISOString(),
    stops: stopsOutput,
    clusters: clustersOutput,
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(finalDataset, null, 2) + '\n', 'utf8');
  console.log(`[✓] Zapisano dataset do: ${OUTPUT_FILE}`);
}

async function main() {
  const cityArg = process.argv.find((a) => a.startsWith('--city='));
  const allArg = process.argv.includes('--all');

  const citiesToRun = allArg
    ? ['wroclaw', 'warszawa', 'gzm']
    : [cityArg ? cityArg.split('=')[1] : 'wroclaw'];

  for (const city of citiesToRun) {
    await processCity(city);
  }
}

main().catch((err) => {
  console.error('[!] Błąd generatora:', err);
  process.exit(1);
});
