// Pakiet kafelków miasta do archiwum gotowego do serwowania z telefonu.
//
// Format archiwum (KMTP v2):
//   nagłówek 32 B  : magic "KMTP" | wersja u32 (=2) | liczba kafelków u32 | maxzoom u32
//   katalog       : pozycja + rozmiar kafla (offset u64, len u32) + z/x/y (u8/u16/u16) + pad u8
//   dane          : sklejone kafle, każdy skompresowany gzipem (level 9).
//                   Natywny serwer HTTP odsyła kafel z nagłówkiem `Content-Encoding: gzip`,
//                   dzięki czemu silnik WebView rozpakowuje go sprzętowo/w C++ w locie.
//
// Katalog jest posortowany po (z, x, y), więc natywny serwer znajduje kafel
// zwykłym wyszukiwaniem binarnym po pliku, bez wczytywania indeksu do RAM.
//
// Uruchomienie: node scripts/build-tile-pack.mjs [--city=wroclaw|krakow|gzm|warszawa|poznan|trojmiasto|lodz|szczecin|kielce|olsztyn|bialystok|opole|rzeszow|lublin|radom|bydgoszcz|torun|elblag|gorzow|czestochowa|zielonagora|rybnik|slupsk|walbrzych|kalisz|siedlce|lomza|krosno|jaslo|olkusz|chrzanow|bochnia|ilawa] [output]
//
// Nowe miasto = wpis w CITY_PACKS niżej (bbox + maxzoom + nazwa pliku).

import { mkdirSync, writeFileSync, readFileSync, statSync } from 'node:fs';
import { Buffer } from 'node:buffer';
import { gzipSync } from 'node:zlib';

const TS = '20261004_113936_pt';
const BASE = `https://tiles.openfreemap.org/planet/${TS}`;

/** Bboxy pakietów: muszą pokrywać strefę obsługi miasta z zapasem. */
const CITY_PACKS = {
  wroclaw: {
    out: 'wroclaw-tiles.ktp',
    bbox: { minLon: 16.8, minLat: 51.0, maxLon: 17.28, maxLat: 51.22 },
    maxZoom: 14,
  },
  krakow: {
    out: 'krakow-tiles.ktp',
    bbox: { minLon: 19.7, minLat: 49.96, maxLon: 20.3, maxLat: 50.16 },
    maxZoom: 14,
  },
  gzm: {
    out: 'gzm-tiles.ktp',
    bbox: { minLon: 18.25, minLat: 49.9, maxLon: 19.85, maxLat: 50.65 },
    // Dzięki kompresji gzip pełne z14 dla całej metropolii mieści się w ~104 MB
    // (limit R2 to 300 MB) i odblokowuje pieszy routing offline w Raptorze.
    maxZoom: 14,
  },
  warszawa: {
    out: 'warszawa-tiles.ktp',
    bbox: { minLon: 20.85, minLat: 52.05, maxLon: 21.28, maxLat: 52.35 },
    // Stolica w z14 z kompresją gzip zajmuje ~39 MB z zapasem na lotnisko i SKM.
    maxZoom: 14,
  },
  poznan: {
    out: 'poznan-tiles.ktp',
    bbox: { minLon: 16.6, minLat: 52.15, maxLon: 17.3, maxLat: 52.65 },
    // Pełna strefa aglomeracji w z14 z gzipem to ~23 MB (jak tileBbox w cities.ts).
    maxZoom: 14,
  },
  trojmiasto: {
    out: 'trojmiasto-tiles.ktp',
    bbox: { minLon: 18.15, minLat: 54.1, maxLon: 18.9, maxLat: 54.66 },
    // Pasmo Gdańsk - Sopot - Gdynia - Wejherowo w z14 z gzipem to ok. 30 MB
    // (jak tileBbox w cities.ts; węższy wycinek niż strefa, bez wody Zatoki).
    maxZoom: 14,
  },
  lodz: {
    out: 'lodz-tiles.ktp',
    bbox: { minLon: 19.05, minLat: 51.55, maxLon: 19.85, maxLat: 51.97 },
    // Pełna strefa aglomeracji w z14 z gzipem to ~20 MB (pomiar próbką kafli).
    maxZoom: 14,
  },
  szczecin: {
    out: 'szczecin-tiles.ktp',
    bbox: { minLon: 14.35, minLat: 53.3, maxLon: 14.75, maxLat: 53.6 },
    // Mniejsza strefa niż Łódź, w z14 z gzipem to ok. 10 MB
    // (jak tileBbox w cities.ts).
    maxZoom: 14,
  },
  kielce: {
    out: 'kielce-tiles.ktp',
    bbox: { minLon: 20.3, minLat: 50.65, maxLon: 20.95, maxLat: 51.02 },
    // Strefa nieco mniejsza niż Łódź, w z14 z gzipem to ok. 15 MB
    // (jak tileBbox w cities.ts).
    maxZoom: 14,
  },
  olsztyn: {
    out: 'olsztyn-tiles.ktp',
    bbox: { minLon: 20.2, minLat: 53.6, maxLon: 20.75, maxLat: 53.95 },
    // Strefa ZDZiT z gminami ościennymi w z14 z gzipem to ok. 15 MB
    // (jak tileBbox w cities.ts).
    maxZoom: 14,
  },
  bialystok: {
    out: 'bialystok-tiles.ktp',
    bbox: { minLon: 22.9, minLat: 52.9, maxLon: 23.35, maxLat: 53.26 },
    // Strefa między Szczecinem a Łodzią, w z14 z gzipem to ok. 12 MB
    // (jak tileBbox w cities.ts).
    maxZoom: 14,
  },
  opole: {
    out: 'opole-tiles.ktp',
    bbox: { minLon: 17.7, minLat: 50.55, maxLon: 18.1, maxLat: 50.8 },
    // Mniejsza strefa niż Szczecin, w z14 z gzipem to ok. 8 MB
    // (jak tileBbox w cities.ts).
    maxZoom: 14,
  },
  rzeszow: {
    out: 'rzeszow-tiles.ktp',
    bbox: { minLon: 21.78, minLat: 49.9, maxLon: 22.26, maxLat: 50.15 },
    // Mała strefa jak Szczecin (621 kafli w z0-14), w z14 z gzipem
    // to ok. 10 MB (jak tileBbox w cities.ts).
    maxZoom: 14,
  },
  lublin: {
    out: 'lublin-tiles.ktp',
    bbox: { minLon: 22.3, minLat: 51.05, maxLon: 22.8, maxLat: 51.42 },
    // Strefa 0,19 deg2 (między Szczecinem a Łodzią), w z14 z gzipem
    // to ok. 14 MB (jak tileBbox w cities.ts).
    maxZoom: 14,
  },
  radom: {
    out: 'radom-tiles.ktp',
    bbox: { minLon: 21.0, minLat: 51.28, maxLon: 21.36, maxLat: 51.5 },
    // Najmniejsza strefa z miast, ale gęste centrum: pomiar próbką kafli
    // z z14 (gzip -9) daje ~9,8 MB (jak tileBbox w cities.ts).
    maxZoom: 14,
  },
  // Miasta z 2026: szacunki MB z gęstości istniejących paczek (radom 0,08 deg2
  // = 10 MB), do zweryfikowania przy pierwszym buildzie.
  bydgoszcz: {
    out: 'bydgoszcz-tiles.ktp',
    bbox: { minLon: 17.78, minLat: 52.94, maxLon: 18.35, maxLat: 53.34 },
    maxZoom: 14,
  },
  torun: {
    out: 'torun-tiles.ktp',
    bbox: { minLon: 18.31, minLat: 52.91, maxLon: 18.94, maxLat: 53.11 },
    maxZoom: 14,
  },
  elblag: {
    out: 'elblag-tiles.ktp',
    bbox: { minLon: 19.33, minLat: 54.12, maxLon: 19.59, maxLat: 54.25 },
    maxZoom: 14,
  },
  gorzow: {
    out: 'gorzow-tiles.ktp',
    bbox: { minLon: 15.03, minLat: 52.67, maxLon: 15.34, maxLat: 52.78 },
    maxZoom: 14,
  },
  czestochowa: {
    out: 'czestochowa-tiles.ktp',
    bbox: { minLon: 18.95, minLat: 50.72, maxLon: 19.3, maxLat: 50.89 },
    maxZoom: 14,
  },
  zielonagora: {
    out: 'zielonagora-tiles.ktp',
    bbox: { minLon: 15.43, minLat: 51.82, maxLon: 15.67, maxLat: 52.01 },
    maxZoom: 14,
  },
  rybnik: {
    out: 'rybnik-tiles.ktp',
    bbox: { minLon: 18.37, minLat: 49.99, maxLon: 18.71, maxLat: 50.2 },
    maxZoom: 14,
  },
  slupsk: {
    out: 'slupsk-tiles.ktp',
    bbox: { minLon: 16.93, minLat: 54.4, maxLon: 17.16, maxLat: 54.52 },
    maxZoom: 14,
  },
  walbrzych: {
    out: 'walbrzych-tiles.ktp',
    bbox: { minLon: 16.08, minLat: 50.61, maxLon: 16.4, maxLat: 50.87 },
    maxZoom: 14,
  },
  kalisz: {
    out: 'kalisz-tiles.ktp',
    bbox: { minLon: 17.75, minLat: 51.6, maxLon: 18.35, maxLat: 51.92 },
    maxZoom: 14,
  },
  siedlce: {
    out: 'siedlce-tiles.ktp',
    bbox: { minLon: 22.11, minLat: 52.05, maxLon: 22.59, maxLat: 52.27 },
    maxZoom: 14,
  },
  lomza: {
    out: 'lomza-tiles.ktp',
    bbox: { minLon: 22.01, minLat: 53.13, maxLon: 22.13, maxLat: 53.23 },
    maxZoom: 14,
  },
  krosno: {
    out: 'krosno-tiles.ktp',
    bbox: { minLon: 21.58, minLat: 49.61, maxLon: 21.89, maxLat: 49.84 },
    maxZoom: 14,
  },
  jaslo: {
    out: 'jaslo-tiles.ktp',
    bbox: { minLon: 21.33, minLat: 49.63, maxLon: 21.71, maxLat: 49.86 },
    maxZoom: 14,
  },
  olkusz: {
    out: 'olkusz-tiles.ktp',
    bbox: { minLon: 19.37, minLat: 50.19, maxLon: 19.7, maxLat: 50.42 },
    maxZoom: 14,
  },
  chrzanow: {
    out: 'chrzanow-tiles.ktp',
    bbox: { minLon: 19.21, minLat: 50.03, maxLon: 19.58, maxLat: 50.22 },
    maxZoom: 14,
  },
  bochnia: {
    out: 'bochnia-tiles.ktp',
    bbox: { minLon: 20.3, minLat: 49.88, maxLon: 20.55, maxLat: 50.1 },
    maxZoom: 14,
  },
  ilawa: {
    out: 'ilawa-tiles.ktp',
    bbox: { minLon: 19.52, minLat: 53.55, maxLon: 19.62, maxLat: 53.63 },
    maxZoom: 14,
  },
  bielskobiala: {
    out: 'bielskobiala-tiles.ktp',
    bbox: { minLon: 18.945, minLat: 49.7274, maxLon: 19.1457, maxLat: 49.9576 },
    maxZoom: 14,
  },
  koszalin: {
    out: 'koszalin-tiles.ktp',
    bbox: { minLon: 16.1127, minLat: 54.1033, maxLon: 16.314, maxLat: 54.2927 },
    maxZoom: 14,
  },
  piotrkow: {
    out: 'piotrkow-tiles.ktp',
    bbox: { minLon: 19.6151, minLat: 51.3485, maxLon: 19.7661, maxLat: 51.4648 },
    maxZoom: 14,
  },
  tomaszow: {
    out: 'tomaszow-tiles.ktp',
    bbox: { minLon: 19.8399, minLat: 51.4186, maxLon: 20.1994, maxLat: 51.6275 },
    maxZoom: 14,
  },
  skarzysko: {
    out: 'skarzysko-tiles.ktp',
    bbox: { minLon: 20.7809, minLat: 51.0609, maxLon: 20.9521, maxLat: 51.1755 },
    maxZoom: 14,
  },
  oswiecim: {
    out: 'oswiecim-tiles.ktp',
    bbox: { minLon: 19.0557, minLat: 49.9197, maxLon: 19.3626, maxLat: 50.1324 },
    maxZoom: 14,
  },
  swinoujscie: {
    out: 'swinoujscie-tiles.ktp',
    bbox: { minLon: 14.1928, minLat: 53.8263, maxLon: 14.4797, maxLat: 53.9531 },
    maxZoom: 14,
  },
  zakopane: {
    out: 'zakopane-tiles.ktp',
    bbox: { minLon: 19.8809, minLat: 49.2452, maxLon: 20.0405, maxLat: 49.3476 },
    maxZoom: 14,
  },
  plock: {
    out: 'plock-tiles.ktp',
    bbox: { minLon: 19.5536, minLat: 52.4084, maxLon: 19.9306, maxLat: 52.7595 },
    maxZoom: 14,
  },
  tarnow: {
    out: 'tarnow-tiles.ktp',
    bbox: { minLon: 20.8869, minLat: 49.9635, maxLon: 21.0666, maxLat: 50.0854 },
    maxZoom: 14,
  },
  legnica: {
    out: 'legnica-tiles.ktp',
    bbox: { minLon: 16.0867, minLat: 51.087, maxLon: 16.3899, maxLat: 51.3319 },
    maxZoom: 14,
  },
  jastrzebie: {
    out: 'jastrzebie-tiles.ktp',
    bbox: { minLon: 18.346, minLat: 49.8527, maxLon: 18.8312, maxLat: 50.2072 },
    maxZoom: 14,
  },
  pila: {
    out: 'pila-tiles.ktp',
    bbox: { minLon: 16.5866, minLat: 53.0088, maxLon: 16.8079, maxLat: 53.2098 },
    maxZoom: 14,
  },
  konin: {
    out: 'konin-tiles.ktp',
    bbox: { minLon: 18.0633, minLat: 52.0876, maxLon: 18.4688, maxLat: 52.3634 },
    maxZoom: 14,
  },
  suwalki: {
    out: 'suwalki-tiles.ktp',
    bbox: { minLon: 22.804, minLat: 53.9953, maxLon: 23.072, maxLat: 54.1812 },
    maxZoom: 14,
  },
  ostrowiec: {
    out: 'ostrowiec-tiles.ktp',
    bbox: { minLon: 21.1813, minLat: 50.8595, maxLon: 21.5659, maxLat: 51.0085 },
    maxZoom: 14,
  },
  stalowawola: {
    out: 'stalowawola-tiles.ktp',
    bbox: { minLon: 21.8663, minLat: 50.4739, maxLon: 22.2263, maxLat: 50.6747 },
    maxZoom: 14,
  },
  przemysl: {
    out: 'przemysl-tiles.ktp',
    bbox: { minLon: 22.6433, minLat: 49.6777, maxLon: 22.8803, maxLat: 49.8666 },
    maxZoom: 14,
  },
  elk: {
    out: 'elk-tiles.ktp',
    bbox: { minLon: 22.1448, minLat: 53.7173, maxLon: 22.5096, maxLat: 53.9643 },
    maxZoom: 14,
  },
  leszno: {
    out: 'leszno-tiles.ktp',
    bbox: { minLon: 16.469, minLat: 51.7314, maxLon: 16.695, maxLat: 51.9784 },
    maxZoom: 14,
  },
  chelm: {
    out: 'chelm-tiles.ktp',
    bbox: { minLon: 23.4014, minLat: 51.0856, maxLon: 23.5642, maxLat: 51.1885 },
    maxZoom: 14,
  },
  mielec: {
    out: 'mielec-tiles.ktp',
    bbox: { minLon: 21.3426, minLat: 50.2046, maxLon: 21.5883, maxLat: 50.4 },
    maxZoom: 14,
  },
  tczew: {
    out: 'tczew-tiles.ktp',
    bbox: { minLon: 18.6034, minLat: 54.0373, maxLon: 18.8297, maxLat: 54.3801 },
    maxZoom: 14,
  },
  ostroleka: {
    out: 'ostroleka-tiles.ktp',
    bbox: { minLon: 21.5134, minLat: 52.9632, maxLon: 21.7095, maxLat: 53.1518 },
    maxZoom: 14,
  },
  starachowice: {
    out: 'starachowice-tiles.ktp',
    bbox: { minLon: 20.9845, minLat: 50.9746, maxLon: 21.1724, maxLat: 51.0982 },
    maxZoom: 14,
  },
  kutno: {
    out: 'kutno-tiles.ktp',
    bbox: { minLon: 19.2732, minLat: 52.1716, maxLon: 19.4687, maxLat: 52.2878 },
    maxZoom: 14,
  },
  kolobrzeg: {
    out: 'kolobrzeg-tiles.ktp',
    bbox: { minLon: 15.4548, minLat: 54.1006, maxLon: 15.6945, maxLat: 54.2175 },
    maxZoom: 14,
  },
  radomsko: {
    out: 'radomsko-tiles.ktp',
    bbox: { minLon: 19.3241, minLat: 50.995, maxLon: 19.5819, maxLat: 51.2339 },
    maxZoom: 14,
  },
  boleslawiec: {
    out: 'boleslawiec-tiles.ktp',
    bbox: { minLon: 15.2393, minLat: 51.1958, maxLon: 15.6223, maxLat: 51.3173 },
    maxZoom: 14,
  },
  cieszyn: {
    out: 'cieszyn-tiles.ktp',
    bbox: { minLon: 18.5533, minLat: 49.703, maxLon: 18.7116, maxLat: 49.8635 },
    maxZoom: 14,
  },
  zywiec: {
    out: 'zywiec-tiles.ktp',
    bbox: { minLon: 19.0905, minLat: 49.5922, maxLon: 19.3636, maxLat: 49.8181 },
    maxZoom: 14,
  },
  krasnik: {
    out: 'krasnik-tiles.ktp',
    bbox: { minLon: 21.9684, minLat: 50.8539, maxLon: 22.345, maxLat: 51.0524 },
    maxZoom: 14,
  },
  grodzisk: {
    out: 'grodzisk-tiles.ktp',
    bbox: { minLon: 20.37, minLat: 51.99, maxLon: 20.79, maxLat: 52.23 },
    maxZoom: 14,
  },
  pruszkow: {
    out: 'pruszkow-tiles.ktp',
    bbox: { minLon: 20.75, minLat: 52.12, maxLon: 20.86, maxLat: 52.22 },
    maxZoom: 14,
  },
  sochaczew: {
    out: 'sochaczew-tiles.ktp',
    bbox: { minLon: 20.1679, minLat: 52.1616, maxLon: 20.4876, maxLat: 52.3494 },
    maxZoom: 14,
  },
  minskmazowiecki: {
    out: 'minskmazowiecki-tiles.ktp',
    bbox: { minLon: 21.4996, minLat: 52.1402, maxLon: 21.6167, maxLat: 52.2212 },
    maxZoom: 14,
  },
  otwock: {
    out: 'otwock-tiles.ktp',
    bbox: { minLon: 21.17, minLat: 52.07, maxLon: 21.33, maxLat: 52.17 },
    maxZoom: 14,
  },
  nowydwormaz: {
    out: 'nowydwormaz-tiles.ktp',
    bbox: { minLon: 20.6413, minLat: 52.389, maxLon: 20.7885, maxLat: 52.4768 },
    maxZoom: 14,
  },
  zabki: {
    out: 'zabki-tiles.ktp',
    bbox: { minLon: 21.07, minLat: 52.245, maxLon: 21.17, maxLat: 52.325 },
    maxZoom: 14,
  },
  pabianice: {
    out: 'pabianice-tiles.ktp',
    bbox: { minLon: 19.29, minLat: 51.61, maxLon: 19.45, maxLat: 51.71 },
    maxZoom: 14,
  },
  zgierz: {
    out: 'zgierz-tiles.ktp',
    bbox: { minLon: 19.34, minLat: 51.81, maxLon: 19.49, maxLat: 51.93 },
    maxZoom: 14,
  },
  grudziadz: {
    out: 'grudziadz-tiles.ktp',
    bbox: { minLon: 18.67, minLat: 53.376, maxLon: 19.068, maxLat: 53.61 },
    maxZoom: 14,
  },
  stargard: {
    out: 'stargard-tiles.ktp',
    bbox: { minLon: 14.863, minLat: 53.229, maxLon: 15.133, maxLat: 53.425 },
    maxZoom: 14,
  },
  gniezno: {
    out: 'gniezno-tiles.ktp',
    bbox: { minLon: 17.481, minLat: 52.44, maxLon: 17.706, maxLat: 52.629 },
    maxZoom: 14,
  },
  jaworzno: {
    out: 'jaworzno-tiles.ktp',
    bbox: { minLon: 18.977, minLat: 50.092, maxLon: 19.457, maxLat: 50.345 },
    maxZoom: 14,
  },
  kedzierzynkozle: {
    out: 'kedzierzynkozle-tiles.ktp',
    bbox: { minLon: 18.074, minLat: 50.254, maxLon: 18.371, maxLat: 50.423 },
    maxZoom: 14,
  },
  zamosc: {
    out: 'zamosc-tiles.ktp',
    bbox: { minLon: 23.036, minLat: 50.59, maxLon: 23.553, maxLat: 50.968 },
    maxZoom: 14,
  },
  raciborz: {
    out: 'raciborz-tiles.ktp',
    bbox: { minLon: 18.122, minLat: 50.014, maxLon: 18.331, maxLat: 50.162 },
    maxZoom: 14,
  },
  belchatow: {
    out: 'belchatow-tiles.ktp',
    bbox: { minLon: 19.285, minLat: 51.289, maxLon: 19.458, maxLat: 51.428 },
    maxZoom: 14,
  },
  tarnobrzeg: {
    out: 'tarnobrzeg-tiles.ktp',
    bbox: { minLon: 21.571, minLat: 50.481, maxLon: 21.808, maxLat: 50.686 },
    maxZoom: 14,
  },
  skierniewice: {
    out: 'skierniewice-tiles.ktp',
    bbox: { minLon: 20.063, minLat: 51.887, maxLon: 20.266, maxLat: 52.026 },
    maxZoom: 14,
  },
  zawiercie: {
    out: 'zawiercie-tiles.ktp',
    bbox: { minLon: 19.19, minLat: 50.43, maxLon: 19.615, maxLat: 50.592 },
    maxZoom: 14,
  },
  starogard: {
    out: 'starogard-tiles.ktp',
    bbox: { minLon: 18.433, minLat: 53.884, maxLon: 18.61, maxLat: 54.057 },
    maxZoom: 14,
  },
  zdunskawola: {
    out: 'zdunskawola-tiles.ktp',
    bbox: { minLon: 18.661, minLat: 51.469, maxLon: 19.102, maxLat: 51.744 },
    maxZoom: 14,
  },
  nysa: {
    out: 'nysa-tiles.ktp',
    bbox: { minLon: 17.091, minLat: 50.311, maxLon: 17.524, maxLat: 50.555 },
    maxZoom: 14,
  },
  malbork: {
    out: 'malbork-tiles.ktp',
    bbox: { minLon: 18.963, minLat: 53.969, maxLon: 19.122, maxLat: 54.085 },
    maxZoom: 14,
  },
  sieradz: {
    out: 'sieradz-tiles.ktp',
    bbox: { minLon: 18.619, minLat: 51.526, maxLon: 19.053, maxLat: 51.672 },
    maxZoom: 14,
  },
  szczecinek: {
    out: 'szczecinek-tiles.ktp',
    bbox: { minLon: 16.589, minLat: 53.633, maxLon: 16.776, maxLat: 53.771 },
    maxZoom: 14,
  },
  nowasol: {
    out: 'nowasol-tiles.ktp',
    bbox: { minLon: 15.438, minLat: 51.657, maxLon: 16.049, maxLat: 52.068 },
    maxZoom: 14,
  },
  olesnica: {
    out: 'olesnica-tiles.ktp',
    bbox: { minLon: 17.309, minLat: 51.151, maxLon: 17.481, maxLat: 51.262 },
    maxZoom: 14,
  },
  czechowicedziedzice: {
    out: 'czechowicedziedzice-tiles.ktp',
    bbox: { minLon: 18.862, minLat: 49.785, maxLon: 19.1, maxLat: 49.976 },
    maxZoom: 14,
  },
  ostroda: {
    out: 'ostroda-tiles.ktp',
    bbox: { minLon: 19.841, minLat: 53.632, maxLon: 20.093, maxLat: 53.784 },
    maxZoom: 14,
  },
  nowytarg: {
    out: 'nowytarg-tiles.ktp',
    bbox: { minLon: 19.914, minLat: 49.397, maxLon: 20.183, maxLat: 49.589 },
    maxZoom: 14,
  },
  augustow: {
    out: 'augustow-tiles.ktp',
    bbox: { minLon: 22.873, minLat: 53.792, maxLon: 23.088, maxLat: 53.902 },
    maxZoom: 14,
  },
  ketrzyn: {
    out: 'ketrzyn-tiles.ktp',
    bbox: { minLon: 21.302, minLat: 54.015, maxLon: 21.556, maxLat: 54.137 },
    maxZoom: 14,
  },
  zgorzelec: {
    out: 'zgorzelec-tiles.ktp',
    bbox: { minLon: 14.954, minLat: 51.085, maxLon: 15.082, maxLat: 51.219 },
    maxZoom: 14,
  },
  polkowice: {
    out: 'polkowice-tiles.ktp',
    bbox: { minLon: 15.931, minLat: 51.402, maxLon: 16.231, maxLat: 51.641 },
    maxZoom: 14,
  },
  gorlice: {
    out: 'gorlice-tiles.ktp',
    bbox: { minLon: 20.978, minLat: 49.549, maxLon: 21.379, maxLat: 49.796 },
    maxZoom: 14,
  },
  jarocin: {
    out: 'jarocin-tiles.ktp',
    bbox: { minLon: 17.197, minLat: 51.826, maxLon: 17.794, maxLat: 52.129 },
    maxZoom: 14,
  },
  wrzesnia: {
    out: 'wrzesnia-tiles.ktp',
    bbox: { minLon: 17.449, minLat: 52.219, maxLon: 17.774, maxLat: 52.442 },
    maxZoom: 14,
  },
  walcz: {
    out: 'walcz-tiles.ktp',
    bbox: { minLon: 16.335, minLat: 53.136, maxLon: 16.618, maxLat: 53.423 },
    maxZoom: 14,
  },
  gizycko: {
    out: 'gizycko-tiles.ktp',
    bbox: { minLon: 21.545, minLat: 53.958, maxLon: 21.965, maxLat: 54.132 },
    maxZoom: 14,
  },
  zagan: {
    out: 'zagan-tiles.ktp',
    bbox: { minLon: 15.21, minLat: 51.54, maxLon: 15.43, maxLat: 51.69 },
    maxZoom: 14,
  },
  koscierzyna: {
    out: 'koscierzyna-tiles.ktp',
    bbox: { minLon: 17.903, minLat: 54.07, maxLon: 18.059, maxLat: 54.173 },
    maxZoom: 14,
  },
  krotoszyn: {
    out: 'krotoszyn-tiles.ktp',
    bbox: { minLon: 17.217, minLat: 51.471, maxLon: 17.856, maxLat: 52.007 },
    maxZoom: 14,
  },
  sandomierz: {
    out: 'sandomierz-tiles.ktp',
    bbox: { minLon: 21.666, minLat: 50.604, maxLon: 21.84, maxLat: 50.748 },
    maxZoom: 14,
  },
  bartoszyce: {
    out: 'bartoszyce-tiles.ktp',
    bbox: { minLon: 20.748, minLat: 54.197, maxLon: 20.892, maxLat: 54.325 },
    maxZoom: 14,
  },
  wielun: {
    out: 'wielun-tiles.ktp',
    bbox: { minLon: 18.388, minLat: 51.123, maxLon: 18.762, maxLat: 51.314 },
    maxZoom: 14,
  },
  mragowo: {
    out: 'mragowo-tiles.ktp',
    bbox: { minLon: 21.226, minLat: 53.801, maxLon: 21.368, maxLat: 53.943 },
    maxZoom: 14,
  },
  swiecie: {
    out: 'swiecie-tiles.ktp',
    bbox: { minLon: 18.267, minLat: 53.309, maxLon: 18.521, maxLat: 53.477 },
    maxZoom: 14,
  },
  wagrowiec: {
    out: 'wagrowiec-tiles.ktp',
    bbox: { minLon: 17.116, minLat: 52.713, maxLon: 17.306, maxLat: 52.9 },
    maxZoom: 14,
  },
  bielskpodlaski: {
    out: 'bielskpodlaski-tiles.ktp',
    bbox: { minLon: 23.073, minLat: 52.704, maxLon: 23.301, maxLat: 52.842 },
    maxZoom: 14,
  },
  dzialdowo: {
    out: 'dzialdowo-tiles.ktp',
    bbox: { minLon: 20.092, minLat: 53.174, maxLon: 20.274, maxLat: 53.292 },
    maxZoom: 14,
  },
  brzesko: {
    out: 'brzesko-tiles.ktp',
    bbox: { minLon: 20.481, minLat: 49.898, maxLon: 20.745, maxLat: 50.081 },
    maxZoom: 14,
  },
  gostyn: {
    out: 'gostyn-tiles.ktp',
    bbox: { minLon: 16.846, minLat: 51.786, maxLon: 17.105, maxLat: 51.989 },
    maxZoom: 14,
  },
  chodziez: {
    out: 'chodziez-tiles.ktp',
    bbox: { minLon: 16.779, minLat: 52.919, maxLon: 17.018, maxLat: 53.083 },
    maxZoom: 14,
  },
  lidzbarkwarminski: {
    out: 'lidzbarkwarminski-tiles.ktp',
    bbox: { minLon: 20.503, minLat: 54.072, maxLon: 20.664, maxLat: 54.193 },
    maxZoom: 14,
  },
  pszczyna: {
    out: 'pszczyna-tiles.ktp',
    bbox: { minLon: 18.644, minLat: 49.885, maxLon: 19.175, maxLat: 50.156 },
    maxZoom: 14,
  },
  wodzislaw: {
    out: 'wodzislaw-tiles.ktp',
    bbox: { minLon: 18.18, minLat: 49.864, maxLon: 18.655, maxLat: 50.136 },
    maxZoom: 14,
  },
  zabkowice: {
    out: 'zabkowice-tiles.ktp',
    bbox: { minLon: 16.688, minLat: 50.5, maxLon: 16.967, maxLat: 50.696 },
    maxZoom: 14,
  },
  strzelin: {
    out: 'strzelin-tiles.ktp',
    bbox: { minLon: 16.914, minLat: 50.657, maxLon: 17.225, maxLat: 50.875 },
    maxZoom: 14,
  },
  srodaslaska: {
    out: 'srodaslaska-tiles.ktp',
    bbox: { minLon: 16.41, minLat: 51.033, maxLon: 16.952, maxLat: 51.282 },
    maxZoom: 14,
  },
  jedrzejow: {
    out: 'jedrzejow-tiles.ktp',
    bbox: { minLon: 20.152, minLat: 50.547, maxLon: 20.465, maxLat: 50.738 },
    maxZoom: 14,
  },
  kozienice: {
    out: 'kozienice-tiles.ktp',
    bbox: { minLon: 21.334, minLat: 51.5, maxLon: 21.711, maxLat: 51.749 },
    maxZoom: 14,
  },
  oborniki: {
    out: 'oborniki-tiles.ktp',
    bbox: { minLon: 16.479, minLat: 52.516, maxLon: 17.05, maxLat: 52.8 },
    maxZoom: 14,
  },
  wieliczka: {
    out: 'wieliczka-tiles.ktp',
    bbox: { minLon: 19.901, minLat: 49.871, maxLon: 20.221, maxLat: 50.109 },
    maxZoom: 14,
  },
  myszkow: {
    out: 'myszkow-tiles.ktp',
    bbox: { minLon: 19.17, minLat: 50.47, maxLon: 19.51, maxLat: 50.69 },
    maxZoom: 14,
  },
  slubice: {
    out: 'slubice-tiles.ktp',
    bbox: { minLon: 14.516, minLat: 52.267, maxLon: 14.696, maxLat: 52.416 },
    maxZoom: 14,
  },
  kartuzy: {
    out: 'kartuzy-tiles.ktp',
    bbox: { minLon: 17.91, minLat: 54.21, maxLon: 18.36, maxLat: 54.44 },
    maxZoom: 14,
  },
};

const argv = process.argv.slice(2);
const cityArg = argv.map((a) => /^--city=(.+)$/.exec(a)?.[1]).find(Boolean) || 'wroclaw';
if (cityArg && !CITY_PACKS[cityArg]) throw new Error(`Nieznane miasto: ${cityArg}`);
const CITY = cityArg || 'wroclaw';
const PACK = CITY_PACKS[CITY];
const OUT = argv.find((a) => !a.startsWith('--')) || PACK.out;
const CACHE = `tilecache-${CITY}`;

const BBOX = PACK.bbox;
const MAXZOOM = PACK.maxZoom;

function lon2x(lon, z) {
  return Math.floor(((lon + 180) / 360) * 2 ** z);
}
function lat2y(lat, z) {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
}

function tilesFor(z) {
  const out = [];
  const x0 = lon2x(BBOX.minLon, z),
    x1 = lon2x(BBOX.maxLon, z);
  const y0 = lat2y(BBOX.maxLat, z),
    y1 = lat2y(BBOX.minLat, z);
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.push([z, x, y]);
  return out;
}

async function fetchTile(z, x, y, attempt = 1) {
  const url = `${BASE}/${z}/${x}/${y}.pbf`;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 30000);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length > 0 ? buf : null; // pusty kafel = poza zasięgiem, pomijamy
  } catch {
    if (attempt >= 3) return null;
    await new Promise((r) => setTimeout(r, 800 * attempt));
    return fetchTile(z, x, y, attempt + 1);
  }
}

function compressTile(buf) {
  // Jeśli z jakiegoś powodu bufor jest już gzipem (np. z zewnętrznego źródła)
  if (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b) {
    return buf;
  }
  return gzipSync(buf, { level: 9 });
}

(async () => {
  try {
    mkdirSync(CACHE);
  } catch {}
  const all = [];
  for (let z = 0; z <= MAXZOOM; z++) all.push(...tilesFor(z));
  console.log(`Kafelkow do pobrania: ${all.length} (z0-${MAXZOOM})`);

  const entries = [];
  let done = 0;
  const t0 = Date.now();

  // Umiarkowana równoległość, żeby nie obciążać publicznego serwera.
  const CONC = 6;
  const queue = [...all];

  async function worker() {
    for (;;) {
      const t = queue.shift();
      if (!t) return;
      const [z, x, y] = t;
      let buf = await fetchTile(z, x, y);
      const cpath = `${CACHE}/${z}/${x}/${y}.pbf`;
      if (buf) {
        mkdirSync(`${CACHE}/${z}/${x}`, { recursive: true });
        writeFileSync(cpath, buf);
      } else {
        // Kafel pusty albo poza zasięgiem: sprawdzamy cache przy kolejnym buildzie.
        try {
          buf = readFileSync(cpath);
        } catch {
          buf = null;
        }
      }
      if (buf && buf.length > 0) {
        entries.push({ z, x, y, data: compressTile(buf) });
      }
      done++;
      if (done % 25 === 0) {
        const mb = entries.reduce((a, e) => a + e.data.length, 0) / 1048576;
        const el = (Date.now() - t0) / 1000;
        console.log(`  ${done}/${all.length} kafelkow, ${mb.toFixed(1)} MB, ${el.toFixed(0)}s`);
      }
    }
  }

  await Promise.all(Array.from({ length: CONC }, worker));

  // Kafle zbieraliśmy współbiegle, więc kolejność katalogu nie odpowiada
  // kolejności bajtów w pliku. Sortujemy, a offsety przeliczamy dopiero
  // potem - inaczej katalog wskazuje cudze bajty.
  entries.sort((a, b) => a.z - b.z || a.x - b.x || a.y - b.y);

  const dirBytes = entries.length * 18;
  const header = Buffer.alloc(32);
  header.write('KMTP', 0, 'ascii');
  header.writeUInt32LE(2, 4); // KMTP v2: kafle skompresowane gzipem
  header.writeUInt32LE(entries.length, 8);
  header.writeUInt32LE(MAXZOOM, 12);

  const DATA_START = 32 + dirBytes;
  const dir = Buffer.alloc(dirBytes);
  let dataPos = DATA_START;
  let p = 0;
  for (const e of entries) {
    // Katalog ma stać szerokość 18 B na pozycję: offset u64, len u32, z u8,
    // x u16, y u16, pad u8. Bez paddingu pozycje rozjeżdżają się o bajt.
    dir.writeBigUInt64LE(BigInt(dataPos), p);
    p += 8;
    dir.writeUInt32LE(e.data.length, p);
    p += 4;
    dir.writeUInt8(e.z, p);
    p += 1;
    dir.writeUInt16LE(e.x, p);
    p += 2;
    dir.writeUInt16LE(e.y, p);
    p += 2;
    dir.writeUInt8(0, p);
    p += 1;
    dataPos += e.data.length;
  }

  writeFileSync(OUT, Buffer.concat([header, dir, ...entries.map((e) => e.data)]));
  const size = statSync(OUT).size;
  console.log(`\nGotowe: ${OUT} (KMTP v2)`);
  console.log(`  kafelkow: ${entries.length}`);
  console.log(`  rozmiar:  ${(size / 1048576).toFixed(1)} MB`);
  if (dataPos !== size) {
    throw new Error(`Offsety nie zgadzają się z rozmiarem pliku (${dataPos} vs ${size})`);
  }
})();
