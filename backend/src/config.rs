use std::env;
use std::net::SocketAddr;
use std::path::PathBuf;

/// Konfiguracja serwera wczytywana ze zmiennych srodowiskowych.
/// Domyslne limity sa dobrane pod VPS Mikrus 3.5 (4 GB RAM, 40 GB dysku).
#[derive(Debug, Clone)]
pub struct AppConfig {
    pub bind_addr: SocketAddr,
    pub db_path: PathBuf,
    pub cities_config_path: Option<PathBuf>,
    pub zbiorkom_base_url: String,
    pub plk_updates_url: String,
    pub mpk_wroclaw_url: String,
    pub enable_collectors: bool,
    pub enable_kp_collector: bool,
    pub enable_rail_collector: bool,
    pub tier1_poll_secs: u64,
    pub tier2_poll_secs: u64,
    pub kp_poll_secs: u64,
    pub boost_poll_secs: u64,
    pub boost_ttl_secs: u64,
    pub rail_poll_secs: u64,
    pub collector_concurrency: usize,
    pub http_timeout_secs: u64,
    pub raw_retention_hours: i64,
    pub flush_interval_secs: u64,
    pub max_db_size_mb: u64,
    pub rate_limit_rps: u32,
    pub rate_limit_burst: u32,
    pub log_json: bool,
    /// Opcjonalna lista miast (oddzielona przecinkami) ograniczajaca polling przy testach lokalnych.
    pub only_cities: Option<Vec<String>>,
    /// Tryb lokalnego dema: zasiewa przykladowy profil historyczny i zator bez czekania na dane.
    pub seed_demo: bool,
}

impl AppConfig {
    pub fn from_env() -> Self {
        let host = env::var("KILOMETR_HOST").unwrap_or_else(|_| "0.0.0.0".to_string());
        let port: u16 = env_parse("KILOMETR_PORT", 8080);
        let bind_addr = format!("{host}:{port}")
            .parse()
            .unwrap_or_else(|_| SocketAddr::from(([0, 0, 0, 0], 8080)));

        Self {
            bind_addr,
            db_path: PathBuf::from(
                env::var("KILOMETR_DB_PATH").unwrap_or_else(|_| "/data/kilometr-delays.db".to_string()),
            ),
            cities_config_path: env::var("KILOMETR_CITIES_PATH").ok().map(PathBuf::from),
            zbiorkom_base_url: env::var("KILOMETR_ZBIORKOM_URL")
                .unwrap_or_else(|_| "https://api.zbiorkom.live".to_string())
                .trim_end_matches('/')
                .to_string(),
            plk_updates_url: env::var("KILOMETR_PLK_UPDATES_URL")
                .unwrap_or_else(|_| "https://mkuran.pl/gtfs/polish_trains/updates.json".to_string()),
            mpk_wroclaw_url: env::var("KILOMETR_MPK_WROCLAW_URL")
                .unwrap_or_else(|_| "https://mpk.wroc.pl/bus_position".to_string()),
            enable_collectors: env_bool("KILOMETR_ENABLE_COLLECTORS", true),
            enable_kp_collector: env_bool("KILOMETR_ENABLE_KP_COLLECTOR", true),
            enable_rail_collector: env_bool("KILOMETR_ENABLE_RAIL_COLLECTOR", true),
            tier1_poll_secs: env_parse("KILOMETR_TIER1_POLL_SECS", 12),
            tier2_poll_secs: env_parse("KILOMETR_TIER2_POLL_SECS", 35),
            kp_poll_secs: env_parse("KILOMETR_KP_POLL_SECS", 55),
            boost_poll_secs: env_parse("KILOMETR_BOOST_POLL_SECS", 4),
            boost_ttl_secs: env_parse("KILOMETR_BOOST_TTL_SECS", 75),
            rail_poll_secs: env_parse("KILOMETR_RAIL_POLL_SECS", 35),
            collector_concurrency: env_parse("KILOMETR_COLLECTOR_CONCURRENCY", 10),
            http_timeout_secs: env_parse("KILOMETR_HTTP_TIMEOUT_SECS", 9),
            raw_retention_hours: env_parse("KILOMETR_RAW_RETENTION_HOURS", 48),
            flush_interval_secs: env_parse("KILOMETR_FLUSH_INTERVAL_SECS", 20),
            max_db_size_mb: env_parse("KILOMETR_MAX_DB_SIZE_MB", 4096),
            rate_limit_rps: env_parse("KILOMETR_RATE_LIMIT_RPS", 30),
            rate_limit_burst: env_parse("KILOMETR_RATE_LIMIT_BURST", 90),
            log_json: env_bool("KILOMETR_LOG_JSON", true),
            only_cities: env::var("KILOMETR_ONLY_CITIES")
                .ok()
                .map(|raw| {
                    raw.split(',')
                        .map(|s| s.trim().to_ascii_lowercase())
                        .filter(|s| !s.is_empty())
                        .collect::<Vec<_>>()
                })
                .filter(|v| !v.is_empty()),
            seed_demo: env_bool("KILOMETR_SEED_DEMO", false),
        }
    }
}

fn env_parse<T: std::str::FromStr>(key: &str, default: T) -> T {
    env::var(key)
        .ok()
        .and_then(|v| v.trim().parse::<T>().ok())
        .unwrap_or(default)
}

fn env_bool(key: &str, default: bool) -> bool {
    match env::var(key) {
        Ok(v) => matches!(v.trim().to_ascii_lowercase().as_str(), "1" | "true" | "yes" | "on"),
        Err(_) => default,
    }
}
