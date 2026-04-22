import { v4 as uuidv4 } from "uuid";
import { EventEmitter } from "node:events";
import { getDb } from "./db";

export type MonitorMode = "keyword" | "profile" | "post" | "instant";
export type MonitorSchedule = "manual" | "once" | "daily" | "weekly" | "monthly";

export type MonitorConfig = {
  keywords?: string[];
  profileUrl?: string;
  postUrls?: string[];
};

export type CustomFieldDef = { name: string; description: string };

export type Monitor = {
  id: string;
  name: string;
  mode: MonitorMode;
  config: MonitorConfig;
  schedule: MonitorSchedule;
  active: boolean;
  webhookUrl?: string;
  requestedFields: string[];
  customFieldDefs: CustomFieldDef[];
  outreachContext?: string;
  manualEngagers?: ManualEngagerInput[];
  createdAt: number;
  updatedAt: number;
  lastRunAt?: number;
  nextRunAt?: number;
  leadCountTotal: number;
  costUsdTotal: number;
};

export type ManualEngagerInput = {
  linkedinUrl: string;
  name?: string;
  engagementType?: string;
  engagementText?: string;
  postUrl?: string;
};

export type RunStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "awaiting_approval";

export type RunTrigger = "manual" | "schedule" | "create";

export type MonitorRun = {
  id: string;
  monitorId: string;
  status: RunStatus;
  trigger: RunTrigger;
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  completedAt?: number;
  discoveredCount: number;
  newCount: number;
  dedupCount: number;
  enrichedCount: number;
  costUsd: number;
  estimatedLeads?: number;
  discoveryLog: string[];
  error?: string;
};

export type LeadEnrichmentStatus = "pending" | "processing" | "done" | "error";

export type MonitorLead = {
  id: string;
  monitorId: string;
  runId: string;
  linkedinUrl: string;
  profileName?: string;
  engagementType?: string;
  engagementText?: string;
  postUrl?: string;
  enrichedData: Record<string, string>;
  enrichmentStatus: LeadEnrichmentStatus;
  enrichmentError?: string;
  costUsd?: number;
  createdAt: number;
  updatedAt: number;
  webhookStatus?: string;
};

type MonitorRow = {
  id: string;
  name: string;
  mode: MonitorMode;
  config: string;
  schedule: MonitorSchedule;
  active: number;
  webhook_url: string | null;
  requested_fields: string;
  custom_field_defs: string;
  outreach_context: string | null;
  manual_engagers: string | null;
  created_at: number;
  updated_at: number;
  last_run_at: number | null;
  next_run_at: number | null;
  lead_count_total: number;
  cost_usd_total: number;
};

type RunRow = {
  id: string;
  monitor_id: string;
  status: RunStatus;
  trigger: RunTrigger;
  created_at: number;
  updated_at: number;
  started_at: number | null;
  completed_at: number | null;
  discovered_count: number;
  new_count: number;
  dedup_count: number;
  enriched_count: number;
  cost_usd: number;
  estimated_leads: number | null;
  discovery_log: string | null;
  error: string | null;
};

type LeadRow = {
  id: string;
  monitor_id: string;
  run_id: string;
  linkedin_url: string;
  profile_name: string | null;
  engagement_type: string | null;
  engagement_text: string | null;
  post_url: string | null;
  enriched_data: string;
  enrichment_status: LeadEnrichmentStatus;
  enrichment_error: string | null;
  cost_usd: number | null;
  created_at: number;
  updated_at: number;
  webhook_status: string | null;
};

function monitorFromRow(r: MonitorRow): Monitor {
  return {
    id: r.id,
    name: r.name,
    mode: r.mode,
    config: JSON.parse(r.config),
    schedule: r.schedule,
    active: !!r.active,
    webhookUrl: r.webhook_url ?? undefined,
    requestedFields: JSON.parse(r.requested_fields),
    customFieldDefs: JSON.parse(r.custom_field_defs),
    outreachContext: r.outreach_context ?? undefined,
    manualEngagers: r.manual_engagers ? JSON.parse(r.manual_engagers) : undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    lastRunAt: r.last_run_at ?? undefined,
    nextRunAt: r.next_run_at ?? undefined,
    leadCountTotal: r.lead_count_total,
    costUsdTotal: r.cost_usd_total,
  };
}

function runFromRow(r: RunRow): MonitorRun {
  return {
    id: r.id,
    monitorId: r.monitor_id,
    status: r.status,
    trigger: r.trigger,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    startedAt: r.started_at ?? undefined,
    completedAt: r.completed_at ?? undefined,
    discoveredCount: r.discovered_count,
    newCount: r.new_count,
    dedupCount: r.dedup_count,
    enrichedCount: r.enriched_count,
    costUsd: r.cost_usd,
    estimatedLeads: r.estimated_leads ?? undefined,
    discoveryLog: r.discovery_log ? JSON.parse(r.discovery_log) : [],
    error: r.error ?? undefined,
  };
}

function leadFromRow(r: LeadRow): MonitorLead {
  return {
    id: r.id,
    monitorId: r.monitor_id,
    runId: r.run_id,
    linkedinUrl: r.linkedin_url,
    profileName: r.profile_name ?? undefined,
    engagementType: r.engagement_type ?? undefined,
    engagementText: r.engagement_text ?? undefined,
    postUrl: r.post_url ?? undefined,
    enrichedData: JSON.parse(r.enriched_data),
    enrichmentStatus: r.enrichment_status,
    enrichmentError: r.enrichment_error ?? undefined,
    costUsd: r.cost_usd ?? undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    webhookStatus: r.webhook_status ?? undefined,
  };
}

export function createMonitor(params: {
  name: string;
  mode: MonitorMode;
  config: MonitorConfig;
  schedule: MonitorSchedule;
  webhookUrl?: string;
  requestedFields: string[];
  customFieldDefs?: CustomFieldDef[];
  outreachContext?: string;
  manualEngagers?: ManualEngagerInput[];
  nextRunAt?: number;
}): Monitor {
  const db = getDb();
  const id = uuidv4();
  const now = Date.now();

  db.prepare(
    `INSERT INTO monitors (
      id, name, mode, config, schedule, active, webhook_url,
      requested_fields, custom_field_defs, outreach_context, manual_engagers,
      created_at, updated_at, next_run_at
    ) VALUES (
      @id, @name, @mode, @config, @schedule, 1, @webhookUrl,
      @requestedFields, @customFieldDefs, @outreachContext, @manualEngagers,
      @now, @now, @nextRunAt
    )`
  ).run({
    id,
    name: params.name,
    mode: params.mode,
    config: JSON.stringify(params.config),
    schedule: params.schedule,
    webhookUrl: params.webhookUrl ?? null,
    requestedFields: JSON.stringify(params.requestedFields),
    customFieldDefs: JSON.stringify(params.customFieldDefs ?? []),
    outreachContext: params.outreachContext?.trim() || null,
    manualEngagers: params.manualEngagers?.length ? JSON.stringify(params.manualEngagers) : null,
    now,
    nextRunAt: params.nextRunAt ?? null,
  });

  return getMonitor(id)!;
}

export function listMonitors(): Monitor[] {
  const db = getDb();
  const rows = db
    .prepare(`SELECT * FROM monitors ORDER BY created_at DESC`)
    .all() as MonitorRow[];
  return rows.map(monitorFromRow);
}

export function getMonitor(id: string): Monitor | undefined {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM monitors WHERE id = ?`).get(id) as
    | MonitorRow
    | undefined;
  return row ? monitorFromRow(row) : undefined;
}

const MONITOR_FIELD_TO_COLUMN: Record<string, string> = {
  name: "name",
  active: "active",
  schedule: "schedule",
  webhookUrl: "webhook_url",
  outreachContext: "outreach_context",
  lastRunAt: "last_run_at",
  nextRunAt: "next_run_at",
};

export function updateMonitor(id: string, partial: Partial<Monitor>): void {
  const db = getDb();
  const sets: string[] = [];
  const values: Record<string, unknown> = { id, updatedAt: Date.now() };
  for (const [key, value] of Object.entries(partial)) {
    const col = MONITOR_FIELD_TO_COLUMN[key];
    if (!col) continue;
    sets.push(`${col} = @${key}`);
    if (key === "active") values[key] = value ? 1 : 0;
    else values[key] = value ?? null;
  }
  if (sets.length === 0) {
    db.prepare(`UPDATE monitors SET updated_at = @updatedAt WHERE id = @id`).run(values);
    return;
  }
  db.prepare(
    `UPDATE monitors SET ${sets.join(", ")}, updated_at = @updatedAt WHERE id = @id`
  ).run(values);
}

export function deleteMonitor(id: string): void {
  const db = getDb();
  db.prepare(`DELETE FROM monitors WHERE id = ?`).run(id);
}

export function incrementMonitorTotals(
  id: string,
  leadDelta: number,
  costDelta: number,
  lastRunAt: number
): void {
  const db = getDb();
  db.prepare(
    `UPDATE monitors
       SET lead_count_total = lead_count_total + ?,
           cost_usd_total   = cost_usd_total   + ?,
           last_run_at      = ?,
           updated_at       = ?
     WHERE id = ?`
  ).run(leadDelta, costDelta, lastRunAt, Date.now(), id);
}

export function pickDueMonitors(nowMs: number): Monitor[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT * FROM monitors
        WHERE active = 1
          AND next_run_at IS NOT NULL
          AND next_run_at <= ?
        ORDER BY next_run_at ASC`
    )
    .all(nowMs) as MonitorRow[];
  return rows.map(monitorFromRow);
}

export function createRun(params: {
  monitorId: string;
  trigger: RunTrigger;
  status?: RunStatus;
  estimatedLeads?: number;
}): MonitorRun {
  const db = getDb();
  const id = uuidv4();
  const now = Date.now();
  db.prepare(
    `INSERT INTO monitor_runs (id, monitor_id, status, trigger, created_at, updated_at, estimated_leads)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    params.monitorId,
    params.status ?? "queued",
    params.trigger,
    now,
    now,
    params.estimatedLeads ?? null
  );
  return getRun(id)!;
}

export function getRun(id: string): MonitorRun | undefined {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM monitor_runs WHERE id = ?`).get(id) as
    | RunRow
    | undefined;
  return row ? runFromRow(row) : undefined;
}

export function listRunsByMonitor(monitorId: string, limit = 50): MonitorRun[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT * FROM monitor_runs WHERE monitor_id = ? ORDER BY created_at DESC LIMIT ?`
    )
    .all(monitorId, limit) as RunRow[];
  return rows.map(runFromRow);
}

const RUN_FIELD_TO_COLUMN: Record<string, string> = {
  status: "status",
  startedAt: "started_at",
  completedAt: "completed_at",
  discoveredCount: "discovered_count",
  newCount: "new_count",
  dedupCount: "dedup_count",
  enrichedCount: "enriched_count",
  costUsd: "cost_usd",
  estimatedLeads: "estimated_leads",
  error: "error",
};

export function updateRun(id: string, partial: Partial<MonitorRun>): void {
  const db = getDb();
  const sets: string[] = [];
  const values: Record<string, unknown> = { id, updatedAt: Date.now() };
  for (const [key, value] of Object.entries(partial)) {
    if (key === "discoveryLog") {
      sets.push(`discovery_log = @discoveryLog`);
      values.discoveryLog = JSON.stringify(value ?? []);
      continue;
    }
    const col = RUN_FIELD_TO_COLUMN[key];
    if (!col) continue;
    sets.push(`${col} = @${key}`);
    values[key] = value ?? null;
  }
  if (sets.length === 0) {
    db.prepare(`UPDATE monitor_runs SET updated_at = @updatedAt WHERE id = @id`).run(values);
  } else {
    db.prepare(
      `UPDATE monitor_runs SET ${sets.join(", ")}, updated_at = @updatedAt WHERE id = @id`
    ).run(values);
  }
  emitRunUpdate(id);
}

export function appendDiscoveryLog(runId: string, line: string): void {
  const run = getRun(runId);
  if (!run) return;
  const log = [...run.discoveryLog, `[${new Date().toISOString()}] ${line}`].slice(-200);
  updateRun(runId, { discoveryLog: log });
}

export function upsertLead(params: {
  monitorId: string;
  runId: string;
  linkedinUrl: string;
  profileName?: string;
  engagementType?: string;
  engagementText?: string;
  postUrl?: string;
}): { lead: MonitorLead; isNew: boolean } {
  const db = getDb();
  const existing = db
    .prepare(`SELECT * FROM monitor_leads WHERE monitor_id = ? AND linkedin_url = ?`)
    .get(params.monitorId, params.linkedinUrl) as LeadRow | undefined;

  if (existing) {
    return { lead: leadFromRow(existing), isNew: false };
  }

  const id = uuidv4();
  const now = Date.now();
  db.prepare(
    `INSERT INTO monitor_leads (
      id, monitor_id, run_id, linkedin_url, profile_name,
      engagement_type, engagement_text, post_url,
      enriched_data, enrichment_status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '{}', 'pending', ?, ?)`
  ).run(
    id,
    params.monitorId,
    params.runId,
    params.linkedinUrl,
    params.profileName ?? null,
    params.engagementType ?? null,
    params.engagementText ?? null,
    params.postUrl ?? null,
    now,
    now
  );

  const row = db.prepare(`SELECT * FROM monitor_leads WHERE id = ?`).get(id) as LeadRow;
  return { lead: leadFromRow(row), isNew: true };
}

export function updateLead(id: string, partial: Partial<MonitorLead>): void {
  const db = getDb();
  const map: Record<string, string> = {
    enrichmentStatus: "enrichment_status",
    enrichmentError: "enrichment_error",
    costUsd: "cost_usd",
    webhookStatus: "webhook_status",
  };
  const sets: string[] = [];
  const values: Record<string, unknown> = { id, updatedAt: Date.now() };
  for (const [key, value] of Object.entries(partial)) {
    if (key === "enrichedData") {
      sets.push(`enriched_data = @enrichedData`);
      values.enrichedData = JSON.stringify(value ?? {});
      continue;
    }
    const col = map[key];
    if (!col) continue;
    sets.push(`${col} = @${key}`);
    values[key] = value ?? null;
  }
  if (sets.length === 0) {
    db.prepare(`UPDATE monitor_leads SET updated_at = @updatedAt WHERE id = @id`).run(values);
  } else {
    db.prepare(
      `UPDATE monitor_leads SET ${sets.join(", ")}, updated_at = @updatedAt WHERE id = @id`
    ).run(values);
  }
}

export function listLeadsByMonitor(monitorId: string, limit = 500): MonitorLead[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT * FROM monitor_leads WHERE monitor_id = ? ORDER BY created_at DESC LIMIT ?`
    )
    .all(monitorId, limit) as LeadRow[];
  return rows.map(leadFromRow);
}

export function listLeadsByRun(runId: string): MonitorLead[] {
  const db = getDb();
  const rows = db
    .prepare(`SELECT * FROM monitor_leads WHERE run_id = ? ORDER BY created_at ASC`)
    .all(runId) as LeadRow[];
  return rows.map(leadFromRow);
}

export function listPendingLeadsByRun(runId: string): MonitorLead[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT * FROM monitor_leads WHERE run_id = ? AND enrichment_status IN ('pending','processing') ORDER BY created_at ASC`
    )
    .all(runId) as LeadRow[];
  return rows.map(leadFromRow);
}

// --------- run event bus (for SSE) ---------

type RunEvents = { run: (run: MonitorRun) => void; end: () => void };
type RunEmitter = EventEmitter & {
  on<K extends keyof RunEvents>(event: K, listener: RunEvents[K]): RunEmitter;
  off<K extends keyof RunEvents>(event: K, listener: RunEvents[K]): RunEmitter;
  emit<K extends keyof RunEvents>(event: K, ...args: Parameters<RunEvents[K]>): boolean;
};

type Globals = typeof globalThis & {
  __monitorRunBuses?: Map<string, RunEmitter>;
  __monitorAborts?: Map<string, AbortController>;
};
const g = globalThis as Globals;
if (!g.__monitorRunBuses) g.__monitorRunBuses = new Map();
if (!g.__monitorAborts) g.__monitorAborts = new Map();

export function getRunBus(runId: string): RunEmitter {
  let bus = g.__monitorRunBuses!.get(runId);
  if (!bus) {
    bus = new EventEmitter() as RunEmitter;
    bus.setMaxListeners(50);
    g.__monitorRunBuses!.set(runId, bus);
  }
  return bus;
}

export function disposeRunBus(runId: string): void {
  const bus = g.__monitorRunBuses!.get(runId);
  if (!bus) return;
  bus.emit("end");
  bus.removeAllListeners();
  g.__monitorRunBuses!.delete(runId);
}

function emitRunUpdate(runId: string): void {
  const run = getRun(runId);
  if (!run) return;
  getRunBus(runId).emit("run", run);
  if (
    run.status === "completed" ||
    run.status === "failed" ||
    run.status === "cancelled"
  ) {
    queueMicrotask(() => disposeRunBus(runId));
  }
}

export function setRunAbort(runId: string, controller: AbortController): void {
  g.__monitorAborts!.set(runId, controller);
}

export function getRunAbort(runId: string): AbortController | undefined {
  return g.__monitorAborts!.get(runId);
}

export function clearRunAbort(runId: string): void {
  g.__monitorAborts!.delete(runId);
}
