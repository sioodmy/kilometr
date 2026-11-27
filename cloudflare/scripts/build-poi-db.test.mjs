import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { getCity } from '../../src/cities.ts';
import {
  classifyOvertureCategory,
  classifyRichOsmPoi,
  cleanPoiName,
  formatRichPoiAddress,
  poiGridCells,
  poiGridCellsInBbox,
} from '../../src/services/poiClassify.ts';
import { buildPoiSqlite, conflatePois, extractSearchTerms } from './poi-conflate.mjs';

test('Klasyfikacja Overture i OSM obsługuje gastronomię, hotele, bary i biznes', () => {
  const rest = classifyOvertureCategory('restaurant', 'ramen_restaurant', ['eat_and_drink', 'restaurant']);
  assert.equal(rest?.category, 'restaurant');
  assert.equal(rest?.subtype, 'Restauracja');

  const cafe = classifyOvertureCategory('coffee_shop', 'coffee_shop', []);
  assert.equal(cafe?.category, 'cafe');

  const bar = classifyOvertureCategory('bar', 'cocktail_bar', []);
  assert.equal(bar?.category, 'bar');
  assert.equal(bar?.subtype, 'Koktajlbar');

  const banned = classifyOvertureCategory('private_home', 'private_home', []);
  assert.equal(banned, null);

  const osmPub = classifyRichOsmPoi({ amenity: 'pub', name: 'Szynkarnia', cuisine: 'pizza' });
  assert.equal(osmPub?.category, 'bar');
  assert.ok(osmPub?.tags.includes('pizza'));

  assert.equal(cleanPoiName('HOTEL MONOPOL'), 'Hotel Monopol');
  assert.equal(cleanPoiName('Pijana Wiśnia \u2014 Bar'), 'Pijana Wiśnia Bar');
});

test('formatRichPoiAddress trzyma miasto na początku w GZM', () => {
  const gzmAddr = formatRichPoiAddress({
    subtype: 'Restauracja',
    street: 'Mariacka 15',
    district: 'Śródmieście',
    city: 'Katowice',
    multiCity: true,
  });
  assert.equal(gzmAddr, 'Katowice • Restauracja • Śródmieście, Mariacka 15');

  const wroAddr = formatRichPoiAddress({
    subtype: 'Kawiarnia',
    street: 'Oławska 8',
    district: 'Stare Miasto',
    city: 'Wrocław',
    multiCity: false,
  });
  assert.equal(wroAddr, 'Kawiarnia • Stare Miasto, Oławska 8');
});

test('conflatePois scala duplikaty z Overture, OSM, Wolt i CWOH oraz odrzuca wirtualne kuchnie', () => {
  const wroclaw = getCity('wroclaw');
  const candidates = [
    {
      extId: 'ov:1',
      source: 'overture',
      name: 'Panda Ramen',
      category: 'restaurant',
      subtype: 'Restauracja',
      baseRank: 220,
      tags: ['restauracja', 'ramen'],
      lat: 51.1095,
      lon: 17.0315,
      street: 'Białoskórnicza 17',
      city: 'Wrocław',
      confidence: 0.92,
      sourceCount: 2,
      website: 'https://pandaramen.pl',
    },
    {
      extId: 'osm:node/10',
      source: 'osm',
      name: 'Panda Ramen',
      category: 'restaurant',
      subtype: 'Restauracja',
      baseRank: 230,
      tags: ['ramen', 'japonska'],
      lat: 51.10955,
      lon: 17.03155,
      street: 'Białoskórnicza 17/19',
      district: 'Stare Miasto',
      city: 'Wrocław',
      hours: 'Mo-Su 12:00-22:00',
    },
    {
      extId: 'wolt:123',
      source: 'wolt',
      name: 'Panda Ramen',
      category: 'restaurant',
      subtype: 'Restauracja',
      baseRank: 230,
      tags: ['ramen', 'zupa'],
      lat: 51.10952,
      lon: 17.03152,
      street: 'Białoskórnicza 17',
      rating: 9.4,
      ratingVolume: 450,
    },
    {
      extId: 'wolt:ghost',
      source: 'wolt',
      name: 'Pizza Nocą',
      category: 'restaurant',
      subtype: 'Restauracja',
      baseRank: 230,
      tags: ['pizza'],
      lat: 51.11,
      lon: 17.03,
      street: 'To jest wirtualny lokal',
      rating: 8.1,
      ratingVolume: 20,
    },
    {
      extId: 'cwoh:h1',
      source: 'cwoh',
      name: 'HOTEL MONOPOL',
      category: 'hotel',
      subtype: 'Hotel',
      baseRank: 265,
      tags: ['hotel', 'nocleg'],
      lat: 51.1052,
      lon: 17.0308,
      street: 'Modrzejewskiej 2',
      city: 'Wrocław',
      stars: 5,
    },
    {
      extId: 'ov:weak',
      source: 'overture',
      name: 'Januszex Usługi Różne',
      category: 'business',
      subtype: 'Usługi',
      baseRank: 160,
      tags: ['uslugi'],
      lat: 51.111,
      lon: 17.035,
      confidence: 0.55,
      sourceCount: 1,
    },
  ];

  const wikidata = [
    { qid: 'Q11709332', label: 'Hotel Monopol', lat: 51.10522, lon: 17.03082, sitelinks: 12 },
  ];

  const merged = conflatePois(candidates, wroclaw, wikidata);
  assert.equal(merged.length, 2);

  const panda = merged.find((p) => p.name === 'Panda Ramen');
  assert.ok(panda);
  assert.equal(panda.sources, 'osm,overture,wolt');
  assert.equal(panda.hours, 'Mo-Su 12:00-22:00');
  assert.equal(panda.rating, 9.4);
  assert.ok(panda.rank >= 650);

  const monopol = merged.find((p) => p.name === 'Hotel Monopol');
  assert.ok(monopol);
  assert.equal(monopol.category, 'hotel');
  assert.ok(monopol.rank >= 450);
});

test('buildPoiSqlite zapisuje tabele, siatkę i indeks termów bez FTS5/RTree', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kilometr-poidb-'));
  const dbPath = join(dir, 'test-pois.db');
  try {
    const city = getCity('gzm');
    const pois = conflatePois(
      [
        {
          extId: 'osm:way/1',
          source: 'osm',
          name: 'Galeria Katowicka',
          category: 'shop',
          subtype: 'Galeria handlowa',
          baseRank: 340,
          tags: ['galeria', 'zakupy'],
          lat: 50.2587,
          lon: 19.0176,
          street: '3 Maja 30',
          city: 'Katowice',
          website: 'https://galeriakatowicka.eu',
        },
      ],
      city,
      [{ qid: 'Q1', label: 'Galeria Katowicka', lat: 50.2587, lon: 19.0176, sitelinks: 6 }],
    );

    const terms = extractSearchTerms(pois[0]);
    assert.ok(terms.includes('galeriakatowicka'));
    assert.ok(terms.includes('katowice'));

    const stats = buildPoiSqlite(dbPath, pois, { city: 'gzm', schema_version: '1' });
    assert.equal(stats.total, 1);

    const db = new DatabaseSync(dbPath);
    try {
      const check = db.prepare('PRAGMA integrity_check').get();
      assert.equal(check.integrity_check, 'ok');

      const hit = db
        .prepare(
          "SELECT p.name, p.address FROM poi_terms t JOIN pois p ON p.id = t.poi_id WHERE t.term >= 'galeriakat' AND t.term < 'galeriakat\uffff' LIMIT 5",
        )
        .get();
      assert.equal(hit.name, 'Galeria Katowicka');
      assert.ok(hit.address.startsWith('Katowice •'));

      const cells = poiGridCellsInBbox([19.0, 50.24, 19.04, 50.27], 'coarse');
      const expectedCell = poiGridCells(50.2587, 19.0176).coarse;
      assert.ok(cells.includes(expectedCell));

      const placeholders = cells.map(() => '?').join(',');
      const mapRow = db
        .prepare(`SELECT name FROM pois WHERE cell_coarse IN (${placeholders}) AND min_zoom <= 14`)
        .get(...cells);
      assert.equal(mapRow.name, 'Galeria Katowicka');
    } finally {
      db.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
