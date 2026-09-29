/**
 * SQLite schema. The database is the authoritative record of products, tasks,
 * dependencies, attempts, audit events, and interventions; Markdown documents
 * are projections of it.
 */

/** Current schema version, recorded in `setting`. */
export const SCHEMA_VERSION = 1

/** Statements executed once at open time (idempotent). */
export const SCHEMA_STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS setting (
     key TEXT PRIMARY KEY,
     value TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS product (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     slug TEXT NOT NULL UNIQUE,
     title TEXT NOT NULL,
     document_path TEXT NOT NULL,
     status TEXT NOT NULL,
     feature_deltas TEXT NOT NULL DEFAULT '[]',
     document_body TEXT NOT NULL DEFAULT '',
     commit_hash TEXT,
     created_at TEXT NOT NULL,
     confirmed_at TEXT
   )`,
  `CREATE TABLE IF NOT EXISTS task (
     id TEXT PRIMARY KEY,
     seq INTEGER NOT NULL UNIQUE,
     product_id INTEGER NOT NULL REFERENCES product(id),
     title TEXT NOT NULL,
     slug TEXT NOT NULL,
     document_path TEXT NOT NULL,
     status TEXT NOT NULL,
     priority INTEGER NOT NULL DEFAULT 100,
     estimate TEXT NOT NULL DEFAULT 'M',
     acceptance TEXT NOT NULL,
     verify_commands TEXT NOT NULL DEFAULT '[]',
     detail TEXT NOT NULL DEFAULT '{}',
     blocked_reason TEXT,
     commit_hash TEXT,
     attempt INTEGER NOT NULL DEFAULT 0,
     runner_session_id TEXT,
     error_kind TEXT,
     error_message TEXT,
     created_at TEXT NOT NULL,
     started_at TEXT,
     finished_at TEXT
   )`,
  `CREATE TABLE IF NOT EXISTS task_dependency (
     task_id TEXT NOT NULL REFERENCES task(id) ON DELETE CASCADE,
     depends_on TEXT NOT NULL REFERENCES task(id) ON DELETE CASCADE,
     PRIMARY KEY (task_id, depends_on),
     CHECK (task_id <> depends_on)
   )`,
  `CREATE TABLE IF NOT EXISTS task_attempt (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     task_id TEXT NOT NULL REFERENCES task(id) ON DELETE CASCADE,
     attempt INTEGER NOT NULL,
     session_id TEXT,
     status TEXT NOT NULL,
     error_kind TEXT,
     error_message TEXT,
     commit_hash TEXT,
     started_at TEXT NOT NULL,
     finished_at TEXT,
     UNIQUE (task_id, attempt)
   )`,
  `CREATE TABLE IF NOT EXISTS task_event (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     at TEXT NOT NULL,
     kind TEXT NOT NULL,
     task_id TEXT,
     product_id INTEGER,
     data TEXT NOT NULL DEFAULT '{}'
   )`,
  `CREATE TABLE IF NOT EXISTS notification (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     task_id TEXT,
     kind TEXT NOT NULL,
     title TEXT NOT NULL,
     message TEXT NOT NULL,
     created_at TEXT NOT NULL,
     read_at TEXT,
     resolved_at TEXT
   )`,
  `CREATE TABLE IF NOT EXISTS scheduler_lock (
     name TEXT PRIMARY KEY,
     owner TEXT NOT NULL,
     expires_at INTEGER NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS task_status_priority ON task(status, priority, created_at)`,
  `CREATE INDEX IF NOT EXISTS task_dependency_reverse ON task_dependency(depends_on)`,
  `CREATE INDEX IF NOT EXISTS task_event_task ON task_event(task_id, id)`,
  `CREATE INDEX IF NOT EXISTS notification_open ON notification(resolved_at, id)`,
]
