import { v4 as uuidv4 } from "uuid";
import { getDb } from "./db";
import type { MonitorSchedule } from "./monitor-store";

export type SignalType = "funding" | "hiring" | "news";

export type SignalConfig = {
  industryFilter?: string;
  geoFilter?: string;
  sizeFilter?: string;
  icpHint?: string;
  // funding-specific
  stageFilter?: string[];
  minAmount?: number;
  maxAmount?: number;
  // hiring-specific
  roles?: string[];
  // news-specific
  keywords?: string[];
};

export type SignalMonitor = {
  id: string;
  name: string;
  signalType: SignalType;
  config: SignalConfig;
  schedule: MonitorSchedule;
  active: boolean;
  maxResults: number;
  timeframe: string;
  createdAt: number;
  updatedAt: number;
  lastRunAt?: number;
  nextRunAt?: number;
  runCount: number;
  leadCountTotal: number;
  costUsdTotal: number;
};

type Row = {
  id: string;
  name: string;
  signal_type: SignalType;
  config: string;
  schedule: MonitorSchedule;
  active: number;
  max_results: number;
  timeframe: string;
  created_at: number;
  updated_at: number;
  last_run_at: number | null;
  next_run_at: number | null;
  run_count: number;
  lead_count_total: number;
  cost_usd_total: number;
};

function fromRow(r: Row): SignalMonitor {
  return {
    id: r.id,
    name: r.name,
    signalType: r.signal_type,
    config: JSON.parse(r.config),
    schedule: r.schedule,
    active: !!r.active,
    maxResults: r.max_results,
    timeframe: r.timeframe,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    lastRunAt: r.last_run_at ?? undefined,
    nextRunAt: r.next_run_at ?? undefined,
    runCount: r.run_count,
    leadCountTotal: r.lead_count_total,
    costUsdTotal: r.cost_usd_total,
  };
}

export function createSignalMonitor(params: {
  name: string;
  signalType: SignalType;
  config: SignalConfig;
  schedule: MonitorSchedule;
  maxResults: number;
  timeframe: string;
  nextRunAt?: number;
}): SignalMonitor {
  const db = getDb();
  const id = uuidv4();
  const now = Date.now();
  db.prepare(
    `INSERT INTO signal_monitors (
      id, name, signal_type, config, schedule, active, max_results, timeframe,
      created_at, updated_at, next_run_at
    ) VALUES (
      @id, @name, @signalType, @config, @schedule, 1, @maxResults, @timeframe,
      @now, @now, @nextRunAt
    )`
  ).run({
    id,
    name: params.name,
    signalType: params.signalType,
    config: JSON.stringify(params.config),
    schedule: params.schedule,
    maxResults: params.maxResults,
    timeframe: params.timeframe,
    nextRunAt: params.nextRunAt ?? null,
    now,
  });
  return getSignalMonitor(id)!;
}

export function getSignalMonitor(id: string): SignalMonitor | undefined {
  const db = getDb();
  const row = db
    .prepare(`SELECT * FROM signal_monitors WHERE id = ?`)
    .get(id) as Row | undefined;
  return row ? fromRow(row) : undefined;
}

export function listSignalMonitors(): SignalMonitor[] {
  const db = getDb();
  const rows = db
    .prepare(`SELECT * FROM signal_monitors ORDER BY created_at DESC`)
    .all() as Row[];
  return rows.map(fromRow);
}

const FIELD_TO_COLUMN: Record<string, string> = {
  name: "name",
  active: "active",
  schedule: "schedule",
  maxResults: "max_results",
  timeframe: "timeframe",
  lastRunAt: "last_run_at",
  nextRunAt: "next_run_at",
};

export function updateSignalMonitor(
  id: string,
  partial: Partial<SignalMonitor>
): void {
  const db = getDb();
  const sets: string[] = [];
  const values: Record<string, unknown> = { id, updatedAt: Date.now() };
  for (const [key, value] of Object.entries(partial)) {
    const col = FIELD_TO_COLUMN[key];
    if (!col) continue;
    sets.push(`${col} = @${key}`);
    if (key === "active") values[key] = value ? 1 : 0;
    else values[key] = value ?? null;
  }
  if (sets.length === 0) {
    db.prepare(
      `UPDATE signal_monitors SET updated_at = @updatedAt WHERE id = @id`
    ).run(values);
    return;
  }
  db.prepare(
    `UPDATE signal_monitors SET ${sets.join(", ")}, updated_at = @updatedAt WHERE id = @id`
  ).run(values);
}

export function deleteSignalMonitor(id: string): void {
  const db = getDb();
  db.prepare(`DELETE FROM signal_monitors WHERE id = ?`).run(id);
}

export function incrementSignalMonitorTotals(
  id: string,
  leadDelta: number,
  costDelta: number,
  lastRunAt: number
): void {
  const db = getDb();
  db.prepare(
    `UPDATE signal_monitors
       SET run_count        = run_count + 1,
           lead_count_total = lead_count_total + ?,
           cost_usd_total   = cost_usd_total   + ?,
           last_run_at      = ?,
           updated_at       = ?
     WHERE id = ?`
  ).run(leadDelta, costDelta, lastRunAt, Date.now(), id);
}

export function pickDueSignalMonitors(nowMs: number): SignalMonitor[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT * FROM signal_monitors
        WHERE active = 1
          AND next_run_at IS NOT NULL
          AND next_run_at <= ?
        ORDER BY next_run_at ASC`
    )
    .all(nowMs) as Row[];
  return rows.map(fromRow);
}
