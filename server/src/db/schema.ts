export const CREATE_TABLES_SQL = `
CREATE TABLE IF NOT EXISTS saved_places (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  icon TEXT NOT NULL,
  place_id TEXT NOT NULL,
  address TEXT NOT NULL,
  lat REAL NOT NULL,
  lon REAL NOT NULL,
  created_at INTEGER NOT NULL,
  anchor_stop_id TEXT,
  anchor_stop_name TEXT,
  anchor_stop_lat REAL,
  anchor_stop_lon REAL
);

CREATE TABLE IF NOT EXISTS saved_routes (
  id TEXT PRIMARY KEY,
  from_title TEXT NOT NULL,
  to_title TEXT NOT NULL,
  from_lat REAL NOT NULL,
  from_lon REAL NOT NULL,
  to_lat REAL NOT NULL,
  to_lon REAL NOT NULL,
  connection_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS trip_history (
  id TEXT PRIMARY KEY,
  origin_title TEXT NOT NULL,
  origin_lat REAL NOT NULL,
  origin_lon REAL NOT NULL,
  dest_id TEXT NOT NULL,
  dest_title TEXT NOT NULL,
  dest_address TEXT NOT NULL,
  dest_lat REAL NOT NULL,
  dest_lon REAL NOT NULL,
  duration_min INTEGER NOT NULL DEFAULT 15,
  timestamp INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS search_cache (
  cache_key TEXT PRIMARY KEY,
  response_json TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

-- Lokalny indeks POI (Overpass cache): sklepy, apteki, uczelnie, kultura...
CREATE TABLE IF NOT EXISTS pois (
  osm_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  category TEXT NOT NULL,
  name TEXT NOT NULL,
  norm_name TEXT NOT NULL,
  address TEXT NOT NULL,
  lat REAL NOT NULL,
  lon REAL NOT NULL,
  street TEXT,
  district TEXT
);

CREATE TABLE IF NOT EXISTS poi_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_saved_places_created ON saved_places(created_at);
CREATE INDEX IF NOT EXISTS idx_saved_routes_created ON saved_routes(created_at);
CREATE INDEX IF NOT EXISTS idx_trip_history_origin ON trip_history(origin_lat, origin_lon);
CREATE INDEX IF NOT EXISTS idx_trip_history_dest ON trip_history(dest_id);
CREATE INDEX IF NOT EXISTS idx_trip_history_time ON trip_history(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_search_cache_expires ON search_cache(expires_at);
CREATE INDEX IF NOT EXISTS idx_pois_name ON pois(norm_name);
`;

export const INITIAL_SAVED_PLACES = [
  {
    id: 'home',
    name: 'Dom',
    icon: 'home',
    place_id: 'swojczycka',
    address: 'Swojczycka 41, Wrocław',
    lat: 51.1085,
    lon: 17.1021,
  },
  {
    id: 'school',
    name: 'Szkoła',
    icon: 'school',
    place_id: 'pwr',
    address: 'Politechnika Wrocławska, Wybrzeże Wyspiańskiego',
    lat: 51.1079,
    lon: 17.0617,
  },
  {
    id: 'work',
    name: 'Praca',
    icon: 'work',
    place_id: 'sky-tower',
    address: 'Sky Tower, Powstańców Śląskich 95',
    lat: 51.0938,
    lon: 17.0196,
  },
  {
    id: 'gym',
    name: 'Siłownia',
    icon: 'gym',
    place_id: 'magnolia',
    address: 'Magnolia Park, Legnicka 58',
    lat: 51.1181,
    lon: 16.9946,
  },
];

export const SEED_TRIPS = [
  // From Work (Sky Tower: 51.0938, 17.0196)
  ...Array.from({ length: 14 }).map((_, i) => ({
    id: `seed-work-home-${i}`,
    origin_title: 'Praca (Sky Tower)',
    origin_lat: 51.0938,
    origin_lon: 17.0196,
    dest_id: 'swojczycka',
    dest_title: 'Dom',
    dest_address: 'Swojczycka 41, Wrocław',
    dest_lat: 51.1085,
    dest_lon: 17.1021,
    duration_min: 22,
    offsetHours: i * 8,
  })),
  ...Array.from({ length: 6 }).map((_, i) => ({
    id: `seed-work-gym-${i}`,
    origin_title: 'Praca (Sky Tower)',
    origin_lat: 51.0938,
    origin_lon: 17.0196,
    dest_id: 'magnolia',
    dest_title: 'Siłownia',
    dest_address: 'Magnolia Park, Legnicka 58',
    dest_lat: 51.1181,
    dest_lon: 16.9946,
    duration_min: 18,
    offsetHours: i * 14,
  })),
  ...Array.from({ length: 4 }).map((_, i) => ({
    id: `seed-work-capitol-${i}`,
    origin_title: 'Praca (Sky Tower)',
    origin_lat: 51.0938,
    origin_lon: 17.0196,
    dest_id: 'hist-capitol',
    dest_title: 'Arkady Capitol',
    dest_address: 'Piłsudskiego 64 • 2, 7, 17',
    dest_lat: 51.1008,
    dest_lon: 17.0312,
    duration_min: 6,
    offsetHours: i * 20,
  })),

  // From Home (Swojczycka: 51.1085, 17.1021)
  ...Array.from({ length: 15 }).map((_, i) => ({
    id: `seed-home-work-${i}`,
    origin_title: 'Dom (Swojczyce)',
    origin_lat: 51.1085,
    origin_lon: 17.1021,
    dest_id: 'sky-tower',
    dest_title: 'Praca',
    dest_address: 'Sky Tower, Powstańców Śląskich 95',
    dest_lat: 51.0938,
    dest_lon: 17.0196,
    duration_min: 25,
    offsetHours: i * 8,
  })),
  ...Array.from({ length: 8 }).map((_, i) => ({
    id: `seed-home-pwr-${i}`,
    origin_title: 'Dom (Swojczyce)',
    origin_lat: 51.1085,
    origin_lon: 17.1021,
    dest_id: 'pwr',
    dest_title: 'Szkoła',
    dest_address: 'Politechnika Wrocławska, Wybrzeże Wyspiańskiego',
    dest_lat: 51.1079,
    dest_lon: 17.0617,
    duration_min: 16,
    offsetHours: i * 12,
  })),
  ...Array.from({ length: 5 }).map((_, i) => ({
    id: `seed-home-rynek-${i}`,
    origin_title: 'Dom (Swojczyce)',
    origin_lat: 51.1085,
    origin_lon: 17.1021,
    dest_id: 'poi-rynek',
    dest_title: 'Rynek',
    dest_address: 'Świdnicka • 6, 7, 15',
    dest_lat: 51.1079,
    dest_lon: 17.0385,
    duration_min: 18,
    offsetHours: i * 16,
  })),

  // From Dworzec Główny (51.0997, 17.0364)
  ...Array.from({ length: 18 }).map((_, i) => ({
    id: `seed-dworzec-capitol-${i}`,
    origin_title: 'Dworzec Główny',
    origin_lat: 51.0997,
    origin_lon: 17.0364,
    dest_id: 'hist-capitol',
    dest_title: 'Arkady Capitol',
    dest_address: 'Piłsudskiego 64 • 4, 10, 14',
    dest_lat: 51.1008,
    dest_lon: 17.0312,
    duration_min: 9,
    offsetHours: i * 6,
  })),
  ...Array.from({ length: 12 }).map((_, i) => ({
    id: `seed-dworzec-pwr-${i}`,
    origin_title: 'Dworzec Główny',
    origin_lat: 51.0997,
    origin_lon: 17.0364,
    dest_id: 'hist-pwr',
    dest_title: 'Politechnika Wrocławska',
    dest_address: 'Wybrzeże Wyspiańskiego • 13, 23',
    dest_lat: 51.1079,
    dest_lon: 17.0617,
    duration_min: 16,
    offsetHours: i * 9,
  })),
  ...Array.from({ length: 7 }).map((_, i) => ({
    id: `seed-dworzec-zoo-${i}`,
    origin_title: 'Dworzec Główny',
    origin_lat: 51.0997,
    origin_lon: 17.0364,
    dest_id: 'poi-zoo',
    dest_title: 'ZOO / Hala Stulecia',
    dest_address: 'Wróblewskiego • 1, 4',
    dest_lat: 51.1043,
    dest_lon: 17.0746,
    duration_min: 21,
    offsetHours: i * 15,
  })),
  ...Array.from({ length: 6 }).map((_, i) => ({
    id: `seed-dworzec-rynek-${i}`,
    origin_title: 'Dworzec Główny',
    origin_lat: 51.0997,
    origin_lon: 17.0364,
    dest_id: 'poi-rynek',
    dest_title: 'Rynek',
    dest_address: 'Świdnicka • 6, 7, 15',
    dest_lat: 51.1079,
    dest_lon: 17.0385,
    duration_min: 11,
    offsetHours: i * 18,
  })),
  ...Array.from({ length: 4 }).map((_, i) => ({
    id: `seed-dworzec-magnolia-${i}`,
    origin_title: 'Dworzec Główny',
    origin_lat: 51.0997,
    origin_lon: 17.0364,
    dest_id: 'addr-legnicka',
    dest_title: 'Magnolia Park',
    dest_address: 'Legnicka 58 • 3, 10, 20',
    dest_lat: 51.1181,
    dest_lon: 16.9946,
    duration_min: 24,
    offsetHours: i * 24,
  })),
];
