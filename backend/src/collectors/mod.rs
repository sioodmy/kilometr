pub mod kiedyprzyjedzie;
pub mod mpk_wroclaw;
pub mod rail_plk;
pub mod zbiorkom;

use dashmap::DashMap;
use reqwest::Client;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{watch, Semaphore};
use tracing::{debug, info, warn};

use crate::analytics::AnalyticsEngine;
use crate::cities::{CityConfig, CityRegistry};
use crate::config::AppConfig;
use crate::models::SourceHealthSummary;
use crate::storage::StorageHandle;

use self::kiedyprzyjedzie::KpCollectorCache;
use self::mpk_wroclaw::fetch_mpk_wroclaw_fallback;
use self::rail_plk::{fetch_plk_updates, RailFetchOutcome};
use self::zbiorkom::{fetch_city_positions, fetch_city_rail_positions};

#[derive(Debug, Default, Clone)]
struct SourceState {
    attempts: u64,
    failures: u64,
    consecutive_failures: u32,
    backoff_until_ms: i64,
    last_success_ms: Option<i64>,
    last_error: Option<String>,
}

pub struct SourceHealthRegistry {
    states: DashMap<String, SourceState>,
}

impl SourceHealthRegistry {
    pub fn new() -> Self {
        Self {
            states: DashMap::new(),
        }
    }

    pub fn should_skip(&self, source: &str, now_ms: i64) -> bool {
        self.states
            .get(source)
            .map(|s| s.backoff_until_ms > now_ms)
            .unwrap_or(false)
    }

    pub fn record_ok(&self, source: &str, now_ms: i64) {
        self.states
            .entry(source.to_string())
            .and_modify(|s| {
                s.attempts += 1;
                s.consecutive_failures = 0;
                s.backoff_until_ms = 0;
                s.last_success_ms = Some(now_ms);
                s.last_error = None;
            })
            .or_insert(SourceState {
                attempts: 1,
                failures: 0,
                consecutive_failures: 0,
                backoff_until_ms: 0,
                last_success_ms: Some(now_ms),
                last_error: None,
            });
    }

    pub fn record_err(&self, source: &str, now_ms: i64, err: String) {
        self.states
            .entry(source.to_string())
            .and_modify(|s| {
                s.attempts += 1;
                s.failures += 1;
                s.consecutive_failures += 1;
                if s.consecutive_failures >= 3 {
                    let shift = (s.consecutive_failures - 3).min(3);
                    let backoff_sec = (45_i64 << shift).min(300);
                    s.backoff_until_ms = now_ms + backoff_sec * 1000;
                }
                s.last_error = Some(err.clone());
            })
            .or_insert(SourceState {
                attempts: 1,
                failures: 1,
                consecutive_failures: 1,
                backoff_until_ms: 0,
                last_success_ms: None,
                last_error: Some(err),
            });
    }

    pub fn snapshot(&self, now_ms: i64) -> Vec<SourceHealthSummary> {
        let mut out: Vec<SourceHealthSummary> = self
            .states
            .iter()
            .map(|entry| {
                let s = entry.value();
                SourceHealthSummary {
                    source: entry.key().clone(),
                    attempts: s.attempts,
                    failures: s.failures,
                    consecutive_failures: s.consecutive_failures,
                    circuit_open: s.backoff_until_ms > now_ms,
                    last_success_ms: s.last_success_ms,
                    last_error: s.last_error.clone(),
                }
            })
            .collect();
        out.sort_by(|a, b| a.source.cmp(&b.source));
        out
    }
}

pub fn spawn_background_tasks(
    config: Arc<AppConfig>,
    cities: Arc<CityRegistry>,
    engine: Arc<AnalyticsEngine>,
    storage: Arc<StorageHandle>,
    health: Arc<SourceHealthRegistry>,
    shutdown_rx: watch::Receiver<bool>,
) {
    // Task zrzutu batcha statystyk do SQLite i okresowej konserwacji dysku.
    {
        let cfg = config.clone();
        let eng = engine.clone();
        let st = storage.clone();
        let mut rx = shutdown_rx.clone();
        tokio::spawn(async move {
            let mut flush_ticker =
                tokio::time::interval(Duration::from_secs(cfg.flush_interval_secs.max(5)));
            let mut maint_ticker = tokio::time::interval(Duration::from_secs(3600));
            flush_ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
            maint_ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

            loop {
                tokio::select! {
                    _ = rx.changed() => {
                        let batch = eng.drain_persistence_batch();
                        st.send_batch(batch).await;
                        st.shutdown().await;
                        break;
                    }
                    _ = flush_ticker.tick() => {
                        let batch = eng.drain_persistence_batch();
                        st.send_batch(batch).await;
                    }
                    _ = maint_ticker.tick() => {
                        st.send_maintenance(cfg.raw_retention_hours, cfg.max_db_size_mb).await;
                    }
                }
            }
        });
    }

    if !config.enable_collectors {
        info!("Kolektory wylaczone (KILOMETR_ENABLE_COLLECTORS=false)");
        return;
    }

    let client = Client::builder()
        .timeout(Duration::from_secs(config.http_timeout_secs.max(3)))
        .pool_max_idle_per_host(16)
        .user_agent("KilometrAPI/1.0 (+https://kilometr.app)")
        .build()
        .expect("reqwest client build");

    let sem = Arc::new(Semaphore::new(config.collector_concurrency.max(2)));
    let kp_cache = Arc::new(KpCollectorCache::new());
    let last_poll_ms: Arc<DashMap<String, i64>> = Arc::new(DashMap::new());

    // Glowna petla adaptacyjnego schedulera miast (Tier 1/2/3 + demand-driven boost).
    {
        let cfg = config.clone();
        let reg = cities.clone();
        let eng = engine.clone();
        let hlt = health.clone();
        let http = client.clone();
        let mut rx = shutdown_rx.clone();

        tokio::spawn(async move {
            let mut ticker = tokio::time::interval(Duration::from_secs(2));
            ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
            info!(
                "Uruchomiono adaptacyjny scheduler dla {} miast live",
                reg.live_cities().count()
            );

            loop {
                tokio::select! {
                    _ = rx.changed() => break,
                    _ = ticker.tick() => {
                        let now_ms = jiff::Timestamp::now().as_millisecond();
                        for city in reg.live_cities() {
                            if let Some(ref only) = cfg.only_cities {
                                if !only.iter().any(|id| id == &city.id) {
                                    continue;
                                }
                            }
                            if city.kp_prefix.is_some() && !cfg.enable_kp_collector {
                                continue;
                            }
                            let boosted = eng.is_city_boosted(&city.id, now_ms, cfg.boost_ttl_secs);
                            let target_interval_secs = if boosted {
                                if city.kp_prefix.is_some() {
                                    cfg.boost_poll_secs.max(15)
                                } else {
                                    cfg.boost_poll_secs.max(3)
                                }
                            } else if city.kp_prefix.is_some() {
                                cfg.kp_poll_secs
                            } else if city.tier == 1 {
                                cfg.tier1_poll_secs
                            } else {
                                cfg.tier2_poll_secs
                            };

                            let prev = last_poll_ms.get(&city.id).map(|v| *v).unwrap_or(0);
                            if now_ms - prev < (target_interval_secs as i64) * 1000 {
                                continue;
                            }
                            let source_key = if city.kp_prefix.is_some() {
                                format!("kp:{}", city.id)
                            } else {
                                format!("zbiorkom:{}", city.id)
                            };
                            if hlt.should_skip(&source_key, now_ms) {
                                continue;
                            }

                            let Ok(permit) = sem.clone().try_acquire_owned() else {
                                break;
                            };
                            last_poll_ms.insert(city.id.clone(), now_ms);

                            let city_owned: CityConfig = city.clone();
                            let http_c = http.clone();
                            let cfg_c = cfg.clone();
                            let eng_c = eng.clone();
                            let hlt_c = hlt.clone();
                            let kp_c = kp_cache.clone();

                            tokio::spawn(async move {
                                let _permit = permit;
                                poll_single_city(&http_c, &cfg_c, &city_owned, &eng_c, &hlt_c, &kp_c).await;
                            });
                        }
                    }
                }
            }
        });
    }

    // Kolektor ogolnopolski kolei PKP PLK (updates.json z ETag).
    if config.enable_rail_collector {
        let cfg = config.clone();
        let eng = engine.clone();
        let hlt = health.clone();
        let http = client.clone();
        let mut rx = shutdown_rx;

        tokio::spawn(async move {
            let mut ticker = tokio::time::interval(Duration::from_secs(cfg.rail_poll_secs.max(15)));
            ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
            loop {
                tokio::select! {
                    _ = rx.changed() => break,
                    _ = ticker.tick() => {
                        let now_ms = jiff::Timestamp::now().as_millisecond();
                        if hlt.should_skip("plk_updates", now_ms) {
                            continue;
                        }
                        let etag = eng.rail_etag();
                        match fetch_plk_updates(&http, &cfg.plk_updates_url, &etag).await {
                            Ok(RailFetchOutcome::NotModified) => {
                                hlt.record_ok("plk_updates", now_ms);
                                debug!("PLK updates 304 Not Modified");
                            }
                            Ok(RailFetchOutcome::Updated { by_trip_id, by_number, timestamp_iso, etag }) => {
                                let count = by_trip_id.len();
                                eng.ingest_rail_updates(by_trip_id, by_number, timestamp_iso, etag, now_ms);
                                hlt.record_ok("plk_updates", now_ms);
                                debug!("PLK updates zaktualizowane: {count} indeksow");
                            }
                            Err(err) => {
                                hlt.record_err("plk_updates", now_ms, err.clone());
                                warn!("Blad pobierania PLK updates: {err}");
                            }
                        }
                    }
                }
            }
        });
    }
}

async fn poll_single_city(
    client: &Client,
    config: &AppConfig,
    city: &CityConfig,
    engine: &AnalyticsEngine,
    health: &SourceHealthRegistry,
    kp_cache: &KpCollectorCache,
) {
    let now_ms = jiff::Timestamp::now().as_millisecond();

    if city.kp_prefix.is_some() {
        let key = format!("kp:{}", city.id);
        match kp_cache.fetch_city_positions(client, city).await {
            Ok(vehicles) => {
                engine.ingest_city_vehicles(&city.id, vehicles, false, now_ms);
                health.record_ok(&key, now_ms);
            }
            Err(err) => {
                health.record_err(&key, now_ms, err.clone());
                debug!("Blad KP {}: {err}", city.id);
            }
        }
        return;
    }

    let key = format!("zbiorkom:{}", city.id);
    match fetch_city_positions(client, &config.zbiorkom_base_url, city).await {
        Ok(vehicles) => {
            engine.ingest_city_vehicles(&city.id, vehicles, false, now_ms);
            health.record_ok(&key, now_ms);
        }
        Err(err) => {
            health.record_err(&key, now_ms, err.clone());
            debug!("Blad zbiorkom {}: {err}", city.id);
            if city.direct_bus_position {
                match fetch_mpk_wroclaw_fallback(client, &config.mpk_wroclaw_url).await {
                    Ok(fallback_veh) => {
                        engine.ingest_city_vehicles(&city.id, fallback_veh, false, now_ms);
                        health.record_ok("mpk_wroclaw_fallback", now_ms);
                    }
                    Err(mpk_err) => {
                        health.record_err("mpk_wroclaw_fallback", now_ms, mpk_err);
                    }
                }
            }
        }
    }

    if !city.rail_agencies.is_empty() {
        let rail_key = format!("zbiorkom_rail:{}", city.id);
        if !health.should_skip(&rail_key, now_ms) {
            match fetch_city_rail_positions(client, &config.zbiorkom_base_url, city).await {
                Ok(rail_vehicles) => {
                    engine.ingest_city_vehicles(&city.id, rail_vehicles, true, now_ms);
                    health.record_ok(&rail_key, now_ms);
                }
                Err(err) => {
                    health.record_err(&rail_key, now_ms, err);
                }
            }
        }
    }
}
