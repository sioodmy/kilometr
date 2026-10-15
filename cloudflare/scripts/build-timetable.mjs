#!/usr/bin/env node
/**
 * build-timetable.mjs: buduje prebuilt SQLite per-miasto.
 *
 * Użycie: node build-timetable.mjs [--city=wroclaw|krakow|gzm|warszawa|poznan|trojmiasto|lodz|szczecin|lublin] [--force] [--write-coords] [--allow-mpk-only]
 * Bez --city buduje Wrocław (domyślne miasto).
 * Artefakty zawsze lądują w cloudflare/dist/{miasto}/, a manifest niesie
 * db.path z prefiksem miasta (klucze R2: {miasto}/manifest.json,
 * {miasto}/db/kilometr-gtfs.db.gz).
 *
 * Wrocław:
 *   Open Data Wrocław — katalog GTFS + ZIP (MPK: tramwaje + autobusy)
 *   + PDP API (PLK): KD, stacje Wrocławia, okno 14 dni (wymaga PDP_API_KEY)
 * Kraków:
 *   ZTP Kraków: 3 statyczne ZIP-y GTFS (A: autobusy, T: tramwaje, M: reszta),
 *   mergowane prefiksami KRK:{A,T,M}. Bez PDP (małopolskie koleje siedzą
 *   we własnym publicznym GTFS Kolei Małopolskich, nie w PDP).
 * Warszawa:
 *   WTP (mkuran.pl/gtfs/warsaw.zip): tramwaje + autobusy + metro M1/M2
 *   + SKA (linie S, w feedzie). Feed to eksport dzienny: każdy kurs ma
 *   własne trip_id z datą, więc import jest zwarty jak GZM (kursy grupowane
 *   po sygnaturze czasów, daty scalone przez calendar_dates). Metro jeździ
 *   na frequencies.txt (headwaye), więc build rozwija je na konkretne
 *   odjazdy, inaczej M1/M2 miałyby po 2 kursy-szablony. KM z ogólno-polskiego
 *   feedu PLK (polish_trains.zip, tylko kursy dotykające Warszawy), WKD
 *   z własnego feedu (wkd.zip). Bez PDP i bez klucza.
 * Poznań:
 *   ZTM Poznań (mirror cdn.zbiorkom.live/gtfs/poznan.zip; upstream to
 *   oficjalny permalink www.ztm.poznan.pl/pl/dla-deweloperow/getGTFSFile,
 *   ale nie zwraca Last-Modified/ETag, więc skip buildu nie wykryłby zmian)
 *   + Koleje Wielkopolskie z własnego publicznego GTFS (pkp-kw.zip, linie
  *   (stop_times ~40 MB), więc zwykły import bez scalania jak GZM/Warszawa.
  * Trójmiasto:
  *   ZTM Gdańsk (eksport dzienny jak WTP: trip_id z datą, tylko
  *   calendar_dates, import zwarty z prefiksem GDA) + ZKM Gdynia (statyczny
  *   zrzut, zwykły import z prefiksem GDY; trolejbusy 800 mapujemy na
  *   kanoniczne 11, tramwaje Gdańska 900 na 0, autobusy 700 na 3)
  *   + SKM z własnego publicznego GTFS (numer pociągu w trip_short_name,
  *   tylko kursy dotykające aglomeracji). Bez PDP i bez klucza.
 * Łódź:
 *   ZDiT Łódź (mirror cdn.zbiorkom.live/gtfs/lodz.zip: tramwaje + autobusy
 *   + linie zastępcze Z/R i nocne N, statyczny zrzut jak Poznań)
 *   + Łódzka Kolej Aglomeracyjna z własnego publicznego GTFS (pkp-lka.zip,
 *   linie Ł/ŁP/ŁS + ZKA jako route_type 3). Bez PDP i bez klucza.
 * Szczecin:
 *   ZDiTM Szczecin wprost z oficjalnego linku (zditm.szczecin.pl/storage/
 *   gtfs/gtfs.zip: tramwaje 1–12 + autobusy + pospieszne A–C i nocne 5xx,
 *   statyczny zrzut z poprawnymi Last-Modified/ETag do skipu buildu,
 *   licencja CC0 1.0). Kolej (SKM Szczecin) nie ma publicznego GTFS,
 *   więc miasto jedzie bez sekcji kolejowej. Bez PDP i bez klucza.
 * Lublin:
 *   ZDiTM Lublin z mirroru cdn.zbiorkom.live/gtfs/lublin.zip (autobusy
 *   2–85 + trolejbusy 150–162 z route_type 11 + nocne N1–N3, miejskie
 *   301–303, 912/917/922 i 950, statyczny zrzut jak Łódź: Last-Modified/
 *   ETag z mirroru, odświeżany codziennie ok. 01:45 UTC, licencja CC0 1.0).
 *   Kolej (POLREGIO/IC przez Lublin) nie ma publicznego GTFS w zakresie
 *   budowy, więc miasto jedzie bez sekcji kolejowej. Bez PDP i bez klucza.
 *
 * Wyjścia (cloudflare/dist/{miasto}/):
 *   kilometr-gtfs.db     — baza w schemacie aplikacji (patrz SCHEMA_SQL niżej)
 *   kilometr-gtfs.db.gz  — ta sama baza spakowana gzip (level 9) do R2
 *   manifest.json: miasto, wersja, statystyki, sha256 bazy (.gz i surowej)
 *
 * Wymagania: Node.js ≥ 22.5 (node:sqlite), program `unzip` w PATH
 * (linux/macos: standard; Windows: Git Bash / WSL). Zero zależności npm.
 *
 * Exit code: 0 = zbudowano, 2 = brak zmian (skip), 1 = błąd.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const args = new Set(process.argv.slice(2));
const FORCE = args.has('--force');
const WRITE_COORDS = args.has('--write-coords');
const CITY_ARG = [...args].map((a) => /^--city=(.+)$/.exec(a)?.[1]).find(Boolean) || '';
const CITY = CITY_ARG === 'krakow' ? 'krakow' : CITY_ARG === 'gzm' ? 'gzm' : CITY_ARG === 'warszawa' ? 'warszawa' : CITY_ARG === 'poznan' ? 'poznan' : CITY_ARG === 'trojmiasto' ? 'trojmiasto' : CITY_ARG === 'lodz' ? 'lodz' : CITY_ARG === 'szczecin' ? 'szczecin' : CITY_ARG === 'lublin' ? 'lublin' : 'wroclaw';
/** Jawny --city przełącza output na dist/{miasto}/ (workflow); bez flagi legacy dist/. */
/** Każde miasto ma własny podkatalog dist/{miasto}/ */
const DIST = join(ROOT, 'dist', CITY);
const DATA = join(ROOT, 'data');
const COORDS_FILE = process.env.KD_COORDS_FILE || join(DATA, 'kd-station-coords.json');
const DB_FILE = join(DIST, 'kilometr-gtfs.db');
const DB_GZ_FILE = join(DIST, 'kilometr-gtfs.db.gz');
const MANIFEST_FILE = join(DIST, 'manifest.json');
const DB_R2_PATH = `${CITY}/db/kilometr-gtfs.db.gz`;

const MPK_CATALOGUE = 'https://api.open-data.cui.wroclaw.pl/od2/6/';
const MPK_DOWNLOAD_BASE = 'https://open-data.cui.wroclaw.pl/hdb/download';
const MPK_FALLBACK_URL = 'https://open-data.cui.wroclaw.pl/hdb/download/136/';
const MPK_UA = { 'User-Agent': 'KilometrTimetableBot/1.0 (build; contact: dev@kilometr.local)' };

/** Statyczne feedy ZTP Kraków (A: autobusy, T: tramwaje, M: pozostałe). */
const ZTP_FEEDS = [
  { prefix: 'A', url: 'https://gtfs.ztp.krakow.pl/GTFS_KRK_A.zip' },
  { prefix: 'T', url: 'https://gtfs.ztp.krakow.pl/GTFS_KRK_T.zip' },
  { prefix: 'M', url: 'https://gtfs.ztp.krakow.pl/GTFS_KRK_M.zip' },
];
const ZTP_UA = { 'User-Agent': 'KilometrTimetableBot/1.0 (build; contact: dev@kilometr.local)' };

/**
 * Koleje Małopolskie: własny publiczny GTFS (SKA + reszta kolei
 * regionalnej, bez klucza). Trasy w feedzie to pociągi imienne
 * (HUBAL, LUXTORPEDA...), numer pociągu siedzi w trip_short_name
 * ("33142 HUBAL"), trasy w bazie grupujemy po numerze jak kursy KD.
 */
const KML_GTFS_URL = 'https://kolejemalopolskie.com.pl/rozklady_jazdy/kml-ska-gtfs.zip';
const KML_UA = { 'User-Agent': 'KilometrTimetableBot/1.0 (build; contact: dev@kilometr.local)' };

/**
 * Warszawa: jeden statyczny ZIP WTP (tramwaje + autobusy + metro M1/M2
 * + SKA). Eksport dzienny (~107 MB ZIP, stop_times ~550 MB): każdy dzień
 * ma własne trip_id z datą w środku, więc prosty import dałby ~8 mln
 * wierszy stop_times i bazę grubo ponad limit 300 MB na obiekt w R2.
 * Import jest zwarty (grupowanie po sygnaturze jak GZM), a kalendarz
 * siedzi wyłącznie w calendar_dates.txt (feed nie ma calendar.txt).
 */
const WAW_GTFS_URL = 'https://mkuran.pl/gtfs/warsaw.zip';
const WAW_UA = { 'User-Agent': 'KilometrTimetableBot/1.0 (build; contact: dev@kilometr.local)' };

/**
 * GZM: ZTM publikuje eksporty dzienne (CKAN, URL-e rotowane codziennie),
 * każdy pokrywa inny zakres dat. Bierzemy wszystkie ZIP-y z datasetu
 * i mergujemy prefiksami GZM:{i} (ten sam wzorzec co feedy ZTP Krakowa).
 * Dataset: otwartedane.metropoliagzm.pl, „GTFS wersja rozszerzona”.
 */
const GZM_CKAN_PACKAGE = 'https://otwartedane.metropoliagzm.pl/api/3/action/package_show?id=317435cc-0075-4d10-b8ef-6e9b0010e90a';
const GZM_UA = { 'User-Agent': 'KilometrTimetableBot/1.0 (build; contact: dev@kilometr.local)' };

/**
 * Koleje Śląskie: publiczny roczny GTFS (bez klucza). Pociągi grupujemy
 * po numerze z trip_short_name jak KMŁ: brygada z live (zbiorkom, agencja
 * KS) to goły numer, a dopasowanie weryfikują nazwy/czasy postojów.
 */
const KS_GTFS_URL = 'https://koleje-ks.pl/gtfs/2025-2026.zip';
const KS_UA = { 'User-Agent': 'KilometrTimetableBot/1.0 (build; contact: dev@kilometr.local)' };

/**
 * Gminy członkowskie GZM (oficjalna lista 41, gzmetropolia.pl/metropolia).
 * Uwaga: Rybnik, Wodzisław Śląski, Żory, Jaworzno i Miasteczko Śląskie NIE
 * należą do GZM (choć ZTM/KŚ mogą tam docierać) i celowo ich tu nie ma.
 * Gminy bez stacji kolejowej (m.in. Psary, Pilchowice, Wojkowice) po prostu
 * nie znajdą wpisu w słowniku PDP; to nie błąd.
 * Bobrowniki też tu nie ma: gmina nie ma stacji, a PDP pod tą nazwą trzyma
 * Bobrowniki z Kujaw (obsługiwane wyłącznie przez ŁKA).
 */
const GZM_GMINAS = [
  'BĘDZIN', 'BIERUŃ', 'BOJSZOWY', 'BYTOM', 'CHEŁM ŚLĄSKI',
  'CHORZÓW', 'CZELADŹ', 'DĄBROWA GÓRNICZA', 'GIERAŁTOWICE', 'GLIWICE',
  'IMIELIN', 'KATOWICE', 'KNURÓW', 'KOBIÓR', 'LĘDZINY', 'ŁAZISKA GÓRNE',
  'MIERZĘCICE', 'MIKOŁÓW', 'MYSŁOWICE', 'OŻAROWICE', 'PIEKARY ŚLĄSKIE',
  'PILCHOWICE', 'PSARY', 'PYSKOWICE', 'RADZIONKÓW', 'RUDA ŚLĄSKA',
  'RUDZINIEC', 'SIEMIANOWICE ŚLĄSKIE', 'SIEWIERZ', 'SŁAWKÓW', 'SOSNOWIEC',
  'SOŚNICOWICE', 'ŚWIERKLANIEC', 'ŚWIĘTOCHŁOWICE', 'TARNOWSKIE GÓRY',
  'TYCHY', 'WOJKOWICE', 'WYRY', 'ZABRZE', 'ZBROSŁAWICE',
];
/**
 * Nazwy miast w słowniku PDP różne od nazwy gminy (słownik używa nazwy
 * miejscowości-węzła, nie pełnej nazwy gminy). Tylko te dwa odstępstwa
 * wychodzą z audytu; każdy inny brak dokładnego trafienia to ostrzeżenie
 * i pominięcie gminy (chroni przed miastem o tej samej nazwie w innym
 * regionie, np. Bobrowniki z Kujaw albo Dąbrowa Białostocka).
 */
const GZM_CITY_ALIASES = {
  'DĄBROWA GÓRNICZA': 'DĄBROWA',
  'ŁAZISKA GÓRNE': 'ŁAZISKA',
};
/**
 * Stacje GZM, których nie obejmuje słownik cities PDP: Katowice Gł.
 * (jest tylko w /dictionaries/stations), Pyrzowice Lotnisko, Nowy Bieruń
 * oraz Taciszów i Rzeczyce Śląskie (gmina Rudziniec, obsługiwane przez PR,
 * a nieujęte w jej wpisie cities). Zweryfikowane parami: IC/PR faktycznie
 * się na nich zatrzymują.
 */
const GZM_EXTRA_STATIONS = [73312, 265126, 77271, 70169, 70151];
/** Bbox GZM do geokodowania stacji (minLon, maxLat, maxLon, minLat jak Nominatim). */
const GZM_BBOX = { minLon: 18.3, maxLat: 50.6, maxLon: 19.8, minLat: 49.95 };
/**
 * Obwiednia GZM z zapasem na geokodowanie: druga linia obrony przed stacją
 * z innego regionu o tej samej nazwie (słownik PDP zwraca całą Polskę).
 * Najdalsza stacja GZM to Rudziniec Gliwicki (~18.40), stąd zachód 18.05.
 */
const GZM_ENVELOPE = { minLat: 49.7, maxLat: 50.75, minLon: 18.05, maxLon: 19.95 };

/**
 * Koleje Mazowieckie z ogólno-polskiego feedu PLK (ten sam autor co WTP):
 * do bazy trafiają tylko kursy dotykające obwiedni Warszawy (reszta
 * Mazowsza to martwa waga), ale z pełną geometrią (da się jechać za miasto).
 */
const KM_GTFS_URL = 'https://mkuran.pl/gtfs/polish_trains.zip';
const KM_UA = { 'User-Agent': 'KilometrTimetableBot/1.0 (build; contact: dev@kilometr.local)' };
/** WKD w całości (jedna linia, cały feed to 55 tys. wierszy). */
const WKD_GTFS_URL = 'https://mkuran.pl/gtfs/wkd.zip';
const WKD_UA = { 'User-Agent': 'KilometrTimetableBot/1.0 (build; contact: dev@kilometr.local)' };
/**
 * Obwiednia Warszawy z zapasem: KM wyjeżdża daleko poza miasto (Modlin,
 * Mińsk, Żyrardów). Kurs łapiemy, gdy ma choć jeden postój w obwiedni.
 */
const WAW_ENVELOPE = { minLat: 51.95, maxLat: 52.45, minLon: 20.75, maxLon: 21.35 };

/**
 * Poznań: statyczny zrzut ZTM (tramwaje + autobusy + linie podmiejskie).
 * Upstream to oficjalny permalink ZTM, ale serwer nie zwraca Last-Modified
 * ani ETag (a nazwa pliku z oknem ważności jest dopiero w nagłówku
 * Content-Disposition po pobraniu całości), więc fingerprint i pobieranie
 * idą z mirroru cdn.zbiorkom.live (ten sam zrzut, odświeżany codziennie
 * ok. 01:45 UTC, z poprawnymi nagłówkami do skipu buildu).
 */
const POZNAN_GTFS_URL = 'https://cdn.zbiorkom.live/gtfs/poznan.zip';
const POZNAN_GTFS_UPSTREAM = 'https://www.ztm.poznan.pl/pl/dla-deweloperow/getGTFSFile';
const POZNAN_UA = { 'User-Agent': 'KilometrTimetableBot/1.0 (build; contact: dev@kilometr.local)' };

/**
 * Koleje Wielkopolskie: własny publiczny GTFS (linie PKM1–PKM5 + reszta
 * regionalnych + ZKA jako route_type 3). Feed obejmuje całe województwo
 * (Piła–Kalisz), więc do bazy trafiają tylko kursy dotykające obwiedni
 * aglomeracji (ten sam wzorzec co KM w Warszawie), ale z pełną geometrią
 * (da się jechać za miasto). Numer pociągu siedzi w trip_short_name.
 */
const KW_GTFS_URL = 'https://cdn.zbiorkom.live/gtfs/pkp-kw.zip';
const KW_UA = { 'User-Agent': 'KilometrTimetableBot/1.0 (build; contact: dev@kilometr.local)' };
/** Obwiednia aglomeracji: kurs KW łapiemy, gdy ma choć jeden postój w środku. */
const POZ_ENVELOPE = { minLat: 52.1, maxLat: 52.65, minLon: 16.5, maxLon: 17.4 };

/**
 * Trójmiasto: oba feedy miejskie idą z mirroru cdn.zbiorkom.live (ten sam
 * wzorzec co Poznań: mirror ma poprawne Last-Modified/ETag do skipu buildu,
 * upstreamy niekoniecznie). Gdańsk to eksport dzienny (trip_id z datą,
 * tylko calendar_dates), Gdynia to statyczny zrzut.
 */
const TRICITY_GDA_GTFS_URL = 'https://cdn.zbiorkom.live/gtfs/tricity-gdansk.zip';
const TRICITY_GDA_GTFS_UPSTREAM = 'https://ckan.multimediagdansk.pl/dataset/c24aa637-3619-4dc2-a171-a23eec8f2172/resource/30e783e4-2bec-4a7d-bb22-ee3e3b26ca96/download/gtfsgoogle.zip';
const TRICITY_GDY_GTFS_URL = 'https://cdn.zbiorkom.live/gtfs/tricity-gdynia.zip';
const TRICITY_GDY_GTFS_UPSTREAM = 'http://api.zdiz.gdynia.pl/pt/gtfs.zip';
const TRICITY_UA = { 'User-Agent': 'KilometrTimetableBot/1.0 (build; contact: dev@kilometr.local)' };

/**
 * SKM Trójmiasto: własny publiczny GTFS (wszystkie kursy to SKM,
 * route_type 2; numer pociągu siedzi w trip_short_name, np. "59606").
 * Feed sięga Słupska, więc do bazy trafiają tylko kursy dotykające
 * obwiedni aglomeracji (ten sam wzorzec co KM/KW), ale z pełną geometrią.
 */
const SKMT_GTFS_URL = 'https://cdn.zbiorkom.live/gtfs/pkp-skmt.zip';
const SKMT_GTFS_UPSTREAM = 'https://bip.skm.pkp.pl/otwarte-dane';
const SKMT_UA = { 'User-Agent': 'KilometrTimetableBot/1.0 (build; contact: dev@kilometr.local)' };
/** Obwiednia Trójmiasta z zapasem: kurs SKM łapiemy, gdy ma postój w środku. */
const TRI_ENVELOPE = { minLat: 54.05, maxLat: 54.7, minLon: 18.1, maxLon: 19.05 };

/**
 * Łódź: statyczny zrzut ZDiT (tramwaje + autobusy + linie zastępcze Z/R,
 * nocne N i podmiejskie). Ten sam wzorzec co Poznań: mirror
 * cdn.zbiorkom.live z poprawnymi nagłówkami do skipu buildu
 * (Last-Modified/ETag, odświeżany codziennie ok. 01:45 UTC).
 */
const LODZ_GTFS_URL = 'https://cdn.zbiorkom.live/gtfs/lodz.zip';
const LODZ_UA = { 'User-Agent': 'KilometrTimetableBot/1.0 (build; contact: dev@kilometr.local)' };

/**
 * Łódzka Kolej Aglomeracyjna: własny publiczny GTFS (linie Ł/ŁP/ŁS + ZKA
 * jako route_type 3, który jedzie w bazie jako autobus). Feed obejmuje całe
 * województwo (Sieradz–Skierniewice), więc do bazy trafiają tylko kursy
 * dotykające obwiedni aglomeracji (ten sam wzorzec co KM/KW), ale z pełną
 * geometrią (da się jechać za miasto). Numer pociągu to pierwszy token
 * trip_short_name przed "/" (np. "11572" z "11572/3").
 */
const LKA_GTFS_URL = 'https://cdn.zbiorkom.live/gtfs/pkp-lka.zip';
const LKA_UA = { 'User-Agent': 'KilometrTimetableBot/1.0 (build; contact: dev@kilometr.local)' };
/** Obwiednia aglomeracji: kurs ŁKA łapiemy, gdy ma choć jeden postój w środku. */
const LODZ_ENVELOPE = { minLat: 51.5, maxLat: 52.0, minLon: 19.0, maxLon: 19.9 };

/**
 * Szczecin: oficjalny stały link ZDiTM (tramwaje + autobusy + pospieszne
 * A–C i nocne 5xx, licencja CC0 1.0). W przeciwieństwie do Poznania i Łodzi
 * nie potrzebuje mirroru: serwer zwraca poprawne Last-Modified i ETag,
 * więc fingerprint i skip buildu działają wprost na źródle.
 */
const SZCZECIN_GTFS_URL = 'https://www.zditm.szczecin.pl/storage/gtfs/gtfs.zip';
const SZCZECIN_UA = { 'User-Agent': 'KilometrTimetableBot/1.0 (build; contact: dev@kilometr.local)' };

/**
 * Lublin: statyczny zrzut ZDiTM (autobusy + trolejbusy 150–162 jako
 * route_type 11 + nocne N1–N3). Ten sam wzorzec co Łódź: mirror
 * cdn.zbiorkom.live z poprawnymi nagłówkami do skipu buildu
 * (Last-Modified/ETag, odświeżany codziennie ok. 01:45 UTC).
 * Oryginał mkuran.pl/gtfs/lublin.zip trzymamy w komentarzu jako awaryjne
 * źródło (ten sam plik, licencja CC0 1.0).
 */
const LUBLIN_GTFS_URL = 'https://cdn.zbiorkom.live/gtfs/lublin.zip';
const LUBLIN_UA = { 'User-Agent': 'KilometrTimetableBot/1.0 (build; contact: dev@kilometr.local)' };

const PDP_BASE = process.env.PDP_BASE_URL || 'https://pdp-api.plk-sa.pl';
const KD_WINDOW_DAYS = 14; // ≤ 31 (limit API: dateTo - dateFrom)
const KD_CARRIER = 'KD';

const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const NOMINATIM_UA = 'KilometrTimetableBot/1.0 (contact: dev@kilometr.local)';
// Wrocław: minLon, maxLat, maxLon, minLat
const WRO_BBOX = { minLon: 16.7, maxLat: 51.25, maxLon: 17.25, minLat: 50.95 };

const ALLOW_MPK_ONLY = args.has('--allow-mpk-only') || process.env.ALLOW_MPK_ONLY === '1';
/**
 * Realne KD jest DOMYŚLNIE wymagane we Wrocławiu: build bez KD albo
 * z niepełnym KD kończy się błędem, żeby do R2 (a więc i do APK) nigdy nie
 * trafiła baza MPK-only ani atrapa. Jedyny świadomy wyjątek to jawne
 * --allow-mpk-only (lokalne testy / diagnostyka), które nigdy nie leci w cronie.
 * Kraków nie ma sekcji KD wcale (małopolskie koleje siedzą w GTFS ZTP).
 */
const PDP_API_KEY = process.env.PDP_API_KEY || '';
const PUBLIC_URL = (process.env.TIMETABLE_PUBLIC_URL || '').replace(/\/$/, '');

const log = (...m) => console.log('[build]', ...m);
const warn = (...m) => console.warn('[build] WARNING:', ...m);

/* ─── CSV (quote-aware, jak src/gtfs/csv.ts) ─────────────────────────── */

function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q;
    } else if (c === ',' && !q) { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

function splitHeader(content) {
  const nl = content.indexOf('\n');
  let header = content.slice(0, nl === -1 ? undefined : nl);
  if (header.charCodeAt(0) === 0xfeff) header = header.slice(1);
  return { header: parseCsvLine(header.replace(/\r$/, '')), bodyPos: nl === -1 ? content.length : nl + 1 };
}

/** Iteruje wiersze bez rozcinania całości na tablicę (stop_times ~46 MB). */
function eachRow(content, fn) {
  const { header, bodyPos } = splitHeader(content);
  const idx = Object.fromEntries(header.map((h, i) => [h.trim(), i]));
  let pos = bodyPos;
  const len = content.length;
  let n = 0;
  while (pos < len) {
    let nl = content.indexOf('\n', pos);
    if (nl === -1) nl = len;
    let line = content.slice(pos, nl);
    pos = nl + 1;
    if (line.endsWith('\r')) line = line.slice(0, -1);
    if (!line.trim()) continue;
    fn(parseCsvLine(line), idx);
    n++;
  }
  return { idx, rows: n };
}

function normalizePolish(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l').replace(/Ł/g, 'l').trim();
}

/** 'WROCŁAW GŁÓWNY' → 'Wrocław Główny' (PDP zwraca nazwy caps-lockiem). */
function titleCasePl(s) {
  return String(s || '').toLowerCase().replace(/(^|[\s\-/()])([a-ząćęłńóśźż])/g, (m, pre, ch) => pre + ch.toUpperCase());
}

/**
 * Słownik stacji z odpowiedzi schedules: `dc.st` = { "60103": "Wrocław Główny" }
 * (ten sam kształt co `st` w /operations). Akceptujemy też `dc.stations`
 * i wartości-obiekty { nm | name }, bo PDP nie ma publicznego schematu `dc`.
 */
function stationNamesFromDict(dc) {
  const out = {};
  const raw = dc?.st || dc?.stations || {};
  for (const [id, v] of Object.entries(raw)) {
    const name = typeof v === 'string' ? v : (v?.nm || v?.name || '');
    if (name) out[id] = titleCasePl(name);
  }
  return out;
}

/**
 * Czas postoju z pól PDP (atm = przyjazd, dtm = odjazd, ady/ddy = przesunięcie
 * dnia). Stacja końcowa ma tylko jedną godzinę, więc brakującą bierzemy z
 * drugiej razem z jej dniem. Brak obu godzin = postój nieużywalny.
 */
function stopTimesOf(s) {
  const arrHms = s.atm ?? s.arrivalTime;
  const depHms = s.dtm ?? s.departureTime;
  if (!arrHms && !depHms) return null;
  const arr = arrHms ? hmsToSec(arrHms) + (Number(s.ady ?? s.arrivalDay) || 0) * 86400 : null;
  const dep = depHms ? hmsToSec(depHms) + (Number(s.ddy ?? s.departureDay) || 0) * 86400 : null;
  return { arr: arr ?? dep, dep: dep ?? arr };
}

function haversineM(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Przesiadki MPK<->KD (te same stałe co store.ts w aplikacji).
const INTERCHANGE_RADIUS_M = 600;
const INTERCHANGE_MIN_SEC = 120;
const IX_WALK_DETOUR = 1.15;
const IX_WALK_SPEED_MPS = 1.45;
/** Dworzec Główny: słupek jest ciutkę dalej od peronów (hala + schody),
 *  więc gwarantujemy link z zapasem, nawet spoza standardowego promienia. */
const GLOWNY_OVERRIDE_SEC = 600;
const GLOWNY_OVERRIDE_RADIUS_M = 1500;

function hmsToSec(hms) {
  const p = String(hms || '00:00:00').trim().split(':');
  return (Number(p[0]) || 0) * 3600 + (Number(p[1]) || 0) * 60 + (Number(p[2]) || 0);
}

function ymdCompact(iso) {
  return iso.replace(/-/g, '');
}

function isoDaysFromNow(offset) {
  const d = new Date(Date.now() + offset * 86400000);
  return d.toISOString().slice(0, 10);
}

/* ─── HTTP ────────────────────────────────────────────────────────────── */

async function fetchJson(url, headers = {}, timeoutMs = 30000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} @ ${url}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

async function fetchBuffer(url, headers = {}, timeoutMs = 120000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} @ ${url}`);
    return Buffer.from(await res.arrayBuffer());
  } finally {
    clearTimeout(t);
  }
}

/** Tani fingerprint feedu (do skipu buildu): Last-Modified albo ETag. */
async function headVersion(url, headers = {}) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15000);
    try {
      const res = await fetch(url, { method: 'HEAD', headers, signal: ctrl.signal });
      if (!res.ok) return '';
      return res.headers.get('last-modified') || res.headers.get('etag') || '';
    } finally {
      clearTimeout(t);
    }
  } catch {
    return '';
  }
}

/* ─── Schemat bazy — MUSI odpowiadać src/services/gtfsDatabase.ts ───────
 * (CREATE TABLE IF NOT EXISTS w aplikacji, więc prebuilt musi tworzyć
 * te same kolumny; kolumna weight liczona w buildzie). */

const SCHEMA_SQL = `
PRAGMA journal_mode = DELETE;
CREATE TABLE stops (
  stop_id TEXT PRIMARY KEY NOT NULL,
  code TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  lat REAL NOT NULL,
  lon REAL NOT NULL,
  norm TEXT NOT NULL,
  weight INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_stops_latlon ON stops (lat, lon);
CREATE INDEX idx_stops_norm ON stops (norm);
CREATE INDEX idx_stops_weight ON stops (weight DESC);
CREATE TABLE routes (
  route_id TEXT PRIMARY KEY NOT NULL,
  short TEXT NOT NULL,
  long_name TEXT NOT NULL DEFAULT '',
  type INTEGER NOT NULL DEFAULT 3
);
CREATE INDEX idx_routes_short ON routes (short);
CREATE TABLE trips (
  trip_id TEXT PRIMARY KEY NOT NULL,
  route_id TEXT NOT NULL,
  service_id TEXT NOT NULL,
  headsign TEXT NOT NULL DEFAULT '',
  direction INTEGER NOT NULL DEFAULT 0,
  shape TEXT NOT NULL DEFAULT ''
);
CREATE INDEX idx_trips_route ON trips (route_id);
CREATE INDEX idx_trips_service ON trips (service_id);
CREATE TABLE stop_times (
  trip_id TEXT NOT NULL,
  stop_id TEXT NOT NULL,
  arr_sec INTEGER NOT NULL,
  dep_sec INTEGER NOT NULL,
  seq INTEGER NOT NULL,
  PRIMARY KEY (trip_id, seq)
) WITHOUT ROWID;
CREATE TABLE calendar (
  service_id TEXT PRIMARY KEY NOT NULL,
  mon INTEGER NOT NULL DEFAULT 0,
  tue INTEGER NOT NULL DEFAULT 0,
  wed INTEGER NOT NULL DEFAULT 0,
  thu INTEGER NOT NULL DEFAULT 0,
  fri INTEGER NOT NULL DEFAULT 0,
  sat INTEGER NOT NULL DEFAULT 0,
  sun INTEGER NOT NULL DEFAULT 0,
  start_date TEXT NOT NULL DEFAULT '',
  end_date TEXT NOT NULL DEFAULT ''
);
CREATE TABLE calendar_dates (
  service_id TEXT NOT NULL,
  date TEXT NOT NULL,
  exc INTEGER NOT NULL
);
CREATE INDEX idx_caldate_date ON calendar_dates (date);
/* Przesiadki MPK<->KD liczone w buildzie (stacja kolejowa to nie słupek:
   dojście na peron, schody, hala — patrz INTERCHANGE_* niżej). Aplikacja
   dokleja je do footpaths przy starcie (loadInterchanges). */
CREATE TABLE interchanges (
  from_stop_id TEXT NOT NULL,
  to_stop_id TEXT NOT NULL,
  walk_sec INTEGER NOT NULL,
  kind TEXT NOT NULL DEFAULT 'mpk-kd'
);
CREATE INDEX idx_interchanges_from ON interchanges (from_stop_id);
CREATE TABLE meta (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
CREATE TABLE pois (
  osm_id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL DEFAULT 'place',
  category TEXT NOT NULL DEFAULT 'place',
  name TEXT NOT NULL,
  norm_name TEXT NOT NULL,
  address TEXT NOT NULL DEFAULT '',
  lat REAL NOT NULL,
  lon REAL NOT NULL,
  street TEXT,
  district TEXT
);
CREATE INDEX idx_pois_norm ON pois (norm_name);
`;

/* ─── MPK: discovery ──────────────────────────────────────────────────── */

function parseEffectiveDate(name) {
  const m = /(\d{2})(\d{2})(\d{4})(?!\d)/.exec(name || '');
  if (!m) return null;
  return Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
}

function fmtDateUTC(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

async function discoverMpk() {
  try {
    const cat = await fetchJson(MPK_CATALOGUE, { Accept: 'application/json' }, 15000);
    const ids = Array.isArray(cat.pliki) ? cat.pliki.slice(0, 5) : [];
    const now = Date.now();
    const cands = [];
    for (const id of ids) {
      const url = `${MPK_DOWNLOAD_BASE}/${id}/`;
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 8000);
        let filename = '';
        try {
          const head = await fetch(url, { method: 'HEAD', headers: MPK_UA, signal: ctrl.signal });
          const disp = head.headers.get('content-disposition') || '';
          const mm = /filename="?([^"]+)"?/.exec(disp);
          filename = mm ? mm[1] : '';
        } finally {
          clearTimeout(t);
        }
        cands.push({ id, url, filename, eff: parseEffectiveDate(filename) || 0 });
      } catch { /* pojedynczy kandydat może odpaść */ }
    }
    const inForce = cands.filter((c) => c.eff && c.eff <= now).sort((a, b) => b.eff - a.eff);
    if (inForce.length > 0) return { ...inForce[0], effectiveDate: fmtDateUTC(inForce[0].eff) };
    if (cands.length > 0) return { ...cands[0], effectiveDate: cands[0].eff ? fmtDateUTC(cands[0].eff) : 'unknown' };
  } catch (e) {
    warn('MPK discovery failed, fallback:', String(e));
  }
  return { id: 136, url: MPK_FALLBACK_URL, filename: '', effectiveDate: 'unknown' };
}

/**
 * Eksporty dzienne ZTM z CKAN: wszystkie ZIP-y datasetu posortowane po
 * dacie utworzenia (jak mirror TransportGZM-GTFS). Razem pokrywają ~14 dni;
 * każdy dostaje własny prefiks GZM:{i}, bo ten sam service_id/trip_id
 * występuje w kilku eksportach z innym zakresem dat.
 */
async function discoverGzmExports() {
  const pkg = await fetchJson(GZM_CKAN_PACKAGE, { Accept: 'application/json', ...GZM_UA }, 30000);
  const resources = Array.isArray(pkg?.result?.resources) ? pkg.result.resources : [];
  const zips = resources
    .filter((r) => (r.format || '').toUpperCase() === 'ZIP' || /\.zip$/i.test(r.name || ''))
    .filter((r) => r.url)
    .sort((a, b) => (String(a.created || '') < String(b.created || '') ? -1 : 1));
  return zips.map((r, i) => ({
    label: `ZTM-${i}`,
    url: r.url,
    prefix: `GZM:${i}`,
    name: r.name || '',
    lastModified: r.last_modified || r.created || '',
  }));
}

/** YYYYMMDD -> Date UTC (bez strefy, kalendarz GTFS to daty lokalne). */
function ymdToDate(s) {
  return new Date(Date.UTC(Number(s.slice(0, 4)), Number(s.slice(4, 6)) - 1, Number(s.slice(6, 8))));
}

/** yyyymmdd z Date UTC. */
function dateToYmd(d) {
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
}

/**
 * Zwarty import eksportów dziennych ZTM (tylko GZM).
 *
 * Eksporty pokrywają rozłączne zakresy dat, ale trip_id się powtarzają
 * (ten sam kurs w różnych dniach). Zwykły merge prefiksami dałby ~4,4 mln
 * wierszy stop_times (~390 MB bazy). Tutaj: jeden wiersz kursu na trip_id
 * z sumą dat ze wszystkich eksportów (serwis scalony przez calendar_dates),
 * więc baza ląduje w okolicy ~130 MB. Kurs, którego czasy zmieniono
 * w trakcie okna, dostaje osobny wariant z sufiksem (poprawność > rozmiar).
 */
function importGzmMerged(db, txtDirs, readers, counts, cityStops, cityStopIds) {
  // 1. Kalendarze -> konkretne daty per (eksport, serwis).
  const serviceDates = new Map(); // `${i}:${sid}` -> Set<yyyymmdd>
  for (let fi = 0; fi < txtDirs.length; fi++) {
    const readTxt = readers[fi];
    const calTxt = readTxt('calendar.txt');
    if (calTxt) {
      eachRow(calTxt, (c, idx) => {
        const sid = (c[idx.service_id] || '').trim();
        const start = (c[idx.start_date] || '').trim();
        const end = (c[idx.end_date] || '').trim();
        if (!sid || start.length !== 8 || end.length !== 8) return;
        const flags = [
          Number(c[idx.sunday]) || 0, Number(c[idx.monday]) || 0, Number(c[idx.tuesday]) || 0,
          Number(c[idx.wednesday]) || 0, Number(c[idx.thursday]) || 0, Number(c[idx.friday]) || 0,
          Number(c[idx.saturday]) || 0,
        ];
        const set = new Set();
        for (let d = ymdToDate(start); dateToYmd(d) <= end; d = new Date(d.getTime() + 86400000)) {
          if (flags[d.getUTCDay()]) set.add(dateToYmd(d));
        }
        serviceDates.set(`${fi}:${sid}`, set);
      });
    }
    const calDatesTxt = readTxt('calendar_dates.txt');
    if (calDatesTxt) {
      eachRow(calDatesTxt, (c, idx) => {
        const sid = (c[idx.service_id] || '').trim();
        const date = (c[idx.date] || '').trim();
        const exc = Number(c[idx.exception_type]) || 0;
        if (!sid || date.length !== 8) return;
        const key = `${fi}:${sid}`;
        if (!serviceDates.has(key)) serviceDates.set(key, new Set());
        if (exc === 1) serviceDates.get(key).add(date);
        else if (exc === 2) serviceDates.get(key).delete(date);
      });
    }
  }

  // 2. Przystanki i linie bez prefiksów (REPLACE deduplikuje między eksportami).
  for (let fi = 0; fi < txtDirs.length; fi++) {
    const readTxt = readers[fi];
    const stopsTxt = readTxt('stops.txt');
    if (!stopsTxt) throw new Error(`ZIP ${txtDirs[fi].label} bez stops.txt, przerywam (nie nadpisuję R2 pustką).`);
    const ins = db.prepare('INSERT OR REPLACE INTO stops (stop_id, code, name, lat, lon, norm) VALUES (?, ?, ?, ?, ?, ?)');
    db.exec('BEGIN');
    eachRow(stopsTxt, (c, idx) => {
      const id = (c[idx.stop_id] || '').trim();
      const name = (c[idx.stop_name] || '').trim();
      if (!id || !name) return;
      const lat = Number(c[idx.stop_lat]) || 0;
      const lon = Number(c[idx.stop_lon]) || 0;
      const norm = normalizePolish(name);
      ins.run(id, (c[idx.stop_code] || '').trim(), name, lat, lon, norm);
      if (lat && lon && !cityStopIds.has(id)) {
        cityStopIds.add(id);
        cityStops.push({ id, norm, lat, lon });
      }
      counts.stops++;
    });
    db.exec('COMMIT');
    const routesTxt = readTxt('routes.txt');
    if (routesTxt) {
      const insR = db.prepare('INSERT OR REPLACE INTO routes (route_id, short, long_name, type) VALUES (?, ?, ?, ?)');
      db.exec('BEGIN');
      eachRow(routesTxt, (c, idx) => {
        const id = (c[idx.route_id] || '').trim();
        if (!id) return;
        const raw = (c[idx.route_type] || '').trim();
        const num = raw !== '' && !isNaN(Number(raw)) ? Number(raw) : 3;
        insR.run(id, (c[idx.route_short_name] || '').trim() || id, (c[idx.route_long_name] || '').trim(), num);
        counts.routes++;
      });
      db.exec('COMMIT');
    }
  }

  // 3. Wystąpienia kursów per eksport (daty z kalendarza tego eksportu).
  const occ = new Map(); // tid -> Array<{route, headsign, direction, shape, dates:Set}>
  let skippedNoService = 0;
  for (let fi = 0; fi < txtDirs.length; fi++) {
    const tripsTxt = readers[fi]('trips.txt');
    if (!tripsTxt) throw new Error(`ZIP ${txtDirs[fi].label} bez trips.txt, przerywam.`);
    eachRow(tripsTxt, (c, idx) => {
      const tid = (c[idx.trip_id] || '').trim();
      const rid = (c[idx.route_id] || '').trim();
      const sid = (c[idx.service_id] || '').trim();
      if (!tid || !rid || !sid) return;
      const dates = serviceDates.get(`${fi}:${sid}`);
      if (!dates || dates.size === 0) { skippedNoService++; return; }
      if (!occ.has(tid)) occ.set(tid, []);
      occ.get(tid).push({
        fi,
        route: rid,
        headsign: (c[idx.trip_headsign] || '').trim(),
        direction: Number(c[idx.direction_id]) || 0,
        shape: (c[idx.shape_id] || '').trim(),
        dates,
      });
    });
  }
  if (skippedNoService > 0) log(`GZM: pominięto ${skippedNoService} kursów bez dat serwisu`);

  // 4. Warianty: ten sam trip_id o różnych czasach w różnych eksportach
  // (zmiana rozkładu w trakcie okna) nie może dzielić jednego wiersza.
  // Sygnatura to pełny odcisk treści (stop_id, godziny, kolejność), nie tylko
  // liczba postojów i końce: zmiana czasów pośrednich też musi dać nowy wariant.
  // Warianty kluczujemy po sygnaturze (nie po numerze eksportu), żeby ten sam
  // rozkład z dwóch eksportów nie trafił do dwóch osobnych wariantów.
  const kept = new Map(); // klucz wiersza -> {sig, dates:Set, data}
  const variants = new Map(); // tid -> Map<sig, klucz wiersza>
  let divergent = 0;
  for (let fi = 0; fi < txtDirs.length; fi++) {
    const stTxt = readers[fi]('stop_times.txt');
    if (!stTxt) throw new Error(`ZIP ${txtDirs[fi].label} bez stop_times.txt, przerywam.`);
    const byTrip = parseStopTimesByTrip(stTxt);
    for (const [tid, rows] of byTrip) {
      if (!occ.has(tid)) continue;
      const sig = hashTripRows(rows);
      const list = occ.get(tid);
      const o = list.find((e) => e.fi === fi) ?? list[0];
      let bySig = variants.get(tid);
      if (!bySig) { bySig = new Map(); variants.set(tid, bySig); }
      const known = bySig.get(sig);
      if (known) {
        for (const d of o.dates) kept.get(known).dates.add(d);
        continue;
      }
      // Pierwszy wariant trzyma oryginalny trip_id (live dopina się po numerze),
      // kolejne dostają sufiks. Numerujemy po liczbie wariantów, nie po eksporcie.
      const key = bySig.size === 0 ? tid : `${tid}#G${bySig.size}`;
      bySig.set(sig, key);
      kept.set(key, { sig, dates: new Set(o.dates), data: o });
      if (bySig.size > 1) divergent++;
    }
  }
  if (divergent > 0) log(`GZM: ${divergent} kursów ze zmienionym rozkładem w trakcie okna (osobne warianty)`);

  // 5. Serwisy scalone: jeden serwis na unikalny zbiór dat (zwykle kilka
  // wzorców: robocze/soboty/niedziele). Daty dopisujemy przez
  // calendar_dates, więc getActiveServices działa bez zmian.
  const svcByDates = new Map(); // klucz dat -> service_id
  const insCal = db.prepare('INSERT OR REPLACE INTO calendar (service_id, mon, tue, wed, thu, fri, sat, sun, start_date, end_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const insCalDate = db.prepare('INSERT INTO calendar_dates (service_id, date, exc) VALUES (?, ?, ?)');
  const insTrip = db.prepare('INSERT OR REPLACE INTO trips (trip_id, route_id, service_id, headsign, direction, shape) VALUES (?, ?, ?, ?, ?, ?)');
  db.exec('BEGIN');
  for (const [key, k] of kept) {
    const sorted = [...k.dates].sort();
    const dkey = sorted.join(',');
    let svc = svcByDates.get(dkey);
    if (!svc) {
      svc = `GZM:SVC:${svcByDates.size}`;
      svcByDates.set(dkey, svc);
      insCal.run(svc, 0, 0, 0, 0, 0, 0, 0, sorted[0] ?? '', sorted[sorted.length - 1] ?? '');
      for (const d of sorted) insCalDate.run(svc, d, 1);
    }
    insTrip.run(key, k.data.route, svc, k.data.headsign, k.data.direction, k.data.shape);
    counts.trips++;
  }
  db.exec('COMMIT');
  log(`GZM: kursów po scaleniu=${kept.size} (serwisów=${svcByDates.size})`);

  // 6. Czasy: drugi przebieg po stop_times, tylko dla trzymanych wariantów.
  // Ten sam wariant kursu powtarza się w kilku eksportach, więc wiersze
  // wstawiamy raz (klucz = wariant z fazy 4, dobrany po pełnej sygnaturze).
  const ins = db.prepare('INSERT INTO stop_times (trip_id, stop_id, arr_sec, dep_sec, seq) VALUES (?, ?, ?, ?, ?)');
  db.exec('BEGIN');
  let batch = 0;
  const inserted = new Set();
  for (let fi = 0; fi < txtDirs.length; fi++) {
    const stTxt = readers[fi]('stop_times.txt');
    if (!stTxt) throw new Error(`ZIP ${txtDirs[fi].label} bez stop_times.txt, przerywam.`);
    const byTrip = parseStopTimesByTrip(stTxt);
    for (const [tid, rows] of byTrip) {
      const bySig = variants.get(tid);
      if (!bySig) continue;
      const key = bySig.get(hashTripRows(rows));
      if (!key || inserted.has(key)) continue;
      inserted.add(key);
      for (const r of rows) {
        ins.run(key, r[0], r[1], r[2], r[3]);
        counts.stopTimes++;
        if (++batch >= 50000) { db.exec('COMMIT'); db.exec('BEGIN'); batch = 0; }
      }
    }
  }
  db.exec('COMMIT');
  log(`GZM: stopTimes po scaleniu=${counts.stopTimes}`);
}

/**
 * Wiersze stop_times pogrupowane po kursie: tid -> [[stop_id, arrSec, depSec, seq]],
 * posortowane po seq. Jeden odczyt na eksport; używa go faza wariantów i faza
 * wstawiania czasów, więc obie liczą sygnaturę z tych samych danych.
 */
function parseStopTimesByTrip(stTxt) {
  const { header } = splitHeader(stTxt);
  const ti = header.indexOf('trip_id'), ai = header.indexOf('arrival_time'),
    di = header.indexOf('departure_time'), si = header.indexOf('stop_id'), qi = header.indexOf('stop_sequence');
  const byTrip = new Map();
  let pos = stTxt.indexOf('\n') + 1;
  const len = stTxt.length;
  while (pos < len) {
    let nl = stTxt.indexOf('\n', pos);
    if (nl === -1) nl = len;
    let line = stTxt.slice(pos, nl);
    pos = nl + 1;
    if (line.endsWith('\r')) line = line.slice(0, -1);
    if (!line.trim()) continue;
    const c = line.split(',');
    const tid = (c[ti] || '').trim();
    if (!tid) continue;
    const arr = (c[ai] || '').trim() || '00:00:00';
    if (!byTrip.has(tid)) byTrip.set(tid, []);
    byTrip.get(tid).push([(c[si] || '').trim(), hmsToSec(arr), hmsToSec((c[di] || '').trim() || arr), Number(c[qi]) || 0]);
  }
  for (const rows of byTrip.values()) rows.sort((a, b) => a[3] - b[3]);
  return byTrip;
}

/** Pełny odcisk treści kursu (stop, godziny, kolejność). Ta sama funkcja dla
 *  obu przebiegów, więc identyczne kursy dają identyczny hash, a każda zmiana
 *  (także czasów pośrednich) daje inny. */
function hashTripRows(rows) {
  const h = createHash('sha1');
  for (const r of rows) h.update(`${r[3]}\t${r[0]}\t${r[1]}\t${r[2]};`);
  return h.digest('hex').slice(0, 16);
}

/**
 * Strumieniowe bloki stop_times: tid -> [[stop_id, arrSec, depSec, seq]].
 * Cały plik (Warszawa: ~550 MB) nie wchodzi na raz do pamięci, więc czytamy
 * go kawałkami, a wiersze trzymamy tylko dla bieżącego kursu. Działa, bo
 * eksport grupuje wiersze po trip_id (zweryfikowane: bloki == unikalne tripy).
 * Plik nie ma cudzysłowów, więc szybki split po przecinku wystarcza.
 *
 * Cięcie idzie po BAJTACH (0x0A), a linie dekodujemy dopiero w całości:
 * dekodowanie każdego chunka osobno rozcięłoby wielobajtowy znak UTF-8
 * na granicy bufora i zamieniło go w U+FFFD.
 */
function streamTripBlocks(path, onBlock) {
  const size = statSync(path).size;
  const fd = openSync(path, 'r');
  const CHUNK = 32 * 1048576;
  const buf = Buffer.alloc(CHUNK);
  let rest = Buffer.alloc(0);
  let header = null;
  let ti = 0, si = 2, ai = 3, di = 4, qi = 1;
  let curTid = null;
  let curRows = [];
  const flush = () => {
    if (curTid !== null) onBlock(curTid, curRows);
    curTid = null;
    curRows = [];
  };
  const handleLine = (rawLine) => {
    let line = rawLine;
    if (line.endsWith('\r')) line = line.slice(0, -1);
    if (!line.trim()) return;
    if (header === null) {
      if (line.startsWith('\ufeff')) line = line.slice(1);
      if (line.startsWith('trip_id,')) {
        header = line.split(',');
        ti = header.indexOf('trip_id');
        si = header.indexOf('stop_id');
        ai = header.indexOf('arrival_time');
        di = header.indexOf('departure_time');
        qi = header.indexOf('stop_sequence');
        if (ti === -1 || si === -1 || ai === -1 || di === -1 || qi === -1) {
          throw new Error(`stop_times.txt bez wymaganych kolumn (trip_id/stop_id/arrival_time/departure_time/stop_sequence): ${header.join(',')}`);
        }
        return;
      }
    }
    const c = line.split(',');
    const tid = (c[ti] || '').trim();
    if (!tid) return;
    if (curTid !== null && tid !== curTid) flush();
    curTid = tid;
    const arr = (c[ai] || '').trim() || '00:00:00';
    curRows.push([(c[si] || '').trim(), hmsToSec(arr), hmsToSec((c[di] || '').trim() || arr), Number(c[qi]) || 0]);
  };
  try {
    let pos = 0;
    while (pos < size) {
      const n = readSync(fd, buf, 0, CHUNK, pos);
      if (n <= 0) break;
      pos += n;
      const chunk = buf.subarray(0, n);
      const combined = rest.length > 0 ? Buffer.concat([rest, chunk]) : chunk;
      let start = 0;
      for (let i = 0; i < combined.length; i++) {
        if (combined[i] !== 0x0a) continue;
        handleLine(combined.subarray(start, i).toString('utf8'));
        start = i + 1;
      }
      rest = Buffer.from(combined.subarray(start)); // kopia: buf jest reużywany
    }
    if (rest.length > 0) handleLine(rest.toString('utf8'));
    flush();
  } finally {
    closeSync(fd);
  }
}

/**
 * Kolej ze statycznego GTFS (KM z polish_trains.zip, WKD z wkd.zip; ten sam
 * wzorzec co KMŁ/KŚ). Trasy grupujemy po numerze pociągu (pierwszy token
 * trip_short_name, sufiks wariantu `/n` odcięty): brygada z live (zbiorkom,
 * agencje KM/WKD) to goły numer. Kursy o tym samym rozkładzie w różne dni
 * scalają się w jeden wiersz z sumą dat (jak import WTP/GZM).
 *
 * o: { tag, dir, prefix, agency (filtr agency_id albo null = wszystko),
 *      trainNum(row, idx) -> numer, touchEnvelope (tylko kursy ze stacją
 *      w o.envelope, dla KM/KW), envelope (domyślnie WAW_ENVELOPE),
 *      counts, railGeo }
 */
function importStaticRailFeed(db, o) {
  const ENV = o.envelope ?? WAW_ENVELOPE;
  const readTxt = (n) => {
    try { return readFileSync(join(o.dir, n), 'utf8'); } catch { return null; }
  };
  const inEnv = (g) => g.lat >= ENV.minLat && g.lat <= ENV.maxLat &&
    g.lon >= ENV.minLon && g.lon <= ENV.maxLon;
  const stat = { stations: 0, routes: 0, trips: 0, stopTimes: 0, skippedNoNumber: 0, skippedNoService: 0, skippedOutside: 0 };

  const stopsTxt = readTxt('stops.txt');
  if (!stopsTxt) throw new Error(`${o.tag} bez stops.txt, przerywam (nie nadpisuję R2 pustką).`);
  // Feed SKM miesza caps-lock ("GDAŃSK GŁÓWNY") z Title Case; KML/KŚ
  // title-case'ują zawsze, więc opcja wyrównuje stacje do reszty UI.
  const nameOf = o.titleCase ? titleCasePl : (s) => s;
  const stopGeo = new Map();
  eachRow(stopsTxt, (c, idx) => {
    const id = (c[idx.stop_id] || '').trim();
    const name = (c[idx.stop_name] || '').trim();
    if (!id || !name) return;
    const lat = Number(c[idx.stop_lat]) || 0;
    const lon = Number(c[idx.stop_lon]) || 0;
    if (!lat || !lon) return;
    stopGeo.set(id, { name: nameOf(name), lat, lon });
  });

  const routesTxt = readTxt('routes.txt');
  if (!routesTxt) throw new Error(`${o.tag} bez routes.txt, przerywam.`);
  const routeIds = new Set();
  const routeTypeById = new Map();
  eachRow(routesTxt, (c, idx) => {
    const id = (c[idx.route_id] || '').trim();
    if (!id) return;
    if (o.agency && (c[idx.agency_id] || '').trim() !== o.agency) return;
    routeIds.add(id);
    const raw = (c[idx.route_type] || '').trim();
    // Typ z feedu: 2 = pociąg, 3 = ZKA (zastępcza komunikacja autobusowa).
    // Bez tego ZKA jechałaby w UI jako pociąg. Mapowanie niemal 1:1 jak
    // w aplikacji (route_type 3 = autobus), z domyślnym 2 dla śmieci.
    routeTypeById.set(id, raw !== '' && !isNaN(Number(raw)) ? Number(raw) : 2);
  });
  if (routeIds.size === 0) throw new Error(`${o.tag}: brak linii agencji ${o.agency || '(dowolnej)'}, przerywam.`);

  const serviceDates = new Map();
  const calDatesTxt = readTxt('calendar_dates.txt');
  if (!calDatesTxt) throw new Error(`${o.tag} bez calendar_dates.txt, przerywam.`);
  {
    const { header } = splitHeader(calDatesTxt);
    const dDate = header.indexOf('date'), dSid = header.indexOf('service_id'), dExc = header.indexOf('exception_type');
    if (dDate === -1 || dSid === -1) throw new Error(`${o.tag} calendar_dates.txt bez kolumn date/service_id, przerywam.`);
    let p = calDatesTxt.indexOf('\n') + 1;
    const len = calDatesTxt.length;
    while (p < len) {
      let nl = calDatesTxt.indexOf('\n', p);
      if (nl === -1) nl = len;
      let line = calDatesTxt.slice(p, nl);
      p = nl + 1;
      if (line.endsWith('\r')) line = line.slice(0, -1);
      if (!line.trim()) continue;
      const c = line.split(',');
      const sid = (c[dSid] || '').trim();
      const date = (c[dDate] || '').trim();
      const exc = Number(c[dExc ?? -1]) || 0;
      if (!sid || date.length !== 8) continue;
      if (!serviceDates.has(sid)) serviceDates.set(sid, new Set());
      if (exc === 1) serviceDates.get(sid).add(date);
      else if (exc === 2) serviceDates.get(sid).delete(date);
    }
  }

  const tripsTxt = readTxt('trips.txt');
  if (!tripsTxt) throw new Error(`${o.tag} bez trips.txt, przerywam.`);
  const occ = new Map();
  eachRow(tripsTxt, (c, idx) => {
    const tid = (c[idx.trip_id] || '').trim();
    const rid = (c[idx.route_id] || '').trim();
    const sid = (c[idx.service_id] || '').trim();
    if (!tid || !rid || !sid || !routeIds.has(rid)) return;
    const num = o.trainNum(c, idx);
    if (!num) { stat.skippedNoNumber++; return; }
    const dates = serviceDates.get(sid);
    if (!dates || dates.size === 0) { stat.skippedNoService++; return; }
    occ.set(tid, {
      num,
      headsign: (c[idx.trip_headsign] || '').trim(),
      direction: Number(c[idx.direction_id]) || 0,
      type: routeTypeById.get(rid) ?? 2,
      dates,
    });
  });

  const kept = new Map();
  const keyOf = new Map();
  const stPath = join(o.dir, 'stop_times.txt');
  streamTripBlocks(stPath, (tid, rows) => {
    const e = occ.get(tid);
    if (!e || rows.length < 2) return;
    if (o.touchEnvelope) {
      let touches = false;
      for (const r of rows) {
        const g = stopGeo.get(r[0]);
        if (g && inEnv(g)) { touches = true; break; }
      }
      if (!touches) { stat.skippedOutside++; return; }
    }
    const sig = hashTripRows(rows);
    const gkey = `${e.num}|${e.headsign}|${e.direction}|${sig}`;
    let key = keyOf.get(gkey);
    if (!key) {
      // Klucz z numeru pociągu i sygnatury czasów: stabilny między buildami
      // (identyczny kurs zachowuje trip_id), a unikalny także wtedy, gdy ten
      // sam numer jedzie różne warianty. Kolizja niemożliwa do wykluczenia
      // (ten sam numer, kierunek i czasy, inny headsign) dostaje sufiks.
      key = `${o.prefix}:T:${e.num}:${sig}`;
      for (let n = 2; kept.has(key); n++) key = `${o.prefix}:T:${e.num}:${sig}#${n}`;
      keyOf.set(gkey, key);
      kept.set(key, { dates: new Set(), data: e, rows });
    }
    for (const d of e.dates) kept.get(key).dates.add(d);
  });

  const insStop = db.prepare('INSERT OR REPLACE INTO stops (stop_id, code, name, lat, lon, norm) VALUES (?, ?, ?, ?, ?, ?)');
  const insRoute = db.prepare('INSERT OR REPLACE INTO routes (route_id, short, long_name, type) VALUES (?, ?, ?, ?)');
  const insTrip = db.prepare('INSERT OR REPLACE INTO trips (trip_id, route_id, service_id, headsign, direction, shape) VALUES (?, ?, ?, ?, ?, ?)');
  const insSt = db.prepare('INSERT INTO stop_times (trip_id, stop_id, arr_sec, dep_sec, seq) VALUES (?, ?, ?, ?, ?)');
  const insCal = db.prepare('INSERT OR REPLACE INTO calendar (service_id, mon, tue, wed, thu, fri, sat, sun, start_date, end_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const insCalDate = db.prepare('INSERT INTO calendar_dates (service_id, date, exc) VALUES (?, ?, ?)');
  db.exec('BEGIN');
  const usedStops = new Set();
  for (const k of kept.values()) for (const r of k.rows) usedStops.add(r[0]);
  for (const id of usedStops) {
    const g = stopGeo.get(id);
    if (!g) continue;
    const stopId = `${o.prefix}:S:${id}`;
    insStop.run(stopId, id, g.name, g.lat, g.lon, normalizePolish(g.name));
    o.railGeo.set(stopId, { stopId, name: g.name, lat: g.lat, lon: g.lon });
    o.counts.stops++;
    stat.stations++;
  }
  const svcByDates = new Map();
  const seenRoutes = new Set();
  for (const [key, k] of kept) {
    const sorted = [...k.dates].sort();
    const dkey = sorted.join(',');
    let svc = svcByDates.get(dkey);
    if (!svc) {
      svc = `${o.prefix}:SVC:${svcByDates.size}`;
      svcByDates.set(dkey, svc);
      insCal.run(svc, 0, 0, 0, 0, 0, 0, 0, sorted[0] ?? '', sorted[sorted.length - 1] ?? '');
      for (const d of sorted) insCalDate.run(svc, d, 1);
    }
    const routeId = `${o.prefix}:R:${k.data.num}`;
    if (!seenRoutes.has(routeId)) {
      const first = stopGeo.get(k.rows[0][0]);
      const last = stopGeo.get(k.rows[k.rows.length - 1][0]);
      insRoute.run(routeId, k.data.num, `${first?.name || ''} – ${last?.name || k.data.headsign}`, k.data.type ?? 2);
      seenRoutes.add(routeId);
      o.counts.routes++;
      stat.routes++;
    }
    insTrip.run(key, routeId, svc, k.data.headsign, k.data.direction, '');
    o.counts.trips++;
    stat.trips++;
    for (const r of k.rows) {
      insSt.run(key, `${o.prefix}:S:${r[0]}`, r[1], r[2], r[3]);
      o.counts.stopTimes++;
      stat.stopTimes++;
    }
  }
  db.exec('COMMIT');
  // Licznik stacji = faktyczne wiersze (użyte przystanki), nie kandydaci.
  try {
    stat.stations = db.prepare(`SELECT COUNT(*) AS n FROM stops WHERE stop_id LIKE '${o.prefix}:S:%'`).get().n;
  } catch {}
  log(`${o.tag}: stations=${stat.stations} routes=${stat.routes} trips=${stat.trips} stopTimes=${stat.stopTimes} (bez numeru=${stat.skippedNoNumber} bez dat=${stat.skippedNoService} poza obwiednią=${stat.skippedOutside})`);
  return stat;
}

/**
 * Zwarty import Warszawy (tylko WAW).
 *
 * Feed WTP to eksport dzienny: każdy dzień ma własne trip_id z datą
 * (`2026-10-13:102:…`), więc prosty import dałby ~285 tys. kursów i ~8 mln
 * wierszy stop_times (baza grubo ponad limit 300 MB na obiekt w R2).
 * Kursy grupujemy po sygnaturze (linia + kierunek + pełne czasy, ten sam
 * wzorzec co warianty GZM): jeden wiersz kursu na unikalny rozkład z sumą
 * dat ze wszystkich dni (serwis scalony przez calendar_dates).
 * Metro M1/M2 jeździ na frequencies.txt (same szablony z czasami względnymi
 * od 00:00), więc najpierw rozwijamy headwaye na konkretne odjazdy;
 * szablony bez rozwinięcia nie trafiają do bazy.
 */
function importWawCompact(db, txtDir, counts, cityStops, cityStopIds) {
  const readTxt = (n) => {
    try { return readFileSync(join(txtDir, n), 'utf8'); } catch { return null; }
  };
  const stPath = join(txtDir, 'stop_times.txt');
  try {
    if (!statSync(stPath).isFile()) throw new Error('x');
  } catch {
    throw new Error('WTP bez stop_times.txt, przerywam (nie nadpisuję R2 pustką).');
  }
  // 1. Daty serwisów wyłącznie z calendar_dates.txt (feed nie ma calendar.txt).
  const serviceDates = new Map(); // sid -> Set<yyyymmdd>
  const calDatesTxt = readTxt('calendar_dates.txt');
  if (!calDatesTxt) throw new Error('WTP bez calendar_dates.txt, przerywam (nie nadpisuję R2 pustką).');
  // Format WTP: nagłówek date,service_id,exception_type (odwrotnie niż GTFS!).
  const { header: cdHead } = splitHeader(calDatesTxt);
  const dDate = cdHead.indexOf('date'), dSid = cdHead.indexOf('service_id'), dExc = cdHead.indexOf('exception_type');
  if (dDate === -1 || dSid === -1) throw new Error('WTP calendar_dates.txt bez kolumn date/service_id, przerywam.');
  let pos0 = calDatesTxt.indexOf('\n') + 1;
  {
    const len = calDatesTxt.length;
    let p = pos0;
    while (p < len) {
      let nl = calDatesTxt.indexOf('\n', p);
      if (nl === -1) nl = len;
      let line = calDatesTxt.slice(p, nl);
      p = nl + 1;
      if (line.endsWith('\r')) line = line.slice(0, -1);
      if (!line.trim()) continue;
      const c = line.split(',');
      const sid = (c[dSid] || '').trim();
      const date = (c[dDate] || '').trim();
      const exc = Number(c[dExc ?? -1]) || 0;
      if (!sid || date.length !== 8) continue;
      if (!serviceDates.has(sid)) serviceDates.set(sid, new Set());
      if (exc === 1) serviceDates.get(sid).add(date);
      else if (exc === 2) serviceDates.get(sid).delete(date);
    }
  }

  // 2. Przystanki i linie.
  const stopsTxt = readTxt('stops.txt');
  if (!stopsTxt) throw new Error('WTP bez stops.txt, przerywam (nie nadpisuję R2 pustką).');
  {
    const ins = db.prepare('INSERT OR REPLACE INTO stops (stop_id, code, name, lat, lon, norm) VALUES (?, ?, ?, ?, ?, ?)');
    db.exec('BEGIN');
    eachRow(stopsTxt, (c, idx) => {
      const id = (c[idx.stop_id] || '').trim();
      const name = (c[idx.stop_name] || '').trim();
      if (!id || !name) return;
      const lat = Number(c[idx.stop_lat]) || 0;
      const lon = Number(c[idx.stop_lon]) || 0;
      ins.run(id, (c[idx.stop_code] || '').trim(), name, lat, lon, normalizePolish(name));
      if (lat && lon && !cityStopIds.has(id)) {
        cityStopIds.add(id);
        cityStops.push({ id, norm: normalizePolish(name), lat, lon });
      }
      counts.stops++;
    });
    db.exec('COMMIT');
  }
  const routesTxt = readTxt('routes.txt');
  if (!routesTxt) throw new Error('WTP bez routes.txt, przerywam.');
  const metroRoutes = new Set();
  {
    const ins = db.prepare('INSERT OR REPLACE INTO routes (route_id, short, long_name, type) VALUES (?, ?, ?, ?)');
    db.exec('BEGIN');
    eachRow(routesTxt, (c, idx) => {
      const id = (c[idx.route_id] || '').trim();
      if (!id) return;
      const raw = (c[idx.route_type] || '').trim();
      const num = raw !== '' && !isNaN(Number(raw)) ? Number(raw) : 3;
      if (num === 1) metroRoutes.add(id);
      ins.run(id, (c[idx.route_short_name] || '').trim() || id, (c[idx.route_long_name] || '').trim(), num);
      counts.routes++;
    });
    db.exec('COMMIT');
  }

  // 3. Kursy z trips.txt (31 MB wchodzi na raz do pamięci).
  const tripsTxt = readTxt('trips.txt');
  if (!tripsTxt) throw new Error('WTP bez trips.txt, przerywam.');
  const occ = new Map(); // tid -> {route, headsign, direction, shape, dates, metro}
  let skippedNoService = 0;
  eachRow(tripsTxt, (c, idx) => {
    const tid = (c[idx.trip_id] || '').trim();
    const rid = (c[idx.route_id] || '').trim();
    const sid = (c[idx.service_id] || '').trim();
    if (!tid || !rid || !sid) return;
    const dates = serviceDates.get(sid);
    if (!dates || dates.size === 0) { skippedNoService++; return; }
    occ.set(tid, {
      route: rid,
      headsign: (c[idx.trip_headsign] || '').trim(),
      direction: Number(c[idx.direction_id]) || 0,
      shape: (c[idx.shape_id] || '').trim(),
      dates,
      metro: metroRoutes.has(rid),
    });
  });
  if (skippedNoService > 0) log(`WAW: pominięto ${skippedNoService} kursów bez dat serwisu`);

  // 4. Jeden strumieniowy przebieg po stop_times.txt (~550 MB): sygnatura
  // kursu -> jeden wiersz na unikalny rozkład z sumą dat. Szablony metra
  // (czasy względne od 00:00) tylko zapamiętujemy, rozwija je krok 4b.
  const kept = new Map(); // klucz kursu -> {dates:Set, data, rows}
  const keyOf = new Map(); // sygnatura kursu -> klucz
  const tplRows = new Map(); // template tid -> wiersze względne
  const absorb = (o, rows) => {
    if (!rows || rows.length < 2) return;
    const sig = hashTripRows(rows);
    const gkey = `${o.route}|${o.headsign}|${o.direction}|${sig}`;
    let key = keyOf.get(gkey);
    if (!key) {
      // Klucz z trasy i sygnatury czasów, NIE z trip_id feedu: id WTP noszą
      // datę dnia (`2026-10-13:102:…`), więc ten sam kurs zmieniałby trip_id
      // przy każdym dziennym eksporcie, a przypięte trasy traciłyby kurs.
      // Sygnatura jest stabilna, dopóki rozkład się nie zmieni.
      key = `${o.route}:${sig}`;
      for (let n = 2; kept.has(key); n++) key = `${o.route}:${sig}#${n}`;
      keyOf.set(gkey, key);
      kept.set(key, { dates: new Set(), data: o, rows });
    }
    for (const d of o.dates) kept.get(key).dates.add(d);
  };
  streamTripBlocks(stPath, (tid, rows) => {
    const o = occ.get(tid);
    if (!o) return;
    if (o.metro) {
      if (rows.length >= 2 && !tplRows.has(tid)) tplRows.set(tid, rows);
      return;
    }
    absorb(o, rows);
  });
  log(`WAW: kursy po scaleniu=${kept.size} (szablony metra: ${tplRows.size})`);

  // 4b. Metro: szablon (czasy względne) x okna headwayów z frequencies.txt.
  // Odjazd D w oknie [start, end] co headway: czasy = D + offset szablonu.
  // Klucz kursu to sygnatura czasów, więc ten sam odjazd w różne dni scala
  // się w jeden wiersz jak zwykłe kursy.
  let metroTrips = 0;
  const freqTxt = readTxt('frequencies.txt');
  if (freqTxt) {
    const { header } = splitHeader(freqTxt);
    const fi = {
      tid: header.indexOf('trip_id'), start: header.indexOf('start_time'),
      end: header.indexOf('end_time'), head: header.indexOf('headway_secs'),
    };
    let p = freqTxt.indexOf('\n') + 1;
    const len = freqTxt.length;
    while (p < len) {
      let nl = freqTxt.indexOf('\n', p);
      if (nl === -1) nl = len;
      let line = freqTxt.slice(p, nl);
      p = nl + 1;
      if (line.endsWith('\r')) line = line.slice(0, -1);
      if (!line.trim()) continue;
      const c = line.split(',');
      const tpl = (c[fi.tid] || '').trim();
      const o = occ.get(tpl);
      const rows = tplRows.get(tpl);
      if (!o || !o.metro || !rows) continue;
      const start = hmsToSec((c[fi.start] || '').trim());
      const end = hmsToSec((c[fi.end] || '').trim());
      const head = Number(c[fi.head]) || 0;
      if (head <= 0 || end <= start) continue;
      for (let d = start; d <= end; d += head) {
        const sh = rows.map((r) => [r[0], r[1] + d, r[2] + d, r[3]]);
        absorb(o, sh);
        metroTrips++;
      }
    }
  }
  log(`WAW: odjazdy metra po rozwinięciu frequencies: ${metroTrips}`);

  // 5. Serwisy scalone po zbiorze dat (jak GZM).
  const svcByDates = new Map();
  const insCal = db.prepare('INSERT OR REPLACE INTO calendar (service_id, mon, tue, wed, thu, fri, sat, sun, start_date, end_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const insCalDate = db.prepare('INSERT INTO calendar_dates (service_id, date, exc) VALUES (?, ?, ?)');
  const insTrip = db.prepare('INSERT OR REPLACE INTO trips (trip_id, route_id, service_id, headsign, direction, shape) VALUES (?, ?, ?, ?, ?, ?)');
  db.exec('BEGIN');
  for (const [key, k] of kept) {
    const sorted = [...k.dates].sort();
    const dkey = sorted.join(',');
    let svc = svcByDates.get(dkey);
    if (!svc) {
      svc = `WAW:SVC:${svcByDates.size}`;
      svcByDates.set(dkey, svc);
      insCal.run(svc, 0, 0, 0, 0, 0, 0, 0, sorted[0] ?? '', sorted[sorted.length - 1] ?? '');
      for (const d of sorted) insCalDate.run(svc, d, 1);
    }
    insTrip.run(key, k.data.route, svc, k.data.headsign, k.data.direction, k.data.shape);
    counts.trips++;
  }
  db.exec('COMMIT');

  // 6. Czasy raz na trzymany kurs.
  const ins = db.prepare('INSERT INTO stop_times (trip_id, stop_id, arr_sec, dep_sec, seq) VALUES (?, ?, ?, ?, ?)');
  db.exec('BEGIN');
  let batch = 0;
  for (const [key, k] of kept) {
    for (const r of k.rows) {
      ins.run(key, r[0], r[1], r[2], r[3]);
      counts.stopTimes++;
      if (++batch >= 50000) { db.exec('COMMIT'); db.exec('BEGIN'); batch = 0; }
    }
  }
  db.exec('COMMIT');
  log(`WAW: stopTimes po scaleniu=${counts.stopTimes} (serwisów=${svcByDates.size})`);
}

/**
 * Zwarty import Gdańska (tylko trojmiasto).
 *
 * Feed ZTM Gdańsk to eksport dzienny jak WTP: każdy dzień ma własne trip_id
 * z datą w środku (`111202610141505_102_111-31`), kalendarz siedzi wyłącznie
 * w calendar_dates.txt, więc prosty import dałby ~95 tys. kursów i ~2,3 mln
 * wierszy stop_times. Kursy grupujemy po sygnaturze (linia + kierunek +
 * pełne czasy, ten sam wzorzec co Warszawa): jeden wiersz kursu na unikalny
 * rozkład z sumą dat ze wszystkich dni. Wszystkie id dostają prefiks GDA:
 * (ten sam wzorzec co feedy ZTP Krakowa), a rozszerzone typy feedu (900 =
 * tramwaj, 700 = autobus) sprowadzamy do kanonicznego GTFS (ten sam wzorzec
 * co Kraków). Feed nie ma frequencies.txt, więc nie ma czego rozwijać.
 */
function importGdaCompact(db, txtDir, counts, cityStops, cityStopIds) {
  const P = (id) => `GDA:${id}`;
  const readTxt = (n) => {
    try { return readFileSync(join(txtDir, n), 'utf8'); } catch { return null; }
  };
  const stPath = join(txtDir, 'stop_times.txt');
  try {
    if (!statSync(stPath).isFile()) throw new Error('x');
  } catch {
    throw new Error('GDA bez stop_times.txt, przerywam (nie nadpisuję R2 pustką).');
  }
  // 1. Daty serwisów wyłącznie z calendar_dates.txt (feed nie ma calendar.txt).
  const serviceDates = new Map(); // sid -> Set<yyyymmdd>
  const calDatesTxt = readTxt('calendar_dates.txt');
  if (!calDatesTxt) throw new Error('GDA bez calendar_dates.txt, przerywam (nie nadpisuję R2 pustką).');
  const { header: cdHead } = splitHeader(calDatesTxt);
  const dDate = cdHead.indexOf('date'), dSid = cdHead.indexOf('service_id'), dExc = cdHead.indexOf('exception_type');
  if (dDate === -1 || dSid === -1) throw new Error('GDA calendar_dates.txt bez kolumn date/service_id, przerywam.');
  let pos0 = calDatesTxt.indexOf('\n') + 1;
  {
    const len = calDatesTxt.length;
    let p = pos0;
    while (p < len) {
      let nl = calDatesTxt.indexOf('\n', p);
      if (nl === -1) nl = len;
      let line = calDatesTxt.slice(p, nl);
      p = nl + 1;
      if (line.endsWith('\r')) line = line.slice(0, -1);
      if (!line.trim()) continue;
      const c = line.split(',');
      const sid = (c[dSid] || '').trim();
      const date = (c[dDate] || '').trim();
      const exc = Number(c[dExc ?? -1]) || 0;
      if (!sid || date.length !== 8) continue;
      if (!serviceDates.has(sid)) serviceDates.set(sid, new Set());
      if (exc === 1) serviceDates.get(sid).add(date);
      else if (exc === 2) serviceDates.get(sid).delete(date);
    }
  }

  // 2. Przystanki i linie.
  const stopsTxt = readTxt('stops.txt');
  if (!stopsTxt) throw new Error('GDA bez stops.txt, przerywam (nie nadpisuję R2 pustką).');
  {
    const ins = db.prepare('INSERT OR REPLACE INTO stops (stop_id, code, name, lat, lon, norm) VALUES (?, ?, ?, ?, ?, ?)');
    db.exec('BEGIN');
    eachRow(stopsTxt, (c, idx) => {
      const id = (c[idx.stop_id] || '').trim();
      const name = (c[idx.stop_name] || '').trim();
      if (!id || !name) return;
      const lat = Number(c[idx.stop_lat]) || 0;
      const lon = Number(c[idx.stop_lon]) || 0;
      ins.run(P(id), (c[idx.stop_code] || '').trim(), name, lat, lon, normalizePolish(name));
      if (lat && lon && !cityStopIds.has(P(id))) {
        cityStopIds.add(P(id));
        cityStops.push({ id: P(id), norm: normalizePolish(name), lat, lon });
      }
      counts.stops++;
    });
    db.exec('COMMIT');
  }
  const routesTxt = readTxt('routes.txt');
  if (!routesTxt) throw new Error('GDA bez routes.txt, przerywam.');
  {
    const ins = db.prepare('INSERT OR REPLACE INTO routes (route_id, short, long_name, type) VALUES (?, ?, ?, ?)');
    db.exec('BEGIN');
    eachRow(routesTxt, (c, idx) => {
      const id = (c[idx.route_id] || '').trim();
      if (!id) return;
      const raw = (c[idx.route_type] || '').trim();
      let num = raw !== '' && !isNaN(Number(raw)) ? Number(raw) : 3;
      // Rozszerzone typy ZTM Gdańsk jak w Krakowie: 900 to tramwaj,
      // 700 to autobus. Bez tego filtry tramwaj/autobus nie działają.
      if (num === 900) num = 0;
      else if (num === 700) num = 3;
      ins.run(P(id), (c[idx.route_short_name] || '').trim() || P(id), (c[idx.route_long_name] || '').trim(), num);
      counts.routes++;
    });
    db.exec('COMMIT');
  }

  // 3. Kursy z trips.txt.
  const tripsTxt = readTxt('trips.txt');
  if (!tripsTxt) throw new Error('GDA bez trips.txt, przerywam.');
  const occ = new Map(); // tid -> {route, headsign, direction, shape, dates}
  let skippedNoService = 0;
  eachRow(tripsTxt, (c, idx) => {
    const tid = (c[idx.trip_id] || '').trim();
    const rid = (c[idx.route_id] || '').trim();
    const sid = (c[idx.service_id] || '').trim();
    if (!tid || !rid || !sid) return;
    const dates = serviceDates.get(sid);
    if (!dates || dates.size === 0) { skippedNoService++; return; }
    occ.set(tid, {
      route: P(rid),
      headsign: (c[idx.trip_headsign] || '').trim(),
      direction: Number(c[idx.direction_id]) || 0,
      shape: (c[idx.shape_id] || '').trim(),
      dates,
    });
  });
  if (skippedNoService > 0) log(`GDA: pominięto ${skippedNoService} kursów bez dat serwisu`);

  // 4. Jeden strumieniowy przebieg po stop_times.txt: sygnatura kursu ->
  // jeden wiersz na unikalny rozkład z sumą dat.
  const kept = new Map(); // klucz kursu -> {dates:Set, data, rows}
  const keyOf = new Map(); // sygnatura kursu -> klucz
  const absorb = (o, rows) => {
    if (!rows || rows.length < 2) return;
    const sig = hashTripRows(rows);
    const gkey = `${o.route}|${o.headsign}|${o.direction}|${sig}`;
    let key = keyOf.get(gkey);
    if (!key) {
      // Klucz z trasy i sygnatury czasów, NIE z trip_id feedu: id Gdańska
      // noszą datę dnia, więc ten sam kurs zmieniałby trip_id przy każdym
      // eksporcie, a przypięte trasy traciłyby kurs (ten sam powód co WAW).
      key = `${o.route}:${sig}`;
      for (let n = 2; kept.has(key); n++) key = `${o.route}:${sig}#${n}`;
      keyOf.set(gkey, key);
      kept.set(key, { dates: new Set(), data: o, rows });
    }
    for (const d of o.dates) kept.get(key).dates.add(d);
  };
  streamTripBlocks(stPath, (tid, rows) => {
    const o = occ.get(tid);
    if (!o) return;
    absorb(o, rows.map((r) => [P(r[0]), r[1], r[2], r[3]]));
  });
  log(`GDA: kursy po scaleniu=${kept.size}`);

  // 5. Serwisy scalone po zbiorze dat (jak WAW).
  const svcByDates = new Map();
  const insCal = db.prepare('INSERT OR REPLACE INTO calendar (service_id, mon, tue, wed, thu, fri, sat, sun, start_date, end_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const insCalDate = db.prepare('INSERT INTO calendar_dates (service_id, date, exc) VALUES (?, ?, ?)');
  const insTrip = db.prepare('INSERT OR REPLACE INTO trips (trip_id, route_id, service_id, headsign, direction, shape) VALUES (?, ?, ?, ?, ?, ?)');
  db.exec('BEGIN');
  for (const [key, k] of kept) {
    const sorted = [...k.dates].sort();
    const dkey = sorted.join(',');
    let svc = svcByDates.get(dkey);
    if (!svc) {
      svc = `GDA:SVC:${svcByDates.size}`;
      svcByDates.set(dkey, svc);
      insCal.run(svc, 0, 0, 0, 0, 0, 0, 0, sorted[0] ?? '', sorted[sorted.length - 1] ?? '');
      for (const d of sorted) insCalDate.run(svc, d, 1);
    }
    insTrip.run(key, k.data.route, svc, k.data.headsign, k.data.direction, k.data.shape);
    counts.trips++;
  }
  db.exec('COMMIT');

  // 6. Czasy raz na trzymany kurs.
  const ins = db.prepare('INSERT INTO stop_times (trip_id, stop_id, arr_sec, dep_sec, seq) VALUES (?, ?, ?, ?, ?)');
  db.exec('BEGIN');
  let batch = 0;
  for (const [key, k] of kept) {
    for (const r of k.rows) {
      ins.run(key, r[0], r[1], r[2], r[3]);
      counts.stopTimes++;
      if (++batch >= 50000) { db.exec('COMMIT'); db.exec('BEGIN'); batch = 0; }
    }
  }
  db.exec('COMMIT');
  log(`GDA: stopTimes po scaleniu=${counts.stopTimes} (serwisów=${svcByDates.size})`);
}

/**
 * Zwykły import Gdyni (tylko trojmiasto).
 *
 * Feed ZKM Gdynia to statyczny zrzut (zwykłe trip_id, kalendarz wyłącznie
 * w calendar_dates.txt), więc idzie generyczną ścieżką jak pojedynczy feed
 * w głównym imporcie. Wszystkie id dostają prefiks GDY:, a typy feedu
 * (700 = autobus, 800 = trolejbus) sprowadzamy do kanonicznego GTFS
 * (3 i 11), żeby klasyfikacja linii działała jak w reszcie miast.
 */
function importGdyniaGeneric(db, txtDir, counts, cityStops, cityStopIds) {
  const P = (id) => `GDY:${id}`;
  const readTxt = (n) => {
    try { return readFileSync(join(txtDir, n), 'utf8'); } catch { return null; }
  };
  const stopsTxt = readTxt('stops.txt');
  if (!stopsTxt) throw new Error('GDY bez stops.txt, przerywam (nie nadpisuję R2 pustką).');
  {
    const ins = db.prepare('INSERT OR REPLACE INTO stops (stop_id, code, name, lat, lon, norm) VALUES (?, ?, ?, ?, ?, ?)');
    db.exec('BEGIN');
    let i = 0;
    eachRow(stopsTxt, (c, idx) => {
      const id = (c[idx.stop_id] || '').trim();
      const name = (c[idx.stop_name] || '').trim();
      if (!id || !name) return;
      const lat = Number(c[idx.stop_lat]) || 0;
      const lon = Number(c[idx.stop_lon]) || 0;
      ins.run(P(id), (c[idx.stop_code] || '').trim(), name, lat, lon, normalizePolish(name));
      if (lat && lon && !cityStopIds.has(P(id))) {
        cityStopIds.add(P(id));
        cityStops.push({ id: P(id), norm: normalizePolish(name), lat, lon });
      }
      if (++i % 2000 === 0) { db.exec('COMMIT'); db.exec('BEGIN'); }
      counts.stops++;
    });
    db.exec('COMMIT');
  }
  const routesTxt = readTxt('routes.txt');
  if (routesTxt) {
    const ins = db.prepare('INSERT OR REPLACE INTO routes (route_id, short, long_name, type) VALUES (?, ?, ?, ?)');
    db.exec('BEGIN');
    eachRow(routesTxt, (c, idx) => {
      const id = (c[idx.route_id] || '').trim();
      if (!id) return;
      const raw = (c[idx.route_type] || '').trim();
      let num = raw !== '' && !isNaN(Number(raw)) ? Number(raw) : 3;
      if (num === 700) num = 3;
      else if (num === 800) num = 11;
      ins.run(P(id), (c[idx.route_short_name] || '').trim() || P(id), (c[idx.route_long_name] || '').trim(), num);
      counts.routes++;
    });
    db.exec('COMMIT');
  }
  const calTxt = readTxt('calendar.txt');
  if (calTxt) {
    const ins = db.prepare('INSERT OR REPLACE INTO calendar (service_id, mon, tue, wed, thu, fri, sat, sun, start_date, end_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    db.exec('BEGIN');
    eachRow(calTxt, (c, idx) => {
      const id = (c[idx.service_id] || '').trim();
      if (!id) return;
      ins.run(P(id), Number(c[idx.monday]) || 0, Number(c[idx.tuesday]) || 0, Number(c[idx.wednesday]) || 0,
        Number(c[idx.thursday]) || 0, Number(c[idx.friday]) || 0, Number(c[idx.saturday]) || 0, Number(c[idx.sunday]) || 0,
        (c[idx.start_date] || '').trim(), (c[idx.end_date] || '').trim());
    });
    db.exec('COMMIT');
  }
  const calDatesTxt = readTxt('calendar_dates.txt');
  if (calDatesTxt) {
    const rows = [];
    // Zakres dat per serwis: GDY nie ma calendar.txt, więc po wstawieniu
    // wyjątków dokładamy wiersz-placeholder do calendar (wszystkie dni 0
    // plus min/max daty). Każde inne miasto trzyma ten niezmiennik
    // (serwis kursu istnieje w calendar), a zapytania aplikacji czytają
    // calendar i calendar_dates razem.
    const dateRange = new Map(); // sid -> { min, max }
    eachRow(calDatesTxt, (c, idx) => {
      const id = (c[idx.service_id] || '').trim();
      if (!id) return;
      const date = (c[idx.date] || '').trim();
      const exc = Number(c[idx.exception_type]) || 0;
      rows.push([P(id), date, exc]);
      if (date.length !== 8 || exc !== 1) return;
      const r = dateRange.get(id);
      if (!r) dateRange.set(id, { min: date, max: date });
      else {
        if (date < r.min) r.min = date;
        if (date > r.max) r.max = date;
      }
    });
    const ins = db.prepare('INSERT INTO calendar_dates (service_id, date, exc) VALUES (?, ?, ?)');
    const insCalPlaceholder = db.prepare('INSERT OR IGNORE INTO calendar (service_id, mon, tue, wed, thu, fri, sat, sun, start_date, end_date) VALUES (?, 0, 0, 0, 0, 0, 0, 0, ?, ?)');
    db.exec('BEGIN');
    for (const r of rows) ins.run(...r);
    // OR IGNORE: gdy feed kiedyś dostarczy calendar.txt, prawdziwy wpis wygrywa.
    for (const [sid, r] of dateRange) insCalPlaceholder.run(P(sid), r.min, r.max);
    db.exec('COMMIT');
  }
  const tripsTxt = readTxt('trips.txt');
  if (!tripsTxt) throw new Error('GDY bez trips.txt, przerywam.');
  {
    const ins = db.prepare('INSERT OR REPLACE INTO trips (trip_id, route_id, service_id, headsign, direction, shape) VALUES (?, ?, ?, ?, ?, ?)');
    db.exec('BEGIN');
    let i = 0;
    eachRow(tripsTxt, (c, idx) => {
      const tid = (c[idx.trip_id] || '').trim();
      const rid = (c[idx.route_id] || '').trim();
      const sid = (c[idx.service_id] || '').trim();
      if (!tid || !rid || !sid) return;
      ins.run(P(tid), P(rid), P(sid), (c[idx.trip_headsign] || '').trim(), Number(c[idx.direction_id]) || 0, (c[idx.shape_id] || '').trim());
      if (++i % 5000 === 0) { db.exec('COMMIT'); db.exec('BEGIN'); }
      counts.trips++;
    });
    db.exec('COMMIT');
  }
  const stTxt = readTxt('stop_times.txt');
  if (!stTxt) throw new Error('GDY bez stop_times.txt, przerywam.');
  {
    const ins = db.prepare('INSERT INTO stop_times (trip_id, stop_id, arr_sec, dep_sec, seq) VALUES (?, ?, ?, ?, ?)');
    const { header } = splitHeader(stTxt);
    const ti = header.indexOf('trip_id'), ai = header.indexOf('arrival_time'),
      di = header.indexOf('departure_time'), si = header.indexOf('stop_id'), qi = header.indexOf('stop_sequence');
    let batch = 0;
    db.exec('BEGIN');
    let pos = stTxt.indexOf('\n') + 1;
    const len = stTxt.length;
    while (pos < len) {
      let nl = stTxt.indexOf('\n', pos);
      if (nl === -1) nl = len;
      let line = stTxt.slice(pos, nl);
      pos = nl + 1;
      if (line.endsWith('\r')) line = line.slice(0, -1);
      if (!line.trim()) continue;
      // stop_times nie ma cudzysłowów, więc szybki split jak w aplikacji
      const c = line.split(',');
      const tid = (c[ti] || '').trim();
      if (!tid) continue;
      const arr = (c[ai] || '').trim() || '00:00:00';
      ins.run(P(tid), P((c[si] || '').trim()), hmsToSec(arr), hmsToSec((c[di] || '').trim() || arr), Number(c[qi]) || 0);
      counts.stopTimes++;
      if (++batch >= 50000) { db.exec('COMMIT'); db.exec('BEGIN'); batch = 0; }
    }
    db.exec('COMMIT');
  }
  log(`GDY: routes=${counts.routes} trips=${counts.trips} stopTimes=${counts.stopTimes}`);
}

/* ─── PDP (KD): stacje Wrocławia → rozkład ────────────────────────────── */

function pdpHeaders() {
  return { 'X-API-Key': PDP_API_KEY, Accept: 'application/json' };
}

async function pdpDataVersion() {
  if (!PDP_API_KEY) return 'none';
  const v = await fetchJson(`${PDP_BASE}/api/v1/data-version`, pdpHeaders(), 20000);
  return v.schedulesVersion || v.dataVersion || 'unknown';
}

async function pdpWroclawStationIds() {
  const res = await fetchJson(`${PDP_BASE}/api/v1/dictionaries/cities?search=${encodeURIComponent('WROC')}`, pdpHeaders(), 20000);
  const cities = res.cities || [];
  const wro = cities.find((c) => String(c.name || '').toUpperCase() === 'WROCŁAW' || String(c.name || '').toUpperCase() === 'WROCLAW')
    || cities.find((c) => String(c.name || '').toUpperCase().includes('WROC'));
  if (!wro || !Array.isArray(wro.stationIds) || wro.stationIds.length === 0) {
    throw new Error('Nie znaleziono miasta WROCŁAW w /dictionaries/cities');
  }
  return wro;
}

async function pdpKdSchedules(stationIds) {
  const from = isoDaysFromNow(0);
  const to = isoDaysFromNow(KD_WINDOW_DAYS - 1);
  const q = new URLSearchParams({
    dateFrom: from, dateTo: to,
    stations: stationIds.join(','),
    carriersInclude: KD_CARRIER,
    dictionaries: 'true',
  });
  const res = await fetchJson(`${PDP_BASE}/api/v1/schedules/shortened?${q}`, pdpHeaders(), 90000);
  return { from, to, routes: res.rt || res.routes || [], dict: res.dc || res.dictionaries || {} };
}

/**
 * Stacje kolejowe GZM: unia stacji gmin członkowskich ze słownika cities
 * PDP plus kuratorowane wyjątki (stacje spoza słownika cities). Każdy inny
 * brak dokładnego trafienia to pominięcie gminy z ostrzeżeniem na końcu:
 * lepiej stracić stację niż wciągnąć miasto o tej samej nazwie z innego
 * regionu (PDP zwraca trafienia z całej Polski). Pusta lista to błąd buildu.
 */
async function pdpGzmStationIds() {
  const ids = new Set(GZM_EXTRA_STATIONS.map(Number));
  const skipped = [];
  for (const g of GZM_GMINAS) {
    const wantName = GZM_CITY_ALIASES[g] ?? g;
    try {
      const res = await fetchJson(`${PDP_BASE}/api/v1/dictionaries/cities?search=${encodeURIComponent(g)}`, pdpHeaders(), 20000);
      const cities = res.cities || [];
      const hit = cities.find((c) => String(c.name || '').toUpperCase() === wantName);
      if (hit && Array.isArray(hit.stationIds) && hit.stationIds.length > 0) {
        for (const id of hit.stationIds) ids.add(Number(id));
      } else {
        skipped.push(g);
      }
    } catch (e) {
      warn(`GZM miasta: ${g}: ${String(e).slice(0, 120)}`);
      skipped.push(g);
    }
  }
  if (skipped.length > 0) {
    log(`GZM: gminy bez wpisu w cities (brak stacji albo inny region): ${skipped.join(', ')}`);
  }
  return [...ids].filter((n) => Number.isFinite(n));
}

/** Rozkład IC/PR dla stacji GZM (okno jak KD, maks. 31 dni w API). */
async function pdpGzmRail(stationIds) {
  const from = isoDaysFromNow(0);
  const to = isoDaysFromNow(KD_WINDOW_DAYS - 1);
  const q = new URLSearchParams({
    dateFrom: from, dateTo: to,
    stations: stationIds.join(','),
    carriersInclude: 'IC,PR',
    dictionaries: 'true',
  });
  const res = await fetchJson(`${PDP_BASE}/api/v1/schedules/shortened?${q}`, pdpHeaders(), 120000);
  return { from, to, routes: res.rt || res.routes || [], dict: res.dc || res.dictionaries || {} };
}

/* ─── Nominatim (tylko brakujące współrzędne stacji KD) ───────────────── */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Współrzędne stacji KD z Nominatim. Tylko wyniki w bboxie Wrocławia:
 * PDP nie podaje lokalizacji, a stacje w zapytaniu są wyłącznie miejskie.
 * Wynik spoza bboxa to śmieć (kiedyś każda stacja dostała ten sam punkt),
 * więc go odrzucamy zamiast brać pierwszy z listy.
 */
async function geocodeStation(name, bbox = WRO_BBOX, placeHint = 'Wrocław, Polska') {
  const inBbox = (r) => {
    const lat = Number(r.lat), lon = Number(r.lon);
    return lat >= bbox.minLat && lat <= bbox.maxLat && lon >= bbox.minLon && lon <= bbox.maxLon;
  };
  const q = new URLSearchParams({
    q: `${name}, ${placeHint}`,
    format: 'json', limit: '5', addressdetails: '0',
    viewbox: `${bbox.minLon},${bbox.maxLat},${bbox.maxLon},${bbox.minLat}`,
    bounded: '1',
  });
  const res = await fetchJson(`${NOMINATIM}?${q}`, { 'User-Agent': NOMINATIM_UA }, 20000);
  const hits = Array.isArray(res) ? res.filter(inBbox) : [];
  // Dworzec to railway=station/halt, nie słupek bus_stop; preferujemy kolej.
  const rank = (r) => {
    const i = ['railway/station', 'railway/halt', 'railway/stop', 'railway/platform', 'railway/junction'].indexOf(`${r.class}/${r.type}`);
    return i === -1 ? 50 : i;
  };
  const hit = [...hits].sort((a, b) => rank(a) - rank(b))[0];
  if (!hit) return null;
  return { lat: Number(hit.lat), lon: Number(hit.lon), display: hit.display_name || '' };
}

/* ─── Build ───────────────────────────────────────────────────────────── */

function todayCompact() {
  return new Date().toISOString().slice(0, 10).replace(/-/g, '');
}

async function main() {
  log(`miasto: ${CITY} (output: ${DIST})`);
  // Realne KD jest wymagane we Wrocławiu, chyba że jawnie --allow-mpk-only.
  // Fail-fast zamiast pobierać MPK i dopiero potem odkryć brak klucza.
  // Kraków i Warszawa nie używają PDP wcale (koleje ze statycznych feedów).
  if (CITY === 'wroclaw' && !PDP_API_KEY && !ALLOW_MPK_ONLY) {
    throw new Error('brak PDP_API_KEY: build wymaga realnych danych KD. Ustaw sekret PDP_API_KEY albo jawnie --allow-mpk-only (tylko diagnostyka).');
  }
  mkdirSync(DIST, { recursive: true });
  const work = join(tmpdir(), `kilometr-gtfs-${Date.now()}`);
  mkdirSync(work, { recursive: true });

  // 1. Zdalny manifest (skip, gdy nic się nie zmieniło — oszczędzamy limity).
  let remote = null;
  if (PUBLIC_URL && !FORCE) {
    try {
      remote = await fetchJson(`${PUBLIC_URL}/${CITY}/manifest.json`, {}, 15000);
      log('remote manifest version:', remote.version);
    } catch { log('brak zdalnego manifestu (pierwszy build?) — buduję pełny.'); }
  }

  // 2. Źródła GTFS per-miasto (tanie zapytania).
  // prefix chroni przed kolizją id między feedami (Kraków ma 3 ZIP-y,
  // GZM ma N eksportów dziennych z powtarzającymi się id).
  let gtfsSources = [];
  let mpk = null;
  let kdVersion = 'none';
  let ztpFingerprint = '';
  let kmlVersion = '';
  let gtmFingerprint = '';
  let ksVersion = '';
  let icprVersion = 'none';
  let wawFingerprint = '';
  let kmVersion = '';
  let wkdVersion = '';
  let poznanFingerprint = '';
  let kwVersion = '';
  let gdaFingerprint = '';
  let gdyFingerprint = '';
  let skmtVersion = '';
  let lodzFingerprint = '';
  let lkaVersion = '';
  let szczecinFingerprint = '';
  let lublinFingerprint = '';
  if (CITY === 'krakow') {
    for (const f of ZTP_FEEDS) {
      gtfsSources.push({ label: `ZTP-${f.prefix}`, url: f.url, prefix: `KRK:${f.prefix}`, headers: ZTP_UA });
    }
    const ztpVersions = [];
    for (const s of gtfsSources) {
      s.version = await headVersion(s.url, s.headers);
      ztpVersions.push(`${s.label}=${s.version || '?'}`);
    }
    ztpFingerprint = ztpVersions.join('|');
    kmlVersion = await headVersion(KML_GTFS_URL, KML_UA);
    log('ZTP:', ztpFingerprint, '| KMŁ:', kmlVersion || '?');
  } else if (CITY === 'warszawa') {
    gtfsSources = [{ label: 'WTP', url: WAW_GTFS_URL, prefix: '', headers: WAW_UA }];
    wawFingerprint = await headVersion(WAW_GTFS_URL, WAW_UA);
    kmVersion = await headVersion(KM_GTFS_URL, KM_UA);
    wkdVersion = await headVersion(WKD_GTFS_URL, WKD_UA);
    log('WTP:', wawFingerprint || '?', '| KM:', kmVersion || '?', '| WKD:', wkdVersion || '?');
  } else if (CITY === 'poznan') {
    gtfsSources = [{ label: 'ZTM', url: POZNAN_GTFS_URL, prefix: '', headers: POZNAN_UA }];
    poznanFingerprint = await headVersion(POZNAN_GTFS_URL, POZNAN_UA);
    kwVersion = await headVersion(KW_GTFS_URL, KW_UA);
    log('ZTM:', poznanFingerprint || '?', '| KW:', kwVersion || '?', '| upstream:', POZNAN_GTFS_UPSTREAM);
  } else if (CITY === 'trojmiasto') {
    // Dwa feedy miejskie mergujemy prefiksami GDA/GDY (ten sam wzorzec co
    // feedy ZTP Krakowa): id są dziś rozłączne, ale formaty ewoluują.
    gtfsSources = [
      { label: 'ZTM-Gdansk', url: TRICITY_GDA_GTFS_URL, prefix: 'GDA', headers: TRICITY_UA },
      { label: 'ZKM-Gdynia', url: TRICITY_GDY_GTFS_URL, prefix: 'GDY', headers: TRICITY_UA },
    ];
    gdaFingerprint = await headVersion(TRICITY_GDA_GTFS_URL, TRICITY_UA);
    gdyFingerprint = await headVersion(TRICITY_GDY_GTFS_URL, TRICITY_UA);
    skmtVersion = await headVersion(SKMT_GTFS_URL, SKMT_UA);
    log('GDA:', gdaFingerprint || '?', '| GDY:', gdyFingerprint || '?', '| SKMT:', skmtVersion || '?');
  } else if (CITY === 'lodz') {
    gtfsSources = [{ label: 'ZDiT', url: LODZ_GTFS_URL, prefix: '', headers: LODZ_UA }];
    lodzFingerprint = await headVersion(LODZ_GTFS_URL, LODZ_UA);
    lkaVersion = await headVersion(LKA_GTFS_URL, LKA_UA);
    log('ZDiT:', lodzFingerprint || '?', '| ŁKA:', lkaVersion || '?');
  } else if (CITY === 'szczecin') {
    gtfsSources = [{ label: 'ZDiTM', url: SZCZECIN_GTFS_URL, prefix: '', headers: SZCZECIN_UA }];
    szczecinFingerprint = await headVersion(SZCZECIN_GTFS_URL, SZCZECIN_UA);
    log('ZDiTM:', szczecinFingerprint || '?');
  } else if (CITY === 'lublin') {
    gtfsSources = [{ label: 'ZDiTM', url: LUBLIN_GTFS_URL, prefix: '', headers: LUBLIN_UA }];
    lublinFingerprint = await headVersion(LUBLIN_GTFS_URL, LUBLIN_UA);
    log('ZDiTM:', lublinFingerprint || '?');
  } else if (CITY === 'gzm') {
    if (!PDP_API_KEY) {
      throw new Error('GZM wymaga PDP_API_KEY (IC/PR z PDP API), inaczej baza byłaby bez kolei.');
    }
    const exports = await discoverGzmExports();
    if (exports.length === 0) throw new Error('CKAN ZTM: brak eksportów ZIP, przerywam (nie nadpisuję R2 pustką).');
    for (const e of exports) {
      gtfsSources.push({ label: e.label, url: e.url, prefix: e.prefix, headers: GZM_UA, version: e.lastModified });
    }
    gtmFingerprint = exports.map((e) => `${e.name}|${e.lastModified}`).join(';');
    ksVersion = await headVersion(KS_GTFS_URL, KS_UA);
    log(`ZTM: ${exports.length} eksportów dziennych | KŚ:`, ksVersion || '?');
    try {
      icprVersion = await pdpDataVersion();
    } catch (e) {
      warn('PDP /data-version failed:', String(e), ', IC/PR mogą być nieaktualne.');
      icprVersion = 'unknown';
    }
    log('IC/PR schedulesVersion:', icprVersion);
  } else {
    mpk = await discoverMpk();
    log('MPK:', mpk.filename || mpk.url, '| effective:', mpk.effectiveDate);
    if (PDP_API_KEY) {
      try {
        kdVersion = await pdpDataVersion();
      } catch (e) {
        warn('PDP /data-version failed:', String(e), ', KD może być nieaktualne.');
        kdVersion = 'unknown';
      }
    }
    log('KD schedulesVersion:', kdVersion);
    gtfsSources = [{ label: 'MPK', url: mpk.url, prefix: '', headers: MPK_UA, version: mpk.effectiveDate }];
  }

  // Odcisk ZTP/KMŁ powstaje z Last-Modified/ETag. Gdy feed ich nie zwraca,
  // „odcisk” jest stały i nie wykryje zmiany rozkładu, więc skip byłby wieczny.
  // Wtedy (bez --force) budujemy na nowo zamiast pomijać.
  const ztpVersionsReliable = CITY !== 'krakow' || (gtfsSources.length > 0 && gtfsSources.every((s) => !!s.version));
  const kmlVersionReliable = CITY !== 'krakow' || !!kmlVersion;
  const gtmVersionsReliable = CITY !== 'gzm' || (gtfsSources.length > 0 && gtfsSources.every((s) => !!s.version));
  const ksVersionReliable = CITY !== 'gzm' || !!ksVersion;
  const wawVersionReliable = CITY !== 'warszawa' || (!!wawFingerprint && !!kmVersion && !!wkdVersion);
  const poznanVersionReliable = CITY !== 'poznan' || (!!poznanFingerprint && !!kwVersion);
  const tricityVersionReliable = CITY !== 'trojmiasto' || (!!gdaFingerprint && !!gdyFingerprint && !!skmtVersion);
  const lodzVersionReliable = CITY !== 'lodz' || (!!lodzFingerprint && !!lkaVersion);
  const szczecinVersionReliable = CITY !== 'szczecin' || !!szczecinFingerprint;
  const lublinVersionReliable = CITY !== 'lublin' || !!lublinFingerprint;

  if (!FORCE && remote?.sources) {
    if (CITY === 'krakow' && remote.sources.ztp?.fingerprint === ztpFingerprint && ztpFingerprint) {
      // Ten sam ZTP wystarczy do skipu tylko wtedy, gdy zdalna baza faktycznie
      // ma Koleje Małopolskie. Manifest sprzed ich wdrożenia ma zgodny odcisk
      // ZTP, ale pociągów nie zawiera, więc bez tego warunku Kraków nigdy by
      // ich nie dostał.
      const remoteKmlReal =
        (remote.sources.kml?.version || null) === (kmlVersion || null) &&
        Number(remote.sources.kml?.stations || 0) > 0 &&
        Number(remote.sources.kml?.trips || 0) > 0;
      if (!ztpVersionsReliable || !kmlVersionReliable) {
        warn('feed bez Last-Modified/ETag, nie mogę wykryć zmian: przebudowuję zamiast skipować.');
      } else if (remoteKmlReal) {
        log('brak zmian (ZTP + KMŁ), skip buildu.');
        rmSync(work, { recursive: true, force: true });
        process.exit(2);
      } else {
        warn('zdalny manifest bez realnego KMŁ, przebudowuję zamiast skipować.');
      }
    }
    if (CITY === 'gzm' && remote.sources.ztm?.fingerprint === gtmFingerprint && gtmFingerprint) {
      // Ten sam zestaw eksportów ZTM wystarczy do skipu tylko wtedy, gdy
      // zdalna baza faktycznie ma Koleje Śląskie i IC/PR (manifest sprzed
      // ich wdrożenia ma zgodny odcisk, ale pociągów nie zawiera).
      const remoteKsReal =
        (remote.sources.ks?.version || null) === (ksVersion || null) &&
        Number(remote.sources.ks?.stations || 0) > 0 &&
        Number(remote.sources.ks?.trips || 0) > 0;
      const remoteIcPrReal =
        (remote.sources.ic?.schedulesVersion || null) === (icprVersion || null) &&
        (remote.sources.pr?.schedulesVersion || null) === (icprVersion || null) &&
        Number(remote.sources.ic?.trips || 0) > 0 &&
        Number(remote.sources.pr?.trips || 0) > 0;
      if (!gtmVersionsReliable || !ksVersionReliable) {
        warn('feed bez Last-Modified/ETag, nie mogę wykryć zmian: przebudowuję zamiast skipować.');
      } else if (remoteKsReal && remoteIcPrReal) {
        log('brak zmian (ZTM + KŚ + IC/PR), skip buildu.');
        rmSync(work, { recursive: true, force: true });
        process.exit(2);
      } else {
        warn('zdalny manifest bez realnych KŚ/IC/PR, przebudowuję zamiast skipować.');
      }
    }
    if (CITY === 'warszawa' && remote.sources.wtp?.fingerprint === wawFingerprint && wawFingerprint) {
      // Ten sam zestaw feedów wystarczy do skipu tylko wtedy, gdy zdalna baza
      // faktycznie ma KM i WKD (manifest sprzed ich wdrożenia ma zgodny
      // odcisk WTP, ale kolei nie zawiera).
      const remoteKmReal =
        (remote.sources.km?.version || null) === (kmVersion || null) &&
        Number(remote.sources.km?.trips || 0) > 0;
      const remoteWkdReal =
        (remote.sources.wkd?.version || null) === (wkdVersion || null) &&
        Number(remote.sources.wkd?.trips || 0) > 0;
      if (!wawVersionReliable) {
        warn('feed bez Last-Modified/ETag, nie mogę wykryć zmian: przebudowuję zamiast skipować.');
      } else if (remoteKmReal && remoteWkdReal) {
        log('brak zmian (WTP + KM + WKD), skip buildu.');
        rmSync(work, { recursive: true, force: true });
        process.exit(2);
      } else {
        warn('zdalny manifest bez realnych KM/WKD, przebudowuję zamiast skipować.');
      }
    }
    if (CITY === 'poznan' && remote.sources.ztm?.fingerprint === poznanFingerprint && poznanFingerprint) {
      // Ten sam zrzut ZTM wystarczy do skipu tylko wtedy, gdy zdalna baza
      // faktycznie ma Koleje Wielkopolskie (manifest sprzed ich wdrożenia
      // ma zgodny odcisk, ale pociągów nie zawiera).
      const remoteKwReal =
        (remote.sources.kw?.version || null) === (kwVersion || null) &&
        Number(remote.sources.kw?.trips || 0) > 0;
      if (!poznanVersionReliable) {
        warn('feed bez Last-Modified/ETag, nie mogę wykryć zmian: przebudowuję zamiast skipować.');
      } else if (remoteKwReal) {
        log('brak zmian (ZTM + KW), skip buildu.');
        rmSync(work, { recursive: true, force: true });
        process.exit(2);
      } else {
        warn('zdalny manifest bez realnych KW, przebudowuję zamiast skipować.');
      }
    }
    if (CITY === 'trojmiasto' && remote.sources.gdansk?.fingerprint === gdaFingerprint && gdaFingerprint
      && remote.sources.gdynia?.fingerprint === gdyFingerprint && gdyFingerprint) {
      // Te same feedy miejskie wystarczą do skipu tylko wtedy, gdy zdalna
      // baza faktycznie ma SKM (manifest sprzed jej wdrożenia ma zgodne
      // odciski, ale pociągów nie zawiera).
      const remoteSkmtReal =
        (remote.sources.skmt?.version || null) === (skmtVersion || null) &&
        Number(remote.sources.skmt?.trips || 0) > 0;
      if (!tricityVersionReliable) {
        warn('feed bez Last-Modified/ETag, nie mogę wykryć zmian: przebudowuję zamiast skipować.');
      } else if (remoteSkmtReal) {
        log('brak zmian (GDA + GDY + SKMT), skip buildu.');
        rmSync(work, { recursive: true, force: true });
        process.exit(2);
      } else {
        warn('zdalny manifest bez realnej SKM, przebudowuję zamiast skipować.');
      }
    }
    if (CITY === 'lodz' && remote.sources.mpk?.fingerprint === lodzFingerprint && lodzFingerprint) {
      // Ten sam zrzut ZDiT wystarczy do skipu tylko wtedy, gdy zdalna baza
      // faktycznie ma ŁKA (manifest sprzed jej wdrożenia ma zgodny odcisk,
      // ale pociągów nie zawiera).
      const remoteLkaReal =
        (remote.sources.lka?.version || null) === (lkaVersion || null) &&
        Number(remote.sources.lka?.trips || 0) > 0;
      if (!lodzVersionReliable) {
        warn('feed bez Last-Modified/ETag, nie mogę wykryć zmian: przebudowuję zamiast skipować.');
      } else if (remoteLkaReal) {
        log('brak zmian (ZDiT + ŁKA), skip buildu.');
        rmSync(work, { recursive: true, force: true });
        process.exit(2);
      } else {
        warn('zdalny manifest bez realnej ŁKA, przebudowuję zamiast skipować.');
      }
    }
    if (CITY === 'szczecin' && remote.sources.zditm?.fingerprint === szczecinFingerprint && szczecinFingerprint) {
      if (!szczecinVersionReliable) {
        warn('feed bez Last-Modified/ETag, nie mogę wykryć zmian: przebudowuję zamiast skipować.');
      } else {
        log('brak zmian (ZDiTM), skip buildu.');
        rmSync(work, { recursive: true, force: true });
        process.exit(2);
      }
    }
    if (CITY === 'lublin' && remote.sources.zditm?.fingerprint === lublinFingerprint && lublinFingerprint) {
      if (!lublinVersionReliable) {
        warn('feed bez Last-Modified/ETag, nie mogę wykryć zmian: przebudowuję zamiast skipować.');
      } else {
        log('brak zmian (ZDiTM), skip buildu.');
        rmSync(work, { recursive: true, force: true });
        process.exit(2);
      }
    }
    if (CITY === 'wroclaw'
      && remote.sources.mpk?.effectiveDate === mpk.effectiveDate
      && (remote.sources.kd?.schedulesVersion || 'none') === kdVersion) {
      // Gdy KD jest wymagane, skip tylko jeśli zdalna baza faktycznie je ma.
      // Inaczej wymuszamy przebudowę (stary manifest mógł być MPK-only/mock).
      const remoteKdReal = !ALLOW_MPK_ONLY
        && !remote.sources.kd?.skippedReason
        && Number(remote.sources.kd?.stations || 0) > 0
        && Number(remote.sources.kd?.trips || 0) > 0;
      if (ALLOW_MPK_ONLY || remoteKdReal) {
        log('brak zmian (MPK + KD), skip buildu.');
        rmSync(work, { recursive: true, force: true });
        process.exit(2);
      }
      warn('zdalny manifest bez realnego KD, przebudowuję zamiast skipować.');
    }
  }

  // 3. Pobieranie ZIP-ów + rozpakowanie (unzip z systemu, Node nie ma wbudowanego).
  // frequencies.txt występuje tylko w Warszawie (metro M1/M2 na headwayach);
  // w reszcie feedów go nie ma, a brak pliku na liście to tylko warning unzip.
  const NEEDED = ['stops.txt', 'routes.txt', 'calendar.txt', 'calendar_dates.txt', 'trips.txt', 'stop_times.txt', 'frequencies.txt'];
  const txtDirs = [];
  for (const [i, src] of gtfsSources.entries()) {
    const zipPath = join(work, `gtfs-${i}.zip`);
    log(`pobieranie ZIP ${src.label}…`);
    const zipBuf = await fetchBuffer(src.url, src.headers, 180000);
    writeFileSync(zipPath, zipBuf);
    log(`ZIP ${src.label}:`, (zipBuf.length / 1048576).toFixed(1), 'MB');
    const txtDir = join(work, `gtfs-${i}`);
    mkdirSync(txtDir, { recursive: true });
    // Niezerowy exit tolerujemy (np. brak opcjonalnego calendar.txt w feedzie:
    // unzip krzyczy "filename not matched", ale resztę wypakowuje). Brak
    // wymaganych plików wyłapią konkretne błędy przy imporcie niżej.
    try {
      execFileSync('unzip', ['-o', '-j', zipPath, ...NEEDED, '-d', txtDir], { stdio: 'pipe' });
    } catch (e) {
      if (e && (e.code === 'ENOENT' || /not found/i.test(String(e.message || '')))) {
        rmSync(work, { recursive: true, force: true });
        throw new Error('Brak programu `unzip` w PATH (linux/macos: standard; Windows: Git Bash/WSL).');
      }
      warn(`unzip dla ${src.label} zwrócił błąd (kontynuuję, zweryfikuję pliki):`, String((e && e.message) || e).slice(0, 160));
    }
    txtDirs.push({ dir: txtDir, prefix: src.prefix, label: src.label });
  }
  const readers = txtDirs.map(({ dir }) => (n) => {
    try { return readFileSync(join(dir, n), 'utf8'); } catch { return null; }
  });

  // 4. Świeża baza.
  try { rmSync(DB_FILE, { force: true }); } catch {}
  for (const suf of ['-wal', '-shm', '-journal']) {
    try { rmSync(DB_FILE + suf, { force: true }); } catch {}
  }
  const db = new DatabaseSync(DB_FILE);
  db.exec(SCHEMA_SQL);
  db.exec('PRAGMA synchronous = OFF;');

  const counts = { stops: 0, routes: 0, trips: 0, stopTimes: 0, kdStations: 0, kdRoutes: 0, kdTrips: 0, kdStopTimes: 0, kmlStations: 0, kmlRoutes: 0, kmlTrips: 0, kmlStopTimes: 0, ksStations: 0, ksRoutes: 0, ksTrips: 0, ksStopTimes: 0, icStations: 0, icRoutes: 0, icTrips: 0, icStopTimes: 0, prStations: 0, prRoutes: 0, prTrips: 0, prStopTimes: 0, kmStations: 0, kmRoutes: 0, kmTrips: 0, kmStopTimes: 0, wkdStations: 0, wkdRoutes: 0, wkdTrips: 0, wkdStopTimes: 0, kwStations: 0, kwRoutes: 0, kwTrips: 0, kwStopTimes: 0, skmtStations: 0, skmtRoutes: 0, skmtTrips: 0, skmtStopTimes: 0, lkaStations: 0, lkaRoutes: 0, lkaTrips: 0, lkaStopTimes: 0 };
  /** Przystanki miasta w pamięci (do liczenia przesiadek na kolej w kroku 6b). */
  const cityStops = [];
  const cityStopIds = new Set();

  // 5. GTFS → tabele. Kraków merguje 3 feedy: przystanki współdzielone
  // (REPLACE po stop_id), reszta id z prefiksem KRK:{A,T,M} (brak kolizji).
  // GZM merguje N eksportów dziennych zwartym importem (dedupe kursów).
  // Warszawa importuje zwarto jak GZM (eksport dzienny, trip_id z datą).
  // Trójmiasto merguje 2 feedy prefiksami GDA/GDY: Gdańsk zwarto (eksport
  // dzienny jak Warszawa), Gdynia generycznie (statyczny zrzut jak Poznań).
  // Poznań, Łódź, Szczecin i Lublin to pojedyncze statyczne zrzuty
  // ZTM/ZDiT/ZDiTM, więc idą generyczną ścieżką jak Wrocław (osobny prefiks
  // id unikalne w feedzie; inna kolejność kolumn w trips.txt nie szkodzi,
  // bo import czyta po nazwach z nagłówka).
  db.exec('DELETE FROM calendar_dates');
  if (CITY === 'gzm') {
    importGzmMerged(db, txtDirs, readers, counts, cityStops, cityStopIds);
  } else if (CITY === 'warszawa') {
    importWawCompact(db, txtDirs[0].dir, counts, cityStops, cityStopIds);
  } else if (CITY === 'trojmiasto') {
    importGdaCompact(db, txtDirs[0].dir, counts, cityStops, cityStopIds);
    importGdyniaGeneric(db, txtDirs[1].dir, counts, cityStops, cityStopIds);
  } else {
  for (let fi = 0; fi < txtDirs.length; fi++) {
    const { prefix, label } = txtDirs[fi];
    const readTxt = readers[fi];
    const P = (id) => (prefix ? `${prefix}:${id}` : id);
    const stopsTxt = readTxt('stops.txt');
    if (!stopsTxt) throw new Error(`ZIP ${label} bez stops.txt, przerywam (nie nadpisuję R2 pustką).`);
    {
      const ins = db.prepare('INSERT OR REPLACE INTO stops (stop_id, code, name, lat, lon, norm) VALUES (?, ?, ?, ?, ?, ?)');
      db.exec('BEGIN');
      let i = 0;
      eachRow(stopsTxt, (c, idx) => {
        const id = (c[idx.stop_id] || '').trim();
        const name = (c[idx.stop_name] || '').trim();
        if (!id || !name) return;
        const lat = Number(c[idx.stop_lat]) || 0;
        const lon = Number(c[idx.stop_lon]) || 0;
        const norm = normalizePolish(name);
        ins.run(id, (c[idx.stop_code] || '').trim(), name, lat, lon, norm);
        if (lat && lon && !cityStopIds.has(id)) {
          cityStopIds.add(id);
          cityStops.push({ id, norm, lat, lon });
        }
        if (++i % 2000 === 0) { db.exec('COMMIT'); db.exec('BEGIN'); }
        counts.stops++;
      });
      db.exec('COMMIT');
    }
    const routesTxt = readTxt('routes.txt');
    if (routesTxt) {
      const ins = db.prepare('INSERT OR REPLACE INTO routes (route_id, short, long_name, type) VALUES (?, ?, ?, ?)');
      db.exec('BEGIN');
      eachRow(routesTxt, (c, idx) => {
        const id = (c[idx.route_id] || '').trim();
        if (!id) return;
        const raw = (c[idx.route_type] || '').trim();
        let num = raw !== '' && !isNaN(Number(raw)) ? Number(raw) : 3;
        // ZTP Kraków oznacza tramwaje rozszerzonym typem 900, sprowadzamy
        // do kanonicznego GTFS 0, żeby filtry tramwaj/autobus działały.
        if (CITY === 'krakow' && num === 900) num = 0;
        ins.run(P(id), (c[idx.route_short_name] || '').trim() || id, (c[idx.route_long_name] || '').trim(), num);
        counts.routes++;
      });
      db.exec('COMMIT');
    }
    const calTxt = readTxt('calendar.txt');
    if (calTxt) {
      const ins = db.prepare('INSERT OR REPLACE INTO calendar (service_id, mon, tue, wed, thu, fri, sat, sun, start_date, end_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
      db.exec('BEGIN');
      eachRow(calTxt, (c, idx) => {
        const id = (c[idx.service_id] || '').trim();
        if (!id) return;
        ins.run(P(id), Number(c[idx.monday]) || 0, Number(c[idx.tuesday]) || 0, Number(c[idx.wednesday]) || 0,
          Number(c[idx.thursday]) || 0, Number(c[idx.friday]) || 0, Number(c[idx.saturday]) || 0, Number(c[idx.sunday]) || 0,
          (c[idx.start_date] || '').trim(), (c[idx.end_date] || '').trim());
      });
      db.exec('COMMIT');
    }
    const calDatesTxt = readTxt('calendar_dates.txt');
    if (calDatesTxt) {
      const rows = [];
      eachRow(calDatesTxt, (c, idx) => {
        const id = (c[idx.service_id] || '').trim();
        if (id) rows.push([P(id), (c[idx.date] || '').trim(), Number(c[idx.exception_type]) || 0]);
      });
      const ins = db.prepare('INSERT INTO calendar_dates (service_id, date, exc) VALUES (?, ?, ?)');
      db.exec('BEGIN');
      for (const r of rows) ins.run(...r);
      db.exec('COMMIT');
    }
    const tripsTxt = readTxt('trips.txt');
    if (!tripsTxt) throw new Error(`ZIP ${label} bez trips.txt, przerywam.`);
    {
      const ins = db.prepare('INSERT OR REPLACE INTO trips (trip_id, route_id, service_id, headsign, direction, shape) VALUES (?, ?, ?, ?, ?, ?)');
      db.exec('BEGIN');
      let i = 0;
      eachRow(tripsTxt, (c, idx) => {
        const tid = (c[idx.trip_id] || '').trim();
        const rid = (c[idx.route_id] || '').trim();
        const sid = (c[idx.service_id] || '').trim();
        if (!tid || !rid || !sid) return;
        ins.run(P(tid), P(rid), P(sid), (c[idx.trip_headsign] || '').trim(), Number(c[idx.direction_id]) || 0, (c[idx.shape_id] || '').trim());
        if (++i % 5000 === 0) { db.exec('COMMIT'); db.exec('BEGIN'); }
        counts.trips++;
      });
      db.exec('COMMIT');
    }
    const stTxt = readTxt('stop_times.txt');
    if (!stTxt) throw new Error(`ZIP ${label} bez stop_times.txt, przerywam.`);
    {
      const ins = db.prepare('INSERT INTO stop_times (trip_id, stop_id, arr_sec, dep_sec, seq) VALUES (?, ?, ?, ?, ?)');
      const { header } = splitHeader(stTxt);
      const ti = header.indexOf('trip_id'), ai = header.indexOf('arrival_time'),
        di = header.indexOf('departure_time'), si = header.indexOf('stop_id'), qi = header.indexOf('stop_sequence');
      let batch = 0;
      db.exec('BEGIN');
      let pos = stTxt.indexOf('\n') + 1;
      const len = stTxt.length;
      while (pos < len) {
        let nl = stTxt.indexOf('\n', pos);
        if (nl === -1) nl = len;
        let line = stTxt.slice(pos, nl);
        pos = nl + 1;
        if (line.endsWith('\r')) line = line.slice(0, -1);
        if (!line.trim()) continue;
        // stop_times nie ma cudzysłowów, więc szybki split jak w aplikacji
        const c = line.split(',');
        const tid = (c[ti] || '').trim();
        if (!tid) continue;
        const arr = (c[ai] || '').trim() || '00:00:00';
        ins.run(P(tid), (c[si] || '').trim(), hmsToSec(arr), hmsToSec((c[di] || '').trim() || arr), Number(c[qi]) || 0);
        counts.stopTimes++;
        if (++batch >= 50000) { db.exec('COMMIT'); db.exec('BEGIN'); batch = 0; }
      }
      db.exec('COMMIT');
    }
    log(`${label}: routes=${counts.routes} trips=${counts.trips} stopTimes=${counts.stopTimes}`);
  }
  }
  // Liczniki po merge: GZM wstawia przystanki/linie eksport po eksporcie
  // (REPLACE), więc surowe zliczenia zawyżają stan. Przelicz na faktyczny
  // stan tabeli (dla Wrocławia/Krakowa to samo co zliczenia, id są unikalne).
  try {
    counts.stops = db.prepare('SELECT COUNT(*) AS n FROM stops').get().n;
    counts.routes = db.prepare('SELECT COUNT(*) AS n FROM routes').get().n;
  } catch {}
  log(`GTFS: stops=${counts.stops} routes=${counts.routes} trips=${counts.trips} stopTimes=${counts.stopTimes}`);

  // 6. Kolej regionalna: KD z PDP API (tylko Wrocław), KM/WKD ze statycznych
  // feedów (tylko Warszawa), Koleje Małopolskie ze statycznego GTFS (tylko
  // Kraków), Koleje Wielkopolskie ze statycznego GTFS (tylko Poznań), SKM
  // ze statycznego GTFS (tylko Trójmiasto) albo ŁKA ze statycznego GTFS
  // (tylko Łódź).
  // Wspólny mianownik: mapa stacji railGeo (do przesiadek w kroku 6b).
  const RAIL_PREFIX = CITY === 'krakow' ? 'KML' : CITY === 'gzm' ? 'KS' : CITY === 'warszawa' ? 'SKM' : CITY === 'poznan' ? 'KW' : CITY === 'trojmiasto' ? 'SKMT' : CITY === 'lodz' ? 'LKA' : 'KD';
  let kdInfo = CITY === 'wroclaw'
    ? { kind: 'pdp-api', skippedReason: PDP_API_KEY ? null : 'no-key' }
    : { kind: 'none', skippedReason: 'krakow-pdp-unused' };
  let kmInfo = CITY === 'warszawa'
    ? { kind: 'gtfs-zip', skippedReason: 'not-fetched-yet' }
    : { kind: 'none', skippedReason: 'only-warszawa-has-km' };
  let wkdInfo = CITY === 'warszawa'
    ? { kind: 'gtfs-zip', skippedReason: 'not-fetched-yet' }
    : { kind: 'none', skippedReason: 'only-warszawa-has-wkd' };
  let kmlInfo = CITY === 'krakow'
    ? { kind: 'gtfs-zip', skippedReason: 'not-fetched-yet' }
    : { kind: 'none', skippedReason: 'wroclaw-no-kml' };
  let ksInfo = CITY === 'gzm'
    ? { kind: 'gtfs-zip', skippedReason: 'not-fetched-yet' }
    : { kind: 'none', skippedReason: 'only-gzm-has-ks' };
  let icInfo = CITY === 'gzm'
    ? { kind: 'pdp-api', skippedReason: 'not-fetched-yet' }
    : { kind: 'none', skippedReason: 'only-gzm-has-ic' };
  let prInfo = CITY === 'gzm'
    ? { kind: 'pdp-api', skippedReason: 'not-fetched-yet' }
    : { kind: 'none', skippedReason: 'only-gzm-has-pr' };
  let kwInfo = CITY === 'poznan'
    ? { kind: 'gtfs-zip', skippedReason: 'not-fetched-yet' }
    : { kind: 'none', skippedReason: 'only-poznan-has-kw' };
  let skmtInfo = CITY === 'trojmiasto'
    ? { kind: 'gtfs-zip', skippedReason: 'not-fetched-yet' }
    : { kind: 'none', skippedReason: 'only-trojmiasto-has-skmt' };
  let lkaInfo = CITY === 'lodz'
    ? { kind: 'gtfs-zip', skippedReason: 'not-fetched-yet' }
    : { kind: 'none', skippedReason: 'only-lodz-has-lka' };
  /** Liczba stacji kolei bez współrzędnych (kursy z nimi są pomijane). */
  let unresolvedCount = 0;
  /** Stacje kolei ze współrzędnymi (do przesiadek w kroku 6b). */
  const railGeo = new Map();
  if (CITY === 'wroclaw' && PDP_API_KEY) {
    try {
      const wro = await pdpWroclawStationIds();
      log(`WROCŁAW: ${wro.stationIds.length} stacji w PDP`);
      const { from, to, routes, dict } = await pdpKdSchedules(wro.stationIds);
      // Współrzędne: cache w repo (trzyma też nazwy) + Nominatim dla brakujących.
      let coords = { stations: {} };
      try {
        const raw = readFileSync(COORDS_FILE, 'utf8');
        coords = JSON.parse(raw);
        if (!coords.stations) coords.stations = {};
      } catch {}
      // Nazwa: słownik z odpowiedzi PDP, a gdy go brak, nazwa z cache.
      const stationNames = stationNamesFromDict(dict);
      for (const [id, c] of Object.entries(coords.stations)) {
        if (!stationNames[id] && c?.name) stationNames[id] = c.name;
      }
      log(`KD: nazwy stacji: ${Object.keys(stationNames).length} (ze słownika PDP + cache)`);
      const unresolved = [];
      const unnamed = new Set();
      let skippedNoTimes = 0;
      const ensureCoords = async (id, name) => {
        if (coords.stations[id]?.lat) return coords.stations[id];
        await sleep(1100); // uprzejmie dla Nominatim (max 1 req/s)
        try {
          const g = await geocodeStation(name);
          if (g) {
            coords.stations[id] = { name, lat: g.lat, lon: g.lon, updatedAt: new Date().toISOString().slice(0, 10) };
            log(`geocode OK: ${name} → ${g.lat.toFixed(5)},${g.lon.toFixed(5)}`);
            return coords.stations[id];
          }
        } catch (e) {
          warn(`geocode fail ${name}:`, String(e));
        }
        unresolved.push({ id, name });
        return null;
      };

      const insStop = db.prepare('INSERT OR REPLACE INTO stops (stop_id, code, name, lat, lon, norm) VALUES (?, ?, ?, ?, ?, ?)');
      const insRoute = db.prepare('INSERT OR REPLACE INTO routes (route_id, short, long_name, type) VALUES (?, ?, ?, ?)');
      const insTrip = db.prepare('INSERT OR REPLACE INTO trips (trip_id, route_id, service_id, headsign, direction, shape) VALUES (?, ?, ?, ?, ?, ?)');
      const insSt = db.prepare('INSERT INTO stop_times (trip_id, stop_id, arr_sec, dep_sec, seq) VALUES (?, ?, ?, ?, ?)');
      const insCal = db.prepare('INSERT OR REPLACE INTO calendar (service_id, mon, tue, wed, thu, fri, sat, sun, start_date, end_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
      const insCalDate = db.prepare('INSERT INTO calendar_dates (service_id, date, exc) VALUES (?, ?, ?)');
      db.exec('BEGIN');
      const seenStops = new Set();
      const seenRoutes = new Set();
      for (const r of routes) {
        // Tylko przewoźnik KD (API filtruje, ale sprawdźmy dla pewności).
        if ((r.cc || r.carrierCode || '') !== KD_CARRIER) continue;
        const sid = r.sid ?? r.scheduleId;
        const oid = r.oid ?? r.orderId;
        const dates = r.od || r.operatingDates || [];
        // Kolejność postojów wg numeru z PDP, nie wg kolejności w tablicy.
        const stops = [...(r.st || r.stations || [])]
          .sort((a, b) => (Number(a.ord ?? a.orderNumber) || 0) - (Number(b.ord ?? b.orderNumber) || 0));
        if (sid == null || oid == null || dates.length === 0) continue;
        // Kurs z jednym postojem albo z postojem bez godziny nie da się przejechać w RAPTOR-ze.
        const times = stops.map(stopTimesOf);
        if (stops.length < 2 || times.some((t) => t === null)) { skippedNoTimes++; continue; }
        // Postój bez nazwy (brak w słowniku i cache) nie dostaje współrzędnych: kurs pomijamy.
        // Postój bez współrzędnych też wyklucza kurs.
        let ok = true;
        for (const s of stops) {
          const id = String(s.id ?? s.stationId);
          const nm = stationNames[id];
          if (!nm) { unnamed.add(id); ok = false; break; }
          if (!seenStops.has(id)) {
            const geo = await ensureCoords(id, nm);
            if (!geo) { ok = false; break; }
            insStop.run(`KD:S:${id}`, id, nm, geo.lat, geo.lon, normalizePolish(nm));
            seenStops.add(id);
            railGeo.set(id, { name: nm, lat: geo.lat, lon: geo.lon });
            counts.stops++;
            counts.kdStations++;
          }
        }
        if (!ok) continue;
        const num = String(r.nn ?? r.nationalNumber ?? r.nm ?? r.name ?? `${sid}/${oid}`);
        const routeId = `KD:R:${sid}:${oid}`;
        const svc = `KD:svc:${sid}:${oid}`;
        const firstName = stationNames[String(stops[0].id ?? stops[0].stationId)];
        const lastName = stationNames[String(stops[stops.length - 1].id ?? stops[stops.length - 1].stationId)];
        if (!seenRoutes.has(routeId)) {
          insRoute.run(routeId, num, `${firstName} – ${lastName}`, 2);
          seenRoutes.add(routeId);
          counts.routes++;
          counts.kdRoutes++;
          insCal.run(svc, 0, 0, 0, 0, 0, 0, 0, '', '');
        }
        for (const d of dates) {
          const dc = ymdCompact(d);
          const tripId = `KD:T:${sid}:${oid}:${dc}`;
          insTrip.run(tripId, routeId, svc, lastName, 0, '');
          counts.trips++;
          counts.kdTrips++;
          for (let i = 0; i < stops.length; i++) {
            const id = String(stops[i].id ?? stops[i].stationId);
            insSt.run(tripId, `KD:S:${id}`, times[i].arr, times[i].dep, i + 1);
            counts.stopTimes++;
            counts.kdStopTimes++;
          }
          insCalDate.run(svc, dc, 1);
        }
      }
      db.exec('COMMIT');
      if (unnamed.size > 0) warn(`KD: ${unnamed.size} stacji bez nazwy (brak w słowniku PDP i cache): ${[...unnamed].join(', ')}`);
      if (skippedNoTimes > 0) log(`KD: pominięto ${skippedNoTimes} kursów bez pełnych czasów (<2 postoje albo brak godziny)`);
      if (WRITE_COORDS) {
        writeFileSync(COORDS_FILE, JSON.stringify(coords, null, 2) + '\n');
        log('zapisano cache współrzędnych →', COORDS_FILE, '(przejrzyj diffa przed commitem!)');
      } else {
        log(`współrzędne KD: ${Object.keys(coords.stations).length} z cache/geokodowania (nie zapisuję pliku bez --write-coords).`);
      }
      kdInfo = {
        kind: 'pdp-api', carrier: KD_CARRIER, windowFrom: from, windowTo: to,
        stations: seenStops.size, routes: seenRoutes.size, trips: counts.kdTrips,
        stopTimes: counts.kdStopTimes, schedulesVersion: kdVersion,
        unresolvedStations: unresolved,
        unnamedStations: [...unnamed],
        skippedTripsNoTimes: skippedNoTimes,
      };
      unresolvedCount = unresolved.length;
      log(`KD: stations=${seenStops.size} routes=${seenRoutes.size} trips=${counts.kdTrips} stopTimes=${counts.kdStopTimes}`);
    } catch (e) {
      try { db.exec('ROLLBACK'); } catch {}
      warn('sekcja KD nieudana:', String(e), '— build MPK-only.');
      kdInfo = { kind: 'pdp-api', skippedReason: `error: ${String(e).slice(0, 200)}` };
    }
  }

  // 6a. Koleje Małopolskie ze statycznego GTFS (tylko Kraków, bez klucza).
  // Trasy w bazie grupujemy po numerze pociągu (pierwszy token trip_short_name,
  // np. "33142" z "33142 HUBAL"), ten sam wzorzec co kursy KD: LineBadge
  // pokazuje numer, a live dopina się po numerze (brygada z zbiorkom).
  if (CITY === 'krakow') {
    const zipPath = join(work, 'kml.zip');
    log('pobieranie ZIP KMŁ…');
    const zipBuf = await fetchBuffer(KML_GTFS_URL, KML_UA, 180000);
    writeFileSync(zipPath, zipBuf);
    log('ZIP KMŁ:', (zipBuf.length / 1048576).toFixed(1), 'MB');
    const txtDir = join(work, 'kml');
    mkdirSync(txtDir, { recursive: true });
    // Jak wyżej: brak opcjonalnego calendar.txt to nie błąd unzip.
    try {
      execFileSync('unzip', ['-o', '-j', zipPath, ...NEEDED, '-d', txtDir], { stdio: 'pipe' });
    } catch (e) {
      if (e && (e.code === 'ENOENT' || /not found/i.test(String(e.message || '')))) {
        rmSync(work, { recursive: true, force: true });
        throw new Error('Brak programu `unzip` w PATH (linux/macos: standard; Windows: Git Bash/WSL).');
      }
      warn('unzip dla KMŁ zwrócił błąd (kontynuuję, zweryfikuję pliki):', String((e && e.message) || e).slice(0, 160));
    }
    const readKml = (n) => {
      try { return readFileSync(join(txtDir, n), 'utf8'); } catch { return null; }
    };
    const PS = (id) => `KML:S:${id}`;
    const PR = (id) => `KML:${id}`;
    const stopsTxt = readKml('stops.txt');
    if (!stopsTxt) throw new Error('ZIP KMŁ bez stops.txt, przerywam (nie nadpisuję R2 pustką).');
    {
      const ins = db.prepare('INSERT OR REPLACE INTO stops (stop_id, code, name, lat, lon, norm) VALUES (?, ?, ?, ?, ?, ?)');
      db.exec('BEGIN');
      eachRow(stopsTxt, (c, idx) => {
        const id = (c[idx.stop_id] || '').trim();
        const name = (c[idx.stop_name] || '').trim();
        if (!id || !name) return;
        const lat = Number(c[idx.stop_lat]) || 0;
        const lon = Number(c[idx.stop_lon]) || 0;
        if (!lat || !lon) { unresolvedCount++; return; }
        ins.run(PS(id), (c[idx.stop_code] || '').trim(), titleCasePl(name), lat, lon, normalizePolish(name));
        railGeo.set(id, { name: titleCasePl(name), lat, lon });
        counts.stops++;
        counts.kmlStations++;
      });
      db.exec('COMMIT');
    }
    const tripsTxt = readKml('trips.txt');
    if (!tripsTxt) throw new Error('ZIP KMŁ bez trips.txt, przerywam.');
    const trainOf = new Map(); // numer pociągu -> { routeId, first, last }
    let skippedNoNumber = 0;
    {
      const insRoute = db.prepare('INSERT OR REPLACE INTO routes (route_id, short, long_name, type) VALUES (?, ?, ?, ?)');
      const insTrip = db.prepare('INSERT OR REPLACE INTO trips (trip_id, route_id, service_id, headsign, direction, shape) VALUES (?, ?, ?, ?, ?, ?)');
      const insCal = db.prepare('INSERT OR REPLACE INTO calendar (service_id, mon, tue, wed, thu, fri, sat, sun, start_date, end_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
      db.exec('BEGIN');
      eachRow(tripsTxt, (c, idx) => {
        const tid = (c[idx.trip_id] || '').trim();
        const sid = (c[idx.service_id] || '').trim();
        if (!tid || !sid) return;
        // Numer pociągu to pierwszy token trip_short_name ("33142" z "33142 HUBAL").
        // Sufiks wariantu ("/1" w "30710/1") odcinamy: live (brygada zbiorkom)
        // niesie goły numer, a kierunek i tak weryfikują nazwy/czasy postojów.
        const fullShort = (c[idx.trip_short_name] || '').trim();
        const rawNum = (fullShort.split(/\s/)[0] || '').trim();
        const num = rawNum.split('/')[0].trim();
        if (!num) { skippedNoNumber++; return; }
        const routeId = `KML:R:${num}`;
        const headsign = (c[idx.trip_headsign] || '').trim();
        if (!trainOf.has(num)) {
          const trainName = fullShort.slice(rawNum.length).trim() || headsign || num;
          insRoute.run(routeId, num, trainName, 2);
          trainOf.set(num, { routeId, name: trainName });
          counts.routes++;
          counts.kmlRoutes++;
          insCal.run(PR(sid), 0, 0, 0, 0, 0, 0, 0, '', '');
        }
        insTrip.run(PR(tid), routeId, PR(sid), headsign, Number(c[idx.direction_id]) || 0, (c[idx.shape_id] || '').trim());
        counts.trips++;
        counts.kmlTrips++;
      });
      db.exec('COMMIT');
    }
    if (skippedNoNumber > 0) log(`KMŁ: pominięto ${skippedNoNumber} kursów bez numeru pociągu`);
    const calDatesTxt = readKml('calendar_dates.txt');
    if (calDatesTxt) {
      const ins = db.prepare('INSERT INTO calendar_dates (service_id, date, exc) VALUES (?, ?, ?)');
      db.exec('BEGIN');
      eachRow(calDatesTxt, (c, idx) => {
        const id = (c[idx.service_id] || '').trim();
        if (id) ins.run(PR(id), (c[idx.date] || '').trim(), Number(c[idx.exception_type]) || 0);
      });
      db.exec('COMMIT');
    }
    const stTxt = readKml('stop_times.txt');
    if (!stTxt) throw new Error('ZIP KMŁ bez stop_times.txt, przerywam.');
    {
      const ins = db.prepare('INSERT INTO stop_times (trip_id, stop_id, arr_sec, dep_sec, seq) VALUES (?, ?, ?, ?, ?)');
      const { header } = splitHeader(stTxt);
      const ti = header.indexOf('trip_id'), ai = header.indexOf('arrival_time'),
        di = header.indexOf('departure_time'), si = header.indexOf('stop_id'), qi = header.indexOf('stop_sequence');
      let batch = 0;
      db.exec('BEGIN');
      let pos = stTxt.indexOf('\n') + 1;
      const len = stTxt.length;
      while (pos < len) {
        let nl = stTxt.indexOf('\n', pos);
        if (nl === -1) nl = len;
        let line = stTxt.slice(pos, nl);
        pos = nl + 1;
        if (line.endsWith('\r')) line = line.slice(0, -1);
        if (!line.trim()) continue;
        const c = line.split(',');
        const tid = (c[ti] || '').trim();
        if (!tid) continue;
        const arr = (c[ai] || '').trim() || '00:00:00';
        ins.run(PR(tid), PS((c[si] || '').trim()), hmsToSec(arr), hmsToSec((c[di] || '').trim() || arr), Number(c[qi]) || 0);
        counts.stopTimes++;
        counts.kmlStopTimes++;
        if (++batch >= 50000) { db.exec('COMMIT'); db.exec('BEGIN'); batch = 0; }
      }
      db.exec('COMMIT');
    }
    kmlInfo = {
      kind: 'gtfs-zip', url: KML_GTFS_URL, version: kmlVersion || null,
      stations: railGeo.size, routes: trainOf.size, trips: counts.kmlTrips,
      stopTimes: counts.kmlStopTimes, skippedTripsNoNumber: skippedNoNumber,
    };
    log(`KMŁ: stations=${railGeo.size} routes=${trainOf.size} trips=${counts.kmlTrips} stopTimes=${counts.kmlStopTimes}`);
  }

  // 6a2. Koleje Śląskie ze statycznego GTFS (tylko GZM, bez klucza).
  // Ten sam wzorzec co KMŁ: trasy grupujemy po numerze pociągu (pierwszy
  // token trip_short_name), live dopina się po numerze (brygada zbiorkom,
  // agencja KS). Numery parzyste "34052/34053" to obie strony kursu:
  // druga strona dostaje alias z sufiksem, żeby brygada wracała też.
  if (CITY === 'gzm') {
    const zipPath = join(work, 'ks.zip');
    log('pobieranie ZIP KŚ…');
    const zipBuf = await fetchBuffer(KS_GTFS_URL, KS_UA, 180000);
    writeFileSync(zipPath, zipBuf);
    log('ZIP KŚ:', (zipBuf.length / 1048576).toFixed(1), 'MB');
    const txtDir = join(work, 'ks');
    mkdirSync(txtDir, { recursive: true });
    try {
      execFileSync('unzip', ['-o', '-j', zipPath, ...NEEDED, '-d', txtDir], { stdio: 'pipe' });
    } catch (e) {
      if (e && (e.code === 'ENOENT' || /not found/i.test(String(e.message || '')))) {
        rmSync(work, { recursive: true, force: true });
        throw new Error('Brak programu `unzip` w PATH (linux/macos: standard; Windows: Git Bash/WSL).');
      }
      warn('unzip dla KŚ zwrócił błąd (kontynuuję, zweryfikuję pliki):', String((e && e.message) || e).slice(0, 160));
    }
    const readKs = (n) => {
      try { return readFileSync(join(txtDir, n), 'utf8'); } catch { return null; }
    };
    const PS = (id) => `KS:S:${id}`;
    const PR = (id) => `KS:${id}`;
    const stopsTxt = readKs('stops.txt');
    if (!stopsTxt) throw new Error('ZIP KŚ bez stops.txt, przerywam (nie nadpisuję R2 pustką).');
    {
      const ins = db.prepare('INSERT OR REPLACE INTO stops (stop_id, code, name, lat, lon, norm) VALUES (?, ?, ?, ?, ?, ?)');
      db.exec('BEGIN');
      eachRow(stopsTxt, (c, idx) => {
        const id = (c[idx.stop_id] || '').trim();
        const name = (c[idx.stop_name] || '').trim();
        if (!id || !name) return;
        const lat = Number(c[idx.stop_lat]) || 0;
        const lon = Number(c[idx.stop_lon]) || 0;
        if (!lat || !lon) { unresolvedCount++; return; }
        ins.run(PS(id), (c[idx.stop_code] || '').trim(), titleCasePl(name), lat, lon, normalizePolish(name));
        railGeo.set(id, { name: titleCasePl(name), lat, lon });
        counts.stops++;
        counts.ksStations++;
      });
      db.exec('COMMIT');
    }
    const calTxt = readKs('calendar.txt');
    if (calTxt) {
      const ins = db.prepare('INSERT OR REPLACE INTO calendar (service_id, mon, tue, wed, thu, fri, sat, sun, start_date, end_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
      db.exec('BEGIN');
      eachRow(calTxt, (c, idx) => {
        const id = (c[idx.service_id] || '').trim();
        if (!id) return;
        ins.run(PR(id), Number(c[idx.monday]) || 0, Number(c[idx.tuesday]) || 0, Number(c[idx.wednesday]) || 0,
          Number(c[idx.thursday]) || 0, Number(c[idx.friday]) || 0, Number(c[idx.saturday]) || 0, Number(c[idx.sunday]) || 0,
          (c[idx.start_date] || '').trim(), (c[idx.end_date] || '').trim());
      });
      db.exec('COMMIT');
    }
    const calDatesTxt = readKs('calendar_dates.txt');
    if (calDatesTxt) {
      const ins = db.prepare('INSERT INTO calendar_dates (service_id, date, exc) VALUES (?, ?, ?)');
      db.exec('BEGIN');
      eachRow(calDatesTxt, (c, idx) => {
        const id = (c[idx.service_id] || '').trim();
        if (id) ins.run(PR(id), (c[idx.date] || '').trim(), Number(c[idx.exception_type]) || 0);
      });
      db.exec('COMMIT');
    }
    const tripsTxt = readKs('trips.txt');
    if (!tripsTxt) throw new Error('ZIP KŚ bez trips.txt, przerywam.');
    const trainOf = new Map(); // numer pociągu -> routeId
    const ksAliases = new Map(); // trip_id -> dopisane aliasy (druga strona "a/b")
    let skippedNoNumber = 0;
    {
      const insRoute = db.prepare('INSERT OR REPLACE INTO routes (route_id, short, long_name, type) VALUES (?, ?, ?, ?)');
      const insTrip = db.prepare('INSERT OR REPLACE INTO trips (trip_id, route_id, service_id, headsign, direction, shape) VALUES (?, ?, ?, ?, ?, ?)');
      db.exec('BEGIN');
      eachRow(tripsTxt, (c, idx) => {
        const tid = (c[idx.trip_id] || '').trim();
        const sid = (c[idx.service_id] || '').trim();
        if (!tid || !sid) return;
        const fullShort = (c[idx.trip_short_name] || '').trim();
        const nums = (fullShort.split(/\s/)[0] || '').split('/').map((s) => s.trim()).filter(Boolean);
        const num = nums[0] || '';
        if (!num) { skippedNoNumber++; return; }
        const headsign = (c[idx.trip_headsign] || '').trim();
        const direction = Number(c[idx.direction_id]) || 0;
        const shape = (c[idx.shape_id] || '').trim();
        const putTrip = (tripId, trainNum) => {
          const routeId = `KS:R:${trainNum}`;
          if (!trainOf.has(trainNum)) {
            insRoute.run(routeId, trainNum, headsign || trainNum, 2);
            trainOf.set(trainNum, routeId);
            counts.routes++;
            counts.ksRoutes++;
          }
          insTrip.run(PR(tripId), routeId, PR(sid), headsign, direction, shape);
          counts.trips++;
          counts.ksTrips++;
        };
        putTrip(tid, num);
        if (nums[1] && nums[1] !== num) {
          const alias = `${tid}#b`;
          putTrip(alias, nums[1]);
          if (!ksAliases.has(tid)) ksAliases.set(tid, []);
          ksAliases.get(tid).push(alias);
        }
      });
      db.exec('COMMIT');
    }
    if (skippedNoNumber > 0) log(`KŚ: pominięto ${skippedNoNumber} kursów bez numeru pociągu`);
    const stTxt = readKs('stop_times.txt');
    if (!stTxt) throw new Error('ZIP KŚ bez stop_times.txt, przerywam.');
    {
      const ins = db.prepare('INSERT INTO stop_times (trip_id, stop_id, arr_sec, dep_sec, seq) VALUES (?, ?, ?, ?, ?)');
      const { header } = splitHeader(stTxt);
      const ti = header.indexOf('trip_id'), ai = header.indexOf('arrival_time'),
        di = header.indexOf('departure_time'), si = header.indexOf('stop_id'), qi = header.indexOf('stop_sequence');
      let batch = 0;
      db.exec('BEGIN');
      let pos = stTxt.indexOf('\n') + 1;
      const len = stTxt.length;
      while (pos < len) {
        let nl = stTxt.indexOf('\n', pos);
        if (nl === -1) nl = len;
        let line = stTxt.slice(pos, nl);
        pos = nl + 1;
        if (line.endsWith('\r')) line = line.slice(0, -1);
        if (!line.trim()) continue;
        const c = line.split(',');
        const tid = (c[ti] || '').trim();
        if (!tid) continue;
        const arr = (c[ai] || '').trim() || '00:00:00';
        const ids = [tid, ...(ksAliases.get(tid) ?? [])];
        for (const id of ids) {
          ins.run(PR(id), PS((c[si] || '').trim()), hmsToSec(arr), hmsToSec((c[di] || '').trim() || arr), Number(c[qi]) || 0);
          counts.stopTimes++;
          counts.ksStopTimes++;
        }
        if (++batch >= 50000) { db.exec('COMMIT'); db.exec('BEGIN'); batch = 0; }
      }
      db.exec('COMMIT');
    }
    ksInfo = {
      kind: 'gtfs-zip', url: KS_GTFS_URL, version: ksVersion || null,
      stations: railGeo.size, routes: trainOf.size, trips: counts.ksTrips,
      stopTimes: counts.ksStopTimes, skippedTripsNoNumber: skippedNoNumber,
    };
    log(`KŚ: stations=${railGeo.size} routes=${trainOf.size} trips=${counts.ksTrips} stopTimes=${counts.ksStopTimes}`);
  }

  // 6a3. IC + Polregio z PDP API (tylko GZM, ten sam klucz co KD).
  // Kursy grupujemy po numerze pociągu (brygada z live to goły numer),
  // trasy po (sid, oid) jak KD. PDP zwraca tylko stacje z zapytania,
  // więc odcinki są z natury ucięte do GZM; kursy z <2 postojami
  // w GZM odrzucamy. Współrzędne najpierw z KŚ (te same fizyczne
  // stacje), brakujące geokodujemy jak KD.
  if (CITY === 'gzm') {
    const GZM_COORDS_FILE = process.env.GZM_COORDS_FILE || join(DATA, 'gzm-station-coords.json');
    const gzmIds = await pdpGzmStationIds();
    if (gzmIds.length === 0) throw new Error('GZM: pusta lista stacji (PDP cities), przerywam.');
    log(`GZM: ${gzmIds.length} stacji w PDP`);
    const gzmSet = new Set(gzmIds.map(String));
    const { from, to, routes, dict } = await pdpGzmRail(gzmIds);
    const stationNames = stationNamesFromDict(dict);
    const ksGeoByNorm = new Map();
    for (const g of railGeo.values()) ksGeoByNorm.set(normalizePolish(g.name), g);
    let coords = { stations: {} };
    try {
      const raw = readFileSync(GZM_COORDS_FILE, 'utf8');
      coords = JSON.parse(raw);
      if (!coords.stations) coords.stations = {};
    } catch {}
    for (const [id, c] of Object.entries(coords.stations)) {
      if (!stationNames[id] && c?.name) stationNames[id] = c.name;
    }
    log(`IC/PR: nazw stacji: ${Object.keys(stationNames).length} (ze słownika PDP + cache + KŚ)`);
    const unresolved = [];
    const unnamed = new Set();
    const outsideEnvelope = new Set();
    let skippedNoTimes = 0;
    let skippedOutside = 0;
    const ensureCoords = async (id, name) => {
      const known = ksGeoByNorm.get(normalizePolish(name));
      if (known) return known;
      if (coords.stations[id]?.lat) return coords.stations[id];
      await sleep(1100); // uprzejmie dla Nominatim (max 1 req/s)
      try {
        const g = await geocodeStation(name, GZM_BBOX, 'Polska');
        if (g) {
          coords.stations[id] = { name, lat: g.lat, lon: g.lon, updatedAt: new Date().toISOString().slice(0, 10) };
          log(`geocode OK: ${name} → ${g.lat.toFixed(5)},${g.lon.toFixed(5)}`);
          return coords.stations[id];
        }
      } catch (e) {
        warn(`geocode fail ${name}:`, String(e));
      }
      unresolved.push({ id, name });
      return null;
    };

    const insStop = db.prepare('INSERT OR REPLACE INTO stops (stop_id, code, name, lat, lon, norm) VALUES (?, ?, ?, ?, ?, ?)');
    const insRoute = db.prepare('INSERT OR REPLACE INTO routes (route_id, short, long_name, type) VALUES (?, ?, ?, ?)');
    const insTrip = db.prepare('INSERT OR REPLACE INTO trips (trip_id, route_id, service_id, headsign, direction, shape) VALUES (?, ?, ?, ?, ?, ?)');
    const insSt = db.prepare('INSERT INTO stop_times (trip_id, stop_id, arr_sec, dep_sec, seq) VALUES (?, ?, ?, ?, ?)');
    const insCal = db.prepare('INSERT OR REPLACE INTO calendar (service_id, mon, tue, wed, thu, fri, sat, sun, start_date, end_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    const insCalDate = db.prepare('INSERT INTO calendar_dates (service_id, date, exc) VALUES (?, ?, ?)');
    db.exec('BEGIN');
    const seenStops = new Set();
    const seenRoutes = new Set();
    const perCc = { IC: { stations: 0, routes: 0, trips: 0, stopTimes: 0 }, PR: { stations: 0, routes: 0, trips: 0, stopTimes: 0 } };
    for (const r of routes) {
      const cc = (r.cc || r.carrierCode || '');
      if (cc !== 'IC' && cc !== 'PR') continue;
      const stat = perCc[cc];
      const sid = r.sid ?? r.scheduleId;
      const oid = r.oid ?? r.orderId;
      const dates = r.od || r.operatingDates || [];
      const stopsSorted = [...(r.st || r.stations || [])]
        .sort((a, b) => (Number(a.ord ?? a.orderNumber) || 0) - (Number(b.ord ?? b.orderNumber) || 0))
        .filter((s) => gzmSet.has(String(s.id ?? s.stationId)));
      if (sid == null || oid == null || dates.length === 0) continue;
      // Rozwiąż nazwy i współrzędne, potem odsiej stacje spoza obwiedni GZM
      // (drugie zabezpieczenie po precyzyjnym dopasowaniu gmin: stacja
      // z innego regionu nie może tworzyć lokalnego odcinka).
      const stops = [];
      let ok = true;
      for (const s of stopsSorted) {
        const id = String(s.id ?? s.stationId);
        const nm = stationNames[id];
        if (!nm) { unnamed.add(id); ok = false; break; }
        const geo = await ensureCoords(id, nm);
        if (!geo) { ok = false; break; }
        if (geo.lat < GZM_ENVELOPE.minLat || geo.lat > GZM_ENVELOPE.maxLat ||
            geo.lon < GZM_ENVELOPE.minLon || geo.lon > GZM_ENVELOPE.maxLon) {
          outsideEnvelope.add(id);
          continue;
        }
        stops.push({ id, nm, geo, t: stopTimesOf(s) });
      }
      if (!ok) continue;
      if (stops.length < 2) { skippedOutside++; continue; }
      if (stops.some((s) => s.t === null)) { skippedNoTimes++; continue; }
      for (const s of stops) {
        if (!seenStops.has(`${cc}:${s.id}`)) {
          insStop.run(`${cc}:S:${s.id}`, s.id, s.nm, s.geo.lat, s.geo.lon, normalizePolish(s.nm));
          seenStops.add(`${cc}:${s.id}`);
          railGeo.set(`${cc}:S:${s.id}`, { stopId: `${cc}:S:${s.id}`, name: s.nm, lat: s.geo.lat, lon: s.geo.lon });
          counts.stops++;
          stat.stations++;
        }
      }
      const num = String(r.nn ?? r.nationalNumber ?? r.nm ?? r.name ?? `${sid}/${oid}`);
      const routeId = `${cc}:R:${sid}:${oid}`;
      const svc = `${cc}:svc:${sid}:${oid}`;
      const firstName = stops[0].nm;
      const lastName = stops[stops.length - 1].nm;
      if (!seenRoutes.has(routeId)) {
        insRoute.run(routeId, num, `${firstName} – ${lastName}`, 2);
        seenRoutes.add(routeId);
        counts.routes++;
        stat.routes++;
        insCal.run(svc, 0, 0, 0, 0, 0, 0, 0, '', '');
      }
      for (const d of dates) {
        const dc = ymdCompact(d);
        const tripId = `${cc}:T:${sid}:${oid}:${dc}`;
        insTrip.run(tripId, routeId, svc, lastName, 0, '');
        counts.trips++;
        stat.trips++;
        for (let i = 0; i < stops.length; i++) {
          insSt.run(tripId, `${cc}:S:${stops[i].id}`, stops[i].t.arr, stops[i].t.dep, i + 1);
          counts.stopTimes++;
          stat.stopTimes++;
        }
        insCalDate.run(svc, dc, 1);
      }
    }
    db.exec('COMMIT');
    if (unnamed.size > 0) warn(`IC/PR: ${unnamed.size} stacji bez nazwy (brak w słowniku PDP i cache): ${[...unnamed].join(', ')}`);
    if (outsideEnvelope.size > 0) warn(`IC/PR: ${outsideEnvelope.size} stacji poza obwiednią GZM (pominięte): ${[...outsideEnvelope].join(', ')}`);
    if (skippedNoTimes > 0) log(`IC/PR: pominięto ${skippedNoTimes} kursów bez pełnych czasów`);
    if (skippedOutside > 0) log(`IC/PR: pominięto ${skippedOutside} kursów z <2 postojami w GZM`);
    if (WRITE_COORDS) {
      writeFileSync(GZM_COORDS_FILE, JSON.stringify(coords, null, 2) + '\n');
      log('zapisano cache współrzędnych →', GZM_COORDS_FILE, '(przejrzyj diffa przed commitem!)');
    } else {
      log(`współrzędne GZM: ${Object.keys(coords.stations).length} z cache/geokodowania (nie zapisuję pliku bez --write-coords).`);
    }
    icInfo = {
      kind: 'pdp-api', carriers: 'IC', windowFrom: from, windowTo: to,
      stations: perCc.IC.stations, routes: perCc.IC.routes, trips: perCc.IC.trips,
      stopTimes: perCc.IC.stopTimes, schedulesVersion: icprVersion,
      unresolvedStations: unresolved, unnamedStations: [...unnamed],
      skippedTripsNoTimes: skippedNoTimes, skippedOutsideGzm: skippedOutside,
    };
    prInfo = {
      kind: 'pdp-api', carriers: 'PR', windowFrom: from, windowTo: to,
      stations: perCc.PR.stations, routes: perCc.PR.routes, trips: perCc.PR.trips,
      stopTimes: perCc.PR.stopTimes, schedulesVersion: icprVersion,
      unresolvedStations: unresolved, unnamedStations: [...unnamed],
      skippedTripsNoTimes: skippedNoTimes, skippedOutsideGzm: skippedOutside,
    };
    counts.icStations = perCc.IC.stations; counts.icRoutes = perCc.IC.routes;
    counts.icTrips = perCc.IC.trips; counts.icStopTimes = perCc.IC.stopTimes;
    counts.prStations = perCc.PR.stations; counts.prRoutes = perCc.PR.routes;
    counts.prTrips = perCc.PR.trips; counts.prStopTimes = perCc.PR.stopTimes;
    log(`IC: stations=${perCc.IC.stations} routes=${perCc.IC.routes} trips=${perCc.IC.trips} stopTimes=${perCc.IC.stopTimes}`);
    log(`PR: stations=${perCc.PR.stations} routes=${perCc.PR.routes} trips=${perCc.PR.trips} stopTimes=${perCc.PR.stopTimes}`);
  }

  // 6a4. KM + WKD ze statycznych feedów (tylko Warszawa, bez klucza PDP).
  // KM: ogólno-polski feed PLK (polish_trains.zip, agencja KM), filtrowany do
  // kursów dotykających Warszawy. WKD: własny feed (cała jedna linia).
  // Trasy grupujemy po numerze pociągu (brygada z live to goły numer, ten sam
  // wzorzec co KMŁ/KŚ). SKA jeździ z GTFS WTP i przesiadek nie potrzebuje
  // (te same przystanki co miasto).
  if (CITY === 'warszawa') {
    const kmZipPath = join(work, 'km.zip');
    log('pobieranie ZIP KM…');
    const kmBuf = await fetchBuffer(KM_GTFS_URL, KM_UA, 180000);
    writeFileSync(kmZipPath, kmBuf);
    log('ZIP KM:', (kmBuf.length / 1048576).toFixed(1), 'MB');
    const kmDir = join(work, 'km');
    mkdirSync(kmDir, { recursive: true });
    try {
      execFileSync('unzip', ['-o', '-j', kmZipPath, ...NEEDED, '-d', kmDir], { stdio: 'pipe' });
    } catch (e) {
      warn('unzip dla KM zwrócił błąd (kontynuuję, zweryfikuję pliki):', String((e && e.message) || e).slice(0, 160));
    }
    const kmStat = importStaticRailFeed(db, {
      tag: 'KM', dir: kmDir, prefix: 'KM', agency: 'KM', touchEnvelope: true,
      trainNum: (c, idx) => ((c[idx.trip_short_name] || '').trim().split(/\s/)[0] || '').split('/')[0].trim(),
      counts, railGeo,
    });
    counts.kmStations = kmStat.stations; counts.kmRoutes = kmStat.routes;
    counts.kmTrips = kmStat.trips; counts.kmStopTimes = kmStat.stopTimes;
    kmInfo = { kind: 'gtfs-zip', url: KM_GTFS_URL, version: kmVersion || null, ...kmStat };

    const wkdZipPath = join(work, 'wkd.zip');
    log('pobieranie ZIP WKD…');
    const wkdBuf = await fetchBuffer(WKD_GTFS_URL, WKD_UA, 180000);
    writeFileSync(wkdZipPath, wkdBuf);
    log('ZIP WKD:', (wkdBuf.length / 1048576).toFixed(1), 'MB');
    const wkdDir = join(work, 'wkd');
    mkdirSync(wkdDir, { recursive: true });
    try {
      execFileSync('unzip', ['-o', '-j', wkdZipPath, ...NEEDED, '-d', wkdDir], { stdio: 'pipe' });
    } catch (e) {
      warn('unzip dla WKD zwrócił błąd (kontynuuję, zweryfikuję pliki):', String((e && e.message) || e).slice(0, 160));
    }
    const wkdStat = importStaticRailFeed(db, {
      tag: 'WKD', dir: wkdDir, prefix: 'WKD', agency: null, touchEnvelope: false,
      trainNum: (c, idx) => (c[idx.trip_short_name] || '').trim(),
      counts, railGeo,
    });
    counts.wkdStations = wkdStat.stations; counts.wkdRoutes = wkdStat.routes;
    counts.wkdTrips = wkdStat.trips; counts.wkdStopTimes = wkdStat.stopTimes;
    wkdInfo = { kind: 'gtfs-zip', url: WKD_GTFS_URL, version: wkdVersion || null, ...wkdStat };
  }

  // 6a5. Koleje Wielkopolskie ze statycznego GTFS (tylko Poznań, bez klucza).
  // Feed obejmuje całe województwo, więc łapiemy tylko kursy dotykające
  // aglomeracji (ten sam wzorzec co KM w Warszawie). Numer pociągu siedzi
  // w trip_short_name (goła liczba, np. "70272"), a brygada z live (zbiorkom,
  // agencja KW) to ten sam numer. ZKA (route_type 3) jedzie jako autobus.
  if (CITY === 'poznan') {
    const kwZipPath = join(work, 'kw.zip');
    log('pobieranie ZIP KW…');
    const kwBuf = await fetchBuffer(KW_GTFS_URL, KW_UA, 180000);
    writeFileSync(kwZipPath, kwBuf);
    log('ZIP KW:', (kwBuf.length / 1048576).toFixed(1), 'MB');
    const kwDir = join(work, 'kw');
    mkdirSync(kwDir, { recursive: true });
    try {
      execFileSync('unzip', ['-o', '-j', kwZipPath, ...NEEDED, '-d', kwDir], { stdio: 'pipe' });
    } catch (e) {
      warn('unzip dla KW zwrócił błąd (kontynuuję, zweryfikuję pliki):', String((e && e.message) || e).slice(0, 160));
    }
    const kwStat = importStaticRailFeed(db, {
      tag: 'KW', dir: kwDir, prefix: 'KW', agency: 'KW', touchEnvelope: true,
      envelope: POZ_ENVELOPE,
      trainNum: (c, idx) => ((c[idx.trip_short_name] || '').trim().split(/\s/)[0] || '').split('/')[0].trim(),
      counts, railGeo,
    });
    counts.kwStations = kwStat.stations; counts.kwRoutes = kwStat.routes;
    counts.kwTrips = kwStat.trips; counts.kwStopTimes = kwStat.stopTimes;
    kwInfo = { kind: 'gtfs-zip', url: KW_GTFS_URL, version: kwVersion || null, ...kwStat };
  }

  // 6a6. SKM ze statycznego GTFS (tylko Trójmiasto, bez klucza).
  // Feed sięga Słupska, więc łapiemy tylko kursy dotykające aglomeracji
  // (ten sam wzorzec co KM/KW). Numer pociągu siedzi w trip_short_name
  // (goła liczba, np. "59606"), a brygada z live (zbiorkom, agencja SKMT)
  // to ten sam numer. Cały feed to jeden przewoźnik (SKMTr), a routes.txt
  // nie ma kolumny agency_id, więc filtr agencji jest wyłączony jak w WKD.
  if (CITY === 'trojmiasto') {
    const skmtZipPath = join(work, 'skmt.zip');
    log('pobieranie ZIP SKM…');
    const skmtBuf = await fetchBuffer(SKMT_GTFS_URL, SKMT_UA, 180000);
    writeFileSync(skmtZipPath, skmtBuf);
    log('ZIP SKM:', (skmtBuf.length / 1048576).toFixed(1), 'MB');
    const skmtDir = join(work, 'skmt');
    mkdirSync(skmtDir, { recursive: true });
    try {
      execFileSync('unzip', ['-o', '-j', skmtZipPath, ...NEEDED, '-d', skmtDir], { stdio: 'pipe' });
    } catch (e) {
      warn('unzip dla SKM zwrócił błąd (kontynuuję, zweryfikuję pliki):', String((e && e.message) || e).slice(0, 160));
    }
    const skmtStat = importStaticRailFeed(db, {
      tag: 'SKMT', dir: skmtDir, prefix: 'SKMT', agency: null, touchEnvelope: true,
      envelope: TRI_ENVELOPE, titleCase: true,
      trainNum: (c, idx) => ((c[idx.trip_short_name] || '').trim().split(/\s/)[0] || '').split('/')[0].trim(),
      counts, railGeo,
    });
    counts.skmtStations = skmtStat.stations; counts.skmtRoutes = skmtStat.routes;
    counts.skmtTrips = skmtStat.trips; counts.skmtStopTimes = skmtStat.stopTimes;
    skmtInfo = { kind: 'gtfs-zip', url: SKMT_GTFS_URL, upstream: SKMT_GTFS_UPSTREAM, version: skmtVersion || null, ...skmtStat };
  }

  // 6a7. Łódzka Kolej Aglomeracyjna ze statycznego GTFS (tylko Łódź, bez klucza).
  // Feed obejmuje całe województwo, więc łapiemy tylko kursy dotykające
  // aglomeracji (ten sam wzorzec co KM w Warszawie i KW w Poznaniu). Numer
  // pociągu to pierwszy token trip_short_name przed "/" (np. "11572"
  // z "11572/3" albo z "11545 Kopciuszek do Koluszek"), a brygada z live
  // (zbiorkom, agencja LKA) to ten sam numer. ZKA (route_type 3) jedzie jako
  // autobus.
  if (CITY === 'lodz') {
    const lkaZipPath = join(work, 'lka.zip');
    log('pobieranie ZIP ŁKA…');
    const lkaBuf = await fetchBuffer(LKA_GTFS_URL, LKA_UA, 180000);
    writeFileSync(lkaZipPath, lkaBuf);
    log('ZIP ŁKA:', (lkaBuf.length / 1048576).toFixed(1), 'MB');
    const lkaDir = join(work, 'lka');
    mkdirSync(lkaDir, { recursive: true });
    try {
      execFileSync('unzip', ['-o', '-j', lkaZipPath, ...NEEDED, '-d', lkaDir], { stdio: 'pipe' });
    } catch (e) {
      warn('unzip dla ŁKA zwrócił błąd (kontynuuję, zweryfikuję pliki):', String((e && e.message) || e).slice(0, 160));
    }
    const lkaStat = importStaticRailFeed(db, {
      tag: 'ŁKA', dir: lkaDir, prefix: 'LKA', agency: 'LKA', touchEnvelope: true,
      envelope: LODZ_ENVELOPE,
      trainNum: (c, idx) => ((c[idx.trip_short_name] || '').trim().split(/\s/)[0] || '').split('/')[0].trim(),
      counts, railGeo,
    });
    counts.lkaStations = lkaStat.stations; counts.lkaRoutes = lkaStat.routes;
    counts.lkaTrips = lkaStat.trips; counts.lkaStopTimes = lkaStat.stopTimes;
    lkaInfo = { kind: 'gtfs-zip', url: LKA_GTFS_URL, version: lkaVersion || null, ...lkaStat };
  }

  // 6b. Przesiadki miasto<->kolej. Stacja kolejowa to nie słupek przy torach:
  // perony bywają schowane (Dworzec Główny: przystanek ~300 m od peronów
  // + hala i schody), więc linki liczymy hojnie. Aplikacja dokleja je do
  // footpaths i ZASTĘPUJE nimi gridowe linki między tymi samymi parami
  // (grid liczy sam dystans w linii prostej — bez zapasu na peron).
  let interchangeCount = 0;
  if (railGeo.size > 0 && cityStops.length > 0) {
    const links = new Map(); // "a|b" (posortowane) -> { a, b, walkSec }
    const link = (a, b, walkSec) => {
      const [x, y] = a < b ? [a, b] : [b, a];
      const k = `${x}|${y}`;
      const prev = links.get(k);
      if (!prev || walkSec > prev.walkSec) links.set(k, { a: x, b: y, walkSec });
    };
    const computed = (distM) => Math.max(INTERCHANGE_MIN_SEC, Math.round(distM * IX_WALK_DETOUR / IX_WALK_SPEED_MPS));
    for (const [kid, g] of railGeo) {
      // IC/PR niosą pełny stop_id w geolokalizacji (prefiks per przewoźnik),
      // reszta (KD/KML/KS) buduje go z RAIL_PREFIX jak dotąd.
      const kStopId = g.stopId ?? `${RAIL_PREFIX}:S:${kid}`;
      const gnorm = normalizePolish(g.name);
      const isGlowny = gnorm.includes('glowny');
      // Warszawa Centralna to ten sam kaliber węzła co wrocławski Główny
      // (hala + przejścia na perony), więc słupki „Dworzec Centralny"
      // dostają ten sam gwarantowany link z zapasem.
      const isCentral = gnorm.includes('centraln');
      const isHub = isGlowny || isCentral;
      const hubStop = (m) => m.norm.includes('dworzec glowny') || (isCentral && m.norm.includes('centraln'));
      for (const m of cityStops) {
        const dist = haversineM(g.lat, g.lon, m.lat, m.lon);
        if (dist <= INTERCHANGE_RADIUS_M) {
          // Dworzec Główny: słupki są blisko w linii prostej (~150 m), ale
          // pieszo to hala + przejście podziemne na perony — twardy zapas.
          const floor = isHub && hubStop(m) ? GLOWNY_OVERRIDE_SEC : INTERCHANGE_MIN_SEC;
          link(kStopId, m.id, Math.max(floor, computed(dist)));
        } else if (isHub && dist <= GLOWNY_OVERRIDE_RADIUS_M && hubStop(m)) {
          // Dalsze słupki węzła (Dworcowa/Stawowa/MDK, Aleje Jerozolimskie)
          // — gwarantowany link z zapasem, nawet spoza standardowego promienia.
          link(kStopId, m.id, Math.max(GLOWNY_OVERRIDE_SEC, computed(dist)));
        }
      }
    }
    if (links.size > 0) {
      const ins = db.prepare('INSERT INTO interchanges (from_stop_id, to_stop_id, walk_sec, kind) VALUES (?, ?, ?, ?)');
      db.exec('BEGIN');
      for (const l of links.values()) ins.run(l.a, l.b, l.walkSec, CITY === 'krakow' ? 'kml-ztp' : CITY === 'gzm' ? 'rail-ztm' : CITY === 'warszawa' ? 'wtp-rail' : CITY === 'poznan' ? 'ztm-kw' : CITY === 'trojmiasto' ? 'ztm-skm' : CITY === 'lodz' ? 'zdit-lka' : 'mpk-kd');
      db.exec('COMMIT');
      interchangeCount = links.size;
    }
    log(`interchanges kolej<->miasto: ${interchangeCount} (stacji kolei: ${railGeo.size})`);
    if (railGeo.size > 0 && interchangeCount === 0) {
      warn('zero linków przesiadkowych: stacje kolei bez połączenia z miastem (sprawdź współrzędne!)');
    }
  }
  if (kdInfo && !kdInfo.skippedReason) kdInfo.interchanges = interchangeCount;
  if (kmlInfo && !kmlInfo.skippedReason) kmlInfo.interchanges = interchangeCount;
  if (ksInfo && !ksInfo.skippedReason) ksInfo.interchanges = interchangeCount;
  if (icInfo && !icInfo.skippedReason) icInfo.interchanges = interchangeCount;
  if (prInfo && !prInfo.skippedReason) prInfo.interchanges = interchangeCount;
  if (kmInfo && !kmInfo.skippedReason) kmInfo.interchanges = interchangeCount;
  if (wkdInfo && !wkdInfo.skippedReason) wkdInfo.interchanges = interchangeCount;
  if (kwInfo && !kwInfo.skippedReason) kwInfo.interchanges = interchangeCount;
  if (skmtInfo && !skmtInfo.skippedReason) skmtInfo.interchanges = interchangeCount;
  if (lkaInfo && !lkaInfo.skippedReason) lkaInfo.interchanges = interchangeCount;

  // 6c. Twarda bramka, tylko Wrocław: bez pełnego, realnego KD nie
  // nadpisujemy R2. Baza MPK-only albo z niekompletnym KD to dokładnie ta
  // atrapa, której nie chcemy w APK. Wszystkie cztery sekcje muszą być niepuste.
  if (CITY === 'wroclaw' && !ALLOW_MPK_ONLY) {
    const problems = [];
    if (counts.kdStations === 0) problems.push('0 stacji KD');
    if (counts.kdRoutes === 0) problems.push('0 tras KD');
    if (counts.kdTrips === 0) problems.push('0 kursów KD');
    if (interchangeCount === 0) problems.push('0 przesiadek MPK<->KD');
    // Zdegenerowane współrzędne (dawniej: 30 stacji w 4 punktach) psują przesiadki.
    const uniqueKdCoords = new Set([...railGeo.values()].map((g) => `${g.lat.toFixed(5)},${g.lon.toFixed(5)}`)).size;
    if (railGeo.size >= 2 && uniqueKdCoords < railGeo.size * 0.9) {
      problems.push(`współrzędne KD zdegenerowane (${uniqueKdCoords} różnych punktów dla ${railGeo.size} stacji)`);
    }
    const kdPlaceholderNames = [...railGeo.values()].filter((g) => /^Stacja \d+$/.test(g.name)).length;
    if (kdPlaceholderNames > 0) problems.push(`${kdPlaceholderNames} stacji KD z zastępczą nazwą "Stacja NNN"`);
    if (problems.length > 0) {
      rmSync(work, { recursive: true, force: true });
      throw new Error(`niepełne realne KD (${problems.join(', ')}): nie publikuję bazy. Napraw źródło KD (klucz/współrzędne) albo użyj --allow-mpk-only tylko do diagnostyki.`);
    }
    if (unresolvedCount > 0) {
      warn(`KD: ${unresolvedCount} stacji bez współrzędnych, część kursów pominięta (uzupełnij cache: --write-coords).`);
    }
  }

  // 6d. Twarda bramka, Kraków: baza bez pełnych Kolei Małopolskich
  // (albo bez przesiadek na nie) nie nadpisuje R2.
  if (CITY === 'krakow') {
    const problems = [];
    if (counts.kmlStations === 0) problems.push('0 stacji KMŁ');
    if (counts.kmlRoutes === 0) problems.push('0 tras KMŁ');
    if (counts.kmlTrips === 0) problems.push('0 kursów KMŁ');
    if (interchangeCount === 0) problems.push('0 przesiadek KMŁ<->ZTP');
    if (problems.length > 0) {
      rmSync(work, { recursive: true, force: true });
      throw new Error(`niepełne KMŁ (${problems.join(', ')}): nie publikuję bazy.`);
    }
  }

  // 6e. Twarda bramka, GZM: baza bez pełnych Kolei Śląskich, IC albo
  // Polregio (albo bez przesiadek na kolej) nie nadpisuje R2.
  if (CITY === 'gzm') {
    const problems = [];
    if (counts.ksStations === 0) problems.push('0 stacji KŚ');
    if (counts.ksRoutes === 0) problems.push('0 tras KŚ');
    if (counts.ksTrips === 0) problems.push('0 kursów KŚ');
    if (counts.icStations === 0) problems.push('0 stacji IC');
    if (counts.icTrips === 0) problems.push('0 kursów IC');
    if (counts.prStations === 0) problems.push('0 stacji PR');
    if (counts.prTrips === 0) problems.push('0 kursów PR');
    if (interchangeCount === 0) problems.push('0 przesiadek kolej<->ZTM');
    if (problems.length > 0) {
      rmSync(work, { recursive: true, force: true });
      throw new Error(`niepełne koleje GZM (${problems.join(', ')}): nie publikuję bazy.`);
    }
  }

  // 6f. Twarda bramka, Warszawa: baza bez metra, SKA, KM albo WKD
  // (albo bez przesiadek na kolej) nie nadpisuje R2. Metro i SKA jadą
  // z GTFS WTP, więc liczymy je wprost z tabel (route_type 1 i 2 spoza PDP).
  if (CITY === 'warszawa' && !ALLOW_MPK_ONLY) {
    const problems = [];
    let wtpMetroTrips = 0;
    let wtpSkmTrips = 0;
    try {
      const row = db.prepare('SELECT COUNT(*) AS n FROM trips t JOIN routes r ON r.route_id = t.route_id WHERE r.type = 1').get();
      wtpMetroTrips = row?.n ?? 0;
    } catch {}
    try {
      const row = db.prepare("SELECT COUNT(*) AS n FROM trips t JOIN routes r ON r.route_id = t.route_id WHERE r.type = 2 AND r.route_id NOT LIKE 'KM:%' AND r.route_id NOT LIKE 'WKD:%'").get();
      wtpSkmTrips = row?.n ?? 0;
    } catch {}
    if (wtpMetroTrips === 0) problems.push('0 kursów metra M1/M2 (frequencies nie rozwinęły się?)');
    if (wtpSkmTrips === 0) problems.push('0 kursów SKA z GTFS WTP');
    if (counts.kmStations === 0) problems.push('0 stacji KM');
    if (counts.kmTrips === 0) problems.push('0 kursów KM');
    if (counts.wkdStations === 0) problems.push('0 stacji WKD');
    if (counts.wkdTrips === 0) problems.push('0 kursów WKD');
    if (interchangeCount === 0) problems.push('0 przesiadek kolej<->WTP');
    if (problems.length > 0) {
      rmSync(work, { recursive: true, force: true });
      throw new Error(`niepełna Warszawa (${problems.join(', ')}): nie publikuję bazy.`);
    }
    log(`WAW: metro kursów=${wtpMetroTrips} SKA kursów=${wtpSkmTrips}`);
  }

  // 6g. Twarda bramka, Poznań: baza bez pełnych Kolei Wielkopolskich
  // albo bez przesiadek na nie nie nadpisuje R2. Tramwaje (route_type 0)
  // jadą z GTFS ZTM, więc liczymy je wprost z tabeli.
  if (CITY === 'poznan') {
    const problems = [];
    let ztmTramTrips = 0;
    try {
      const row = db.prepare('SELECT COUNT(*) AS n FROM trips t JOIN routes r ON r.route_id = t.route_id WHERE r.type = 0').get();
      ztmTramTrips = row?.n ?? 0;
    } catch {}
    if (ztmTramTrips === 0) problems.push('0 kursów tramwajów ZTM');
    if (counts.kwStations === 0) problems.push('0 stacji KW');
    if (counts.kwRoutes === 0) problems.push('0 tras KW');
    if (counts.kwTrips === 0) problems.push('0 kursów KW');
    if (interchangeCount === 0) problems.push('0 przesiadek KW<->ZTM');
    if (problems.length > 0) {
      rmSync(work, { recursive: true, force: true });
      throw new Error(`niepełny Poznań (${problems.join(', ')}): nie publikuję bazy.`);
    }
    log(`POZNAN: kursów tramwajów ZTM=${ztmTramTrips}`);
  }

  // 6h. Twarda bramka, Trójmiasto: baza bez Gdańska, Gdyni albo SKM
  // (albo bez przesiadek na SKM) nie nadpisuje R2. Tramwaje (route_type 0
  // z prefiksem GDA:) i trolejbusy (route_type 11 z prefiksem GDY:) liczymy
  // wprost z tabel.
  if (CITY === 'trojmiasto') {
    const problems = [];
    let gdaTramTrips = 0;
    let gdyTrolleyTrips = 0;
    let gdyTrips = 0;
    try {
      const row = db.prepare("SELECT COUNT(*) AS n FROM trips t JOIN routes r ON r.route_id = t.route_id WHERE r.type = 0 AND r.route_id LIKE 'GDA:%'").get();
      gdaTramTrips = row?.n ?? 0;
    } catch {}
    try {
      const row = db.prepare("SELECT COUNT(*) AS n FROM trips t JOIN routes r ON r.route_id = t.route_id WHERE r.type = 11 AND r.route_id LIKE 'GDY:%'").get();
      gdyTrolleyTrips = row?.n ?? 0;
    } catch {}
    try {
      const row = db.prepare("SELECT COUNT(*) AS n FROM trips t JOIN routes r ON r.route_id = t.route_id WHERE r.route_id LIKE 'GDY:%'").get();
      gdyTrips = row?.n ?? 0;
    } catch {}
    if (gdaTramTrips === 0) problems.push('0 kursów tramwajów ZTM Gdańsk');
    if (gdyTrips === 0) problems.push('0 kursów ZKM Gdynia');
    if (gdyTrolleyTrips === 0) problems.push('0 kursów trolejbusów ZKM Gdynia');
    if (counts.skmtStations === 0) problems.push('0 stacji SKM');
    if (counts.skmtRoutes === 0) problems.push('0 tras SKM');
    if (counts.skmtTrips === 0) problems.push('0 kursów SKM');
    if (interchangeCount === 0) problems.push('0 przesiadek SKM<->ZTM/ZKM');
    // Niezmiennik: każdy kurs wskazuje serwis obecny w calendar (GDY nie ma
    // calendar.txt, więc build dokłada wiersz-placeholder z calendar_dates).
    let orphanServices = 0;
    try {
      const row = db.prepare('SELECT COUNT(*) AS n FROM trips t LEFT JOIN calendar c ON c.service_id = t.service_id WHERE c.service_id IS NULL').get();
      orphanServices = row?.n ?? 0;
    } catch {}
    if (orphanServices > 0) problems.push(`${orphanServices} kursów z serwisem spoza calendar`);
    if (problems.length > 0) {
      rmSync(work, { recursive: true, force: true });
      throw new Error(`niepełne Trójmiasto (${problems.join(', ')}): nie publikuję bazy.`);
    }
    log(`TROJMIASTO: kursów tramwajów GDA=${gdaTramTrips} trolejbusów GDY=${gdyTrolleyTrips} (całe GDY=${gdyTrips})`);
  }

  // 6i. Twarda bramka, Łódź: baza bez pełnej ŁKA albo bez przesiadek
  // na nią nie nadpisuje R2. Tramwaje (route_type 0) jadą z GTFS ZDiT,
  // więc liczymy je wprost z tabeli jak w Poznaniu.
  if (CITY === 'lodz') {
    const problems = [];
    let zditTramTrips = 0;
    try {
      const row = db.prepare('SELECT COUNT(*) AS n FROM trips t JOIN routes r ON r.route_id = t.route_id WHERE r.type = 0').get();
      zditTramTrips = row?.n ?? 0;
    } catch {}
    if (zditTramTrips === 0) problems.push('0 kursów tramwajów ZDiT');
    if (counts.lkaStations === 0) problems.push('0 stacji ŁKA');
    if (counts.lkaRoutes === 0) problems.push('0 tras ŁKA');
    if (counts.lkaTrips === 0) problems.push('0 kursów ŁKA');
    if (interchangeCount === 0) problems.push('0 przesiadek ŁKA<->ZDiT');
    if (problems.length > 0) {
      rmSync(work, { recursive: true, force: true });
      throw new Error(`niepełna Łódź (${problems.join(', ')}): nie publikuję bazy.`);
    }
    log(`LODZ: kursów tramwajów ZDiT=${zditTramTrips}`);
  }

  // 6j. Twarda bramka, Szczecin: baza bez tramwajów ZDiTM nie nadpisuje R2.
  // Kolei nie ma wcale (SKM Szczecin nie ma publicznego GTFS), więc bramka
  // nie wymaga ani stacji, ani przesiadek kolejowych. Tramwaje (route_type 0)
  // liczymy wprost z tabeli jak w Poznaniu i Łodzi.
  if (CITY === 'szczecin') {
    const problems = [];
    let zditmTramTrips = 0;
    try {
      const row = db.prepare('SELECT COUNT(*) AS n FROM trips t JOIN routes r ON r.route_id = t.route_id WHERE r.type = 0').get();
      zditmTramTrips = row?.n ?? 0;
    } catch {}
    if (zditmTramTrips === 0) problems.push('0 kursów tramwajów ZDiTM');
    if (problems.length > 0) {
      rmSync(work, { recursive: true, force: true });
      throw new Error(`niepełny Szczecin (${problems.join(', ')}): nie publikuję bazy.`);
    }
    log(`SZCZECIN: kursów tramwajów ZDiTM=${zditmTramTrips}`);
  }

  // 6k. Twarda bramka, Lublin: baza bez autobusów albo bez trolejbusów
  // ZDiTM nie nadpisuje R2. Kolei nie ma wcale (POLREGIO/IC nie mają
  // publicznego GTFS w zakresie budowy), więc bramka nie wymaga ani
  // stacji, ani przesiadek kolejowych. Trolejbusy (route_type 11)
  // liczymy wprost z tabeli jak tramwaje w Poznaniu, Łodzi i Szczecinie.
  if (CITY === 'lublin') {
    const problems = [];
    let zditmBusTrips = 0;
    let zditmTrolleyTrips = 0;
    try {
      const bus = db.prepare('SELECT COUNT(*) AS n FROM trips t JOIN routes r ON r.route_id = t.route_id WHERE r.type = 3').get();
      zditmBusTrips = bus?.n ?? 0;
      const tro = db.prepare('SELECT COUNT(*) AS n FROM trips t JOIN routes r ON r.route_id = t.route_id WHERE r.type = 11').get();
      zditmTrolleyTrips = tro?.n ?? 0;
    } catch {}
    if (zditmBusTrips === 0) problems.push('0 kursów autobusów ZDiTM');
    if (zditmTrolleyTrips === 0) problems.push('0 kursów trolejbusów ZDiTM');
    if (problems.length > 0) {
      rmSync(work, { recursive: true, force: true });
      throw new Error(`niepełny Lublin (${problems.join(', ')}): nie publikuję bazy.`);
    }
    log(`LUBLIN: kursów autobusów ZDiTM=${zditmBusTrips} trolejbusów=${zditmTrolleyTrips}`);
  }

  // 7. Wagi, meta, porządki. stop_times jest WITHOUT ROWID z kluczem
  // (trip_id, seq), więc żaden indeks na tej tabeli nie jest potrzebny.
  db.exec('PRAGMA synchronous = NORMAL;');
  log('wagi przystanków…');
  db.exec('UPDATE stops SET weight = 0');
  db.exec('UPDATE stops SET weight = agg.c FROM (SELECT stop_id, COUNT(*) AS c FROM stop_times GROUP BY stop_id) AS agg WHERE agg.stop_id = stops.stop_id');
  // Statystyki planisty (sqlite_stat1): świeży plik nie ma historii zapytań,
  // więc PRAGMA optimize nic by nie dał — jawny ANALYZE robi to deterministycznie.
  // Na telefonie tego nie powtarzamy (import i tak jest ciężki, a indeksy wystarczą).
  log('analyze…');
  db.exec('ANALYZE');
  const version = CITY === 'krakow'
    ? `${todayCompact()}-krk${createHash('sha256').update(`${ztpFingerprint}|${kmlVersion}`).digest('hex').slice(0, 8)}`
    : CITY === 'gzm'
      ? `${todayCompact()}-gzm${createHash('sha256').update(`${gtmFingerprint}|${ksVersion}|${icprVersion}`).digest('hex').slice(0, 8)}`
      : CITY === 'warszawa'
        ? `${todayCompact()}-waw${createHash('sha256').update(`${wawFingerprint}|${kmVersion}|${wkdVersion}`).digest('hex').slice(0, 8)}`
        : CITY === 'poznan'
          ? `${todayCompact()}-poznan${createHash('sha256').update(`${poznanFingerprint}|${kwVersion}`).digest('hex').slice(0, 8)}`
          : CITY === 'trojmiasto'
            ? `${todayCompact()}-tri${createHash('sha256').update(`${gdaFingerprint}|${gdyFingerprint}|${skmtVersion}`).digest('hex').slice(0, 8)}`
            : CITY === 'lodz'
              ? `${todayCompact()}-lodz${createHash('sha256').update(`${lodzFingerprint}|${lkaVersion}`).digest('hex').slice(0, 8)}`
            : CITY === 'szczecin'
              ? `${todayCompact()}-szczecin${createHash('sha256').update(`${szczecinFingerprint}`).digest('hex').slice(0, 8)}`
            : CITY === 'lublin'
              ? `${todayCompact()}-lublin${createHash('sha256').update(`${lublinFingerprint}`).digest('hex').slice(0, 8)}`
            : `${todayCompact()}-mpk${(mpk.effectiveDate || 'unknown').replace(/-/g, '')}-kd${String(kdVersion).slice(0, 8)}`;
  const meta = db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)');
  meta.run('timetable_version', version);
  meta.run('gtfs_imported_at', new Date().toISOString());
  meta.run('gtfs_source', 'network');
  meta.run('feeds', JSON.stringify(CITY === 'krakow' ? { ztp: ztpFingerprint, kml: kmlVersion } : CITY === 'gzm' ? { ztm: gtmFingerprint, ks: ksVersion, icpr: icprVersion } : CITY === 'warszawa' ? { wtp: wawFingerprint, km: kmVersion, wkd: wkdVersion } : CITY === 'poznan' ? { ztm: poznanFingerprint, kw: kwVersion } : CITY === 'trojmiasto' ? { gdansk: gdaFingerprint, gdynia: gdyFingerprint, skmt: skmtVersion } : CITY === 'lodz' ? { mpk: lodzFingerprint, lka: lkaVersion } : CITY === 'szczecin' ? { zditm: szczecinFingerprint } : CITY === 'lublin' ? { zditm: lublinFingerprint } : { mpk: mpk.effectiveDate, kd: kdVersion }));
  db.exec('VACUUM');
  const chk = db.prepare('PRAGMA integrity_check').get();
  const vals = chk ? Object.values(chk) : [];
  if (!vals.includes('ok')) throw new Error('integrity_check NIE przeszedł: ' + JSON.stringify(chk));
  // Pusta baza (padnięte ZIP-y) nigdy nie leci do R2, niezależnie od miasta.
  const guard = db.prepare('SELECT (SELECT COUNT(*) FROM stops) AS s, (SELECT COUNT(*) FROM trips) AS t, (SELECT COUNT(*) FROM stop_times) AS st').get();
  if (!guard || guard.s <= 0 || guard.t <= 0 || guard.st <= 0) {
    throw new Error(`pusta baza (stops=${guard?.s} trips=${guard?.t} times=${guard?.st}): nie publikuję.`);
  }
  // Podział Trójmiasta na feedy po prefiksach (do manifestu, jak rozbicia
  // per-źródło w innych miastach). Liczone z tabel, bo liczniki importu
  // są współdzielone między Gdańsk a Gdynię.
  let triSplit = null;
  if (CITY === 'trojmiasto') {
    try {
      const splitFor = (prefix) => ({
        stops: db.prepare(`SELECT COUNT(*) AS n FROM stops WHERE stop_id LIKE '${prefix}:%'`).get()?.n ?? 0,
        routes: db.prepare(`SELECT COUNT(*) AS n FROM routes WHERE route_id LIKE '${prefix}:%'`).get()?.n ?? 0,
        trips: db.prepare(`SELECT COUNT(*) AS n FROM trips t JOIN routes r ON r.route_id = t.route_id WHERE r.route_id LIKE '${prefix}:%'`).get()?.n ?? 0,
        stopTimes: db.prepare(`SELECT COUNT(*) AS n FROM stop_times st JOIN trips t ON t.trip_id = st.trip_id JOIN routes r ON r.route_id = t.route_id WHERE r.route_id LIKE '${prefix}:%'`).get()?.n ?? 0,
      });
      triSplit = { gdansk: splitFor('GDA'), gdynia: splitFor('GDY') };
    } catch {}
  }
  const uncompressedSize = statSync(DB_FILE).size;
  db.close();
  rmSync(work, { recursive: true, force: true });

  log(`Kompresja bazy gzip (level 9)...`);
  const rawDb = readFileSync(DB_FILE);
  const gzBuf = gzipSync(rawDb, { level: 9 });
  writeFileSync(DB_GZ_FILE, gzBuf);
  const gzSize = statSync(DB_GZ_FILE).size;
  const gzSha = createHash('sha256').update(gzBuf).digest('hex');
  log(`  raw: ${(uncompressedSize / 1048576).toFixed(1)} MB -> gz: ${(gzSize / 1048576).toFixed(1)} MB (-${((1 - gzSize / uncompressedSize) * 100).toFixed(0)}%)`);

  const manifest = {
    version,
    builtAt: new Date().toISOString(),
    city: CITY,
    db: {
      path: DB_R2_PATH,
      sizeBytes: gzSize,
      sha256: gzSha,
      uncompressedSizeBytes: uncompressedSize,
    },
    sources: CITY === 'krakow'
      ? {
          ztp: {
            kind: 'gtfs-zip', feeds: ZTP_FEEDS.map((f) => f.url),
            fingerprint: ztpFingerprint,
            stops: counts.stops - counts.kmlStations, routes: counts.routes - counts.kmlRoutes,
            trips: counts.trips - counts.kmlTrips, stopTimes: counts.stopTimes - counts.kmlStopTimes,
          },
          kml: kmlInfo,
        }
      : CITY === 'gzm'
      ? {
          ztm: {
            kind: 'gtfs-ckan-daily', dataset: GZM_CKAN_PACKAGE,
            fingerprint: gtmFingerprint,
            stops: counts.stops - counts.ksStations - counts.icStations - counts.prStations,
            routes: counts.routes - counts.ksRoutes - counts.icRoutes - counts.prRoutes,
            trips: counts.trips - counts.ksTrips - counts.icTrips - counts.prTrips,
            stopTimes: counts.stopTimes - counts.ksStopTimes - counts.icStopTimes - counts.prStopTimes,
          },
          ks: ksInfo,
          ic: icInfo,
          pr: prInfo,
        }
      : CITY === 'warszawa'
      ? {
          wtp: {
            kind: 'gtfs-zip', url: WAW_GTFS_URL,
            fingerprint: wawFingerprint,
            stops: counts.stops - counts.kmStations - counts.wkdStations,
            routes: counts.routes - counts.kmRoutes - counts.wkdRoutes,
            trips: counts.trips - counts.kmTrips - counts.wkdTrips,
            stopTimes: counts.stopTimes - counts.kmStopTimes - counts.wkdStopTimes,
          },
          km: kmInfo,
          wkd: wkdInfo,
        }
      : CITY === 'poznan'
      ? {
          ztm: {
            kind: 'gtfs-zip', url: POZNAN_GTFS_URL, upstream: POZNAN_GTFS_UPSTREAM,
            fingerprint: poznanFingerprint,
            stops: counts.stops - counts.kwStations,
            routes: counts.routes - counts.kwRoutes,
            trips: counts.trips - counts.kwTrips,
            stopTimes: counts.stopTimes - counts.kwStopTimes,
          },
          kw: kwInfo,
        }
      : CITY === 'trojmiasto'
      ? {
          gdansk: {
            kind: 'gtfs-zip', url: TRICITY_GDA_GTFS_URL, upstream: TRICITY_GDA_GTFS_UPSTREAM,
            fingerprint: gdaFingerprint,
            ...(triSplit?.gdansk ?? {}),
          },
          gdynia: {
            kind: 'gtfs-zip', url: TRICITY_GDY_GTFS_URL, upstream: TRICITY_GDY_GTFS_UPSTREAM,
            fingerprint: gdyFingerprint,
            ...(triSplit?.gdynia ?? {}),
          },
          skmt: skmtInfo,
        }
      : CITY === 'lodz'
      ? {
          mpk: {
            kind: 'gtfs-zip', url: LODZ_GTFS_URL,
            fingerprint: lodzFingerprint,
            stops: counts.stops - counts.lkaStations,
            routes: counts.routes - counts.lkaRoutes,
            trips: counts.trips - counts.lkaTrips,
            stopTimes: counts.stopTimes - counts.lkaStopTimes,
          },
          lka: lkaInfo,
        }
      : CITY === 'szczecin'
      ? {
          zditm: {
            kind: 'gtfs-zip', url: SZCZECIN_GTFS_URL,
            fingerprint: szczecinFingerprint,
            stops: counts.stops, routes: counts.routes,
            trips: counts.trips, stopTimes: counts.stopTimes,
          },
        }
      : CITY === 'lublin'
      ? {
          zditm: {
            kind: 'gtfs-zip', url: LUBLIN_GTFS_URL,
            fingerprint: lublinFingerprint,
            stops: counts.stops, routes: counts.routes,
            trips: counts.trips, stopTimes: counts.stopTimes,
          },
        }
      : {
          mpk: {
            kind: 'gtfs-zip', catalogueUrl: MPK_CATALOGUE, downloadUrl: mpk.url,
            filename: mpk.filename || null, effectiveDate: mpk.effectiveDate,
            stops: counts.stops - counts.kdStations, routes: counts.routes - counts.kdRoutes,
            trips: counts.trips - counts.kdTrips, stopTimes: counts.stopTimes - counts.kdStopTimes,
          },
          kd: kdInfo,
        },
    stats: { stops: counts.stops, routes: counts.routes, trips: counts.trips, stopTimes: counts.stopTimes },
  };
  writeFileSync(MANIFEST_FILE, JSON.stringify(manifest, null, 2) + '\n');
  log(`OK version=${version} gzSize=${(gzSize / 1048576).toFixed(1)} MB (raw=${(uncompressedSize / 1048576).toFixed(1)} MB) sha256=${gzSha.slice(0, 12)}…`);
  log(`artefakty: ${DB_GZ_FILE}, ${DB_FILE}, ${MANIFEST_FILE}`);
}

main().catch((e) => {
  console.error('[build] FATAL:', e?.stack || e);
  process.exit(1);
});
