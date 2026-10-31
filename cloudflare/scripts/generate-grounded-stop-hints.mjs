#!/usr/bin/env node
/**
 * Generator wskazówek przystankowych dla miast (Wrocław, Warszawa, GZM, Kraków).
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
 * 5. Zwięzłe, 1-zdaniowe opisy (< 25 słów).
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
  if (
    name &&
    /^(Wrocław|Warszawa|Katowice|Gliwice|Sosnowiec|Zabrze|Bytom|Kraków)\s+\d+$/i.test(
      name,
    )
  )
    return null;

  const isMajor =
    /train_station|hospital|commercial|retail|mall/i.test(JSON.stringify(t)) ||
    /galeria|dworzec|szpital|pasaż|renoma|wroclavia|capitol|opera|tarasy|park|kaufland|auchan|carrefour|arkadia|mokotow|zlote tarasy|silesia|bonarka|serenada|sukiennice|wawel|ice krakow|teatr słowackiego/i.test(
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
  } else if (
    t.amenity === 'theatre' ||
    (name && /teatr|opera|filharmonia/i.test(name))
  ) {
    phrase = `obok ${name}`;
  } else if (t.amenity === 'pharmacy' || (name && /apteka/i.test(name))) {
    phrase = `obok apteki ${name ? name.replace(/^apteka\s+/i, '') : ''}`.trim();
  } else if (
    name &&
    /żabka|biedronka|lidl|kaufland|netto|dino|carrefour|auchan|rossmann|delikatesy/i.test(
      name,
    )
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

  const OSM_CACHE = path.join(
    ROOT_DIR,
    `cloudflare/.cache/${city}-osm-elements.json`,
  );
  const OUTPUT_FILE = path.join(
    ROOT_DIR,
    `cloudflare/data/stop-hints-${city}.json`,
  );

  let zipFiles = [];
  if (city === 'krakow') {
    zipFiles = [
      {
        path: path.join(ROOT_DIR, 'cloudflare/.cache/gtfs-krakow-t.zip'),
        isTram: true,
        prefix: 'KRK:T',
      },
      {
        path: path.join(ROOT_DIR, 'cloudflare/.cache/gtfs-krakow-a.zip'),
        isTram: false,
        prefix: 'KRK:A',
      },
    ];
  } else {
    zipFiles = [
      {
        path: path.join(ROOT_DIR, `cloudflare/.cache/gtfs-${city}.zip`),
        isTram: false,
        prefix: '',
      },
    ];
  }

  for (const z of zipFiles) {
    if (!fs.existsSync(z.path)) {
      throw new Error(`Brak pliku GTFS w: ${z.path}`);
    }
  }
  if (!fs.existsSync(OSM_CACHE)) {
    throw new Error(`Brak pliku OSM w: ${OSM_CACHE}`);
  }

  console.log('[1/4] Ładowanie danych GTFS...');
  const clusterMap = new Map();
  const allStops = [];

  for (const z of zipFiles) {
    const stopsCsv = execSync(`unzip -p "${z.path}" stops.txt`, {
      maxBuffer: 50 * 1024 * 1024,
    }).toString('utf8');

    for (const line of stopsCsv.split('\n').slice(1)) {
      if (!line.trim()) continue;
      const p = line.split(',');

      let id = '',
        code = '',
        name = '',
        lat = 0,
        lon = 0,
        street = '',
        isTram = z.isTram;

      if (city === 'warszawa') {
        const locType = p[6]?.trim();
        if (locType === '1' || locType === '2') continue;
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
      } else if (city === 'krakow') {
        id = p[0].trim();
        code = (p[1] || '').replace(/"/g, '').trim();
        name = (p[2] || '').replace(/"/g, '').trim();
        lat = parseFloat(p[4]);
        lon = parseFloat(p[5]);
      } else if (city === 'poznan') {
        id = p[0].trim();
        name = (p[1] || '').replace(/"/g, '').trim();
        const m = name.match(/\s(\d{2})$/);
        code = m ? m[1] : '';
        lat = parseFloat(p[3]);
        lon = parseFloat(p[4]);
        const n = parseInt(code, 10);
        isTram = (n >= 41 && n <= 49) || (n >= 71 && n <= 79);
      } else {
        // Wrocław
        id = p[0].trim();
        code = (p[1] || '').trim();
        name = (p[2] || '').replace(/"/g, '').trim();
        lat = parseFloat(p[3]);
        lon = parseFloat(p[4]);
      }

      if (!name || isNaN(lat) || isNaN(lon)) continue;

      const stopObj = {
        id,
        code,
        name,
        lat,
        lon,
        street,
        isTram,
        prefix: z.prefix,
      };
      allStops.push(stopObj);

      const list = clusterMap.get(name) || [];
      list.push(stopObj);
      clusterMap.set(name, list);
    }
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

  console.log(
    `[✓] Zaindeksowano ${landmarks.length} fizycznych punktów orientacyjnych OSM.`,
  );

  console.log('[3/4] Generowanie zakotwiczonych wskazówek dla słupków...');
  const stopsOutput = {};

  let SPECIFIC_POLE_HINTS = {};
  if (city === 'wroclaw') {
    SPECIFIC_POLE_HINTS = {
      20820:
        'Peron 1 • Wyspa centralna Ronda Reagana od strony Pasażu Grunwaldzkiego.',
      20823:
        'Peron 2 • Wyspa centralna Ronda Reagana od strony Pasażu Grunwaldzkiego.',
      20824:
        'Peron 3 • Wyspa centralna Ronda Reagana od strony Politechniki.',
      20815:
        'Peron 4 • Wyspa centralna Ronda Reagana od strony Politechniki.',
      20855:
        'Słupek na ul. Curie-Skłodowskiej przed wjazdem na rondo obok Pasażu Grunwaldzkiego.',
      20816:
        'Słupek na ul. Curie-Skłodowskiej za zjazdem z ronda obok Uniwersytetu Medycznego.',
      20916:
        'Zatoka autobusowa na pl. Grunwaldzkim przed głównym wejściem do Pasażu Grunwaldzkiego.',
      20915:
        'Zatoka autobusowa na pl. Grunwaldzkim naprzeciwko Pasażu Grunwaldzkiego.',
      10101:
        'Peron 1 • Wyspa tramwajowa przed frontem dworca PKP w stronę Arkad.',
      10102:
        'Peron 2 • Wyspa tramwajowa na ul. Piłsudskiego naprzeciwko frontu dworca PKP.',
      10103:
        'Słupek autobusowy na ul. Peronowej bezpośrednio przed wejściem na dworzec PKP.',
      10201:
        'Przystanek na ul. Suchej przy wejściu do galerii Wroclavia.',
      10202:
        'Przystanek na ul. Suchej naprzeciwko wejścia do dworca PKP.',
      10501:
        'Dolny peron 1 w wykopie pod pl. Dominikańskim w stronę mostu Grunwaldzkiego.',
      10502:
        'Dolny peron 2 w wykopie pod pl. Dominikańskim w stronę Rynku i Dworca Głównego.',
      10531: 'Górny peron na poziomie ulicy przy pl. Dominikańskim.',
      10532:
        'Górny peron na poziomie ulicy przy wejściu do Galerii Dominikańskiej.',
      10511:
        'Zatoka autobusowa przy fosie miejskiej przed Galerią Dominikańską.',
      10521:
        'Zatoka autobusowa na ul. Kazimierza Wielkiego przy wyjściu z Galerii Dominikańskiej.',
    };
  } else if (city === 'warszawa') {
    SPECIFIC_POLE_HINTS = {
      700201:
        'Słupek 01 • Al. Jerozolimskie, wyspa tramwajowa naprzeciwko CH Złote Tarasy.',
      700202:
        'Słupek 02 • Al. Jerozolimskie, wyspa tramwajowa naprzeciwko wejścia do Dworca Centralnego.',
      700203:
        'Słupek 03 • al. Jana Pawła II przed wejściem do Dworca Centralnego.',
      700204:
        'Słupek 04 • al. Jana Pawła II naprzeciwko wejścia do Dworca Centralnego.',
      700205:
        'Słupek 05 • Al. Jerozolimskie pod halą główną dworca kolejowego.',
      700206: 'Słupek 06 • Al. Jerozolimskie pod halą główną dworca.',
      700207:
        'Słupek 07 • Al. Jerozolimskie w stronę Centrum naprzeciwko CH Złote Tarasy.',
      700208:
        'Słupek 08 • Al. Jerozolimskie w stronę pl. Zawiszy przed Dworcem Centralnym.',
      700209: 'Słupek 09 • al. Jana Pawła II obok CH Złote Tarasy.',
      700210: 'Słupek 10 • al. Jana Pawła II obok Dworca Centralnego.',
      700211:
        'Słupek 11 • ul. Emilii Plater naprzeciwko Pałacu Kultury i Nauki.',
      700212:
        'Słupek 12 • ul. Emilii Plater przy wejściu do CH Złote Tarasy.',
      700216:
        'Słupek 16 • ul. Emilii Plater przy Pałacu Kultury i Nauki.',
      700221:
        'Słupek 21 • Pętla autobusowa Dworzec Centralny, peron 1 przy CH Złote Tarasy.',
      700223:
        'Słupek 23 • Pętla autobusowa Dworzec Centralny, peron 2 obok CH Złote Tarasy.',
      700225:
        'Słupek 25 • Pętla autobusowa Dworzec Centralny, peron 3 obok CH Złote Tarasy.',
      700227:
        'Słupek 27 • Pętla autobusowa Dworzec Centralny, peron 4 pod zadaszeniem.',
      700229:
        'Słupek 29 • Pętla autobusowa Dworzec Centralny, peron 5 pod zadaszeniem.',
      700272:
        'Słupek 72 • ul. Emilii Plater naprzeciwko wejścia do Pałacu Kultury.',
      605901:
        'Słupek 01 • Pętla tramwajowa Metro Młociny, peron wysiadkowy przed wejściem do metra.',
      605902:
        'Słupek 02 • Pętla tramwajowa Metro Młociny, peron odjazdowy przed stacją metra.',
      605903:
        'Słupek 03 • Pętla tramwajowa Metro Młociny przy stacji metra w stronę mostu Skłodowskiej-Curie.',
      605904:
        'Słupek 04 • Pętla tramwajowa Metro Młociny przed wejściem do stacji metra.',
      605905:
        'Słupek 05 • Pętla tramwajowa Metro Młociny przed wejściem do stacji metra.',
      605906:
        'Słupek 06 • Pętla tramwajowa Metro Młociny przed wejściem do stacji metra.',
      605907:
        'Słupek 07 • Pętla tramwajowa Metro Młociny przed wejściem do stacji metra.',
      605917:
        'Słupek 17 • Zatoka autobusowa na ul. Kasprowicza obok wejścia do metra.',
      605921:
        'Słupek 21 • Dworzec autobusowy P+R Metro Młociny, peron 1 przy wyjściu z metra.',
      605922:
        'Słupek 22 • Dworzec autobusowy P+R Metro Młociny, peron 2 przy wyjściu z metra.',
      605923:
        'Słupek 23 • Dworzec autobusowy P+R Metro Młociny, peron 3 przy wyjściu z metra.',
      605924:
        'Słupek 24 • Dworzec autobusowy P+R Metro Młociny, peron 4 przy wyjściu z metra.',
      605925:
        'Słupek 25 • Dworzec autobusowy P+R Metro Młociny, peron 5 przy wyjściu z metra.',
      605928:
        'Słupek 28 • Dworzec autobusowy P+R Metro Młociny, peron wysiadkowy.',
      700101:
        'Słupek 01 • Peron tramwajowy na ul. Marszałkowskiej przed Błękitnym Wieżowcem.',
      700102:
        'Słupek 02 • Peron tramwajowy na ul. Marszałkowskiej naprzeciwko Błękitnego Wieżowca.',
      700103:
        'Słupek 03 • Zatoka autobusowa na al. Solidarności przed Urzędem Miasta.',
      700104:
        'Słupek 04 • Zatoka autobusowa na al. Solidarności naprzeciwko Urzędu Miasta.',
      700105:
        'Słupek 05 • Zatoka autobusowa na ul. Marszałkowskiej przed Błękitnym Wieżowcem.',
      700106:
        'Słupek 06 • Zatoka autobusowa na ul. Marszałkowskiej naprzeciwko Błękitnego Wieżowca.',
      702601:
        'Słupek 01 • Wyspa tramwajowa na ul. Prostej naprzeciwko wieżowca Warsaw Spire.',
      702602:
        'Słupek 02 • Wyspa tramwajowa na ul. Towarowej obok kompleksu The Warsaw Hub.',
      702603:
        'Słupek 03 • Wyspa tramwajowa na ul. Prostej obok wieżowca Skyliner.',
      702604:
        'Słupek 04 • Wyspa tramwajowa na ul. Towarowej obok kompleksu The Warsaw Hub.',
      702605:
        'Słupek 05 • Zatoka autobusowa na ul. Prostej przed Warsaw Spire.',
      702606:
        'Słupek 06 • Zatoka autobusowa na ul. Towarowej przed The Warsaw Hub.',
      701701:
        'Słupek 01 • Wyspa tramwajowa na al. Jana Pawła II obok wieżowca Rondo 1.',
      701702:
        'Słupek 02 • Wyspa tramwajowa na ul. Świętokrzyskiej obok wieżowca Rondo 1.',
    };
  } else if (city === 'gzm') {
    SPECIFIC_POLE_HINTS = {
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
      '2469011-00201t':
        'Peron tramwajowy • ul. 3 Maja naprzeciwko Galerii Katowickiej.',
      '2469011-00202t':
        'Peron tramwajowy • ul. 3 Maja przed wejściem do Galerii Katowickiej.',
    };
  } else if (city === 'poznan') {
    SPECIFIC_POLE_HINTS = {
      // Poznań Główny / Dworzec Zachodni
      'poznan-glowny73-wqjhw':
        'Peron tramwajowy na Moście Dworcowym w stronę Ronda Kaponiera.',
      'poznan-glowny73':
        'Peron tramwajowy na Moście Dworcowym w stronę Ronda Kaponiera.',
      'poznan-glowny74-wqo4m':
        'Peron tramwajowy na Moście Dworcowym w stronę ul. Głogowskiej i Dębca.',
      'poznan-glowny74':
        'Peron tramwajowy na Moście Dworcowym w stronę ul. Głogowskiej i Dębca.',
      'poznan-glowny41-wozxq':
        'Podziemny peron PST Poznań Główny pod galerią Avenida w stronę Os. Sobieskiego.',
      'poznan-glowny41':
        'Podziemny peron PST Poznań Główny pod galerią Avenida w stronę Os. Sobieskiego.',
      'poznan-glowny42-wpigc':
        'Podziemny peron PST Poznań Główny pod galerią Avenida w stronę Dworca Zachodniego.',
      'poznan-glowny42':
        'Podziemny peron PST Poznań Główny pod galerią Avenida w stronę Dworca Zachodniego.',
      'poznan-glowny01-wl51l':
        'Słupek 01 • Przystanek autobusowy na placu Dworcowym przed wejściem na dworzec PKP.',
      'poznan-glowny01':
        'Słupek 01 • Przystanek autobusowy na placu Dworcowym przed wejściem na dworzec PKP.',
      'poznan-glowny02-wl51n':
        'Słupek 02 • Przystanek autobusowy na placu Dworcowym przed wejściem do galerii Avenida.',
      'poznan-glowny02':
        'Słupek 02 • Przystanek autobusowy na placu Dworcowym przed wejściem do galerii Avenida.',
      'poznan-glowny05-wpn2o':
        'Stanowisko 05 • Dworzec autobusowy Poznań Główny pod galerią Avenida.',
      'poznan-glowny05':
        'Stanowisko 05 • Dworzec autobusowy Poznań Główny pod galerią Avenida.',
      'poznan-glowny06-wq0yg':
        'Stanowisko 06 • Dworzec autobusowy Poznań Główny pod galerią Avenida.',
      'poznan-glowny06':
        'Stanowisko 06 • Dworzec autobusowy Poznań Główny pod galerią Avenida.',
      'dworzec-zachodni71-wgrmp':
        'Peron tramwajowy na ul. Głogowskiej przed wejściem do Dworca Zachodniego PKP w stronę centrum.',
      'dworzec-zachodni71':
        'Peron tramwajowy na ul. Głogowskiej przed wejściem do Dworca Zachodniego PKP w stronę centrum.',
      'dworzec-zachodni72-wh5iq':
        'Peron tramwajowy na ul. Głogowskiej naprzeciwko Dworca Zachodniego PKP w stronę Górczyna.',
      'dworzec-zachodni72':
        'Peron tramwajowy na ul. Głogowskiej naprzeciwko Dworca Zachodniego PKP w stronę Górczyna.',
      'dworzec-zachodni41-wip2j':
        'Peron PST w wykopie przy Dworcu Zachodnim w stronę Dworca Głównego i Mostu Teatralnego.',
      'dworzec-zachodni41':
        'Peron PST w wykopie przy Dworcu Zachodnim w stronę Dworca Głównego i Mostu Teatralnego.',
      'dworzec-zachodni42-wift7':
        'Pętla PST przy Dworcu Zachodnim, peron dla wysiadających.',
      'dworzec-zachodni42':
        'Pętla PST przy Dworcu Zachodnim, peron dla wysiadających.',
      'dworzec-zachodni02-wi1x6':
        'Zatoka autobusowa na ul. Zachodniej przed wejściem do tunelu Dworca Zachodniego.',
      'dworzec-zachodni02':
        'Zatoka autobusowa na ul. Zachodniej przed wejściem do tunelu Dworca Zachodniego.',

      // Rondo Kaponiera
      'rondo-kaponiera45-wm64d':
        'Poziom -2 w wykopie PST, peron w stronę Mostu Teatralnego i Os. Sobieskiego.',
      'rondo-kaponiera45':
        'Poziom -2 w wykopie PST, peron w stronę Mostu Teatralnego i Os. Sobieskiego.',
      'rondo-kaponiera46-wmfdq':
        'Poziom -2 w wykopie PST, peron w stronę Dworca Zachodniego.',
      'rondo-kaponiera46':
        'Poziom -2 w wykopie PST, peron w stronę Dworca Zachodniego.',
      'rondo-kaponiera71-wliz8':
        'Poziom 0, peron tramwajowy na ul. Roosevelta obok hotelu Mercure w stronę Mostu Teatralnego.',
      'rondo-kaponiera71':
        'Poziom 0, peron tramwajowy na ul. Roosevelta obok hotelu Mercure w stronę Mostu Teatralnego.',
      'rondo-kaponiera72-wls8k':
        'Poziom 0, peron tramwajowy na ul. Roosevelta obok Bałtyku w stronę Mostu Dworcowego.',
      'rondo-kaponiera72':
        'Poziom 0, peron tramwajowy na ul. Roosevelta obok Bałtyku w stronę Mostu Dworcowego.',
      'rondo-kaponiera73-wmon0':
        'Poziom 0, peron tramwajowy na ul. Zwierzynieckiej obok DS Jowita w stronę ul. Kraszewskiego.',
      'rondo-kaponiera73':
        'Poziom 0, peron tramwajowy na ul. Zwierzynieckiej obok DS Jowita w stronę ul. Kraszewskiego.',
      'rondo-kaponiera74-wmxwd':
        'Poziom 0, peron tramwajowy na ul. Święty Marcin przed CK Zamek w stronę centrum.',
      'rondo-kaponiera74':
        'Poziom 0, peron tramwajowy na ul. Święty Marcin przed CK Zamek w stronę centrum.',
      'rondo-kaponiera01-wkhxt':
        'Słupek 01 • Zatoka autobusowa na ul. Zwierzynieckiej obok Domu Studenckiego Jowita.',
      'rondo-kaponiera01':
        'Słupek 01 • Zatoka autobusowa na ul. Zwierzynieckiej obok Domu Studenckiego Jowita.',
      'rondo-kaponiera02-wi6ls':
        'Słupek 02 • Zatoka autobusowa na ul. Zwierzynieckiej przed hotelem Mercure.',
      'rondo-kaponiera02':
        'Słupek 02 • Zatoka autobusowa na ul. Zwierzynieckiej przed hotelem Mercure.',
      'rondo-kaponiera05-wmfdi':
        'Słupek 05 • Zatoka autobusowa na ul. Roosevelta obok wejścia do Kaponiery.',
      'rondo-kaponiera05':
        'Słupek 05 • Zatoka autobusowa na ul. Roosevelta obok wejścia do Kaponiery.',
      'rondo-kaponiera06-wmomr':
        'Słupek 06 • Zatoka autobusowa na ul. Roosevelta obok wieżowca Bałtyk.',
      'rondo-kaponiera06':
        'Słupek 06 • Zatoka autobusowa na ul. Roosevelta obok wieżowca Bałtyk.',

      // Most Teatralny
      'most-teatralny44-wn2jy':
        'Dolny peron PST w wykopie pod wiaduktem w stronę Dworca Zachodniego.',
      'most-teatralny44':
        'Dolny peron PST w wykopie pod wiaduktem w stronę Dworca Zachodniego.',
      'most-teatralny45-wocut':
        'Dolny peron PST w wykopie pod wiaduktem w stronę Os. Sobieskiego.',
      'most-teatralny45':
        'Dolny peron PST w wykopie pod wiaduktem w stronę Os. Sobieskiego.',
      'most-teatralny46-wnyyt':
        'Rampa wyjazdowa PST przy parku Wieniawskiego w stronę ul. Roosevelta.',
      'most-teatralny46':
        'Rampa wyjazdowa PST przy parku Wieniawskiego w stronę ul. Roosevelta.',
      'most-teatralny71-wmfec':
        'Peron tramwajowy na ul. Roosevelta przed Teatrem Nowym w stronę Ronda Kaponiera.',
      'most-teatralny71':
        'Peron tramwajowy na ul. Roosevelta przed Teatrem Nowym w stronę Ronda Kaponiera.',
      'most-teatralny72-wlnmj':
        'Peron tramwajowy na Moście Teatralnym w stronę Jeżyc i ul. Dąbrowskiego.',
      'most-teatralny72':
        'Peron tramwajowy na Moście Teatralnym w stronę Jeżyc i ul. Dąbrowskiego.',
      'most-teatralny73-wnubr':
        'Peron tramwajowy na ul. Fredry przed Teatrem Wielkim w stronę centrum.',
      'most-teatralny73':
        'Peron tramwajowy na ul. Fredry przed Teatrem Wielkim w stronę centrum.',
      'most-teatralny01-wnbt9':
        'Słupek 01 • Zatoka autobusowa na Moście Teatralnym w stronę centrum.',
      'most-teatralny01':
        'Słupek 01 • Zatoka autobusowa na Moście Teatralnym w stronę centrum.',
      'most-teatralny02-wm1ic':
        'Słupek 02 • Zatoka autobusowa na Moście Teatralnym w stronę Jeżyc.',
      'most-teatralny02':
        'Słupek 02 • Zatoka autobusowa na Moście Teatralnym w stronę Jeżyc.',

      // Rondo Rataje
      'rondo-rataje71-xxd3e':
        'Peron tramwajowy na ul. Zamenhofa obok CH Posnania w stronę Starołęki.',
      'rondo-rataje71':
        'Peron tramwajowy na ul. Zamenhofa obok CH Posnania w stronę Starołęki.',
      'rondo-rataje72-xxmcs':
        'Peron tramwajowy na ul. Zamenhofa obok CH Posnania w stronę Ronda Śródka.',
      'rondo-rataje72':
        'Peron tramwajowy na ul. Zamenhofa obok CH Posnania w stronę Ronda Śródka.',
      'rondo-rataje73-xys1a':
        'Peron tramwajowy na ul. Krzywoustego przed mostem Królowej Jadwigi.',
      'rondo-rataje73':
        'Peron tramwajowy na ul. Krzywoustego przed mostem Królowej Jadwigi.',
      'rondo-rataje74-xz1an':
        'Peron tramwajowy na ul. Krzywoustego obok dworca Rondo Rataje w stronę Franowa.',
      'rondo-rataje74':
        'Peron tramwajowy na ul. Krzywoustego obok dworca Rondo Rataje w stronę Franowa.',
      'rondo-rataje75-xwlbs':
        'Peron tramwajowy przed wejściem do galerii Posnania.',
      'rondo-rataje75':
        'Peron tramwajowy przed wejściem do galerii Posnania.',
      'rondo-rataje76-xw7fu':
        'Peron tramwajowy obok dworca autobusowego Rondo Rataje.',
      'rondo-rataje76':
        'Peron tramwajowy obok dworca autobusowego Rondo Rataje.',
      'rondo-rataje06-xwul7':
        'Stanowisko 06 • Dworzec autobusowy Rondo Rataje obok galerii Posnania.',
      'rondo-rataje06':
        'Stanowisko 06 • Dworzec autobusowy Rondo Rataje obok galerii Posnania.',

      // Rondo Śródka
      'rondo-srodka43-y5q4v':
        'Peron tramwajowy na ul. Jana Pawła II obok dworca Śródka w stronę Ronda Rataje.',
      'rondo-srodka43':
        'Peron tramwajowy na ul. Jana Pawła II obok dworca Śródka w stronę Ronda Rataje.',
      'rondo-srodka44-y5ze7':
        'Peron tramwajowy na ul. Jana Pawła II obok dworca Śródka w stronę Zawad.',
      'rondo-srodka44':
        'Peron tramwajowy na ul. Jana Pawła II obok dworca Śródka w stronę Zawad.',
      'rondo-srodka45-y7s7n':
        'Peron tramwajowy na ul. Wyszyńskiego przed mostem Mieszka I w stronę Katedry.',
      'rondo-srodka45':
        'Peron tramwajowy na ul. Wyszyńskiego przed mostem Mieszka I w stronę Katedry.',
      'rondo-srodka46-y863o':
        'Peron tramwajowy na ul. Warszawskiej obok dworca Śródka w stronę Miłostowa.',
      'rondo-srodka46':
        'Peron tramwajowy na ul. Warszawskiej obok dworca Śródka w stronę Miłostowa.',
      'rondo-srodka01-y7nkx':
        'Stanowisko 01 • Dworzec autobusowy Rondo Śródka.',
      'rondo-srodka01':
        'Stanowisko 01 • Dworzec autobusowy Rondo Śródka.',
      'rondo-srodka03-y7wul':
        'Stanowisko 03 • Dworzec autobusowy Rondo Śródka.',
      'rondo-srodka03':
        'Stanowisko 03 • Dworzec autobusowy Rondo Śródka.',
      'rondo-srodka04-y52zi':
        'Stanowisko 04 • Dworzec autobusowy Rondo Śródka.',
      'rondo-srodka04':
        'Stanowisko 04 • Dworzec autobusowy Rondo Śródka.',

      // Os. Sobieskiego
      'os-sobieskiego41-wscs0':
        'Peron 1 • Pętla tramwajowa PST Os. Sobieskiego w stronę centrum.',
      'os-sobieskiego41':
        'Peron 1 • Pętla tramwajowa PST Os. Sobieskiego w stronę centrum.',
      'os-sobieskiego42-wqxum':
        'Peron 2 • Pętla tramwajowa PST Os. Sobieskiego w stronę centrum.',
      'os-sobieskiego42':
        'Peron 2 • Pętla tramwajowa PST Os. Sobieskiego w stronę centrum.',
      'os-sobieskiego01-wqjyl':
        'Stanowisko 01 • Dworzec autobusowy Os. Sobieskiego obok pętli PST.',
      'os-sobieskiego01':
        'Stanowisko 01 • Dworzec autobusowy Os. Sobieskiego obok pętli PST.',

      // Rynek Jeżycki
      'rynek-jezycki71-walhm':
        'Peron tramwajowy na ul. Dąbrowskiego obok Rynku Jeżyckiego w stronę Ogrodów.',
      'rynek-jezycki71':
        'Peron tramwajowy na ul. Dąbrowskiego obok Rynku Jeżyckiego w stronę Ogrodów.',
      'rynek-jezycki72-wa2yw':
        'Peron tramwajowy na ul. Dąbrowskiego obok Rynku Jeżyckiego w stronę centrum.',
      'rynek-jezycki72':
        'Peron tramwajowy na ul. Dąbrowskiego obok Rynku Jeżyckiego w stronę centrum.',
      'rynek-jezycki73-wbmj1':
        'Peron tramwajowy na ul. Kraszewskiego obok Rynku Jeżyckiego w stronę Zwierzynieckiej.',
      'rynek-jezycki73':
        'Peron tramwajowy na ul. Kraszewskiego obok Rynku Jeżyckiego w stronę Zwierzynieckiej.',
      'rynek-jezycki74-wcnka':
        'Peron tramwajowy na ul. Kraszewskiego obok Rynku Jeżyckiego w stronę Dąbrowskiego.',
      'rynek-jezycki74':
        'Peron tramwajowy na ul. Kraszewskiego obok Rynku Jeżyckiego w stronę Dąbrowskiego.',

      // Rynek Wildecki
      'rynek-wildecki71-wvoll':
        'Peron tramwajowy na ul. Wierzbięcice obok Rynku Wildeckiego w stronę Dębca.',
      'rynek-wildecki71':
        'Peron tramwajowy na ul. Wierzbięcice obok Rynku Wildeckiego w stronę Dębca.',
      'rynek-wildecki72-ww2hn':
        'Peron tramwajowy na ul. Wierzbięcice obok Rynku Wildeckiego w stronę Mostu Dworcowego.',
      'rynek-wildecki72':
        'Peron tramwajowy na ul. Wierzbięcice obok Rynku Wildeckiego w stronę Mostu Dworcowego.',

      // Aleje Marcinkowskiego / Plac Wolności
      'aleje-marcinkowskiego71-x63pc':
        'Peron tramwajowy w Alejach Marcinkowskiego obok Placu Wolności w stronę mostu Rocha.',
      'aleje-marcinkowskiego71':
        'Peron tramwajowy w Alejach Marcinkowskiego obok Placu Wolności w stronę mostu Rocha.',
      'aleje-marcinkowskiego72-x6m89':
        'Peron tramwajowy w Alejach Marcinkowskiego obok Placu Wolności w stronę Ronda Kaponiera.',
      'aleje-marcinkowskiego72':
        'Peron tramwajowy w Alejach Marcinkowskiego obok Placu Wolności w stronę Ronda Kaponiera.',

      // Pl. Wielkopolski & Pl. Bernardyński
      'pl-wielkopolski41-x9bh3':
        'Peron tramwajowy przy placu targowym na Placu Wielkopolskim w stronę Małych Garbar.',
      'pl-wielkopolski41':
        'Peron tramwajowy przy placu targowym na Placu Wielkopolskim w stronę Małych Garbar.',
      'pl-wielkopolski42-x927s':
        'Peron tramwajowy przy placu targowym na Placu Wielkopolskim w stronę Placu Ratajskiego.',
      'pl-wielkopolski42':
        'Peron tramwajowy przy placu targowym na Placu Wielkopolskim w stronę Placu Ratajskiego.',
      'pl-bernardynski71-xh17f':
        'Peron tramwajowy na Placu Bernardyńskim przed kościołem św. Franciszka z Asyżu w stronę mostu Rocha.',
      'pl-bernardynski71':
        'Peron tramwajowy na Placu Bernardyńskim przed kościołem św. Franciszka z Asyżu w stronę mostu Rocha.',
      'pl-bernardynski72-xgry4':
        'Peron tramwajowy na Placu Bernardyńskim przed kościołem św. Franciszka z Asyżu w stronę centrum.',
      'pl-bernardynski72':
        'Peron tramwajowy na Placu Bernardyńskim przed kościołem św. Franciszka z Asyżu w stronę centrum.',

      // Pętle PKM
      'gorczyn-pkm41-vh0fq':
        'Peron odjazdowy tramwajów na pętli Górczyn PKM przed dworcem kolejowym.',
      'gorczyn-pkm41':
        'Peron odjazdowy tramwajów na pętli Górczyn PKM przed dworcem kolejowym.',
      'debiec-pkm41-w9k5d':
        'Peron odjazdowy tramwajów na pętli Dębiec PKM przed pętlą autobusową.',
      'debiec-pkm41':
        'Peron odjazdowy tramwajów na pętli Dębiec PKM przed pętlą autobusową.',
      'staroleka-pkm41-xa7k4':
        'Peron odjazdowy tramwajów na pętli Starołęka PKM przed dworcem kolejowym.',
      'staroleka-pkm41':
        'Peron odjazdowy tramwajów na pętli Starołęka PKM przed dworcem kolejowym.',
      'ogrody41-viy5n':
        'Peron odjazdowy tramwajów na pętli Ogrody przy pętli autobusowej na ul. Dąbrowskiego.',
      'ogrody41':
        'Peron odjazdowy tramwajów na pętli Ogrody przy pętli autobusowej na ul. Dąbrowskiego.',
    };
  } else if (city === 'krakow') {
    SPECIFIC_POLE_HINTS = {
      // Dworzec Główny Tunel (KST pod peronami PKP)
      '901-01':
        'Peron 1 • Podziemny peron tramwajowy KST w tunelu pod Dworcem Głównym PKP w stronę Politechniki.',
      '901-02':
        'Peron 2 • Podziemny peron tramwajowy KST w tunelu pod Dworcem Głównym PKP w stronę Ronda Mogilskiego.',
      stop_322_117319:
        'Peron 1 • Podziemny peron tramwajowy KST w tunelu pod Dworcem Głównym PKP w stronę Politechniki.',
      stop_322_117329:
        'Peron 2 • Podziemny peron tramwajowy KST w tunelu pod Dworcem Głównym PKP w stronę Ronda Mogilskiego.',
      'KRK:T:stop_322_117319':
        'Peron 1 • Podziemny peron tramwajowy KST w tunelu pod Dworcem Głównym PKP w stronę Politechniki.',
      'KRK:T:stop_322_117329':
        'Peron 2 • Podziemny peron tramwajowy KST w tunelu pod Dworcem Głównym PKP w stronę Ronda Mogilskiego.',
      // Dworzec Główny Zachód
      '760-01':
        'Peron 1 • Peron tramwajowy na ul. Pawiej przed Galerią Krakowską w stronę Dworca Towarowego.',
      '760-02':
        'Peron 2 • Peron tramwajowy na ul. Pawiej przed Galerią Krakowską w stronę Teatru Słowackiego.',
      stop_335_260819:
        'Peron 1 • Peron tramwajowy na ul. Pawiej przed Galerią Krakowską w stronę Dworca Towarowego.',
      stop_335_260829:
        'Peron 2 • Peron tramwajowy na ul. Pawiej przed Galerią Krakowską w stronę Teatru Słowackiego.',
      'KRK:T:stop_335_260819':
        'Peron 1 • Peron tramwajowy na ul. Pawiej przed Galerią Krakowską w stronę Dworca Towarowego.',
      'KRK:T:stop_335_260829':
        'Peron 2 • Peron tramwajowy na ul. Pawiej przed Galerią Krakowską w stronę Teatru Słowackiego.',
      '760-03':
        'Słupek 03 • Zatoka autobusowa na ul. Pawiej przed Galerią Krakowską.',
      11977:
        'Słupek 03 • Zatoka autobusowa na ul. Pawiej przed Galerią Krakowską.',
      'KRK:A:11977':
        'Słupek 03 • Zatoka autobusowa na ul. Pawiej przed Galerią Krakowską.',
      '760-07':
        'Słupek 07 • Pętla autobusowa przed dworcem PKP i Galerią Krakowską.',
      13714:
        'Słupek 07 • Pętla autobusowa przed dworcem PKP i Galerią Krakowską.',
      'KRK:A:13714':
        'Słupek 07 • Pętla autobusowa przed dworcem PKP i Galerią Krakowską.',
      '760-09':
        'Słupek 09 • Pętla autobusowa przed dworcem PKP i Galerią Krakowską.',
      13718:
        'Słupek 09 • Pętla autobusowa przed dworcem PKP i Galerią Krakowską.',
      'KRK:A:13718':
        'Słupek 09 • Pętla autobusowa przed dworcem PKP i Galerią Krakowską.',
      // Dworzec Główny Wschód (MDA)
      '461-01':
        'Stanowisko 01 • Pętla autobusowa przy ul. Bosackiej obok Małopolskiego Dworca Autobusowego MDA.',
      8906:
        'Stanowisko 01 • Pętla autobusowa przy ul. Bosackiej obok Małopolskiego Dworca Autobusowego MDA.',
      'KRK:A:8906':
        'Stanowisko 01 • Pętla autobusowa przy ul. Bosackiej obok Małopolskiego Dworca Autobusowego MDA.',
      '461-02':
        'Stanowisko 02 • Pętla autobusowa przy ul. Bosackiej obok Małopolskiego Dworca Autobusowego MDA.',
      12070:
        'Stanowisko 02 • Pętla autobusowa przy ul. Bosackiej obok Małopolskiego Dworca Autobusowego MDA.',
      'KRK:A:12070':
        'Stanowisko 02 • Pętla autobusowa przy ul. Bosackiej obok Małopolskiego Dworca Autobusowego MDA.',
      // Teatr Słowackiego
      '801-01':
        'Słupek 01 • Peron tramwajowy na ul. Basztowej przed Teatrem im. J. Słowackiego w stronę Dworca Głównego.',
      stop_852_324219:
        'Słupek 01 • Peron tramwajowy na ul. Basztowej przed Teatrem im. J. Słowackiego w stronę Dworca Głównego.',
      12717:
        'Słupek 01 • Peron tramwajowy na ul. Basztowej przed Teatrem im. J. Słowackiego w stronę Dworca Głównego.',
      '801-02':
        'Słupek 02 • Peron tramwajowy na ul. Basztowej od strony Plant w stronę Starego Kleparza.',
      stop_852_324229:
        'Słupek 02 • Peron tramwajowy na ul. Basztowej od strony Plant w stronę Starego Kleparza.',
      12718:
        'Słupek 02 • Peron tramwajowy na ul. Basztowej od strony Plant w stronę Starego Kleparza.',
      '801-03':
        'Słupek 03 • Peron tramwajowy na ul. Westerplatte od strony Plant w stronę Poczty Głównej.',
      stop_852_324239:
        'Słupek 03 • Peron tramwajowy na ul. Westerplatte od strony Plant w stronę Poczty Głównej.',
      12719:
        'Słupek 03 • Peron tramwajowy na ul. Westerplatte od strony Plant w stronę Poczty Głównej.',
      '801-04':
        'Słupek 04 • Peron tramwajowy na ul. Lubicz przed Teatrem im. J. Słowackiego w stronę Ronda Mogilskiego.',
      stop_852_324249:
        'Słupek 04 • Peron tramwajowy na ul. Lubicz przed Teatrem im. J. Słowackiego w stronę Ronda Mogilskiego.',
      // Rondo Mogilskie (poziom dolny w wykopie)
      '802-01':
        'Peron 1 • Dolny poziom w wykopie ronda, peron tramwajowy w stronę Ronda Grzegórzeckiego.',
      stop_203_12519:
        'Peron 1 • Dolny poziom w wykopie ronda, peron tramwajowy w stronę Ronda Grzegórzeckiego.',
      7471: 'Peron 1 • Dolny poziom w wykopie ronda, peron tramwajowy w stronę Ronda Grzegórzeckiego.',
      '802-02':
        'Peron 2 • Dolny poziom w wykopie ronda, peron tramwajowy w stronę Tunelu KST i Politechniki.',
      stop_203_12529:
        'Peron 2 • Dolny poziom w wykopie ronda, peron tramwajowy w stronę Tunelu KST i Politechniki.',
      9051: 'Peron 2 • Dolny poziom w wykopie ronda, peron tramwajowy w stronę Tunelu KST i Politechniki.',
      '802-03':
        'Peron 3 • Dolny poziom w wykopie ronda, peron w stronę Dworca Głównego i ul. Lubicz.',
      stop_203_12539:
        'Peron 3 • Dolny poziom w wykopie ronda, peron w stronę Dworca Głównego i ul. Lubicz.',
      9050: 'Peron 3 • Dolny poziom w wykopie ronda, peron w stronę Dworca Głównego i ul. Lubicz.',
      '802-04':
        'Peron 4 • Dolny poziom w wykopie ronda, peron w stronę al. Powstania Warszawskiego.',
      stop_203_12549:
        'Peron 4 • Dolny poziom w wykopie ronda, peron w stronę al. Powstania Warszawskiego.',
      9049: 'Peron 4 • Dolny poziom w wykopie ronda, peron w stronę al. Powstania Warszawskiego.',
      '802-05':
        'Peron 5 • Dolny poziom w wykopie ronda, peron tramwajowy w stronę al. Beliny-Prażmowskiego.',
      stop_203_12559:
        'Peron 5 • Dolny poziom w wykopie ronda, peron tramwajowy w stronę al. Beliny-Prażmowskiego.',
      '802-06':
        'Słupek 06 • Górny poziom ronda, zatoka autobusowa na al. Beliny-Prażmowskiego obok wieżowca Unity Centre.',
      10991:
        'Słupek 06 • Górny poziom ronda, zatoka autobusowa na al. Beliny-Prażmowskiego obok wieżowca Unity Centre.',
      '802-08':
        'Słupek 08 • Górny poziom ronda, zatoka autobusowa przy Uniwersytecie Ekonomicznym.',
      11432:
        'Słupek 08 • Górny poziom ronda, zatoka autobusowa przy Uniwersytecie Ekonomicznym.',
      '802-09':
        'Słupek 09 • Górny poziom ronda, zatoka autobusowa na ul. Lubicz przed wejściem do Opery Krakowskiej.',
      11433:
        'Słupek 09 • Górny poziom ronda, zatoka autobusowa na ul. Lubicz przed wejściem do Opery Krakowskiej.',
      // Rondo Grzegórzeckie
      '809-01':
        'Peron 1 • Peron tramwajowy na al. Pokoju w stronę Dąbia i Nowej Huty.',
      stop_230_36519:
        'Peron 1 • Peron tramwajowy na al. Pokoju w stronę Dąbia i Nowej Huty.',
      7905: 'Peron 1 • Peron tramwajowy na al. Pokoju w stronę Dąbia i Nowej Huty.',
      '809-02':
        'Peron 2 • Peron tramwajowy na ul. Grzegórzeckiej w stronę Hali Targowej.',
      stop_230_36529:
        'Peron 2 • Peron tramwajowy na ul. Grzegórzeckiej w stronę Hali Targowej.',
      7907: 'Peron 2 • Peron tramwajowy na ul. Grzegórzeckiej w stronę Hali Targowej.',
      '809-03':
        'Peron 3 • Peron tramwajowy na al. Powstania Warszawskiego w stronę Ronda Mogilskiego.',
      stop_230_36539:
        'Peron 3 • Peron tramwajowy na al. Powstania Warszawskiego w stronę Ronda Mogilskiego.',
      7908: 'Peron 3 • Peron tramwajowy na al. Powstania Warszawskiego w stronę Ronda Mogilskiego.',
      '809-04':
        'Peron 4 • Peron tramwajowy na ul. Kotlarskiej w stronę mostu Kotlarskiego.',
      stop_230_36549:
        'Peron 4 • Peron tramwajowy na ul. Kotlarskiej w stronę mostu Kotlarskiego.',
      8604: 'Peron 4 • Peron tramwajowy na ul. Kotlarskiej w stronę mostu Kotlarskiego.',
      // Rondo Grunwaldzkie (ICE Kraków)
      '501-01':
        'Peron 1 • Peron tramwajowy na ul. Monte Cassino przed Centrum Kongresowym ICE Kraków.',
      stop_957_333819:
        'Peron 1 • Peron tramwajowy na ul. Monte Cassino przed Centrum Kongresowym ICE Kraków.',
      13180:
        'Peron 1 • Peron tramwajowy na ul. Monte Cassino przed Centrum Kongresowym ICE Kraków.',
      '501-02':
        'Peron 2 • Peron tramwajowy na ul. Dietla w stronę mostu Grunwaldzkiego i Wawelu.',
      stop_957_333829:
        'Peron 2 • Peron tramwajowy na ul. Dietla w stronę mostu Grunwaldzkiego i Wawelu.',
      13179:
        'Peron 2 • Peron tramwajowy na ul. Dietla w stronę mostu Grunwaldzkiego i Wawelu.',
      '501-03':
        'Słupek 03 • Zatoka autobusowa na ul. Konopnickiej obok hotelu Park Inn w stronę mostu Dębnickiego.',
      13177:
        'Słupek 03 • Zatoka autobusowa na ul. Konopnickiej obok hotelu Park Inn w stronę mostu Dębnickiego.',
      '501-04':
        'Słupek 04 • Zatoka autobusowa na ul. Konopnickiej naprzeciwko Centrum Kongresowego ICE Kraków w stronę Ronda Matecznego.',
      13178:
        'Słupek 04 • Zatoka autobusowa na ul. Konopnickiej naprzeciwko Centrum Kongresowego ICE Kraków w stronę Ronda Matecznego.',
      '501-05':
        'Słupek 05 • Zatoka autobusowa na ul. Monte Cassino przed Centrum Kongresowym ICE Kraków.',
      13183:
        'Słupek 05 • Zatoka autobusowa na ul. Monte Cassino przed Centrum Kongresowym ICE Kraków.',
      '501-06':
        'Słupek 06 • Zatoka autobusowa na ul. Dietla przed mostem Grunwaldzkim w stronę Kazimierza.',
      13186:
        'Słupek 06 • Zatoka autobusowa na ul. Dietla przed mostem Grunwaldzkim w stronę Kazimierza.',
      // Plac Centralny im. R. Reagana
      '105-01':
        'Peron 1 • Peron tramwajowy na al. Jana Pawła II w stronę Ronda Czyżyńskiego.',
      stop_12_19:
        'Peron 1 • Peron tramwajowy na al. Jana Pawła II w stronę Ronda Czyżyńskiego.',
      '105-02':
        'Peron 2 • Peron tramwajowy na al. Solidarności w stronę Kombinatu.',
      stop_12_20:
        'Peron 2 • Peron tramwajowy na al. Solidarności w stronę Kombinatu.',
      '105-03':
        'Peron 3 • Peron tramwajowy na al. Andersa w stronę Ronda Kocmyrzowskiego.',
      stop_12_21:
        'Peron 3 • Peron tramwajowy na al. Andersa w stronę Ronda Kocmyrzowskiego.',
      '105-04': 'Peron 4 • Peron tramwajowy na Placu Centralnym w stronę Kopca Wandy.',
      stop_12_24: 'Peron 4 • Peron tramwajowy na Placu Centralnym w stronę Kopca Wandy.',
      '105-05':
        'Słupek 05 • Zatoka autobusowa na al. Solidarności obok Placu Centralnego.',
      18296:
        'Słupek 05 • Zatoka autobusowa na al. Solidarności obok Placu Centralnego.',
      '105-06':
        'Słupek 06 • Zatoka autobusowa na al. Jana Pawła II przed Placem Centralnym w stronę Czyżyn.',
      18314:
        'Słupek 06 • Zatoka autobusowa na al. Jana Pawła II przed Placem Centralnym w stronę Czyżyn.',
      '105-07':
        'Słupek 07 • Zatoka autobusowa na al. Jana Pawła II przy Placu Centralnym w stronę Nowego Kleparza.',
      18291:
        'Słupek 07 • Zatoka autobusowa na al. Jana Pawła II przy Placu Centralnym w stronę Nowego Kleparza.',
      '105-09':
        'Słupek 09 • Zatoka autobusowa na al. Andersa przy Nowohuckim Centrum Kultury.',
      18297:
        'Słupek 09 • Zatoka autobusowa na al. Andersa przy Nowohuckim Centrum Kultury.',
      // Nowy Kleparz
      '835-01':
        'Peron 1 • Peron tramwajowy na ul. Długiej obok Nowego Kleparza w stronę Starego Miasta.',
      stop_187_7119:
        'Peron 1 • Peron tramwajowy na ul. Długiej obok Nowego Kleparza w stronę Starego Miasta.',
      '835-02':
        'Peron 2 • Peron tramwajowy na ul. Kamiennej przy pętli Nowy Kleparz w stronę Dworca Towarowego.',
      stop_187_7129:
        'Peron 2 • Peron tramwajowy na ul. Kamiennej przy pętli Nowy Kleparz w stronę Dworca Towarowego.',
      '835-03':
        'Stanowisko 03 • Pętla autobusowa Nowy Kleparz obok placu targowego.',
      7432:
        'Stanowisko 03 • Pętla autobusowa Nowy Kleparz obok placu targowego.',
      '835-04':
        'Stanowisko 04 • Pętla autobusowa Nowy Kleparz przy al. Słowackiego.',
      7430:
        'Stanowisko 04 • Pętla autobusowa Nowy Kleparz przy al. Słowackiego.',
      '835-05':
        'Stanowisko 05 • Pętla autobusowa Nowy Kleparz, peron 5.',
      7407: 'Stanowisko 05 • Pętla autobusowa Nowy Kleparz, peron 5.',
      '835-06':
        'Stanowisko 06 • Pętla autobusowa Nowy Kleparz, peron 6.',
      8389: 'Stanowisko 06 • Pętla autobusowa Nowy Kleparz, peron 6.',
      '835-07':
        'Stanowisko 07 • Pętla autobusowa Nowy Kleparz, peron 7.',
      12457:
        'Stanowisko 07 • Pętla autobusowa Nowy Kleparz, peron 7.',
    };
  }

  for (const [key, hint] of Object.entries(SPECIFIC_POLE_HINTS)) {
    stopsOutput[key] = hint;
  }

  let skippedCount = 0;

  for (const stop of allStops) {
    const key = (city === 'warszawa' || city === 'poznan') ? stop.id : stop.code || stop.id;
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
        : city === 'poznan' && parseInt(stop.code, 10) >= 41 && parseInt(stop.code, 10) <= 49
          ? 'Peron PST w wykopie'
          : stop.isTram
            ? 'Peron tramwajowy'
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
    } else if (city === 'krakow') {
      const krkMatch = stop.code?.match(/^\d{1,4}-(\d{2})$/);
      if (krkMatch) {
        const poleNum = krkMatch[1];
        const n = parseInt(poleNum, 10);
        if (stop.isTram && (n === 1 || n === 2)) {
          polePrefix = `Peron ${n} • `;
        } else {
          polePrefix = `Słupek ${poleNum} • `;
        }
      }
    } else if (city === 'poznan') {
      const n = parseInt(stop.code, 10);
      if (n >= 41 && n <= 49) {
        polePrefix = `Słupek ${stop.code} (PST) • `;
      } else if (stop.code) {
        polePrefix = `Słupek ${stop.code} • `;
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
    if (stop.id && stop.id !== key) {
      stopsOutput[stop.id] = sentence;
    }
    if (stop.prefix && stop.id) {
      stopsOutput[`${stop.prefix}:${stop.id}`] = sentence;
    }
    if (city === 'poznan') {
      if (stop.name) {
        stopsOutput[stop.name] = sentence;
      }
      const slug = stop.id.split('-').slice(0, -1).join('-');
      if (slug && slug !== stop.id) {
        stopsOutput[slug] = sentence;
      }
    }
  }

  console.log(
    `[✓] Zapisano ${Object.keys(stopsOutput).length} słupków z autentycznym punktem odniesienia.`,
  );
  console.log(
    `[i] Pominięto ${skippedCount} słupków bez fizycznego punktu odniesienia.`,
  );

  const clustersOutput = {};

  const finalDataset = {
    schemaVersion: 1,
    city,
    generatedAt: new Date().toISOString(),
    stops: stopsOutput,
    clusters: clustersOutput,
  };

  fs.writeFileSync(
    OUTPUT_FILE,
    JSON.stringify(finalDataset, null, 2) + '\n',
    'utf8',
  );
  console.log(`[✓] Zapisano dataset do: ${OUTPUT_FILE}`);
}

async function main() {
  const cityArg = process.argv.find((a) => a.startsWith('--city='));
  const allArg = process.argv.includes('--all');

  const citiesToRun = allArg
    ? ['wroclaw', 'warszawa', 'gzm', 'krakow', 'poznan']
    : [cityArg ? cityArg.split('=')[1] : 'wroclaw'];

  for (const city of citiesToRun) {
    await processCity(city);
  }
}

main().catch((err) => {
  console.error('[!] Błąd generowania:', err);
  process.exit(1);
});
