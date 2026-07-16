PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS station_state (
    station_id TEXT PRIMARY KEY,
    camera_id TEXT NOT NULL,
    action_id INTEGER,
    action_name TEXT,
    status TEXT NOT NULL DEFAULT 'idle',
    cycle_id INTEGER,
    cosmos_description TEXT,
    confidence REAL NOT NULL DEFAULT 96.7,
    checker_result TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sop_cycles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    station_id TEXT NOT NULL,
    cycle_id INTEGER NOT NULL,
    compliant INTEGER NOT NULL,
    duration_seconds REAL,
    completed_at TEXT NOT NULL,
    UNIQUE(station_id, cycle_id)
);

CREATE TABLE IF NOT EXISTS sop_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    station_id TEXT NOT NULL,
    camera_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    severity TEXT NOT NULL,
    action_id INTEGER,
    cycle_id INTEGER,
    message TEXT NOT NULL,
    payload TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sop_events_station_time
    ON sop_events(station_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sop_cycles_station_time
    ON sop_cycles(station_id, completed_at DESC);
