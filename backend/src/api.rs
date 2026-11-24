use axum::extract::{ConnectInfo, Query, Request, State};
use axum::http::header::{CACHE_CONTROL, CONTENT_TYPE, ETAG, IF_NONE_MATCH};
use axum::http::{HeaderMap, HeaderValue, Method, StatusCode};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use chrono::Utc;
use dashmap::DashMap;
use serde::Deserialize;
use std::collections::HashSet;
use std::net::{IpAddr, SocketAddr};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tower_http::compression::CompressionLayer;
use tower_http::cors::{Any, CorsLayer};
use tower_http::limit::RequestBodyLimitLayer;
use tower_http::trace::TraceLayer;

use crate::analytics::AnalyticsEngine;
use crate::cities::CityRegistry;
use crate::collectors::SourceHealthRegistry;
use crate::config::AppConfig;
use crate::models::{Bbox, DelayEstimateRequest, SystemStatus};
use crate::storage::StorageHandle;

pub struct AppState {
    pub config: Arc<AppConfig>,
    pub cities: Arc<CityRegistry>,
    pub engine: Arc<AnalyticsEngine>,
    pub storage: Arc<StorageHandle>,
    pub health: Arc<SourceHealthRegistry>,
    pub started_at: Instant,
    pub total_requests: AtomicU64,
    pub rate_limiter: RateLimiter,
}

pub struct RateLimiter {
    buckets: DashMap<IpAddr, (f64, Instant)>,
    rps: f64,
    burst: f64,
}

impl RateLimiter {
    pub fn new(rps: u32, burst: u32) -> Self {
        Self {
            buckets: DashMap::new(),
            rps: rps.max(1) as f64,
            burst: burst.max(1) as f64,
        }
    }

    pub fn allow(&self, ip: IpAddr) -> bool {
        let now = Instant::now();
        if self.buckets.len() > 20_000 {
            self.buckets
                .retain(|_, (_, last)| now.duration_since(*last) < Duration::from_secs(120));
        }
        let mut entry = self.buckets.entry(ip).or_insert((self.burst, now));
        let (tokens, last) = entry.value_mut();
        let elapsed = now.duration_since(*last).as_secs_f64();
        *tokens = (*tokens + elapsed * self.rps).min(self.burst);
        *last = now;
        if *tokens >= 1.0 {
            *tokens -= 1.0;
            true
        } else {
            false
        }
    }
}

pub fn build_router(state: Arc<AppState>) -> Router {
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods([Method::GET, Method::POST, Method::HEAD, Method::OPTIONS])
        .allow_headers(Any)
        .expose_headers([ETAG, CACHE_CONTROL]);

    Router::new()
        .route("/health", get(handle_health))
        .route("/v1/status", get(handle_status))
        .route("/v1/cities", get(handle_cities))
        .route("/v1/vehicles", get(handle_vehicles))
        .route("/v1/delays/heatmap", get(handle_heatmap))
        .route("/v1/delays/lines", get(handle_lines))
        .route("/v1/delays/hubs", get(handle_hubs))
        .route("/v1/delays/estimate", post(handle_estimate))
        .route("/v1/shared/live", post(handle_estimate))
        .route("/v1/rail/delays", get(handle_rail_delays))
        .route("/metrics", get(handle_metrics))
        .layer(middleware::from_fn_with_state(state.clone(), rate_limit_middleware))
        .layer(RequestBodyLimitLayer::new(128 * 1024))
        .layer(CompressionLayer::new())
        .layer(cors)
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}

async fn rate_limit_middleware(
    State(state): State<Arc<AppState>>,
    req: Request,
    next: Next,
) -> Response {
    state.total_requests.fetch_add(1, Ordering::Relaxed);
    let ip = extract_client_ip(&req);
    if !state.rate_limiter.allow(ip) {
        return (
            StatusCode::TOO_MANY_REQUESTS,
            Json(serde_json::json!({ "error": "rate_limited" })),
        )
            .into_response();
    }
    next.run(req).await
}

fn extract_client_ip(req: &Request) -> IpAddr {
    if let Some(cf_ip) = req
        .headers()
        .get("cf-connecting-ip")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.trim().parse::<IpAddr>().ok())
    {
        return cf_ip;
    }
    if let Some(xff) = req
        .headers()
        .get("x-forwarded-for")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.split(',').next())
        .and_then(|s| s.trim().parse::<IpAddr>().ok())
    {
        return xff;
    }
    req.extensions()
        .get::<ConnectInfo<SocketAddr>>()
        .map(|ci| ci.0.ip())
        .unwrap_or_else(|| IpAddr::from([127, 0, 0, 1]))
}

async fn handle_health() -> impl IntoResponse {
    (
        StatusCode::OK,
        [(CACHE_CONTROL, "no-store")],
        Json(serde_json::json!({
            "ok": true,
            "service": "kilometr-api",
            "version": env!("CARGO_PKG_VERSION"),
        })),
    )
}

async fn handle_status(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let now_ms = Utc::now().timestamp_millis();
    let (hist_lines, hist_hubs) = state.engine.historical_counts();
    let status = SystemStatus {
        service: "kilometr-api".to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        uptime_secs: state.started_at.elapsed().as_secs(),
        cities_configured: state.cities.all.len(),
        cities_live_active: state.engine.active_city_count(now_ms),
        total_vehicles_in_memory: state.engine.total_vehicles_in_memory(),
        total_rail_trips_cached: state.engine.total_rail_trips_cached(),
        boosted_cities: state
            .engine
            .boosted_cities(now_ms, state.config.boost_ttl_secs),
        db_size_bytes: state.storage.db_size_bytes(),
        historical_line_profiles: hist_lines,
        historical_hub_profiles: hist_hubs,
        sources: state.health.snapshot(now_ms),
    };
    (StatusCode::OK, [(CACHE_CONTROL, "public, max-age=5")], Json(status))
}

async fn handle_cities(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let list: Vec<serde_json::Value> = state
        .cities
        .all
        .iter()
        .map(|c| {
            serde_json::json!({
                "id": c.id,
                "name": c.name,
                "live": c.live,
                "tier": c.tier,
                "has_kp": c.kp_prefix.is_some(),
                "has_regional_rail": !c.rail_agencies.is_empty(),
            })
        })
        .collect();
    (
        StatusCode::OK,
        [(CACHE_CONTROL, "public, max-age=300")],
        Json(serde_json::json!({ "count": list.len(), "cities": list })),
    )
}

#[derive(Debug, Deserialize)]
struct VehiclesQuery {
    city: String,
    bbox: Option<String>,
    mode: Option<String>,
    line: Option<String>,
    include_rail: Option<u8>,
    since: Option<i64>,
}

async fn handle_vehicles(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(q): Query<VehiclesQuery>,
) -> Response {
    let city_id = q.city.trim().to_ascii_lowercase();
    if state.cities.get(&city_id).is_none() {
        return (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": "unknown_city", "city": city_id })),
        )
            .into_response();
    }
    let bbox = match q.bbox.as_deref() {
        Some(raw) if !raw.trim().is_empty() => match Bbox::parse(raw) {
            Some(b) => Some(b),
            None => {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(serde_json::json!({ "error": "invalid_bbox" })),
                )
                    .into_response()
            }
        },
        _ => None,
    };
    let modes: Option<HashSet<String>> = q.mode.as_deref().map(|m| {
        m.split(',')
            .map(|s| s.trim().to_ascii_lowercase())
            .filter(|s| !s.is_empty())
            .collect()
    });
    let include_rail = q.include_rail.unwrap_or(1) != 0;
    let now_ms = Utc::now().timestamp_millis();

    let payload = state.engine.query_vehicles(
        &city_id,
        bbox,
        modes.as_ref(),
        q.line.as_deref(),
        include_rail,
        q.since,
        now_ms,
        state.config.boost_ttl_secs,
    );

    let etag = format!("W/\"{}-{}-{}\"", city_id, payload.updated_at, payload.count);
    if headers
        .get(IF_NONE_MATCH)
        .and_then(|v| v.to_str().ok())
        .map(|v| v == etag)
        .unwrap_or(false)
    {
        return (
            StatusCode::NOT_MODIFIED,
            [(ETAG, etag), (CACHE_CONTROL, "no-cache".to_string())],
        )
            .into_response();
    }

    let mut resp = Json(payload).into_response();
    if let Ok(v) = HeaderValue::from_str(&etag) {
        resp.headers_mut().insert(ETAG, v);
    }
    resp.headers_mut()
        .insert(CACHE_CONTROL, HeaderValue::from_static("public, max-age=2"));
    resp
}

#[derive(Debug, Deserialize)]
struct HeatmapQuery {
    city: String,
    bbox: Option<String>,
}

async fn handle_heatmap(
    State(state): State<Arc<AppState>>,
    Query(q): Query<HeatmapQuery>,
) -> Response {
    let city_id = q.city.trim().to_ascii_lowercase();
    if state.cities.get(&city_id).is_none() {
        return (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": "unknown_city" })),
        )
            .into_response();
    }
    let bbox = match q.bbox.as_deref() {
        Some(raw) if !raw.trim().is_empty() => Bbox::parse(raw),
        _ => None,
    };
    let now_ms = Utc::now().timestamp_millis();
    let res = state.engine.query_heatmap(&city_id, bbox, now_ms);
    (
        StatusCode::OK,
        [(CACHE_CONTROL, "public, max-age=10")],
        Json(res),
    )
        .into_response()
}

#[derive(Debug, Deserialize)]
struct LinesQuery {
    city: String,
    lines: Option<String>,
}

async fn handle_lines(
    State(state): State<Arc<AppState>>,
    Query(q): Query<LinesQuery>,
) -> Response {
    let city_id = q.city.trim().to_ascii_lowercase();
    if state.cities.get(&city_id).is_none() {
        return (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": "unknown_city" })),
        )
            .into_response();
    }
    let filter: Option<HashSet<String>> = q.lines.as_deref().map(|raw| {
        raw.split(',')
            .map(|s| s.trim().to_ascii_uppercase())
            .filter(|s| !s.is_empty())
            .collect()
    });
    let now_ms = Utc::now().timestamp_millis();
    let res = state.engine.query_lines(&city_id, filter.as_ref(), now_ms);
    (
        StatusCode::OK,
        [(CACHE_CONTROL, "public, max-age=15")],
        Json(res),
    )
        .into_response()
}

#[derive(Debug, Deserialize)]
struct HubsQuery {
    city: String,
    limit: Option<usize>,
    min_delay_sec: Option<i32>,
}

async fn handle_hubs(
    State(state): State<Arc<AppState>>,
    Query(q): Query<HubsQuery>,
) -> Response {
    let city_id = q.city.trim().to_ascii_lowercase();
    if state.cities.get(&city_id).is_none() {
        return (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": "unknown_city" })),
        )
            .into_response();
    }
    let now_ms = Utc::now().timestamp_millis();
    let res = state.engine.query_hubs(
        &city_id,
        q.limit.unwrap_or(20),
        q.min_delay_sec.unwrap_or(120),
        now_ms,
    );
    (
        StatusCode::OK,
        [(CACHE_CONTROL, "public, max-age=15")],
        Json(res),
    )
        .into_response()
}

async fn handle_estimate(
    State(state): State<Arc<AppState>>,
    Json(mut req): Json<DelayEstimateRequest>,
) -> Response {
    req.city = req.city.trim().to_ascii_lowercase();
    if state.cities.get(&req.city).is_none() {
        return (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": "unknown_city", "city": req.city })),
        )
            .into_response();
    }
    if req.legs.is_empty() || req.legs.len() > 32 {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "invalid_legs_count" })),
        )
            .into_response();
    }
    let now_ms = Utc::now().timestamp_millis();
    let res = state.engine.estimate_legs(&req, now_ms);
    (
        StatusCode::OK,
        [(CACHE_CONTROL, "public, max-age=5")],
        Json(res),
    )
        .into_response()
}

#[derive(Debug, Deserialize)]
struct RailDelaysQuery {
    trips: Option<String>,
    numbers: Option<String>,
}

async fn handle_rail_delays(
    State(state): State<Arc<AppState>>,
    Query(q): Query<RailDelaysQuery>,
) -> Response {
    if q.trips.as_deref().unwrap_or("").trim().is_empty()
        && q.numbers.as_deref().unwrap_or("").trim().is_empty()
    {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({
                "error": "missing-param",
                "hint": "Podaj parametr ?trips=pl:PLK_... lub ?numbers=77226"
            })),
        )
            .into_response();
    }
    let res = state
        .engine
        .query_rail_delays(q.trips.as_deref(), q.numbers.as_deref());
    (
        StatusCode::OK,
        [(CACHE_CONTROL, "public, max-age=15")],
        Json(res),
    )
        .into_response()
}

async fn handle_metrics(State(state): State<Arc<AppState>>) -> Response {
    let now_ms = Utc::now().timestamp_millis();
    let (hist_lines, hist_hubs) = state.engine.historical_counts();
    let body = format!(
        "# TYPE kilometr_uptime_seconds counter\n\
         kilometr_uptime_seconds {}\n\
         # TYPE kilometr_http_requests_total counter\n\
         kilometr_http_requests_total {}\n\
         # TYPE kilometr_vehicles_in_memory gauge\n\
         kilometr_vehicles_in_memory {}\n\
         # TYPE kilometr_cities_active gauge\n\
         kilometr_cities_active {}\n\
         # TYPE kilometr_rail_trips_cached gauge\n\
         kilometr_rail_trips_cached {}\n\
         # TYPE kilometr_db_size_bytes gauge\n\
         kilometr_db_size_bytes {}\n\
         # TYPE kilometr_historical_line_profiles gauge\n\
         kilometr_historical_line_profiles {}\n\
         # TYPE kilometr_historical_hub_profiles gauge\n\
         kilometr_historical_hub_profiles {}\n",
        state.started_at.elapsed().as_secs(),
        state.total_requests.load(Ordering::Relaxed),
        state.engine.total_vehicles_in_memory(),
        state.engine.active_city_count(now_ms),
        state.engine.total_rail_trips_cached(),
        state.storage.db_size_bytes(),
        hist_lines,
        hist_hubs,
    );
    (
        StatusCode::OK,
        [(CONTENT_TYPE, "text/plain; version=0.0.4; charset=utf-8")],
        body,
    )
        .into_response()
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use http_body_util::BodyExt;
    use tower::ServiceExt;

    fn test_state() -> Arc<AppState> {
        let mut cfg = AppConfig::from_env();
        cfg.enable_collectors = false;
        let tmp = std::env::temp_dir().join(format!(
            "kilometr-api-test-{}.db",
            Utc::now().timestamp_nanos_opt().unwrap_or(0)
        ));
        cfg.db_path = tmp;
        let cities = Arc::new(CityRegistry::load(None).expect("cities"));
        let (storage, loaded) = StorageHandle::open(&cfg.db_path).expect("sqlite");
        let engine = Arc::new(AnalyticsEngine::new(loaded));
        Arc::new(AppState {
            config: Arc::new(cfg),
            cities,
            engine,
            storage: Arc::new(storage),
            health: Arc::new(SourceHealthRegistry::new()),
            started_at: Instant::now(),
            total_requests: AtomicU64::new(0),
            rate_limiter: RateLimiter::new(100, 200),
        })
    }

    #[tokio::test]
    async fn health_and_vehicles_endpoints_respond_ok() {
        let state = test_state();
        let app = build_router(state);

        let res = app
            .clone()
            .oneshot(Request::builder().uri("/health").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK);

        let res_veh = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/v1/vehicles?city=wroclaw&bbox=16.9,51.0,17.2,51.2")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res_veh.status(), StatusCode::OK);
        let bytes = res_veh.into_body().collect().await.unwrap().to_bytes();
        let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(json["city"], "wroclaw");
        assert_eq!(json["boosted"], true);

        let res_404 = app
            .oneshot(
                Request::builder()
                    .uri("/v1/vehicles?city=atlantyda")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res_404.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn shared_live_endpoint_validates_and_returns_legs() {
        let state = test_state();
        let app = build_router(state);

        let body = serde_json::json!({
            "city": "wroclaw",
            "legs": [
                {
                    "id": "leg-0",
                    "mode": "tram",
                    "line": "4",
                    "from_stop": "Rondo Reagana",
                    "to_stop": "Dworzec Glowny",
                    "scheduled_departure_sec": 43200
                }
            ]
        });

        let res = app
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/v1/shared/live")
                    .header("content-type", "application/json")
                    .body(Body::from(body.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK);
        let bytes = res.into_body().collect().await.unwrap().to_bytes();
        let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(json["city"], "wroclaw");
        assert_eq!(json["legs"].as_array().unwrap().len(), 1);
    }
}
