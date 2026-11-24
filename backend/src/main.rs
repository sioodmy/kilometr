mod analytics;
mod api;
mod cities;
mod collectors;
mod config;
mod models;
mod storage;

use std::net::SocketAddr;
use std::sync::atomic::AtomicU64;
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::watch;
use tracing::info;
use tracing_subscriber::EnvFilter;

use crate::analytics::AnalyticsEngine;
use crate::api::{build_router, AppState, RateLimiter};
use crate::cities::CityRegistry;
use crate::collectors::{spawn_background_tasks, SourceHealthRegistry};
use crate::config::AppConfig;
use crate::storage::StorageHandle;

#[tokio::main]
async fn main() {
    let config = Arc::new(AppConfig::from_env());
    init_tracing(config.log_json);

    let cities = Arc::new(
        CityRegistry::load(config.cities_config_path.as_deref())
            .expect("Nie udalo sie wczytac rejestru miast"),
    );
    let (storage, loaded_profiles) =
        StorageHandle::open(&config.db_path).expect("Nie udalo sie otworzyc bazy SQLite");
    let storage = Arc::new(storage);
    let loaded_line_count = loaded_profiles.lines.len();
    let loaded_hub_count = loaded_profiles.hubs.len();
    let engine = Arc::new(AnalyticsEngine::new(loaded_profiles));
    if config.seed_demo {
        engine.seed_demo_data(chrono::Utc::now().timestamp_millis());
        info!("Zasiano lokalne dane demonstracyjne (KILOMETR_SEED_DEMO=true)");
    }
    let health = Arc::new(SourceHealthRegistry::new());

    info!(
        version = env!("CARGO_PKG_VERSION"),
        bind = %config.bind_addr,
        db = %config.db_path.display(),
        cities = cities.all.len(),
        loaded_line_profiles = loaded_line_count,
        loaded_hub_profiles = loaded_hub_count,
        "Start kilometr-api"
    );

    let (shutdown_tx, shutdown_rx) = watch::channel(false);
    spawn_background_tasks(
        config.clone(),
        cities.clone(),
        engine.clone(),
        storage.clone(),
        health.clone(),
        shutdown_rx,
    );

    let state = Arc::new(AppState {
        config: config.clone(),
        cities,
        engine,
        storage,
        health,
        started_at: Instant::now(),
        total_requests: AtomicU64::new(0),
        rate_limiter: RateLimiter::new(config.rate_limit_rps, config.rate_limit_burst),
    });

    let app = build_router(state);
    let listener = tokio::net::TcpListener::bind(config.bind_addr)
        .await
        .expect("Nie mozna zbindowac adresu HTTP");

    info!("Nasluchuje na http://{}", config.bind_addr);

    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown(shutdown_signal(shutdown_tx))
    .await
    .expect("Blad serwera HTTP");

    info!("Zakonczono kilometr-api");
}

fn init_tracing(json: bool) {
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("kilometr_api=info,tower_http=warn"));
    if json {
        tracing_subscriber::fmt()
            .with_env_filter(filter)
            .json()
            .init();
    } else {
        tracing_subscriber::fmt().with_env_filter(filter).init();
    }
}

async fn shutdown_signal(tx: watch::Sender<bool>) {
    let ctrl_c = async {
        let _ = tokio::signal::ctrl_c().await;
    };

    #[cfg(unix)]
    let terminate = async {
        if let Ok(mut sig) =
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
        {
            sig.recv().await;
        }
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }
    info!("Odebrano sygnal zamkniecia, zapisuje ostatni stan...");
    let _ = tx.send(true);
    // Krotka pauza na domkniecie batcha SQLite i wal_checkpoint.
    tokio::time::sleep(std::time::Duration::from_millis(300)).await;
}
