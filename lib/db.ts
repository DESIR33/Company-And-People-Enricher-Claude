import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";

const DB_PATH = process.env.DATABASE_PATH ?? path.join(process.cwd(), ".data", "jobs.db");

type DbWithInit = { db: Database.Database; initialized: boolean };
type Globals = typeof globalThis & { __enricherDb?: DbWithInit };
const g = globalThis as Globals;

function init(db: Database.Database): void {
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("synchronous = NORMAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      brand_name TEXT,
      logo_url TEXT,
      primary_color TEXT,
      accent_color TEXT,
      support_email TEXT,
      footer_text TEXT,
      share_token TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS workspace_business_profiles (
      workspace_id TEXT PRIMARY KEY,
      business_name TEXT NOT NULL DEFAULT '',
      offerings TEXT NOT NULL DEFAULT '[]',
      service_geographies TEXT NOT NULL DEFAULT '[]',
      target_industries TEXT NOT NULL DEFAULT '[]',
      persona_titles TEXT NOT NULL DEFAULT '[]',
      company_size_min INTEGER,
      company_size_max INTEGER,
      deal_size_min REAL,
      deal_size_max REAL,
      excluded_segments TEXT NOT NULL DEFAULT '[]',
      messaging_tone TEXT,
      compliance_boundaries TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
    );
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
    CREATE TABLE IF NOT EXISTS discovery_searches (
      id TEXT PRIMARY KEY,
      mode TEXT NOT NULL,
      name TEXT NOT NULL,
      query_text TEXT NOT NULL,
      seed_companies TEXT,
      directory_config TEXT,
      max_results INTEGER NOT NULL DEFAULT 25,
      status TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      started_at INTEGER,
      completed_at INTEGER,
      discovered_count INTEGER NOT NULL DEFAULT 0,
      cost_usd REAL NOT NULL DEFAULT 0,
      discovery_log TEXT,
      agent_note TEXT,
      error TEXT,
      parent_monitor_id TEXT
    );
    CREATE TABLE IF NOT EXISTS discovered_leads (
      id TEXT PRIMARY KEY,
      search_id TEXT NOT NULL,
      company_name TEXT NOT NULL,
      website_url TEXT,
      linkedin_url TEXT,
      description TEXT,
      location TEXT,
      industry TEXT,
      employee_range TEXT,
      match_reason TEXT,
      source_url TEXT,
      score INTEGER,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (search_id) REFERENCES discovery_searches(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_discovered_leads_search
      ON discovered_leads(search_id, created_at ASC);
    CREATE INDEX IF NOT EXISTS idx_discovery_searches_parent
      ON discovery_searches(parent_monitor_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS signal_monitors (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      signal_type TEXT NOT NULL,
      config TEXT NOT NULL,
      schedule TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      max_results INTEGER NOT NULL DEFAULT 25,
      timeframe TEXT NOT NULL DEFAULT 'last 14 days',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      last_run_at INTEGER,
      next_run_at INTEGER,
      run_count INTEGER NOT NULL DEFAULT 0,
      lead_count_total INTEGER NOT NULL DEFAULT 0,
      cost_usd_total REAL NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_signal_monitors_due
      ON signal_monitors(active, next_run_at);
  `);
  // parent_monitor_id is nullable and inline on discovery_searches for fresh
  // installs; existing dev DBs from Phase 1 need the column backfilled.
  const searchColumns = new Set(
    (db.prepare(`PRAGMA table_info(discovery_searches)`).all() as { name: string }[]).map(
      (c) => c.name
    )
  );
  if (!searchColumns.has("parent_monitor_id")) {
    db.exec(`ALTER TABLE discovery_searches ADD COLUMN parent_monitor_id TEXT`);
  }
  if (!searchColumns.has("directory_config")) {
    db.exec(`ALTER TABLE discovery_searches ADD COLUMN directory_config TEXT`);
  }
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
  if (!jobColumns.has("channel_types")) {
    db.exec(`ALTER TABLE jobs ADD COLUMN channel_types TEXT`);
  }
  if (!jobColumns.has("include_owner_personal")) {
    db.exec(`ALTER TABLE jobs ADD COLUMN include_owner_personal INTEGER`);
  }
  if (!jobColumns.has("city_column")) {
    db.exec(`ALTER TABLE jobs ADD COLUMN city_column TEXT`);
  }
  if (!jobColumns.has("suppression_list")) {
    db.exec(`ALTER TABLE jobs ADD COLUMN suppression_list TEXT`);
  }

  // --- Client workspace scoping (white-label) ---
  // Every tenant-bearing table gets a nullable workspace_id, backfilled to the
  // "Default" workspace on first boot. FK enforcement is intentionally loose
  // (no ON DELETE CASCADE) — we don't want deleting a workspace to nuke
  // in-flight jobs. The workspace UI warns and reassigns instead.
  const monitorColumns = new Set(
    (db.prepare(`PRAGMA table_info(monitors)`).all() as { name: string }[]).map((c) => c.name)
  );
  const signalColumns = new Set(
    (db.prepare(`PRAGMA table_info(signal_monitors)`).all() as { name: string }[]).map((c) => c.name)
  );
  if (!jobColumns.has("workspace_id")) {
    db.exec(`ALTER TABLE jobs ADD COLUMN workspace_id TEXT`);
  }
  if (!monitorColumns.has("workspace_id")) {
    db.exec(`ALTER TABLE monitors ADD COLUMN workspace_id TEXT`);
  }
  if (!signalColumns.has("workspace_id")) {
    db.exec(`ALTER TABLE signal_monitors ADD COLUMN workspace_id TEXT`);
  }
  if (!searchColumns.has("workspace_id")) {
    db.exec(`ALTER TABLE discovery_searches ADD COLUMN workspace_id TEXT`);
  }
  db.exec(`CREATE INDEX IF NOT EXISTS idx_jobs_workspace ON jobs(workspace_id, created_at DESC)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_monitors_workspace ON monitors(workspace_id, created_at DESC)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_signal_monitors_workspace ON signal_monitors(workspace_id, created_at DESC)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_discovery_searches_workspace ON discovery_searches(workspace_id, created_at DESC)`);

  // Ensure a default workspace exists and backfill rows that predate
  // workspace scoping. Idempotent — cheap to run every boot.
  const defaultRow = db
    .prepare(`SELECT id FROM workspaces WHERE slug = 'default'`)
    .get() as { id: string } | undefined;
  let defaultId: string;
  if (defaultRow) {
    defaultId = defaultRow.id;
  } else {
    defaultId = crypto.randomUUID();
    const now = Date.now();
    db.prepare(
      `INSERT INTO workspaces (id, slug, name, brand_name, share_token, created_at, updated_at)
       VALUES (?, 'default', 'Default Workspace', 'Enricher', ?, ?, ?)`
    ).run(defaultId, crypto.randomBytes(18).toString("base64url"), now, now);
  }
  db.prepare(`UPDATE jobs              SET workspace_id = ? WHERE workspace_id IS NULL`).run(defaultId);
  db.prepare(`UPDATE monitors          SET workspace_id = ? WHERE workspace_id IS NULL`).run(defaultId);
  db.prepare(`UPDATE signal_monitors   SET workspace_id = ? WHERE workspace_id IS NULL`).run(defaultId);
  db.prepare(`UPDATE discovery_searches SET workspace_id = ? WHERE workspace_id IS NULL`).run(defaultId);
  const backfillNow = Date.now();
  db.prepare(
    `INSERT INTO workspace_business_profiles (
      workspace_id, business_name, offerings, service_geographies, target_industries,
      persona_titles, company_size_min, company_size_max, deal_size_min, deal_size_max,
      excluded_segments, messaging_tone, compliance_boundaries, created_at, updated_at
    )
    SELECT
      w.id,
      '',
      '[]',
      '[]',
      '[]',
      '[]',
      NULL,
      NULL,
      NULL,
      NULL,
      '[]',
      NULL,
      '{}',
      ?,
      ?
    FROM workspaces w
    LEFT JOIN workspace_business_profiles p ON p.workspace_id = w.id
    WHERE p.workspace_id IS NULL`
  ).run(backfillNow, backfillNow);

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
  db.prepare(
    `UPDATE discovery_searches SET status = 'failed', error = 'Interrupted by server restart', updated_at = ?
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
