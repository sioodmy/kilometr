use std::cell::RefCell;
use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};

use crate::search::{distance_meters, expand_token_synonyms, normalize_polish};

#[derive(Default)]
struct AddressCatalog {
    streets: Vec<Street>,
    street_ids: HashMap<(String, String), usize>,
    words: Vec<Word>,
}

struct Street {
    id: String,
    name: String,
    locality: String,
    addresses: Vec<Address>,
}

struct Address {
    id: String,
    house: String,
    norm_house: String,
    lat: f64,
    lon: f64,
}

struct Word {
    text: String,
    streets: Vec<usize>,
}

struct Hit<'a> {
    address: &'a Address,
    street: &'a Street,
    with_house: bool,
    score: i32,
    distance: Option<i32>,
}

impl Hit<'_> {
    fn compare(&self, other: &Self) -> Ordering {
        other
            .score
            .cmp(&self.score)
            .then_with(|| self.distance.cmp(&other.distance))
            .then_with(|| self.street.name.cmp(&other.street.name))
            .then_with(|| self.street.locality.cmp(&other.street.locality))
            .then_with(|| self.address.id.cmp(&other.address.id))
    }
}

fn insert_hit<'a>(hits: &mut Vec<Hit<'a>>, hit: Hit<'a>, limit: usize) {
    let index = hits
        .binary_search_by(|other| other.compare(&hit))
        .unwrap_or_else(|i| i);
    if index < limit {
        hits.insert(index, hit);
        hits.truncate(limit);
    }
}

fn tokens(text: &str) -> Vec<&str> {
    text.split(|c: char| !c.is_alphanumeric() && c != '/')
        .filter(|word| !word.is_empty() && !matches!(*word, "ul" | "ulica"))
        .collect()
}

fn normalize_house(text: &str) -> String {
    normalize_polish(text)
        .chars()
        .filter(|c| !c.is_whitespace())
        .collect()
}

impl AddressCatalog {
    fn append(&mut self, id: &str, name: &str, house: &str, locality: &str, lat: f64, lon: f64) {
        if name.trim().is_empty()
            || house.trim().is_empty()
            || !lat.is_finite()
            || !lon.is_finite()
            || lat.abs() > 90.0
            || lon.abs() > 180.0
        {
            return;
        }
        let next = self.streets.len();
        let key = (name.to_owned(), locality.to_owned());
        let idx = *self.street_ids.entry(key).or_insert_with(|| {
            self.streets.push(Street {
                id: id.to_owned(),
                name: name.to_owned(),
                locality: locality.to_owned(),
                addresses: Vec::new(),
            });
            next
        });
        self.streets[idx].addresses.push(Address {
            id: id.to_owned(),
            house: house.to_owned(),
            norm_house: normalize_house(house),
            lat,
            lon,
        });
    }

    fn finish(&mut self) {
        let mut postings: HashMap<String, Vec<usize>> = HashMap::new();
        for (idx, street) in self.streets.iter_mut().enumerate() {
            street
                .addresses
                .sort_unstable_by(|a, b| a.norm_house.cmp(&b.norm_house));
            let text = normalize_polish(&format!("{} {}", street.name, street.locality));
            let unique: HashSet<&str> = tokens(&text).into_iter().collect();
            for word in unique {
                postings.entry(word.to_owned()).or_default().push(idx);
            }
        }
        self.words = postings
            .into_iter()
            .map(|(text, streets)| Word { text, streets })
            .collect();
        self.words.sort_unstable_by(|a, b| a.text.cmp(&b.text));
        self.street_ids.clear();
        self.street_ids.shrink_to_fit();
    }

    // Prefiksy znajdujemy binarnie w słowniku, bez skanowania ulic i liczenia literówek.
    fn match_streets(&self, query: &[&str]) -> HashMap<usize, i32> {
        let mut matches: Option<HashMap<usize, i32>> = None;
        let mut ordered = query.to_vec();
        ordered.sort_by_key(|token| !token.chars().any(|c| c.is_ascii_digit()));
        for token in ordered {
            let mut current: HashMap<usize, i32> = HashMap::new();
            for variant in expand_token_synonyms(token) {
                let numeric = variant.chars().any(|c| c.is_ascii_digit());
                let start = self
                    .words
                    .partition_point(|word| word.text.as_str() < variant);
                for word in self.words[start..]
                    .iter()
                    .take_while(|word| word.text.starts_with(variant))
                {
                    let score = if word.text == variant {
                        100
                    } else if !numeric {
                        90
                    } else {
                        break;
                    };
                    for &idx in &word.streets {
                        if matches
                            .as_ref()
                            .is_none_or(|previous| previous.contains_key(&idx))
                        {
                            current
                                .entry(idx)
                                .and_modify(|best| *best = (*best).max(score))
                                .or_insert(score);
                        }
                    }
                }
            }
            if let Some(previous) = matches {
                for (idx, score) in &mut current {
                    *score = (*score).min(previous[idx]);
                }
            }
            if current.is_empty() {
                return current;
            }
            matches = Some(current);
        }
        matches.unwrap_or_default()
    }

    fn search(&self, query: &str, position: Option<(f64, f64)>, limit: usize) -> Vec<Hit<'_>> {
        let normalized = normalize_polish(query);
        if normalized.chars().count() < 2 || normalized.len() > 160 || limit == 0 {
            return Vec::new();
        }
        let query_tokens = tokens(&normalized);
        let mut matches = self.match_streets(&query_tokens);
        let mut house = None;
        if matches.is_empty() {
            for (index, token) in query_tokens.iter().enumerate().rev() {
                if !token.starts_with(|c: char| c.is_ascii_digit()) {
                    continue;
                }
                let remaining: Vec<&str> = query_tokens
                    .iter()
                    .enumerate()
                    .filter_map(|(i, token)| (i != index).then_some(*token))
                    .collect();
                if remaining.is_empty() {
                    continue;
                }
                let candidates = self.match_streets(&remaining);
                if !candidates.is_empty() {
                    matches = candidates;
                    house = Some(normalize_house(token));
                    break;
                }
            }
        }
        let mut hits = Vec::with_capacity(limit);
        for (idx, score) in matches {
            let street = &self.streets[idx];
            let start = house.as_ref().map_or(0, |house| {
                street
                    .addresses
                    .partition_point(|address| address.norm_house < *house)
            });
            let mut nearest: Option<Hit<'_>> = None;
            for address in &street.addresses[start..] {
                let mut score = score;
                if let Some(house) = &house {
                    if !address.norm_house.starts_with(house) {
                        break;
                    }
                    let remainder = &address.norm_house[house.len()..];
                    if remainder.starts_with(|c: char| c.is_ascii_digit()) {
                        continue;
                    }
                    if !remainder.is_empty() {
                        score -= 5;
                    }
                }
                let distance = position.map(|(lat, lon)| {
                    distance_meters(lat, lon, address.lat, address.lon).round() as i32
                });
                let hit = Hit {
                    address,
                    street,
                    with_house: house.is_some(),
                    score,
                    distance,
                };
                if house.is_some() {
                    insert_hit(&mut hits, hit, limit);
                } else if nearest
                    .as_ref()
                    .is_none_or(|best| hit.compare(best).is_lt())
                {
                    nearest = Some(hit);
                }
            }
            if let Some(hit) = nearest {
                insert_hit(&mut hits, hit, limit);
            }
        }
        hits
    }
}

thread_local! {
    static CATALOG: RefCell<AddressCatalog> = RefCell::new(AddressCatalog::default());
}

struct Reader<'a> {
    bytes: &'a [u8],
    offset: usize,
}

impl<'a> Reader<'a> {
    fn take<const N: usize>(&mut self) -> Option<[u8; N]> {
        let bytes = self
            .bytes
            .get(self.offset..self.offset.checked_add(N)?)?
            .try_into()
            .ok()?;
        self.offset += N;
        Some(bytes)
    }
    fn u32(&mut self) -> Option<u32> {
        Some(u32::from_le_bytes(self.take()?))
    }
    fn f64(&mut self) -> Option<f64> {
        Some(f64::from_le_bytes(self.take()?))
    }
    fn string(&mut self) -> Option<&'a str> {
        let len = u16::from_le_bytes(self.take()?) as usize;
        let text = std::str::from_utf8(self.bytes.get(self.offset..self.offset.checked_add(len)?)?)
            .ok()?;
        self.offset += len;
        Some(text)
    }
}

fn write_string(out: &mut Vec<u8>, text: &str) {
    let len = text.len().min(u16::MAX as usize);
    out.extend_from_slice(&(len as u16).to_le_bytes());
    out.extend_from_slice(&text.as_bytes()[..len]);
}

/// Cmd 17: 0 czyści, 1 dokłada paczkę, 2 buduje indeks słów, 3 szuka adresów.
pub fn handle_address_cmd(payload: &[u8]) -> Vec<u8> {
    fn handle(payload: &[u8]) -> Option<Vec<u8>> {
        let (&command, bytes) = payload.split_first()?;
        let mut reader = Reader { bytes, offset: 0 };
        let mut out = Vec::new();
        match command {
            0 => CATALOG.with(|catalog| *catalog.borrow_mut() = AddressCatalog::default()),
            1 => {
                let count = reader.u32()?;
                CATALOG.with(|catalog| {
                    let mut catalog = catalog.borrow_mut();
                    for _ in 0..count {
                        catalog.append(
                            reader.string()?,
                            reader.string()?,
                            reader.string()?,
                            reader.string()?,
                            reader.f64()?,
                            reader.f64()?,
                        );
                    }
                    Some(())
                })?;
            }
            2 => CATALOG.with(|catalog| catalog.borrow_mut().finish()),
            3 => {
                let query = reader.string()?;
                let has_position = reader.take::<1>()?[0] != 0;
                let lat = reader.f64()?;
                let lon = reader.f64()?;
                let limit = (reader.u32()? as usize).min(50);
                let position =
                    (has_position && lat.is_finite() && lon.is_finite()).then_some((lat, lon));
                CATALOG.with(|catalog| {
                    let catalog = catalog.borrow();
                    let hits = catalog.search(query, position, limit);
                    out.extend_from_slice(&(hits.len() as u32).to_le_bytes());
                    for hit in hits {
                        let title = if hit.with_house {
                            format!("{} {}", hit.street.name, hit.address.house)
                        } else {
                            hit.street.name.clone()
                        };
                        let id = if hit.with_house {
                            &hit.address.id
                        } else {
                            &hit.street.id
                        };
                        write_string(
                            &mut out,
                            &format!(
                                "{}{}",
                                if hit.with_house {
                                    "address-"
                                } else {
                                    "street-"
                                },
                                id
                            ),
                        );
                        write_string(&mut out, &title);
                        write_string(&mut out, &hit.street.locality);
                        out.extend_from_slice(&hit.address.lat.to_le_bytes());
                        out.extend_from_slice(&hit.address.lon.to_le_bytes());
                    }
                });
                return Some(out);
            }
            _ => return None,
        }
        out.extend_from_slice(&1u32.to_le_bytes());
        Some(out)
    }
    handle(payload).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[ignore]
    fn benchmark_city_catalog() {
        let mut catalog = catalog();
        let mut seed = 17u32;
        for street in 0..10_000 {
            let mut name = String::new();
            for _ in 0..12 {
                seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
                name.push((b'a' + ((seed >> 16) % 26) as u8) as char);
            }
            for house in 1..=10 {
                catalog.append(
                    &format!("{street}/{house}"),
                    &name,
                    &house.to_string(),
                    "Wrocław",
                    51.1 + street as f64 * 0.000001,
                    17.0,
                );
            }
        }
        catalog.finish();
        for query in [
            "gr",
            "grun",
            "grunwaldzka",
            "grunwaldzka 12",
            "grunwladzka 12",
            "wroclaw",
            "nieistniejaca 99",
        ] {
            let mut timings = Vec::new();
            for _ in 0..50 {
                let start = std::time::Instant::now();
                std::hint::black_box(catalog.search(query, Some((51.11, 17.04)), 16));
                timings.push(start.elapsed());
            }
            timings.sort();
            println!("{query}: p50 {:?}, p95 {:?}", timings[25], timings[47]);
        }
    }

    fn catalog() -> AddressCatalog {
        let mut catalog = AddressCatalog::default();
        for (id, street, house, city) in [
            ("node/1", "Grunwaldzka", "12", "Wrocław"),
            ("way/2", "Grunwaldzka", "12A", "Wrocław"),
            ("node/3", "Grunwaldzka", "120", "Wrocław"),
            ("node/4", "3 Maja", "7", "Katowice"),
            ("node/5", "Długa", "5", "Gdańsk"),
            ("node/6", "Długa", "5", "Gdynia"),
            ("node/7", "Grunwaldzka", "14/2", "Wrocław"),
        ] {
            catalog.append(id, street, house, city, 51.1, 17.0);
        }
        catalog.finish();
        catalog
    }

    #[test]
    fn street_prefix_and_strict_house_number() {
        let catalog = catalog();
        for query in [
            "Grunwaldzka 12",
            "grun 12",
            "12 grunwaldzka",
            "ul. Grunwaldzka 12 Wroclaw",
        ] {
            let hits = catalog.search(query, None, 10);
            assert_eq!(hits.len(), 2, "{query}");
            assert_eq!(hits[0].address.house, "12");
            assert_eq!(hits[1].address.house, "12A");
        }
        assert!(catalog.search("grunwaldzka 13", None, 10).is_empty());
        assert!(catalog.search("grunwladzka 12", None, 10).is_empty());
        let limited = catalog.search("grun 12", None, 1);
        assert_eq!(limited.len(), 1);
        assert_eq!(limited[0].address.house, "12");
        assert_eq!(
            catalog.search("grunwaldzka 12a", None, 10)[0].address.house,
            "12A"
        );
        assert_eq!(
            catalog.search("grunwaldzka 14/2", None, 10)[0]
                .address
                .house,
            "14/2"
        );
        assert_eq!(catalog.search("3 maja", None, 10)[0].street.name, "3 Maja");
        assert_eq!(catalog.search("3 maja 7", None, 10)[0].address.house, "7");
        assert_eq!(catalog.search("dluga 5 gdansk", None, 10).len(), 1);
        assert_eq!(catalog.search("dluga 5", None, 10).len(), 2);
        assert!(catalog.search("", None, 10).is_empty());
        assert!(catalog.search("grunwaldzka", None, 0).is_empty());
    }

    #[test]
    fn malformed_commands_do_not_panic() {
        for payload in [&[][..], &[1], &[1, 255, 255, 255, 255], &[3, 4, 0, b'x']] {
            assert!(handle_address_cmd(payload).is_empty());
        }
    }
}
