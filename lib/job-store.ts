import { v4 as uuidv4 } from "uuid";

export type CustomFieldDef = { name: string; description: string };

export type EnrichmentRow = {
  rowIndex: number;
  originalData: Record<string, string>;
  enrichedData: Record<string, string>;
  status: "pending" | "processing" | "done" | "error";
  error?: string;
  costUsd?: number;
};

export type Job = {
  id: string;
  type: "company" | "people";
  status: "pending" | "processing" | "completed" | "failed" | "cancelled";
  createdAt: number;
  updatedAt: number;
  identifierColumn: string;
  requestedFields: string[];
  customFieldDefs: CustomFieldDef[];
  newsParams?: { count: number; timeframe: string };
  rows: EnrichmentRow[];
  totalRows: number;
  processedRows: number;
  error?: string;
};

const store = new Map<string, Job>();
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

export function createJob(params: {
  type: "company" | "people";
  identifierColumn: string;
  requestedFields: string[];
  customFieldDefs?: CustomFieldDef[];
  newsParams?: { count: number; timeframe: string };
  rows: Record<string, string>[];
}): Job {
  const id = uuidv4();
  const now = Date.now();
  const job: Job = {
    id,
    type: params.type,
    status: "pending",
    createdAt: now,
    updatedAt: now,
    identifierColumn: params.identifierColumn,
    requestedFields: params.requestedFields,
    customFieldDefs: params.customFieldDefs ?? [],
    newsParams: params.newsParams,
    rows: params.rows.map((originalData, rowIndex) => ({
      rowIndex,
      originalData,
      enrichedData: {},
      status: "pending",
    })),
    totalRows: params.rows.length,
    processedRows: 0,
  };
  store.set(id, job);
  return job;
}

export function getJob(id: string): Job | undefined {
  return store.get(id);
}

export function updateJob(id: string, partial: Partial<Job>): void {
  const job = store.get(id);
  if (!job) return;
  Object.assign(job, partial, { updatedAt: Date.now() });
}

export function updateRow(
  jobId: string,
  rowIndex: number,
  partial: Partial<EnrichmentRow>
): void {
  const job = store.get(jobId);
  if (!job) return;
  const row = job.rows[rowIndex];
  if (!row) return;
  Object.assign(row, partial);
  job.updatedAt = Date.now();
}
