//! Silnik wyszukiwania rozmytego (fuzzy), indeks przestrzenny przystanków i POI,
//! generator przesiadek pieszych (footpaths), ujednolicony ranking sugestii
//! (`dedupeAndSort`) oraz ranking nawyków (`smartRanking`).
//!
//! Zaprojektowany do ścisłej współpracy z `raptor.rs`: współrzędne i wagi
//! przystanków załadowane raz w pamięci Rust służą jednocześnie do:
//! - natychmiastowego wyszukiwania tekstowego przystanków (`search_stops`),
//! - wyszukiwania przystanków w promieniu (`find_nearest_stops` w < 10 µs),
//! - wyznaczania punktów wejścia/wyjścia i bonusu kotwicy dla RAPTOR-a,
//! - budowy grafu przesiadek pieszych (`build_footpaths`).

use std::cell::RefCell;
use std::collections::{HashMap, HashSet};

const EARTH_RADIUS_METERS: f64 = 6_371_000.0;

#[inline]
pub fn distance_meters(lat1: f64, lon1: f64, lat2: f64, lon2: f64) -> f64 {
    let d_lat = (lat2 - lat1).to_radians();
    let d_lon = (lon2 - lon1).to_radians();
    let a = (d_lat * 0.5).sin().powi(2)
        + lat1.to_radians().cos() * lat2.to_radians().cos() * (d_lon * 0.5).sin().powi(2);
    let c = 2.0 * a.sqrt().atan2((1.0 - a).max(0.0).sqrt());
    EARTH_RADIUS_METERS * c
}

#[inline]
pub fn bearing_degrees(lat1: f64, lon1: f64, lat2: f64, lon2: f64) -> f64 {
    let phi1 = lat1.to_radians();
    let phi2 = lat2.to_radians();
    let lambda = (lon2 - lon1).to_radians();
    let y = lambda.sin() * phi2.cos();
    let x = phi1.cos() * phi2.sin() - phi1.sin() * phi2.cos() * lambda.cos();
    (y.atan2(x).to_degrees() + 360.0) % 360.0
}

/// Normalizacja polskich znaków i diakrytyków zgodna 1:1 z `normalizePolish`:
/// małe litery, usunięcie znaków diakrytycznych NFD (`\u{0300}`..`\u{036f}`),
/// zamiana `ł`/`Ł` -> `l`, `trim()`.
pub fn normalize_polish(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for ch in input.trim().chars() {
        // Pomijamy łączące znaki diakrytyczne (combining marks), jeśli tekst był w NFD
        if ('\u{0300}'..='\u{036f}').contains(&ch) {
            continue;
        }
        for lc in ch.to_lowercase() {
            if ('\u{0300}'..='\u{036f}').contains(&lc) {
                continue;
            }
            let mapped = match lc {
                'ą' | 'à' | 'á' | 'â' | 'ã' | 'ä' | 'å' | 'ā' | 'ă' => 'a',
                'ć' | 'ç' | 'č' | 'ĉ' | 'ċ' => 'c',
                'ď' | 'đ' => 'd',
                'ę' | 'è' | 'é' | 'ê' | 'ë' | 'ē' | 'ĕ' | 'ė' | 'ě' => 'e',
                'ğ' | 'ĝ' | 'ġ' | 'ģ' => 'g',
                'ĥ' | 'ħ' => 'h',
                'ì' | 'í' | 'î' | 'ï' | 'ĩ' | 'ī' | 'ĭ' | 'į' => 'i',
                'ĵ' => 'j',
                'ķ' => 'k',
                'ł' | 'ĺ' | 'ļ' | 'ľ' | 'ŀ' => 'l',
                'ń' | 'ñ' | 'ň' | 'ņ' => 'n',
                'ó' | 'ò' | 'ô' | 'õ' | 'ö' | 'ō' | 'ŏ' | 'ő' => 'o',
                'ŕ' | 'ŗ' | 'ř' => 'r',
                'ś' | 'š' | 'ŝ' | 'ş' | 'ș' => 's',
                'ť' | 'ţ' | 'ț' => 't',
                'ù' | 'ú' | 'û' | 'ü' | 'ũ' | 'ū' | 'ŭ' | 'ů' | 'ű' | 'ų' => 'u',
                'ŵ' => 'w',
                'ý' | 'ÿ' | 'ŷ' => 'y',
                'ź' | 'ż' | 'ž' => 'z',
                other => other,
            };
            out.push(mapped);
        }
    }
    let trimmed = out.trim();
    if trimmed.len() == out.len() {
        out
    } else {
        trimmed.to_string()
    }
}

/// Odległość Damerau-Levenshteina (Optimal String Alignment) bez alokacji sterty
/// dla słów do 63 znaków.
pub fn damerau_levenshtein_chars(a: &[char], b: &[char]) -> u32 {
    let la = a.len();
    let lb = b.len();
    if la == 0 {
        return lb as u32;
    }
    if lb == 0 {
        return la as u32;
    }

    const MAX_STACK: usize = 64;
    if lb + 1 <= MAX_STACK {
        let mut prev2 = [0u16; MAX_STACK];
        let mut prev1 = [0u16; MAX_STACK];
        let mut curr = [0u16; MAX_STACK];
        for j in 0..=lb {
            prev1[j] = j as u16;
        }
        for i in 1..=la {
            curr[0] = i as u16;
            for j in 1..=lb {
                let cost = if a[i - 1] == b[j - 1] { 0u16 } else { 1u16 };
                let del = prev1[j] + 1;
                let ins = curr[j - 1] + 1;
                let sub = prev1[j - 1] + cost;
                let mut best = del.min(ins).min(sub);
                if i > 1 && j > 1 && a[i - 1] == b[j - 2] && a[i - 2] == b[j - 1] {
                    best = best.min(prev2[j - 2] + 1);
                }
                curr[j] = best;
            }
            prev2[..=lb].copy_from_slice(&prev1[..=lb]);
            prev1[..=lb].copy_from_slice(&curr[..=lb]);
        }
        return prev1[lb] as u32;
    }

    let mut prev2 = vec![0u32; lb + 1];
    let mut prev1: Vec<u32> = (0..=(lb as u32)).collect();
    let mut curr = vec![0u32; lb + 1];
    for i in 1..=la {
        curr[0] = i as u32;
        for j in 1..=lb {
            let cost = if a[i - 1] == b[j - 1] { 0 } else { 1 };
            let mut best = (prev1[j] + 1).min(curr[j - 1] + 1).min(prev1[j - 1] + cost);
            if i > 1 && j > 1 && a[i - 1] == b[j - 2] && a[i - 2] == b[j - 1] {
                best = best.min(prev2[j - 2] + 1);
            }
            curr[j] = best;
        }
        prev2.copy_from_slice(&prev1);
        prev1.copy_from_slice(&curr);
    }
    prev1[lb]
}

pub fn damerau_levenshtein(a: &str, b: &str) -> u32 {
    let ac: Vec<char> = a.chars().collect();
    let bc: Vec<char> = b.chars().collect();
    damerau_levenshtein_chars(&ac, &bc)
}

const SYNONYM_GROUPS: &[&[&str]] = &[
    &["pl", "plac"],
    &["dw", "dworzec"],
    &["al", "aleja", "aleje"],
    &["os", "osiedle"],
    &["sw", "swiety", "swietego", "swietej"],
    &["gal", "galeria"],
    &["pkp", "dworzec", "glowny", "kolejowa", "stacja"],
    &["jp2", "jana", "pawla"],
    &["rd", "rondo"],
    &["ul", "ulica"],
];

pub fn expand_token_synonyms<'a>(token: &'a str) -> Vec<&'a str> {
    let mut out: Vec<&'a str> = Vec::with_capacity(6);
    out.push(token);
    for group in SYNONYM_GROUPS {
        if group.contains(&token) {
            for &word in *group {
                if !out.contains(&word) {
                    out.push(word);
                }
            }
        }
    }
    out
}

#[derive(Clone, Copy)]
struct TokenMatch {
    matched: bool,
    dist: u32,
    is_exact: bool,
    is_prefix: bool,
}

fn match_token_against_target_words(q_token: &str, t_words: &[&str]) -> TokenMatch {
    let mut min_dist = u32::MAX;
    let mut best_is_prefix = false;
    let q_chars: Vec<char> = q_token.chars().collect();
    let q_len = q_chars.len();

    for &tw in t_words {
        if tw == q_token {
            return TokenMatch {
                matched: true,
                dist: 0,
                is_exact: true,
                is_prefix: true,
            };
        }
        if tw.starts_with(q_token) {
            if 0 < min_dist {
                min_dist = 0;
                best_is_prefix = true;
            }
            continue;
        }
        if q_len >= 3 && tw.contains(q_token) && 1 < min_dist {
            min_dist = 1;
            best_is_prefix = false;
        }
        if q_len >= 4 {
            let max_edits: u32 = if q_len >= 6 { 2 } else { 1 };
            let tw_chars: Vec<char> = tw.chars().collect();
            let tw_len = tw_chars.len();
            let candidates = [q_len, q_len + 1, q_len.saturating_sub(1)];
            for &len in &candidates {
                if len == 0 || len > tw_len {
                    continue;
                }
                let d = damerau_levenshtein_chars(&q_chars, &tw_chars[..len]);
                if d <= max_edits && d < min_dist {
                    min_dist = d;
                    best_is_prefix = true;
                }
            }
        }
    }

    if min_dist != u32::MAX {
        TokenMatch {
            matched: true,
            dist: min_dist,
            is_exact: false,
            is_prefix: best_is_prefix,
        }
    } else {
        TokenMatch {
            matched: false,
            dist: u32::MAX,
            is_exact: false,
            is_prefix: false,
        }
    }
}

#[inline]
fn split_words(s: &str) -> Vec<&str> {
    s.split(|c: char| c.is_whitespace() || c == '-' || c == '/' || c == '.' || c == ',' || c == '(' || c == ')')
        .filter(|w| !w.is_empty())
        .collect()
}

#[inline]
fn compute_initials(words: &[&str]) -> String {
    let mut s = String::with_capacity(words.len());
    for w in words {
        if let Some(ch) = w.chars().next() {
            s.push(ch);
        }
    }
    s
}

/// Rdzeń dopasowania rozmytego (1:1 z `src/gtfs/fuzzy.ts`).
pub fn fuzzy_match_pretokenized(
    norm_q: &str,
    norm_t: &str,
    t_words: &[&str],
    t_initials: &str,
) -> (bool, i32) {
    if norm_q.is_empty() || norm_t.is_empty() {
        return (false, 0);
    }

    if norm_t == norm_q {
        return (true, 100);
    }

    let q_char_len = norm_q.chars().count();
    let t_char_len = norm_t.chars().count();

    if norm_t.starts_with(norm_q) {
        let score = 92.max(98 - (t_char_len as i32 - q_char_len as i32));
        return (true, score);
    }

    let q_tokens: Vec<&str> = split_words(norm_q);
    if q_tokens.is_empty() {
        return (false, 0);
    }

    // Dopasowanie akronimem (np. "pg" -> "Plac Grunwaldzki", "dw" -> "Dworzec Główny")
    if q_tokens.len() == 1 && (2..=4).contains(&q_char_len) && t_words.len() >= 2 {
        if t_initials.starts_with(norm_q) {
            return (true, 85);
        }
    }

    let mut total_dist: u32 = 0;
    let mut matches_count: usize = 0;
    let mut all_exact = true;
    let mut all_prefix = true;

    for &qt in &q_tokens {
        let variants = expand_token_synonyms(qt);
        let mut best = TokenMatch {
            matched: false,
            dist: u32::MAX,
            is_exact: false,
            is_prefix: false,
        };

        for v in variants {
            let res = match_token_against_target_words(v, t_words);
            if res.matched {
                if !best.matched
                    || res.dist < best.dist
                    || (res.dist == best.dist && res.is_exact && !best.is_exact)
                    || (res.dist == best.dist && res.is_prefix && !best.is_prefix)
                {
                    best = res;
                }
            }
        }

        if best.matched {
            matches_count += 1;
            total_dist += best.dist;
            if !best.is_exact {
                all_exact = false;
            }
            if !best.is_prefix {
                all_prefix = false;
            }
        } else {
            all_exact = false;
            all_prefix = false;
        }
    }

    if matches_count == q_tokens.len() {
        if total_dist == 0 {
            if all_exact && q_tokens.len() == t_words.len() {
                return (true, 98);
            }
            if all_prefix {
                return (true, 90);
            }
            return (true, 82);
        }
        let score = 50.max(84 - (total_dist as i32) * 10);
        return (true, score);
    }

    if q_tokens.len() > 2 && matches_count >= q_tokens.len() - 1 && total_dist <= 1 {
        let score = 40.max(65 - (total_dist as i32) * 10);
        return (true, score);
    }

    if norm_t.contains(norm_q) {
        return (true, 72);
    }

    if q_tokens.len() == 1 {
        let qt = q_tokens[0];
        let qt_chars: Vec<char> = qt.chars().collect();
        let qt_len = qt_chars.len();
        if qt_len >= 5 {
            let max_edits: u32 = if qt_len >= 7 { 2 } else { 1 };
            for &tw in t_words {
                let tw_chars: Vec<char> = tw.chars().collect();
                if tw_chars.len().abs_diff(qt_len) > max_edits as usize {
                    continue;
                }
                let d = damerau_levenshtein_chars(&qt_chars, &tw_chars);
                if d <= max_edits {
                    return (true, 74 - (d as i32) * 8);
                }
            }
        }
    }

    (false, 0)
}

pub fn fuzzy_match(query: &str, target: &str) -> (bool, i32) {
    let norm_q = normalize_polish(query);
    let norm_t = normalize_polish(target);
    if norm_q.is_empty() || norm_t.is_empty() {
        return (false, 0);
    }
    let t_words = split_words(&norm_t);
    let t_initials = compute_initials(&t_words);
    fuzzy_match_pretokenized(&norm_q, &norm_t, &t_words, &t_initials)
}

// ============================================================================
// Indeks przystanków + siatka przestrzenna (Spatial Grid) + integracja z RAPTOR
// ============================================================================

const GRID_LAT_STEP: f64 = 0.001;
const GRID_LON_STEP: f64 = 0.0015;

#[derive(Clone)]
pub struct StopEntry {
    pub id: String,
    pub code: String,
    pub name: String,
    pub norm_name: String,
    pub words: Vec<String>,
    pub initials: String,
    pub lat: f64,
    pub lon: f64,
    pub weight: i32,
}

#[derive(Default)]
pub struct StopCatalog {
    pub stops: Vec<StopEntry>,
    pub id_to_index: HashMap<String, usize>,
    /// Indeks unikalnych nazw przystanków (jak `GROUP BY name` w SQLite `searchStops`)
    pub unique_by_name: Vec<usize>,
    pub grid: HashMap<(i32, i32), Vec<usize>>,
}

impl StopCatalog {
    pub fn load(&mut self, entries: Vec<(String, String, String, f64, f64, i32)>) {
        self.stops.clear();
        self.id_to_index.clear();
        self.unique_by_name.clear();
        self.grid.clear();

        self.stops.reserve(entries.len());
        let mut seen_names: HashMap<String, usize> = HashMap::with_capacity(entries.len());

        for (idx, (id, code, name, lat, lon, weight)) in entries.into_iter().enumerate() {
            let norm_name = normalize_polish(&name);
            let words: Vec<String> = split_words(&norm_name).into_iter().map(String::from).collect();
            let word_refs: Vec<&str> = words.iter().map(|s| s.as_str()).collect();
            let initials = compute_initials(&word_refs);

            self.id_to_index.insert(id.clone(), idx);

            if let Some(&prev_idx) = seen_names.get(&name) {
                if weight > self.stops[prev_idx].weight {
                    seen_names.insert(name.clone(), idx);
                }
            } else {
                seen_names.insert(name.clone(), idx);
            }

            let cell = (
                (lat / GRID_LAT_STEP).floor() as i32,
                (lon / GRID_LON_STEP).floor() as i32,
            );
            self.grid.entry(cell).or_default().push(idx);

            self.stops.push(StopEntry {
                id,
                code,
                name,
                norm_name,
                words,
                initials,
                lat,
                lon,
                weight,
            });
        }

        let mut uniq: Vec<usize> = seen_names.into_values().collect();
        uniq.sort_unstable();
        self.unique_by_name = uniq;
    }

    /// Błyskawiczne wyszukiwanie przystanków w promieniu `max_dist_m` przy użyciu siatki przestrzennej.
    pub fn find_nearest(&self, lat: f64, lon: f64, max_dist_m: f64, limit: usize) -> Vec<(usize, i32)> {
        if self.stops.is_empty() || limit == 0 || !lat.is_finite() || !lon.is_finite() {
            return Vec::new();
        }
        let d_lat = max_dist_m / 111_000.0;
        let cos_lat = lat.to_radians().cos().abs().max(0.2);
        let d_lon = max_dist_m / (111_000.0 * cos_lat);

        let r_min = ((lat - d_lat) / GRID_LAT_STEP).floor() as i32 - 1;
        let r_max = ((lat + d_lat) / GRID_LAT_STEP).floor() as i32 + 1;
        let c_min = ((lon - d_lon) / GRID_LON_STEP).floor() as i32 - 1;
        let c_max = ((lon + d_lon) / GRID_LON_STEP).floor() as i32 + 1;

        let mut hits: Vec<(usize, i32)> = Vec::new();
        for r in r_min..=r_max {
            for c in c_min..=c_max {
                if let Some(bucket) = self.grid.get(&(r, c)) {
                    for &idx in bucket {
                        let s = &self.stops[idx];
                        let d = distance_meters(lat, lon, s.lat, s.lon);
                        if d <= max_dist_m {
                            hits.push((idx, d.round() as i32));
                        }
                    }
                }
            }
        }

        hits.sort_by(|a, b| a.1.cmp(&b.1).then_with(|| a.0.cmp(&b.0)));
        if hits.len() > limit {
            hits.truncate(limit);
        }
        hits
    }

    /// Buduje wszystkie krawędzie przesiadek pieszych (`footpaths`) pomiędzy przystankami
    /// w promieniu `max_transfer_m`.
    pub fn build_footpaths(
        &self,
        max_transfer_m: f64,
        walk_speed_mps: f64,
        detour_factor: f64,
        min_footpath_sec: i32,
    ) -> Vec<(u32, u32, u16, u16)> {
        let mut edges: Vec<(u32, u32, u16, u16)> = Vec::with_capacity(self.stops.len() * 8);
        for (i, s1) in self.stops.iter().enumerate() {
            let r = (s1.lat / GRID_LAT_STEP).floor() as i32;
            let c = (s1.lon / GRID_LON_STEP).floor() as i32;
            for dr in -2..=2 {
                for dc in -2..=2 {
                    if let Some(cell) = self.grid.get(&(r + dr, c + dc)) {
                        for &j in cell {
                            if i == j {
                                continue;
                            }
                            let s2 = &self.stops[j];
                            let d = distance_meters(s1.lat, s1.lon, s2.lat, s2.lon);
                            if d <= max_transfer_m {
                                let dist_m = d.round() as u16;
                                let walk_sec = min_footpath_sec
                                    .max(((d * detour_factor) / walk_speed_mps).round() as i32)
                                    as u16;
                                edges.push((i as u32, j as u32, dist_m, walk_sec));
                            }
                        }
                    }
                }
            }
        }
        edges
    }

    /// Wyszukiwanie rozmyte przystanków po nazwie z uwzględnieniem wag (liczby kursów).
    pub fn search_stops(&self, query: &str, limit: usize) -> Vec<(usize, i32)> {
        let norm_q = normalize_polish(query);
        if norm_q.is_empty() || limit == 0 {
            return Vec::new();
        }
        let mut scored: Vec<(usize, i32, i32)> = Vec::new();
        for &idx in &self.unique_by_name {
            let s = &self.stops[idx];
            let word_refs: Vec<&str> = s.words.iter().map(|w| w.as_str()).collect();
            let (matches, score) =
                fuzzy_match_pretokenized(&norm_q, &s.norm_name, &word_refs, &s.initials);
            if matches && score >= 50 {
                scored.push((idx, score, s.weight));
            }
        }
        scored.sort_by(|a, b| {
            if (a.1 - b.1).abs() > 12 {
                b.1.cmp(&a.1)
            } else {
                b.2.cmp(&a.2).then_with(|| b.1.cmp(&a.1))
            }
        });
        if scored.len() > limit {
            scored.truncate(limit);
        }
        scored.into_iter().map(|(idx, score, _)| (idx, score)).collect()
    }
}

// ============================================================================
// Indeks POI w pamięci Rust
// ============================================================================

#[derive(Clone)]
pub struct PoiEntry {
    pub osm_id: String,
    pub name: String,
    pub norm_name: String,
    pub words: Vec<String>,
    pub initials: String,
    pub category: String,
    pub lat: f64,
    pub lon: f64,
    pub address: String,
}

#[derive(Default)]
pub struct PoiCatalog {
    pub pois: Vec<PoiEntry>,
}

impl PoiCatalog {
    pub fn load(&mut self, entries: Vec<(String, String, String, f64, f64, String)>) {
        self.pois.clear();
        self.pois.reserve(entries.len());
        for (osm_id, name, category, lat, lon, address) in entries {
            let norm_name = normalize_polish(&name);
            let words: Vec<String> = split_words(&norm_name).into_iter().map(String::from).collect();
            let word_refs: Vec<&str> = words.iter().map(|s| s.as_str()).collect();
            let initials = compute_initials(&word_refs);
            self.pois.push(PoiEntry {
                osm_id,
                name,
                norm_name,
                words,
                initials,
                category,
                lat,
                lon,
                address,
            });
        }
    }

    pub fn search(
        &self,
        query: &str,
        user_lat: Option<f64>,
        user_lon: Option<f64>,
        limit: usize,
    ) -> Vec<(usize, f64, Option<i32>)> {
        let norm_q = normalize_polish(query);
        if norm_q.len() < 2 || limit == 0 {
            return Vec::new();
        }
        let has_pos = match (user_lat, user_lon) {
            (Some(lat), Some(lon)) => lat.is_finite() && lon.is_finite(),
            _ => false,
        };
        let u_lat = user_lat.unwrap_or(0.0);
        let u_lon = user_lon.unwrap_or(0.0);

        let mut results: Vec<(usize, f64, Option<i32>)> = Vec::new();
        for (idx, poi) in self.pois.iter().enumerate() {
            let word_refs: Vec<&str> = poi.words.iter().map(|w| w.as_str()).collect();
            let (matches, score) =
                fuzzy_match_pretokenized(&norm_q, &poi.norm_name, &word_refs, &poi.initials);
            if !matches || score < 50 {
                continue;
            }
            let (dist_m, dist_penalty) = if has_pos {
                let d = distance_meters(u_lat, u_lon, poi.lat, poi.lon).round();
                (Some(d as i32), 40.0_f64.min(d / 250.0))
            } else {
                (None, 0.0)
            };
            let final_score = (score as f64) - dist_penalty;
            results.push((idx, final_score, dist_m));
        }

        results.sort_by(|a, b| {
            b.1.partial_cmp(&a.1)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| a.0.cmp(&b.0))
        });
        if results.len() > limit {
            results.truncate(limit);
        }
        results
    }
}

thread_local! {
    static STOP_CATALOG: RefCell<StopCatalog> = RefCell::new(StopCatalog::default());
    static POI_CATALOG: RefCell<PoiCatalog> = RefCell::new(PoiCatalog::default());
}

pub fn with_stop_catalog<R>(f: impl FnOnce(&StopCatalog) -> R) -> R {
    STOP_CATALOG.with(|c| f(&c.borrow()))
}

pub fn with_stop_catalog_mut<R>(f: impl FnOnce(&mut StopCatalog) -> R) -> R {
    STOP_CATALOG.with(|c| f(&mut c.borrow_mut()))
}

// ============================================================================
// Ujednolicony ranking podpowiedzi (`searchRank.ts`: `dedupeAndSort`)
// ============================================================================

#[derive(Clone)]
pub struct RankCandidate {
    pub orig_index: u32,
    pub kind: u8, // 0 = stop, 1 = address, 2 = place
    pub title: String,
    pub address: String,
    pub category_or_kind: String,
    pub lat: f64,
    pub lon: f64,
    pub distance_m: Option<f64>,
    pub weight: f64,
    pub aliases: Vec<String>,
}

fn candidate_name_score(c: &RankCandidate, norm_q: &str) -> f64 {
    if norm_q.is_empty() {
        return 50.0;
    }
    let (m_title, s_title) = fuzzy_match(norm_q, &c.title);
    let mut best: i32 = if m_title { s_title } else { 0 };
    for alias in &c.aliases {
        let (m_al, s_al) = fuzzy_match(norm_q, alias);
        if m_al && s_al > best {
            best = s_al;
        }
    }
    if best > 0 {
        return best as f64;
    }
    if !c.address.is_empty() {
        let (m_addr, s_addr) = fuzzy_match(norm_q, &c.address);
        if m_addr {
            return 30.max(s_addr - 15) as f64;
        }
    }
    10.0
}

#[inline]
fn candidate_dist_penalty(c: &RankCandidate, has_user_pos: bool) -> f64 {
    if !has_user_pos {
        return 0.0;
    }
    match c.distance_m {
        Some(d) if d.is_finite() => 40.0_f64.min(d / 250.0),
        _ => 0.0,
    }
}

#[inline]
fn candidate_weight_bonus(c: &RankCandidate) -> f64 {
    if c.weight > 0.0 {
        c.weight / 100.0
    } else {
        0.0
    }
}

/// Zwraca posortowane indeksy `orig_index` po deduplikacji zgodnej 1:1 z `dedupeAndSort`.
pub fn dedupe_and_sort(
    candidates: &[RankCandidate],
    has_user_pos: bool,
    norm_q: &str,
) -> Vec<u32> {
    let mut seen: HashSet<String> = HashSet::with_capacity(candidates.len());
    let mut unique: Vec<(usize, f64)> = Vec::with_capacity(candidates.len());

    let norm_query = normalize_polish(norm_q);
    let has_digit = norm_query.chars().any(|ch| ch.is_ascii_digit());

    for (idx, item) in candidates.iter().enumerate() {
        let key = format!(
            "{}-{}-{:.3}-{:.3}",
            normalize_polish(&item.title),
            item.category_or_kind,
            item.lat,
            item.lon
        );
        if seen.insert(key) {
            let score = candidate_name_score(item, &norm_query)
                - candidate_dist_penalty(item, has_user_pos)
                + candidate_weight_bonus(item);
            unique.push((idx, score));
        }
    }

    unique.sort_by(|&(ia, score_a), &(ib, score_b)| {
        let a = &candidates[ia];
        let b = &candidates[ib];

        // 1. Przystanki zawsze na górze, z zachowaniem kolejności wejściowej (stabilnie).
        if a.kind == 0 && b.kind != 0 {
            return std::cmp::Ordering::Less;
        }
        if a.kind != 0 && b.kind == 0 {
            return std::cmp::Ordering::Greater;
        }
        if a.kind == 0 && b.kind == 0 {
            return ia.cmp(&ib);
        }

        // 2. Jeśli zapytanie zawiera cyfrę, adresy przed POI.
        if has_digit {
            if a.kind == 1 && b.kind != 1 {
                return std::cmp::Ordering::Less;
            }
            if a.kind != 1 && b.kind == 1 {
                return std::cmp::Ordering::Greater;
            }
        }

        // 3. Reszta wg wyniku malejąco, tie-break po kolejności wejściowej.
        score_b
            .partial_cmp(&score_a)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| ia.cmp(&ib))
    });

    unique.into_iter().map(|(idx, _)| candidates[idx].orig_index).collect()
}

// ============================================================================
// Ranking nawyków (`smartRanking.ts`)
// ============================================================================

pub const CLUSTER_RADIUS_M: f64 = 1600.0;
pub const EXCLUSION_RADIUS_M: f64 = 250.0;
pub const SAME_PLACE_RADIUS_M: f64 = 150.0;
pub const CONTEXT_PLACE_RADIUS_M: f64 = 350.0;
pub const REPEAT_GAP_MS: f64 = 5.0 * 60.0 * 1000.0;
pub const FALLBACK_TRIP_MIN: i32 = 18;

const HABIT_WINDOW_MS: f64 = 30.0 * 24.0 * 3600.0 * 1000.0;
const HABIT_WEIGHT: f64 = 10.0;
const SAVED_BONUS: f64 = 14.0;
const FRESHNESS_MAX: f64 = 6.0;
const FRESHNESS_DECAY_DAYS: f64 = 10.0;
const MS_PER_DAY: f64 = 24.0 * 3600.0 * 1000.0;

#[inline]
pub fn score_candidate(uses: i32, last_timestamp: f64, is_saved_place: bool, now: f64) -> f64 {
    let days_since = ((now - last_timestamp) / MS_PER_DAY).max(0.0);
    let freshness = FRESHNESS_MAX * (-days_since / FRESHNESS_DECAY_DAYS).exp();
    (uses as f64) * HABIT_WEIGHT + if is_saved_place { SAVED_BONUS } else { 0.0 } + freshness
}

pub fn typical_duration_min(durations: &[i32]) -> Option<i32> {
    if durations.is_empty() {
        return None;
    }
    let mut valid: Vec<i32> = durations.to_vec();
    valid.sort_unstable();
    let mid = valid.len() / 2;
    if valid.len() % 2 == 1 {
        Some(valid[mid])
    } else {
        Some(((valid[mid - 1] + valid[mid]) as f64 / 2.0).round() as i32)
    }
}

// ============================================================================
// Binarny protokół wywołań (opcodes 10..19)
// ============================================================================

#[inline]
fn read_u16(b: &[u8], off: &mut usize) -> u16 {
    let v = u16::from_le_bytes([b[*off], b[*off + 1]]);
    *off += 2;
    v
}

#[inline]
fn read_u32(b: &[u8], off: &mut usize) -> u32 {
    let v = u32::from_le_bytes([b[*off], b[*off + 1], b[*off + 2], b[*off + 3]]);
    *off += 4;
    v
}

#[inline]
fn read_i32(b: &[u8], off: &mut usize) -> i32 {
    read_u32(b, off) as i32
}

#[inline]
fn read_f64(b: &[u8], off: &mut usize) -> f64 {
    let mut arr = [0u8; 8];
    arr.copy_from_slice(&b[*off..*off + 8]);
    *off += 8;
    f64::from_le_bytes(arr)
}

#[inline]
fn read_str<'a>(b: &'a [u8], off: &mut usize) -> &'a str {
    let len = read_u16(b, off) as usize;
    let s = std::str::from_utf8(&b[*off..*off + len]).unwrap_or("");
    *off += len;
    s
}

#[inline]
fn write_u16(out: &mut Vec<u8>, v: u16) {
    out.extend_from_slice(&v.to_le_bytes());
}

#[inline]
fn write_u32(out: &mut Vec<u8>, v: u32) {
    out.extend_from_slice(&v.to_le_bytes());
}

#[inline]
fn write_i32(out: &mut Vec<u8>, v: i32) {
    out.extend_from_slice(&v.to_le_bytes());
}

#[inline]
fn write_f64(out: &mut Vec<u8>, v: f64) {
    out.extend_from_slice(&v.to_le_bytes());
}

/// Cmd 10: Pojedyncze lub wsadowe `fuzzy_match` + `damerau_levenshtein`.
/// Format wejścia:
/// - `mode: u8`:
///   - `0`: `fuzzy_match(query, target)` -> `[matches: u8, score: i32]`
///   - `1`: `damerau_levenshtein(a, b)` -> `[dist: u32]`
///   - `2`: wsadowe `fuzzy_match(query, targets[])` -> `[count: u32, (matches: u8, score: i32)*]`
pub fn handle_fuzzy_cmd(payload: &[u8]) -> Vec<u8> {
    if payload.is_empty() {
        return Vec::new();
    }
    let mut off = 0usize;
    let mode = payload[off];
    off += 1;
    let mut out = Vec::new();
    match mode {
        0 => {
            let q = read_str(payload, &mut off);
            let t = read_str(payload, &mut off);
            let (m, score) = fuzzy_match(q, t);
            out.push(if m { 1 } else { 0 });
            write_i32(&mut out, score);
        }
        1 => {
            let a = read_str(payload, &mut off);
            let b = read_str(payload, &mut off);
            let d = damerau_levenshtein(a, b);
            write_u32(&mut out, d);
        }
        2 => {
            let q = read_str(payload, &mut off);
            let norm_q = normalize_polish(q);
            let count = read_u32(payload, &mut off) as usize;
            out.reserve(4 + count * 5);
            write_u32(&mut out, count as u32);
            for _ in 0..count {
                let t = read_str(payload, &mut off);
                let norm_t = normalize_polish(t);
                let words = split_words(&norm_t);
                let initials = compute_initials(&words);
                let (m, score) = fuzzy_match_pretokenized(&norm_q, &norm_t, &words, &initials);
                out.push(if m { 1 } else { 0 });
                write_i32(&mut out, score);
            }
        }
        _ => {}
    }
    out
}

/// Cmd 11: Załadowanie katalogu przystanków do pamięci Rust (z siatką przestrzenną).
/// Wejście: `[count: u32, (id: str, code: str, name: str, lat: f64, lon: f64, weight: i32)*]`
/// Wyjście: `[loaded_count: u32]`
pub fn handle_load_stops_cmd(payload: &[u8]) -> Vec<u8> {
    if payload.len() < 4 {
        return Vec::new();
    }
    let mut off = 0usize;
    let count = read_u32(payload, &mut off) as usize;
    let mut entries = Vec::with_capacity(count);
    for _ in 0..count {
        let id = read_str(payload, &mut off).to_string();
        let code = read_str(payload, &mut off).to_string();
        let name = read_str(payload, &mut off).to_string();
        let lat = read_f64(payload, &mut off);
        let lon = read_f64(payload, &mut off);
        let weight = read_i32(payload, &mut off);
        entries.push((id, code, name, lat, lon, weight));
    }
    with_stop_catalog_mut(|cat| cat.load(entries));
    let mut out = Vec::with_capacity(4);
    write_u32(&mut out, count as u32);
    out
}

/// Cmd 12: Operacje na katalogu przystanków:
/// - `subcmd 0`: `find_nearest_stops(lat: f64, lon: f64, max_dist_m: f64, limit: u32)`
///   -> `[count: u32, (stop_idx: u32, dist_m: i32)*]`
/// - `subcmd 1`: `search_stops(query: str, limit: u32)`
///   -> `[count: u32, (stop_idx: u32, score: i32)*]`
/// - `subcmd 2`: `build_footpaths(max_transfer_m: f64, walk_speed_mps: f64, detour_factor: f64, min_footpath_sec: i32)`
///   -> `[edge_count: u32, (from_idx: u32, to_idx: u32, dist_m: u16, walk_sec: u16)*]`
pub fn handle_stops_query_cmd(payload: &[u8]) -> Vec<u8> {
    if payload.is_empty() {
        return Vec::new();
    }
    let mut off = 0usize;
    let subcmd = payload[off];
    off += 1;
    let mut out = Vec::new();

    match subcmd {
        0 => {
            let lat = read_f64(payload, &mut off);
            let lon = read_f64(payload, &mut off);
            let max_dist_m = read_f64(payload, &mut off);
            let limit = read_u32(payload, &mut off) as usize;
            let hits = with_stop_catalog(|cat| cat.find_nearest(lat, lon, max_dist_m, limit));
            out.reserve(4 + hits.len() * 8);
            write_u32(&mut out, hits.len() as u32);
            for (idx, dist_m) in hits {
                write_u32(&mut out, idx as u32);
                write_i32(&mut out, dist_m);
            }
        }
        1 => {
            let query = read_str(payload, &mut off);
            let limit = read_u32(payload, &mut off) as usize;
            let hits = with_stop_catalog(|cat| cat.search_stops(query, limit));
            out.reserve(4 + hits.len() * 8);
            write_u32(&mut out, hits.len() as u32);
            for (idx, score) in hits {
                write_u32(&mut out, idx as u32);
                write_i32(&mut out, score);
            }
        }
        2 => {
            let max_transfer_m = read_f64(payload, &mut off);
            let walk_speed_mps = read_f64(payload, &mut off);
            let detour_factor = read_f64(payload, &mut off);
            let min_footpath_sec = read_i32(payload, &mut off);
            let edges = with_stop_catalog(|cat| {
                cat.build_footpaths(max_transfer_m, walk_speed_mps, detour_factor, min_footpath_sec)
            });
            out.reserve(4 + edges.len() * 12);
            write_u32(&mut out, edges.len() as u32);
            for (u, v, dist_m, walk_sec) in edges {
                write_u32(&mut out, u);
                write_u32(&mut out, v);
                write_u16(&mut out, dist_m);
                write_u16(&mut out, walk_sec);
            }
        }
        _ => {}
    }
    out
}

/// Cmd 13: Katalog POI w pamięci Rust (`load` + `search`).
/// - `subcmd 0`: `load_pois([count: u32, (osm_id, name, category, lat, lon, address)*])`
/// - `subcmd 1`: `search_pois(query: str, has_pos: u8, user_lat: f64, user_lon: f64, limit: u32)`
///   -> `[count: u32, (poi_idx: u32, has_dist: u8, dist_m: i32, score: f64)*]`
pub fn handle_poi_cmd(payload: &[u8]) -> Vec<u8> {
    if payload.is_empty() {
        return Vec::new();
    }
    let mut off = 0usize;
    let subcmd = payload[off];
    off += 1;
    let mut out = Vec::new();
    match subcmd {
        0 => {
            let count = read_u32(payload, &mut off) as usize;
            let mut entries = Vec::with_capacity(count);
            for _ in 0..count {
                let osm_id = read_str(payload, &mut off).to_string();
                let name = read_str(payload, &mut off).to_string();
                let category = read_str(payload, &mut off).to_string();
                let lat = read_f64(payload, &mut off);
                let lon = read_f64(payload, &mut off);
                let address = read_str(payload, &mut off).to_string();
                entries.push((osm_id, name, category, lat, lon, address));
            }
            POI_CATALOG.with(|c| c.borrow_mut().load(entries));
            write_u32(&mut out, count as u32);
        }
        1 => {
            let query = read_str(payload, &mut off);
            let has_pos = payload[off] != 0;
            off += 1;
            let user_lat = read_f64(payload, &mut off);
            let user_lon = read_f64(payload, &mut off);
            let limit = read_u32(payload, &mut off) as usize;
            let hits = POI_CATALOG.with(|c| {
                c.borrow().search(
                    query,
                    if has_pos { Some(user_lat) } else { None },
                    if has_pos { Some(user_lon) } else { None },
                    limit,
                )
            });
            out.reserve(4 + hits.len() * 17);
            write_u32(&mut out, hits.len() as u32);
            for (idx, score, dist_opt) in hits {
                write_u32(&mut out, idx as u32);
                match dist_opt {
                    Some(d) => {
                        out.push(1);
                        write_i32(&mut out, d);
                    }
                    None => {
                        out.push(0);
                        write_i32(&mut out, 0);
                    }
                }
                write_f64(&mut out, score);
            }
        }
        _ => {}
    }
    out
}

/// Cmd 14: `dedupe_and_sort` w Rust.
/// Wejście:
/// `[has_user_pos: u8, norm_q: str, count: u32, (orig_idx: u32, kind: u8, title: str, address: str, cat_or_kind: str, lat: f64, lon: f64, has_dist: u8, dist_m: f64, weight: f64, alias_count: u16, alias: str*)*]`
/// Wyjście:
/// `[out_count: u32, orig_idx: u32*]`
pub fn handle_dedupe_and_sort_cmd(payload: &[u8]) -> Vec<u8> {
    if payload.is_empty() {
        return Vec::new();
    }
    let mut off = 0usize;
    let has_user_pos = payload[off] != 0;
    off += 1;
    let norm_q = read_str(payload, &mut off).to_string();
    let count = read_u32(payload, &mut off) as usize;
    let mut candidates = Vec::with_capacity(count);
    for _ in 0..count {
        let orig_index = read_u32(payload, &mut off);
        let kind = payload[off];
        off += 1;
        let title = read_str(payload, &mut off).to_string();
        let address = read_str(payload, &mut off).to_string();
        let category_or_kind = read_str(payload, &mut off).to_string();
        let lat = read_f64(payload, &mut off);
        let lon = read_f64(payload, &mut off);
        let has_dist = payload[off] != 0;
        off += 1;
        let dist_val = read_f64(payload, &mut off);
        let weight = read_f64(payload, &mut off);
        let alias_count = read_u16(payload, &mut off) as usize;
        let mut aliases = Vec::with_capacity(alias_count);
        for _ in 0..alias_count {
            aliases.push(read_str(payload, &mut off).to_string());
        }
        candidates.push(RankCandidate {
            orig_index,
            kind,
            title,
            address,
            category_or_kind,
            lat,
            lon,
            distance_m: if has_dist { Some(dist_val) } else { None },
            weight,
            aliases,
        });
    }

    let sorted = dedupe_and_sort(&candidates, has_user_pos, &norm_q);
    let mut out = Vec::with_capacity(4 + sorted.len() * 4);
    write_u32(&mut out, sorted.len() as u32);
    for idx in sorted {
        write_u32(&mut out, idx);
    }
    out
}

/// Cmd 15: `smartRanking` w Rust (`score_candidate`, `typical_duration_min`, `rank_smart_destinations`).
pub fn handle_smart_rank_cmd(payload: &[u8]) -> Vec<u8> {
    if payload.is_empty() {
        return Vec::new();
    }
    let mut off = 0usize;
    let subcmd = payload[off];
    off += 1;
    let mut out = Vec::new();

    match subcmd {
        // score_candidate(count, last_seen, is_pinned, now)
        0 => {
            let count = read_i32(payload, &mut off);
            let last_seen = read_f64(payload, &mut off);
            let is_pinned = payload[off] != 0;
            off += 1;
            let now = read_f64(payload, &mut off);
            let s = score_candidate(count, last_seen, is_pinned, now);
            write_f64(&mut out, s);
        }
        // typical_duration_min(durations[])
        1 => {
            let n = read_u32(payload, &mut off) as usize;
            let mut durs = Vec::with_capacity(n);
            for _ in 0..n {
                durs.push(read_i32(payload, &mut off));
            }
            match typical_duration_min(&durs) {
                Some(v) => {
                    out.push(1);
                    write_i32(&mut out, v);
                }
                None => {
                    out.push(0);
                    write_i32(&mut out, 0);
                }
            }
        }
        // rank_smart_destinations
        2 => {
            let user_lat = read_f64(payload, &mut off);
            let user_lon = read_f64(payload, &mut off);
            let now = read_f64(payload, &mut off);
            let limit = read_u32(payload, &mut off) as usize;
            let exclusion_radius_m = read_f64(payload, &mut off);

            let hist_len = read_u32(payload, &mut off) as usize;
            struct HistRow {
                origin_lat: f64,
                origin_lon: f64,
                dest_id: String,
                dest_title: String,
                dest_address: String,
                dest_lat: f64,
                dest_lon: f64,
                duration_min: i32,
                timestamp: f64,
                uses: i32,
            }
            let mut history = Vec::with_capacity(hist_len);
            for _ in 0..hist_len {
                let origin_lat = read_f64(payload, &mut off);
                let origin_lon = read_f64(payload, &mut off);
                let dest_id = read_str(payload, &mut off).to_string();
                let dest_title = read_str(payload, &mut off).to_string();
                let dest_address = read_str(payload, &mut off).to_string();
                let dest_lat = read_f64(payload, &mut off);
                let dest_lon = read_f64(payload, &mut off);
                let duration_min = read_i32(payload, &mut off);
                let timestamp = read_f64(payload, &mut off);
                let uses = read_i32(payload, &mut off).max(1);
                history.push(HistRow {
                    origin_lat,
                    origin_lon,
                    dest_id,
                    dest_title,
                    dest_address,
                    dest_lat,
                    dest_lon,
                    duration_min,
                    timestamp,
                    uses,
                });
            }

            let places_len = read_u32(payload, &mut off) as usize;
            struct PlaceRow {
                id: String,
                place_id: String,
                name: String,
                address: String,
                lat: f64,
                lon: f64,
            }
            let mut saved_places = Vec::with_capacity(places_len);
            for _ in 0..places_len {
                let id = read_str(payload, &mut off).to_string();
                let place_id = read_str(payload, &mut off).to_string();
                let name = read_str(payload, &mut off).to_string();
                let address = read_str(payload, &mut off).to_string();
                let lat = read_f64(payload, &mut off);
                let lon = read_f64(payload, &mut off);
                saved_places.push(PlaceRow {
                    id,
                    place_id,
                    name,
                    address,
                    lat,
                    lon,
                });
            }

            // 1. Miejsce kontekstowe (pierwszy przypięty pin w promieniu 350 m)
            let ctx_idx = saved_places.iter().position(|p| {
                p.lat.is_finite()
                    && p.lon.is_finite()
                    && distance_meters(user_lat, user_lon, p.lat, p.lon) <= CONTEXT_PLACE_RADIUS_M
            });
            let origin_id = match ctx_idx {
                Some(ci) => {
                    let cp = &saved_places[ci];
                    if !cp.place_id.is_empty() {
                        cp.place_id.clone()
                    } else {
                        cp.id.clone()
                    }
                }
                None => "current-gps".to_string(),
            };

            // 2. Filtrowanie historii (30 dni + 1600 m, z fallbackiem do recentMonthTrips lub całej historii)
            let one_month_ago = now - HABIT_WINDOW_MS;
            let recent_month_indices: Vec<usize> = history
                .iter()
                .enumerate()
                .filter(|(_, t)| t.timestamp >= one_month_ago)
                .map(|(i, _)| i)
                .collect();

            let mut nearby_indices: Vec<usize> = recent_month_indices
                .iter()
                .copied()
                .filter(|&i| {
                    let t = &history[i];
                    distance_meters(user_lat, user_lon, t.origin_lat, t.origin_lon)
                        <= CLUSTER_RADIUS_M
                })
                .collect();

            if nearby_indices.is_empty() {
                if !recent_month_indices.is_empty() {
                    nearby_indices = recent_month_indices;
                } else {
                    nearby_indices = (0..history.len()).collect();
                }
            }

            struct Candidate {
                key: String,
                id: String,
                title: String,
                address: String,
                lat: f64,
                lon: f64,
                uses: i32,
                duration_sum: i64,
                last_timestamp: f64,
                is_saved_place: bool,
            }

            let mut candidates: Vec<Candidate> = Vec::new();

            // 3. Agregacja historii z okolicy
            for idx in nearby_indices {
                let trip = &history[idx];
                let dist_to_dest = distance_meters(user_lat, user_lon, trip.dest_lat, trip.dest_lon);
                if !(dist_to_dest > exclusion_radius_m) {
                    continue;
                }
                if let Some(ci) = ctx_idx {
                    let cp = &saved_places[ci];
                    if trip.dest_id == cp.id || (!cp.place_id.is_empty() && trip.dest_id == cp.place_id) {
                        continue;
                    }
                }
                let key = if !trip.dest_id.is_empty() {
                    trip.dest_id.clone()
                } else {
                    trip.dest_title.clone()
                };
                let duration = if trip.duration_min != 0 {
                    trip.duration_min
                } else {
                    FALLBACK_TRIP_MIN
                };
                if let Some(cand) = candidates.iter_mut().find(|c| c.key == key) {
                    cand.uses += trip.uses;
                    cand.duration_sum += (duration as i64) * (trip.uses as i64);
                    if trip.timestamp > cand.last_timestamp {
                        cand.last_timestamp = trip.timestamp;
                    }
                } else {
                    candidates.push(Candidate {
                        key,
                        id: trip.dest_id.clone(),
                        title: trip.dest_title.clone(),
                        address: trip.dest_address.clone(),
                        lat: trip.dest_lat,
                        lon: trip.dest_lon,
                        uses: trip.uses,
                        duration_sum: (duration as i64) * (trip.uses as i64),
                        last_timestamp: trip.timestamp,
                        is_saved_place: false,
                    });
                }
            }

            // 4. Przypięte miejsca i scalanie w promieniu 150 m
            for (pi, place) in saved_places.iter().enumerate() {
                if let Some(ci) = ctx_idx {
                    if place.id == saved_places[ci].id {
                        continue;
                    }
                }
                let dist_to_dest = distance_meters(user_lat, user_lon, place.lat, place.lon);
                if !(dist_to_dest > exclusion_radius_m) {
                    continue;
                }
                let key = if !place.place_id.is_empty() {
                    place.place_id.clone()
                } else {
                    place.id.clone()
                };

                let mut found_idx = candidates.iter().position(|c| c.key == key);
                let mut merged_by_distance = false;
                if found_idx.is_none() && place.lat.is_finite() && place.lon.is_finite() {
                    found_idx = candidates.iter().position(|existing| {
                        !existing.is_saved_place
                            && existing.lat.is_finite()
                            && existing.lon.is_finite()
                            && distance_meters(existing.lat, existing.lon, place.lat, place.lon)
                                <= SAME_PLACE_RADIUS_M
                    });
                    if found_idx.is_some() {
                        merged_by_distance = true;
                    }
                }

                match found_idx {
                    Some(fi) => {
                        let cand = &mut candidates[fi];
                        cand.is_saved_place = true;
                        if merged_by_distance {
                            cand.title = place.name.clone();
                            cand.address = place.address.clone();
                            cand.lat = place.lat;
                            cand.lon = place.lon;
                            cand.id = key;
                        }
                    }
                    None => {
                        let _ = pi;
                        candidates.push(Candidate {
                            key: key.clone(),
                            id: key,
                            title: place.name.clone(),
                            address: place.address.clone(),
                            lat: place.lat,
                            lon: place.lon,
                            uses: 0,
                            duration_sum: 0,
                            last_timestamp: now - 12.0 * 3600.0 * 1000.0,
                            is_saved_place: true,
                        });
                    }
                }
            }

            // 5. Punktacja i sortowanie
            let mut scored: Vec<(usize, f64)> = candidates
                .iter()
                .enumerate()
                .map(|(i, c)| {
                    (
                        i,
                        score_candidate(c.uses, c.last_timestamp, c.is_saved_place, now),
                    )
                })
                .collect();

            scored.sort_by(|a, b| {
                let ca = &candidates[a.0];
                let cb = &candidates[b.0];
                b.1.partial_cmp(&a.1)
                    .unwrap_or(std::cmp::Ordering::Equal)
                    .then_with(|| cb.uses.cmp(&ca.uses))
                    .then_with(|| {
                        cb.last_timestamp
                            .partial_cmp(&ca.last_timestamp)
                            .unwrap_or(std::cmp::Ordering::Equal)
                    })
                    .then_with(|| ca.title.cmp(&cb.title))
            });

            if scored.len() > limit {
                scored.truncate(limit);
            }

            let write_str = |buf: &mut Vec<u8>, s: &str| {
                let b = s.as_bytes();
                write_u16(buf, b.len() as u16);
                buf.extend_from_slice(b);
            };

            write_u32(&mut out, scored.len() as u32);
            write_str(&mut out, &origin_id);
            for (ci, _) in scored {
                let cand = &candidates[ci];
                let freq = cand.uses.max(1);
                let avg_dur = if cand.uses > 0 {
                    1.max(((cand.duration_sum as f64) / (cand.uses as f64)).round() as i32)
                } else {
                    FALLBACK_TRIP_MIN
                };
                write_str(&mut out, &cand.id);
                write_str(&mut out, &cand.title);
                write_str(&mut out, &cand.address);
                write_i32(&mut out, freq);
                write_i32(&mut out, avg_dur);
                write_f64(&mut out, cand.lat);
                write_f64(&mut out, cand.lon);
            }
        }
        _ => {}
    }
    out
}

/// Cmd 16: Integracja wyszukiwarki przystanków z RAPTOR-em:
/// - `subcmd 0`: `resolve_raptor_endpoints` (znajduje przystanki startowe i docelowe w siatce
///   przestrzennej Rust, aplikuje `ANCHOR_ORIGIN_BONUS_SEC = 180` dla wskazanego przystanku-kotwicy
///   oraz dokłada kotwicę w promieniu `1.5 * walk_radius_m`).
/// - `subcmd 1`: `select_journeys` (front Pareto dominacji, deduplikacja łańcucha kursów,
///   dywersyfikacja kombinacji linii co 180 s oraz gwarancja najszybszego przyjazdu).
pub fn handle_raptor_integration_cmd(payload: &[u8]) -> Vec<u8> {
    if payload.is_empty() {
        return Vec::new();
    }
    let mut off = 0usize;
    let subcmd = payload[off];
    off += 1;
    let mut out = Vec::new();

    match subcmd {
        0 => {
            let from_lat = read_f64(payload, &mut off);
            let from_lon = read_f64(payload, &mut off);
            let to_lat = read_f64(payload, &mut off);
            let to_lon = read_f64(payload, &mut off);
            let walk_radius_m = read_f64(payload, &mut off);
            let walk_speed_mps = read_f64(payload, &mut off);
            let detour_factor = read_f64(payload, &mut off);
            let min_access_sec = read_i32(payload, &mut off);
            let anchor_bonus_sec = read_i32(payload, &mut off);
            let limit = read_u32(payload, &mut off) as usize;
            let anchor_stop_id = read_str(payload, &mut off).to_string();

            with_stop_catalog(|cat| {
                let raw_origins = cat.find_nearest(from_lat, from_lon, walk_radius_m, limit);
                let raw_dests = cat.find_nearest(to_lat, to_lon, walk_radius_m, limit);

                let anchor_idx = if !anchor_stop_id.is_empty() {
                    cat.id_to_index.get(&anchor_stop_id).copied()
                } else {
                    None
                };

                let mut origins: Vec<(usize, i32, i32)> = Vec::with_capacity(raw_origins.len() + 1);
                let mut has_anchor = false;

                for (s_idx, dist_m) in raw_origins {
                    let effective = (dist_m as f64) * detour_factor;
                    let raw_walk_sec =
                        min_access_sec.max((effective / walk_speed_mps).round() as i32);
                    let is_anchor = anchor_idx == Some(s_idx);
                    if is_anchor {
                        has_anchor = true;
                    }
                    let walk_sec = if is_anchor {
                        0.max(raw_walk_sec - anchor_bonus_sec)
                    } else {
                        raw_walk_sec
                    };
                    origins.push((s_idx, dist_m, walk_sec));
                }

                if !has_anchor {
                    if let Some(a_idx) = anchor_idx {
                        let a_stop = &cat.stops[a_idx];
                        let dist_m =
                            distance_meters(from_lat, from_lon, a_stop.lat, a_stop.lon).round()
                                as i32;
                        if (dist_m as f64) <= walk_radius_m * 1.5 {
                            let effective = (dist_m as f64) * detour_factor;
                            let raw_walk_sec =
                                min_access_sec.max((effective / walk_speed_mps).round() as i32);
                            origins.push((
                                a_idx,
                                dist_m,
                                0.max(raw_walk_sec - anchor_bonus_sec),
                            ));
                        }
                    }
                }

                write_u32(&mut out, origins.len() as u32);
                for (s_idx, dist_m, walk_sec) in origins {
                    write_u32(&mut out, s_idx as u32);
                    write_i32(&mut out, dist_m);
                    write_i32(&mut out, walk_sec);
                }

                write_u32(&mut out, raw_dests.len() as u32);
                for (s_idx, dist_m) in raw_dests {
                    let effective = (dist_m as f64) * detour_factor;
                    let walk_sec = min_access_sec.max((effective / walk_speed_mps).round() as i32);
                    write_u32(&mut out, s_idx as u32);
                    write_i32(&mut out, dist_m);
                    write_i32(&mut out, walk_sec);
                }
            });
        }
        1 => {
            let ref_sec = read_i32(payload, &mut off);
            let has_arrive_by = payload[off] != 0;
            off += 1;
            let arrive_by_sec = read_i32(payload, &mut off);
            let walk_reluctance = read_f64(payload, &mut off);
            let transfer_penalty_sec = read_f64(payload, &mut off);
            let limit = read_u32(payload, &mut off) as usize;
            let count = read_u32(payload, &mut off) as usize;

            struct JItem {
                orig_idx: u32,
                dep_sec: i32,
                arr_sec: i32,
                transfers: i32,
                walk_sec: i32,
                cost: f64,
                chain: String,
                combo: String,
            }

            let mut scored = Vec::with_capacity(count);
            let wr = (walk_reluctance.max(1.0) - 1.0).max(0.0);
            for _ in 0..count {
                let orig_idx = read_u32(payload, &mut off);
                let dep_sec = read_i32(payload, &mut off);
                let arr_sec = read_i32(payload, &mut off);
                let transfers = read_i32(payload, &mut off);
                let walk_sec = read_i32(payload, &mut off);
                let chain = read_str(payload, &mut off).to_string();
                let combo = read_str(payload, &mut off).to_string();
                let base = if has_arrive_by {
                    (arrive_by_sec - dep_sec) as f64
                } else {
                    (arr_sec - ref_sec) as f64
                };
                let cost =
                    base + wr * (walk_sec as f64) + (transfers as f64) * transfer_penalty_sec;
                scored.push(JItem {
                    orig_idx,
                    dep_sec,
                    arr_sec,
                    transfers,
                    walk_sec,
                    cost,
                    chain,
                    combo,
                });
            }

            scored.sort_by(|a, b| {
                a.cost
                    .partial_cmp(&b.cost)
                    .unwrap_or(std::cmp::Ordering::Equal)
                    .then_with(|| a.arr_sec.cmp(&b.arr_sec))
            });

            let mut by_chain: HashSet<String> = HashSet::with_capacity(scored.len());
            let mut unique: Vec<JItem> = Vec::with_capacity(scored.len());
            for item in scored {
                if by_chain.insert(item.chain.clone()) {
                    unique.push(item);
                }
            }

            let mut front_indices: Vec<usize> = Vec::with_capacity(unique.len());
            for (xi, x) in unique.iter().enumerate() {
                let dominated = unique.iter().enumerate().any(|(yi, y)| {
                    yi != xi
                        && y.dep_sec >= x.dep_sec
                        && y.arr_sec <= x.arr_sec
                        && y.transfers <= x.transfers
                        && y.walk_sec <= x.walk_sec + 30
                        && (y.dep_sec > x.dep_sec
                            || y.arr_sec < x.arr_sec
                            || y.transfers < x.transfers
                            || y.walk_sec < x.walk_sec - 30
                            || y.cost < x.cost)
                });
                if !dominated {
                    front_indices.push(xi);
                }
            }

            let mut per_combo: HashMap<String, Vec<i32>> = HashMap::new();
            let mut result_front_pos: Vec<usize> = Vec::with_capacity(limit);
            for &fi in &front_indices {
                let x = &unique[fi];
                let kept = per_combo.entry(x.combo.clone()).or_default();
                if kept.len() >= 4 {
                    continue;
                }
                if kept.iter().any(|&d| (d - x.dep_sec).abs() < 180) {
                    continue;
                }
                kept.push(x.dep_sec);
                result_front_pos.push(fi);
                if result_front_pos.len() >= limit {
                    break;
                }
            }

            if !result_front_pos.is_empty() && !has_arrive_by {
                let mut fastest_fi = front_indices[0];
                for &fi in &front_indices {
                    if unique[fi].arr_sec < unique[fastest_fi].arr_sec {
                        fastest_fi = fi;
                    }
                }
                if !result_front_pos.contains(&fastest_fi) {
                    if result_front_pos.len() >= limit {
                        result_front_pos.pop();
                    }
                    result_front_pos.push(fastest_fi);
                }
            }

            write_u32(&mut out, result_front_pos.len() as u32);
            for fi in result_front_pos {
                write_u32(&mut out, unique[fi].orig_idx);
            }
        }
        _ => {}
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn polish_normalization_and_fuzzy_match_work() {
        assert_eq!(normalize_polish("  Dworzec Główny Łódź  "), "dworzec glowny lodz");

        // Dokładne trafienie
        assert_eq!(fuzzy_match("Rynek", "Rynek"), (true, 100));
        // Prefiks
        let (m_pref, s_pref) = fuzzy_match("Ryn", "Rynek");
        assert!(m_pref && s_pref >= 92);
        // Akronim 2-4 znakowy
        assert_eq!(fuzzy_match("pg", "Plac Grunwaldzki"), (true, 85));
        // Synonim skrótu "pl grunwaldzki" -> "Plac Grunwaldzki"
        let (m_syn, s_syn) = fuzzy_match("pl grunwaldzki", "Plac Grunwaldzki");
        assert!(m_syn && s_syn >= 90);
        // Literówka Damerau-Levenshtein
        let (m_typo, s_typo) = fuzzy_match("grunwaldzik", "Plac Grunwaldzki");
        assert!(m_typo && s_typo >= 60);
    }

    #[test]
    fn spatial_stop_catalog_finds_nearest_and_builds_footpaths() {
        let mut cat = StopCatalog::default();
        cat.load(vec![
            ("s1".into(), "101".into(), "Renoma".into(), 51.1038, 17.0315, 500),
            ("s2".into(), "102".into(), "Arkady".into(), 51.1010, 17.0290, 400),
            ("s3".into(), "103".into(), "Leśnica".into(), 51.1450, 16.8700, 100),
        ]);

        let near = cat.find_nearest(51.1038, 17.0315, 600.0, 5);
        assert_eq!(near.len(), 2);
        assert_eq!(near[0].0, 0);
        assert_eq!(near[1].0, 1);

        let fps = cat.build_footpaths(600.0, 1.34, 1.15, 45);
        assert_eq!(fps.len(), 2); // s1->s2 oraz s2->s1
    }
}
