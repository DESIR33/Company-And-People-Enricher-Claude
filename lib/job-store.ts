import { v4 as uuidv4 } from "uuid";
import { getDb } from "./db";
import { disposeJobBus, getJobBus } from "./job-events";
import type { ChannelType } from "./channels/types";
import type { EnrichmentType } from "./enrichment-fields";

export type CustomFieldDef = { name: string; description: string };

export type ScoreRubric = {
  icpCriteria: string;
  painSignals: string;
  reachability: string;
  weights: { icp: number; pain: number; reach: number };
};

export type EnrichmentRow = {
  rowIndex: number;
  originalData: Record<string, string>;
  enrichedData: Record<string, string>;
  status: "pending" | "processing" | "done" | "error";
  error?: string;
  costUsd?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
};

export type Job = {
  id: string;
  workspaceId: string;
  type: EnrichmentType;
  status: "pending" | "processing" | "completed" | "failed" | "cancelled";
  createdAt: number;
  updatedAt: number;
  identifierColumn: string;
  cityColumn?: string;
  requestedFields: string[];
  customFieldDefs: CustomFieldDef[];
  newsParams?: { count: number; timeframe: string };
  outreachContext?: string;
  scoreRubric?: ScoreRubric;
  channelTypes?: ChannelType[];
  includeOwnerPersonal?: boolean;
  suppressionList?: string[];
  rows: EnrichmentRow[];
  totalRows: number;
  processedRows: number;
  error?: string;
};

const abortControllers = new Map<string, AbortController>();

export function setJobAbortController(jobId: string, controller: AbortController): void {
  abortControllers.set(jobId, controller);
}

export function abortJob(jobId: string): void {
  abortControllers.get(jobId)?.abort();
}

export function clearJobAbortController(jobId: string): void {
  abortControllers.delete(jobId);
}

type JobRowRow = {
  row_index: number;
  original_data: string;
  enriched_data: string;
  status: EnrichmentRow["status"];
  error: string | null;
  cost_usd: number | null;
  cache_read_tokens: number | null;
  cache_creation_tokens: number | null;
};

type JobMetaRow = {
  id: string;
  workspace_id: string;
  type: Job["type"];
  status: Job["status"];
  created_at: number;
  updated_at: number;
  identifier_column: string;
  city_column: string | null;
  requested_fields: string;
  custom_field_defs: string;
  news_params: string | null;
  outreach_context: string | null;
  score_rubric: string | null;
  channel_types: string | null;
  include_owner_personal: number | null;
  suppression_list: string | null;
  total_rows: number;
  processed_rows: number;
  error: string | null;
};

function rowFromDb(r: JobRowRow): EnrichmentRow {
  return {
    rowIndex: r.row_index,
    originalData: JSON.parse(r.original_data),
    enrichedData: JSON.parse(r.enriched_data),
    status: r.status,
    error: r.error ?? undefined,
    costUsd: r.cost_usd ?? undefined,
    cacheReadTokens: r.cache_read_tokens ?? undefined,
    cacheCreationTokens: r.cache_creation_tokens ?? undefined,
  };
}

function jobFromDb(meta: JobMetaRow, rows: JobRowRow[]): Job {
  return {
    id: meta.id,
    workspaceId: meta.workspace_id,
    type: meta.type,
    status: meta.status,
    createdAt: meta.created_at,
    updatedAt: meta.updated_at,
    identifierColumn: meta.identifier_column,
    cityColumn: meta.city_column ?? undefined,
    requestedFields: JSON.parse(meta.requested_fields),
    customFieldDefs: JSON.parse(meta.custom_field_defs),
    newsParams: meta.news_params ? JSON.parse(meta.news_params) : undefined,
    outreachContext: meta.outreach_context ?? undefined,
    scoreRubric: meta.score_rubric ? JSON.parse(meta.score_rubric) : undefined,
    channelTypes: meta.channel_types ? JSON.parse(meta.channel_types) : undefined,
    includeOwnerPersonal:
      meta.include_owner_personal === null || meta.include_owner_personal === undefined
        ? undefined
        : Boolean(meta.include_owner_personal),
    suppressionList: meta.suppression_list ? JSON.parse(meta.suppression_list) : undefined,
    rows: rows.map(rowFromDb),
    totalRows: meta.total_rows,
    processedRows: meta.processed_rows,
    error: meta.error ?? undefined,
  };
}

export function createJob(params: {
  workspaceId: string;
  type: EnrichmentType;
  identifierColumn: string;
  cityColumn?: string;
  requestedFields: string[];
  customFieldDefs?: CustomFieldDef[];
  newsParams?: { count: number; timeframe: string };
  outreachContext?: string;
  scoreRubric?: ScoreRubric;
  channelTypes?: ChannelType[];
  includeOwnerPersonal?: boolean;
  suppressionList?: string[];
  rows: Record<string, string>[];
}): Job {
  const db = getDb();
  const id = uuidv4();
  const now = Date.now();
  const customFieldDefs = params.customFieldDefs ?? [];

  const insertMeta = db.prepare(`
    INSERT INTO jobs (id, workspace_id, type, status, created_at, updated_at, identifier_column, city_column,
      requested_fields, custom_field_defs, news_params, outreach_context, score_rubric,
      channel_types, include_owner_personal, suppression_list, total_rows, processed_rows)
    VALUES (@id, @workspaceId, @type, 'pending', @now, @now, @identifierColumn, @cityColumn,
      @requestedFields, @customFieldDefs, @newsParams, @outreachContext, @scoreRubric,
      @channelTypes, @includeOwnerPersonal, @suppressionList, @totalRows, 0)
  `);
  const insertRow = db.prepare(`
    INSERT INTO job_rows (job_id, row_index, original_data, enriched_data, status)
    VALUES (?, ?, ?, '{}', 'pending')
  `);

  db.transaction(() => {
    insertMeta.run({
      id,
      workspaceId: params.workspaceId,
      type: params.type,
      now,
      identifierColumn: params.identifierColumn,
      cityColumn: params.cityColumn?.trim() ? params.cityColumn.trim() : null,
      requestedFields: JSON.stringify(params.requestedFields),
      customFieldDefs: JSON.stringify(customFieldDefs),
      newsParams: params.newsParams ? JSON.stringify(params.newsParams) : null,
      outreachContext: params.outreachContext?.trim() ? params.outreachContext.trim() : null,
      scoreRubric: params.scoreRubric ? JSON.stringify(params.scoreRubric) : null,
      channelTypes: params.channelTypes && params.channelTypes.length > 0
        ? JSON.stringify(params.channelTypes)
        : null,
      includeOwnerPersonal:
        params.includeOwnerPersonal === undefined ? null : params.includeOwnerPersonal ? 1 : 0,
      suppressionList: params.suppressionList && params.suppressionList.length > 0
        ? JSON.stringify(params.suppressionList)
        : null,
      totalRows: params.rows.length,
    });
    for (let i = 0; i < params.rows.length; i++) {
      insertRow.run(id, i, JSON.stringify(params.rows[i]));
    }
  })();

  return getJob(id)!;
}

export type JobSummary = {
  id: string;
  workspaceId: string;
  type: EnrichmentType;
  status: Job["status"];
  createdAt: number;
  updatedAt: number;
  totalRows: number;
  processedRows: number;
};

// Lightweight list for the per-workspace "Job history" page. We deliberately
// don't load every row payload — the history view only needs counters.
export function listJobsByWorkspace(workspaceId: string, limit = 100): JobSummary[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, workspace_id, type, status, created_at, updated_at, total_rows, processed_rows
         FROM jobs
        WHERE workspace_id = ?
        ORDER BY created_at DESC
        LIMIT ?`
    )
    .all(workspaceId, limit) as Array<{
    id: string;
    workspace_id: string;
    type: EnrichmentType;
    status: Job["status"];
    created_at: number;
    updated_at: number;
    total_rows: number;
    processed_rows: number;
  }>;
  return rows.map((r) => ({
    id: r.id,
    workspaceId: r.workspace_id,
    type: r.type,
    status: r.status,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    totalRows: r.total_rows,
    processedRows: r.processed_rows,
  }));
}

export function getJob(id: string): Job | undefined {
  const db = getDb();
  const meta = db.prepare(`SELECT * FROM jobs WHERE id = ?`).get(id) as JobMetaRow | undefined;
  if (!meta) return undefined;
  const rows = db
    .prepare(`SELECT * FROM job_rows WHERE job_id = ? ORDER BY row_index ASC`)
    .all(id) as JobRowRow[];
  return jobFromDb(meta, rows);
}

const JOB_FIELD_TO_COLUMN: Record<string, string> = {
  status: "status",
  processedRows: "processed_rows",
  error: "error",
};

export function updateJob(id: string, partial: Partial<Job>): void {
  const db = getDb();
  const sets: string[] = [];
  const values: Record<string, unknown> = { id, updatedAt: Date.now() };
  for (const [key, value] of Object.entries(partial)) {
    const col = JOB_FIELD_TO_COLUMN[key];
    if (!col) continue;
    sets.push(`${col} = @${key}`);
    values[key] = value ?? null;
  }
  if (sets.length === 0) {
    db.prepare(`UPDATE jobs SET updated_at = @updatedAt WHERE id = @id`).run(values);
  } else {
    db.prepare(`UPDATE jobs SET ${sets.join(", ")}, updated_at = @updatedAt WHERE id = @id`).run(values);
  }

  getJobBus(id).emit("job", { ...partial, updatedAt: values.updatedAt as number });

  if (partial.status === "completed" || partial.status === "failed" || partial.status === "cancelled") {
    queueMicrotask(() => disposeJobBus(id));
  }
}

export function updateRow(
  jobId: string,
  rowIndex: number,
  partial: Partial<EnrichmentRow>
): void {
  const db = getDb();
  const now = Date.now();
  const sets: string[] = [];
  const values: Record<string, unknown> = { jobId, rowIndex };
  const map: Record<string, string> = {
    status: "status",
    error: "error",
    enrichedData: "enriched_data",
    costUsd: "cost_usd",
    cacheReadTokens: "cache_read_tokens",
    cacheCreationTokens: "cache_creation_tokens",
  };
  for (const [key, value] of Object.entries(partial)) {
    const col = map[key];
    if (!col) continue;
    sets.push(`${col} = @${key}`);
    values[key] = key === "enrichedData" ? JSON.stringify(value ?? {}) : value ?? null;
  }
  if (sets.length > 0) {
    db.prepare(
      `UPDATE job_rows SET ${sets.join(", ")} WHERE job_id = @jobId AND row_index = @rowIndex`
    ).run(values);
    db.prepare(`UPDATE jobs SET updated_at = ? WHERE id = ?`).run(now, jobId);
  }

  const fresh = db
    .prepare(`SELECT * FROM job_rows WHERE job_id = ? AND row_index = ?`)
    .get(jobId, rowIndex) as JobRowRow | undefined;
  if (fresh) getJobBus(jobId).emit("row", rowFromDb(fresh));
}
