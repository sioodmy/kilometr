use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;

const EMBEDDED_CITIES_JSON: &str = include_str!("../config/cities.json");

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct CityCenter {
    pub lat: f64,
    pub lon: f64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct CityBounds {
    #[serde(rename = "minLat")]
    pub min_lat: f64,
    #[serde(rename = "maxLat")]
    pub max_lat: f64,
    #[serde(rename = "minLon")]
    pub min_lon: f64,
    #[serde(rename = "maxLon")]
    pub max_lon: f64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct CityConfig {
    pub id: String,
    pub name: String,
    pub center: CityCenter,
    pub bounds: CityBounds,
    pub zbiorkom_slug: String,
    pub zbiorkom_bbox: String,
    pub zbiorkom_agencies: Option<String>,
    pub kp_prefix: Option<String>,
    #[serde(default)]
    pub rail_agencies: Vec<String>,
    pub live: bool,
    pub direct_bus_position: bool,
    pub tier: u8,
}

#[derive(Debug, Clone)]
pub struct CityRegistry {
    pub all: Vec<CityConfig>,
    by_id: HashMap<String, usize>,
}

impl CityRegistry {
    pub fn load(override_path: Option<&Path>) -> Result<Self, String> {
        let raw = match override_path {
            Some(path) if path.exists() => std::fs::read_to_string(path)
                .map_err(|e| format!("Nie mozna odczytac {}: {e}", path.display()))?,
            _ => EMBEDDED_CITIES_JSON.to_string(),
        };
        let all: Vec<CityConfig> =
            serde_json::from_str(&raw).map_err(|e| format!("Bledny JSON miast: {e}"))?;
        let mut by_id = HashMap::with_capacity(all.len());
        for (idx, c) in all.iter().enumerate() {
            by_id.insert(c.id.clone(), idx);
        }
        Ok(Self { all, by_id })
    }

    pub fn get(&self, id: &str) -> Option<&CityConfig> {
        self.by_id.get(id).map(|&i| &self.all[i])
    }

    pub fn live_cities(&self) -> impl Iterator<Item = &CityConfig> {
        self.all.iter().filter(|c| c.live)
    }
}
