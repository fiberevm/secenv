import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL DEFAULT '',
  password_hash TEXT,
  oidc_subject TEXT UNIQUE,
  created_at INTEGER NOT NULL,
  last_login_at INTEGER
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS env_groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  description TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS env_vars (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES env_groups(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value_enc TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT '',
  last_loaded_at INTEGER,
  last_loaded_by TEXT,
  UNIQUE (group_id, key)
);

CREATE TABLE IF NOT EXISTS api_tokens (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  prefix TEXT NOT NULL,
  access TEXT NOT NULL DEFAULT 'read',
  group_ids TEXT,
  created_by TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  last_used_at INTEGER,
  revoked_at INTEGER
);

CREATE TABLE IF NOT EXISTS audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  actor_id TEXT,
  actor_label TEXT NOT NULL,
  actor_kind TEXT NOT NULL DEFAULT 'user',
  action TEXT NOT NULL,
  group_id TEXT,
  group_name TEXT,
  var_key TEXT,
  old_value_enc TEXT,
  new_value_enc TEXT,
  meta TEXT,
  ip TEXT,
  user_agent TEXT
);

CREATE INDEX IF NOT EXISTS audit_events_action ON audit_events (action, at DESC);
CREATE INDEX IF NOT EXISTS audit_events_at ON audit_events (at DESC);
CREATE INDEX IF NOT EXISTS audit_events_group ON audit_events (group_id, at DESC);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions (expires_at);
`;

export function openDatabase(path: string): Database {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true, strict: true });
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  migrate(db);
  db.exec(SCHEMA);
  return db;
}

/** Additive column migrations for databases created by older versions. */
function migrate(db: Database) {
  const table = db.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'audit_events'").get();
  if (!table) return;
  migrateVariables(db);
  const columns = new Set((db.query("PRAGMA table_info(audit_events)").all() as Array<{ name: string }>).map((c) => c.name));
  if (!columns.has("ip")) db.exec("ALTER TABLE audit_events ADD COLUMN ip TEXT");
  if (!columns.has("user_agent")) db.exec("ALTER TABLE audit_events ADD COLUMN user_agent TEXT");
}

function migrateVariables(db: Database) {
  const columns = new Set((db.query("PRAGMA table_info(env_vars)").all() as Array<{ name: string }>).map((c) => c.name));
  if (columns.has("created_by")) return;
  db.transaction(() => {
    db.exec("ALTER TABLE env_vars ADD COLUMN created_by TEXT NOT NULL DEFAULT ''");
    db.exec("ALTER TABLE env_vars ADD COLUMN last_loaded_at INTEGER");
    db.exec("ALTER TABLE env_vars ADD COLUMN last_loaded_by TEXT");
    // Backfill from the audit log: who created each key, and the latest SDK load that included it.
    db.exec(`UPDATE env_vars SET created_by = COALESCE((
      SELECT actor_label FROM audit_events e
      WHERE e.action = 'var.create' AND e.group_id = env_vars.group_id AND e.var_key = env_vars.key
      ORDER BY e.id DESC LIMIT 1), updated_by)`);
    db.exec(`UPDATE env_vars SET
      last_loaded_at = (SELECT e.at FROM audit_events e, json_each(e.meta, '$.keys') k
        WHERE e.action = 'env.read' AND e.group_id = env_vars.group_id AND k.value = env_vars.key ORDER BY e.id DESC LIMIT 1),
      last_loaded_by = (SELECT e.actor_label FROM audit_events e, json_each(e.meta, '$.keys') k
        WHERE e.action = 'env.read' AND e.group_id = env_vars.group_id AND k.value = env_vars.key ORDER BY e.id DESC LIMIT 1)`);
  })();
}
