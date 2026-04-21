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
  `);
  // Jobs that were in flight when the process died can never resume — their
  // workers and abort controllers are gone. Mark them failed so the UI can
  // tell the user instead of leaving them stuck at "processing".
  db.prepare(
    `UPDATE jobs SET status = 'failed', error = 'Interrupted by server restart', updated_at = ?
     WHERE status IN ('pending', 'processing')`
  ).run(Date.now());
}

export function getDb(): Database.Database {
  if (g.__enricherDb) return g.__enricherDb.db;
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const db = new Database(DB_PATH);
  init(db);
  g.__enricherDb = { db, initialized: true };
  return db;
}
