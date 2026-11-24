use rusqlite::{params, Connection};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use tokio::sync::mpsc;
use tracing::{error, info, warn};

/// Profil historyczny (per linia lub wezel dla danego day_type i godziny).
#[derive(Debug, Clone)]
pub struct HistoricalProfile {
    pub sample_count: u64,
    pub mean_delay_sec: f64,
    pub p90_delay_sec: f64,
    pub late_rate: f64,
    pub ema_delay_sec: f64,
}

impl HistoricalProfile {
    /// Bayesowskie wygładzenie (shrinkage) w strone 0 dla małych probek.
    pub fn shrunk_delay_sec(&self) -> f64 {
        let weight = (self.sample_count as f64) / ((self.sample_count as f64) + 20.0);
        let blended = 0.65 * self.ema_delay_sec + 0.35 * self.mean_delay_sec;
        blended * weight
    }
}

#[derive(Debug, Clone)]
pub struct LineProfileDelta {
    pub city: String,
    pub line: String,
    pub day_type: String,
    pub hour_bucket: u8,
    pub delay_sec: f64,
    pub is_late: bool,
}

#[derive(Debug, Clone)]
pub struct HubProfileDelta {
    pub city: String,
    pub hub_key: String,
    pub hub_name: String,
    pub lat: f64,
    pub lon: f64,
    pub day_type: String,
    pub hour_bucket: u8,
    pub delay_sec: f64,
    pub is_late: bool,
}

#[derive(Debug, Clone)]
pub struct CellProfileDelta {
    pub city: String,
    pub cell_lat: i32,
    pub cell_lon: i32,
    pub day_type: String,
    pub hour_bucket: u8,
    pub delay_sec: f64,
    pub is_late: bool,
}

#[derive(Debug, Clone)]
pub struct RailProfileDelta {
    pub agency: String,
    pub train_key: String,
    pub day_type: String,
    pub hour_bucket: u8,
    pub delay_sec: f64,
    pub is_late: bool,
    pub cancelled: bool,
}

#[derive(Debug, Clone)]
pub struct ObservationRecord {
    pub ts_sec: i64,
    pub city: String,
    pub line: String,
    pub hub_key: Option<String>,
    pub cell_lat: i32,
    pub cell_lon: i32,
    pub delay_sec: i32,
}

#[derive(Debug, Default)]
pub struct PersistenceBatch {
    pub lines: Vec<LineProfileDelta>,
    pub hubs: Vec<HubProfileDelta>,
    pub cells: Vec<CellProfileDelta>,
    pub rails: Vec<RailProfileDelta>,
    pub observations: Vec<ObservationRecord>,
}

impl PersistenceBatch {
    pub fn is_empty(&self) -> bool {
        self.lines.is_empty()
            && self.hubs.is_empty()
            && self.cells.is_empty()
            && self.rails.is_empty()
            && self.observations.is_empty()
    }
}

pub type LineProfileKey = (String, String, String, u8);
pub type HubProfileKey = (String, String, String, u8);
pub type CellProfileKey = (String, i32, i32, String, u8);

#[derive(Debug, Default)]
pub struct LoadedProfiles {
    pub lines: HashMap<LineProfileKey, HistoricalProfile>,
    pub hubs: HashMap<HubProfileKey, HistoricalProfile>,
    pub cells: HashMap<CellProfileKey, HistoricalProfile>,
}

pub enum StorageCommand {
    WriteBatch(PersistenceBatch),
    Maintenance {
        raw_retention_hours: i64,
        max_db_size_mb: u64,
    },
    Shutdown,
}

pub struct StorageHandle {
    tx: mpsc::Sender<StorageCommand>,
    db_path: PathBuf,
}

impl StorageHandle {
    pub fn open(db_path: &Path) -> Result<(Self, LoadedProfiles), String> {
        if let Some(parent) = db_path.parent() {
            if !parent.as_os_str().is_empty() {
                std::fs::create_dir_all(parent)
                    .map_err(|e| format!("Nie mozna utworzyc katalogu DB: {e}"))?;
            }
        }
        let conn = open_sqlite(db_path)?;
        init_schema(&conn)?;
        let loaded = load_all_profiles(&conn)?;

        let (tx, mut rx) = mpsc::channel::<StorageCommand>(64);
        let worker_path = db_path.to_path_buf();
        std::thread::Builder::new()
            .name("kilometr-sqlite-writer".to_string())
            .spawn(move || {
                let mut conn = match open_sqlite(&worker_path) {
                    Ok(c) => c,
                    Err(e) => {
                        error!("SQLite writer nie mogl otworzyc bazy: {e}");
                        return;
                    }
                };
                while let Some(cmd) = rx.blocking_recv() {
                    match cmd {
                        StorageCommand::WriteBatch(batch) => {
                            if let Err(e) = apply_batch(&mut conn, &batch) {
                                warn!("Blad zapisu batcha SQLite: {e}");
                            }
                        }
                        StorageCommand::Maintenance {
                            raw_retention_hours,
                            max_db_size_mb,
                        } => {
                            if let Err(e) = run_maintenance(
                                &mut conn,
                                &worker_path,
                                raw_retention_hours,
                                max_db_size_mb,
                            ) {
                                warn!("Blad konserwacji SQLite: {e}");
                            }
                        }
                        StorageCommand::Shutdown => {
                            let _ = conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);");
                            break;
                        }
                    }
                }
            })
            .map_err(|e| format!("Nie mozna uruchomic watku SQLite: {e}"))?;

        Ok((
            Self {
                tx,
                db_path: db_path.to_path_buf(),
            },
            loaded,
        ))
    }

    pub async fn send_batch(&self, batch: PersistenceBatch) {
        if batch.is_empty() {
            return;
        }
        if let Err(e) = self.tx.try_send(StorageCommand::WriteBatch(batch)) {
            warn!("Kolejka zapisu SQLite pelna lub zamknieta: {e}");
        }
    }

    pub async fn send_maintenance(&self, raw_retention_hours: i64, max_db_size_mb: u64) {
        let _ = self
            .tx
            .send(StorageCommand::Maintenance {
                raw_retention_hours,
                max_db_size_mb,
            })
            .await;
    }

    pub async fn shutdown(&self) {
        let _ = self.tx.send(StorageCommand::Shutdown).await;
    }

    pub fn db_size_bytes(&self) -> u64 {
        let main_len = std::fs::metadata(&self.db_path).map(|m| m.len()).unwrap_or(0);
        let wal_path = PathBuf::from(format!("{}-wal", self.db_path.display()));
        let wal_len = std::fs::metadata(wal_path).map(|m| m.len()).unwrap_or(0);
        main_len + wal_len
    }
}

fn open_sqlite(path: &Path) -> Result<Connection, String> {
    let conn = Connection::open(path).map_err(|e| format!("Blad otwarcia SQLite: {e}"))?;
    // Konfiguracja pod VPS 4GB RAM / 40GB SSD: WAL, maly cache 32MB, auto_vacuum incremental.
    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA synchronous = NORMAL;
         PRAGMA temp_store = MEMORY;
         PRAGMA cache_size = -32000;
         PRAGMA busy_timeout = 5000;
         PRAGMA auto_vacuum = INCREMENTAL;",
    )
    .map_err(|e| format!("Blad PRAGMA SQLite: {e}"))?;
    Ok(conn)
}

fn init_schema(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS line_delay_profiles (
            city TEXT NOT NULL,
            line TEXT NOT NULL,
            day_type TEXT NOT NULL,
            hour_bucket INTEGER NOT NULL,
            sample_count INTEGER NOT NULL DEFAULT 0,
            mean_delay_sec REAL NOT NULL DEFAULT 0,
            p90_delay_sec REAL NOT NULL DEFAULT 0,
            late_rate REAL NOT NULL DEFAULT 0,
            ema_delay_sec REAL NOT NULL DEFAULT 0,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY (city, line, day_type, hour_bucket)
        ) WITHOUT ROWID;

        CREATE TABLE IF NOT EXISTS hub_delay_profiles (
            city TEXT NOT NULL,
            hub_key TEXT NOT NULL,
            hub_name TEXT NOT NULL,
            lat REAL NOT NULL,
            lon REAL NOT NULL,
            day_type TEXT NOT NULL,
            hour_bucket INTEGER NOT NULL,
            sample_count INTEGER NOT NULL DEFAULT 0,
            mean_delay_sec REAL NOT NULL DEFAULT 0,
            p90_delay_sec REAL NOT NULL DEFAULT 0,
            late_rate REAL NOT NULL DEFAULT 0,
            ema_delay_sec REAL NOT NULL DEFAULT 0,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY (city, hub_key, day_type, hour_bucket)
        ) WITHOUT ROWID;

        CREATE TABLE IF NOT EXISTS cell_delay_profiles (
            city TEXT NOT NULL,
            cell_lat INTEGER NOT NULL,
            cell_lon INTEGER NOT NULL,
            day_type TEXT NOT NULL,
            hour_bucket INTEGER NOT NULL,
            sample_count INTEGER NOT NULL DEFAULT 0,
            mean_delay_sec REAL NOT NULL DEFAULT 0,
            late_rate REAL NOT NULL DEFAULT 0,
            ema_delay_sec REAL NOT NULL DEFAULT 0,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY (city, cell_lat, cell_lon, day_type, hour_bucket)
        ) WITHOUT ROWID;

        CREATE TABLE IF NOT EXISTS rail_delay_profiles (
            agency TEXT NOT NULL,
            train_key TEXT NOT NULL,
            day_type TEXT NOT NULL,
            hour_bucket INTEGER NOT NULL,
            sample_count INTEGER NOT NULL DEFAULT 0,
            mean_delay_sec REAL NOT NULL DEFAULT 0,
            p90_delay_sec REAL NOT NULL DEFAULT 0,
            late_rate REAL NOT NULL DEFAULT 0,
            cancel_rate REAL NOT NULL DEFAULT 0,
            ema_delay_sec REAL NOT NULL DEFAULT 0,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY (agency, train_key, day_type, hour_bucket)
        ) WITHOUT ROWID;

        CREATE TABLE IF NOT EXISTS delay_observations (
            ts_sec INTEGER NOT NULL,
            city TEXT NOT NULL,
            line TEXT NOT NULL,
            hub_key TEXT,
            cell_lat INTEGER NOT NULL,
            cell_lon INTEGER NOT NULL,
            delay_sec INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_obs_ts ON delay_observations(ts_sec);",
    )
    .map_err(|e| format!("Blad inicjalizacji schematu SQLite: {e}"))?;
    Ok(())
}

fn load_all_profiles(conn: &Connection) -> Result<LoadedProfiles, String> {
    let mut loaded = LoadedProfiles::default();

    {
        let mut stmt = conn
            .prepare(
                "SELECT city, line, day_type, hour_bucket, sample_count, mean_delay_sec, p90_delay_sec, late_rate, ema_delay_sec
                 FROM line_delay_profiles",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok((
                    (
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, u8>(3)?,
                    ),
                    HistoricalProfile {
                        sample_count: row.get::<_, i64>(4)?.max(0) as u64,
                        mean_delay_sec: row.get(5)?,
                        p90_delay_sec: row.get(6)?,
                        late_rate: row.get(7)?,
                        ema_delay_sec: row.get(8)?,
                    },
                ))
            })
            .map_err(|e| e.to_string())?;
        for r in rows.flatten() {
            loaded.lines.insert(r.0, r.1);
        }
    }

    {
        let mut stmt = conn
            .prepare(
                "SELECT city, hub_key, day_type, hour_bucket, sample_count, mean_delay_sec, p90_delay_sec, late_rate, ema_delay_sec
                 FROM hub_delay_profiles",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok((
                    (
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, u8>(3)?,
                    ),
                    HistoricalProfile {
                        sample_count: row.get::<_, i64>(4)?.max(0) as u64,
                        mean_delay_sec: row.get(5)?,
                        p90_delay_sec: row.get(6)?,
                        late_rate: row.get(7)?,
                        ema_delay_sec: row.get(8)?,
                    },
                ))
            })
            .map_err(|e| e.to_string())?;
        for r in rows.flatten() {
            loaded.hubs.insert(r.0, r.1);
        }
    }

    {
        let mut stmt = conn
            .prepare(
                "SELECT city, cell_lat, cell_lon, day_type, hour_bucket, sample_count, mean_delay_sec, late_rate, ema_delay_sec
                 FROM cell_delay_profiles",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok((
                    (
                        row.get::<_, String>(0)?,
                        row.get::<_, i32>(1)?,
                        row.get::<_, i32>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, u8>(4)?,
                    ),
                    HistoricalProfile {
                        sample_count: row.get::<_, i64>(5)?.max(0) as u64,
                        mean_delay_sec: row.get(6)?,
                        p90_delay_sec: row.get(6)?,
                        late_rate: row.get(7)?,
                        ema_delay_sec: row.get(8)?,
                    },
                ))
            })
            .map_err(|e| e.to_string())?;
        for r in rows.flatten() {
            loaded.cells.insert(r.0, r.1);
        }
    }

    Ok(loaded)
}

fn apply_batch(conn: &mut Connection, batch: &PersistenceBatch) -> Result<(), String> {
    let now = chrono::Utc::now().timestamp();
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    if !batch.lines.is_empty() {
        // Przyrostowy upsert online (srednia inkrementalna + EMA + przyblizony p90).
        let mut stmt = tx
            .prepare_cached(
                "INSERT INTO line_delay_profiles
                    (city, line, day_type, hour_bucket, sample_count, mean_delay_sec, p90_delay_sec, late_rate, ema_delay_sec, updated_at)
                 VALUES (?1, ?2, ?3, ?4, 1, ?5, ?5, ?6, ?5, ?7)
                 ON CONFLICT(city, line, day_type, hour_bucket) DO UPDATE SET
                    sample_count = sample_count + 1,
                    mean_delay_sec = mean_delay_sec + (?5 - mean_delay_sec) / (sample_count + 1),
                    p90_delay_sec = CASE
                        WHEN ?5 > p90_delay_sec THEN p90_delay_sec + 0.12 * (?5 - p90_delay_sec)
                        ELSE p90_delay_sec - 0.015 * (p90_delay_sec - ?5)
                    END,
                    late_rate = late_rate + (?6 - late_rate) / (sample_count + 1),
                    ema_delay_sec = 0.92 * ema_delay_sec + 0.08 * ?5,
                    updated_at = ?7",
            )
            .map_err(|e| e.to_string())?;
        for d in &batch.lines {
            let late = if d.is_late { 1.0_f64 } else { 0.0_f64 };
            stmt.execute(params![
                d.city,
                d.line,
                d.day_type,
                d.hour_bucket,
                d.delay_sec,
                late,
                now
            ])
            .map_err(|e| e.to_string())?;
        }
    }

    if !batch.hubs.is_empty() {
        let mut stmt = tx
            .prepare_cached(
                "INSERT INTO hub_delay_profiles
                    (city, hub_key, hub_name, lat, lon, day_type, hour_bucket, sample_count, mean_delay_sec, p90_delay_sec, late_rate, ema_delay_sec, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 1, ?8, ?8, ?9, ?8, ?10)
                 ON CONFLICT(city, hub_key, day_type, hour_bucket) DO UPDATE SET
                    hub_name = ?3,
                    lat = 0.9 * lat + 0.1 * ?4,
                    lon = 0.9 * lon + 0.1 * ?5,
                    sample_count = sample_count + 1,
                    mean_delay_sec = mean_delay_sec + (?8 - mean_delay_sec) / (sample_count + 1),
                    p90_delay_sec = CASE
                        WHEN ?8 > p90_delay_sec THEN p90_delay_sec + 0.12 * (?8 - p90_delay_sec)
                        ELSE p90_delay_sec - 0.015 * (p90_delay_sec - ?8)
                    END,
                    late_rate = late_rate + (?9 - late_rate) / (sample_count + 1),
                    ema_delay_sec = 0.92 * ema_delay_sec + 0.08 * ?8,
                    updated_at = ?10",
            )
            .map_err(|e| e.to_string())?;
        for d in &batch.hubs {
            let late = if d.is_late { 1.0_f64 } else { 0.0_f64 };
            stmt.execute(params![
                d.city,
                d.hub_key,
                d.hub_name,
                d.lat,
                d.lon,
                d.day_type,
                d.hour_bucket,
                d.delay_sec,
                late,
                now
            ])
            .map_err(|e| e.to_string())?;
        }
    }

    if !batch.cells.is_empty() {
        let mut stmt = tx
            .prepare_cached(
                "INSERT INTO cell_delay_profiles
                    (city, cell_lat, cell_lon, day_type, hour_bucket, sample_count, mean_delay_sec, late_rate, ema_delay_sec, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6, ?7, ?6, ?8)
                 ON CONFLICT(city, cell_lat, cell_lon, day_type, hour_bucket) DO UPDATE SET
                    sample_count = sample_count + 1,
                    mean_delay_sec = mean_delay_sec + (?6 - mean_delay_sec) / (sample_count + 1),
                    late_rate = late_rate + (?7 - late_rate) / (sample_count + 1),
                    ema_delay_sec = 0.92 * ema_delay_sec + 0.08 * ?6,
                    updated_at = ?8",
            )
            .map_err(|e| e.to_string())?;
        for d in &batch.cells {
            let late = if d.is_late { 1.0_f64 } else { 0.0_f64 };
            stmt.execute(params![
                d.city,
                d.cell_lat,
                d.cell_lon,
                d.day_type,
                d.hour_bucket,
                d.delay_sec,
                late,
                now
            ])
            .map_err(|e| e.to_string())?;
        }
    }

    if !batch.rails.is_empty() {
        let mut stmt = tx
            .prepare_cached(
                "INSERT INTO rail_delay_profiles
                    (agency, train_key, day_type, hour_bucket, sample_count, mean_delay_sec, p90_delay_sec, late_rate, cancel_rate, ema_delay_sec, updated_at)
                 VALUES (?1, ?2, ?3, ?4, 1, ?5, ?5, ?6, ?7, ?5, ?8)
                 ON CONFLICT(agency, train_key, day_type, hour_bucket) DO UPDATE SET
                    sample_count = sample_count + 1,
                    mean_delay_sec = mean_delay_sec + (?5 - mean_delay_sec) / (sample_count + 1),
                    p90_delay_sec = CASE
                        WHEN ?5 > p90_delay_sec THEN p90_delay_sec + 0.12 * (?5 - p90_delay_sec)
                        ELSE p90_delay_sec - 0.015 * (p90_delay_sec - ?5)
                    END,
                    late_rate = late_rate + (?6 - late_rate) / (sample_count + 1),
                    cancel_rate = cancel_rate + (?7 - cancel_rate) / (sample_count + 1),
                    ema_delay_sec = 0.92 * ema_delay_sec + 0.08 * ?5,
                    updated_at = ?8",
            )
            .map_err(|e| e.to_string())?;
        for d in &batch.rails {
            let late = if d.is_late { 1.0_f64 } else { 0.0_f64 };
            let canc = if d.cancelled { 1.0_f64 } else { 0.0_f64 };
            stmt.execute(params![
                d.agency,
                d.train_key,
                d.day_type,
                d.hour_bucket,
                d.delay_sec,
                late,
                canc,
                now
            ])
            .map_err(|e| e.to_string())?;
        }
    }

    if !batch.observations.is_empty() {
        let mut stmt = tx
            .prepare_cached(
                "INSERT INTO delay_observations (ts_sec, city, line, hub_key, cell_lat, cell_lon, delay_sec)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            )
            .map_err(|e| e.to_string())?;
        for o in &batch.observations {
            stmt.execute(params![
                o.ts_sec,
                o.city,
                o.line,
                o.hub_key,
                o.cell_lat,
                o.cell_lon,
                o.delay_sec
            ])
            .map_err(|e| e.to_string())?;
        }
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

fn run_maintenance(
    conn: &mut Connection,
    db_path: &Path,
    raw_retention_hours: i64,
    max_db_size_mb: u64,
) -> Result<(), String> {
    let cutoff = chrono::Utc::now().timestamp() - raw_retention_hours.max(1) * 3600;
    let deleted = conn
        .execute("DELETE FROM delay_observations WHERE ts_sec < ?1", params![cutoff])
        .map_err(|e| e.to_string())?;

    // Twarde zabezpieczenie dysku VPS 40GB: jesli baza przekroczy prog, skracamy surowe obserwacje.
    let size_mb = std::fs::metadata(db_path).map(|m| m.len() / (1024 * 1024)).unwrap_or(0);
    if size_mb > max_db_size_mb {
        let aggressive_cutoff = chrono::Utc::now().timestamp() - 6 * 3600;
        let extra = conn
            .execute(
                "DELETE FROM delay_observations WHERE ts_sec < ?1",
                params![aggressive_cutoff],
            )
            .map_err(|e| e.to_string())?;
        warn!("Przekroczono limit DB ({size_mb} MB > {max_db_size_mb} MB), usunieto {extra} rekordow");
    }

    let _ = conn.execute_batch("PRAGMA incremental_vacuum(500); PRAGMA wal_checkpoint(PASSIVE);");
    if deleted > 0 {
        info!("Konserwacja SQLite: usunieto {deleted} starych obserwacji, rozmiar DB={size_mb} MB");
    }
    Ok(())
}
