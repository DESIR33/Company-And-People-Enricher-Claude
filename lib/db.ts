import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";

const DB_PATH = process.env.DATABASE_PATH ?? path.join(process.cwd(), ".data", "jobs.db");

type DbWithInit = { db: Database.Database; initialized: boolean };
type Globals = typeof globalThis & { __enricherDb?: DbWithInit };
const g = globalThis as Globals;

function init(db: Database.Database): void {
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("synchronous = NORMAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      identifier_column TEXT NOT NULL,
      requested_fields TEXT NOT NULL,
      custom_field_defs TEXT NOT NULL,
      news_params TEXT,
      outreach_context TEXT,
      total_rows INTEGER NOT NULL,
      processed_rows INTEGER NOT NULL DEFAULT 0,
      error TEXT
    );
    CREATE TABLE IF NOT EXISTS job_rows (
      job_id TEXT NOT NULL,
      row_index INTEGER NOT NULL,
      original_data TEXT NOT NULL,
      enriched_data TEXT NOT NULL,
      status TEXT NOT NULL,
      error TEXT,
      cost_usd REAL,
      cache_read_tokens INTEGER,
      cache_creation_tokens INTEGER,
      PRIMARY KEY (job_id, row_index),
      FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS monitors (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      mode TEXT NOT NULL,
      config TEXT NOT NULL,
      schedule TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      webhook_url TEXT,
      requested_fields TEXT NOT NULL,
      custom_field_defs TEXT NOT NULL DEFAULT '[]',
      outreach_context TEXT,
      manual_engagers TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      last_run_at INTEGER,
      next_run_at INTEGER,
      lead_count_total INTEGER NOT NULL DEFAULT 0,
      cost_usd_total REAL NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS monitor_runs (
      id TEXT PRIMARY KEY,
      monitor_id TEXT NOT NULL,
      status TEXT NOT NULL,
      trigger TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      started_at INTEGER,
      completed_at INTEGER,
      discovered_count INTEGER NOT NULL DEFAULT 0,
      new_count INTEGER NOT NULL DEFAULT 0,
      dedup_count INTEGER NOT NULL DEFAULT 0,
      enriched_count INTEGER NOT NULL DEFAULT 0,
      cost_usd REAL NOT NULL DEFAULT 0,
      estimated_leads INTEGER,
      discovery_log TEXT,
      error TEXT,
      FOREIGN KEY (monitor_id) REFERENCES monitors(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS monitor_leads (
      id TEXT PRIMARY KEY,
      monitor_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      linkedin_url TEXT NOT NULL,
      profile_name TEXT,
      engagement_type TEXT,
      engagement_text TEXT,
      post_url TEXT,
      enriched_data TEXT NOT NULL DEFAULT '{}',
      enrichment_status TEXT NOT NULL DEFAULT 'pending',
      enrichment_error TEXT,
      cost_usd REAL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      webhook_status TEXT,
      UNIQUE(monitor_id, linkedin_url),
      FOREIGN KEY (monitor_id) REFERENCES monitors(id) ON DELETE CASCADE,
      FOREIGN KEY (run_id)     REFERENCES monitor_runs(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS monthly_usage (
      month TEXT PRIMARY KEY,
      lead_count INTEGER NOT NULL DEFAULT 0,
      cost_usd REAL NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_monitor_runs_monitor ON monitor_runs(monitor_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_monitor_leads_monitor ON monitor_leads(monitor_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_monitor_leads_run     ON monitor_leads(run_id);
  `);
  // Backfill new columns on pre-existing databases.
  const jobColumns = new Set(
    (db.prepare(`PRAGMA table_info(jobs)`).all() as { name: string }[]).map((c) => c.name)
  );
  if (!jobColumns.has("outreach_context")) {
    db.exec(`ALTER TABLE jobs ADD COLUMN outreach_context TEXT`);
  }
  if (!jobColumns.has("score_rubric")) {
    db.exec(`ALTER TABLE jobs ADD COLUMN score_rubric TEXT`);
  }
  // Jobs that were in flight when the process died can never resume — their
  // workers and abort controllers are gone. Mark them failed so the UI can
  // tell the user instead of leaving them stuck at "processing".
  const now = Date.now();
  db.prepare(
    `UPDATE jobs SET status = 'failed', error = 'Interrupted by server restart', updated_at = ?
     WHERE status IN ('pending', 'processing')`
  ).run(now);
  db.prepare(
    `UPDATE monitor_runs SET status = 'failed', error = 'Interrupted by server restart', updated_at = ?
     WHERE status IN ('queued', 'running')`
  ).run(now);
}

export function getDb(): Database.Database {
  if (g.__enricherDb) return g.__enricherDb.db;
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const db = new Database(DB_PATH);
  init(db);
  g.__enricherDb = { db, initialized: true };
  return db;
}
