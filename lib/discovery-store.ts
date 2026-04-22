import { v4 as uuidv4 } from "uuid";
import { getDb } from "./db";

export type DiscoveryMode =
  | "icp"
  | "lookalike"
  | "signal_funding"
  | "signal_hiring"
  | "signal_news"
  | "signal_reviews"
  | "directory";

export type DirectorySource =
  | "yc"
  | "producthunt"
  | "github"
  | "google_maps"
  | "tech_stack"
  | "custom"
  | "yelp"
  | "bbb"
  | "angi"
  | "facebook_pages";

export type DirectoryConfig = {
  source: DirectorySource;
  category?: string;
  query?: string;
  geo?: string;
  url?: string;
  techStack?: string;
  batch?: string;
};

export type DiscoveryStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type DiscoverySearch = {
  id: string;
  mode: DiscoveryMode;
  name: string;
  queryText: string;
  seedCompanies?: string[];
  directoryConfig?: DirectoryConfig;
  maxResults: number;
  status: DiscoveryStatus;
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  completedAt?: number;
  discoveredCount: number;
  costUsd: number;
  discoveryLog: string[];
  agentNote?: string;
  error?: string;
  parentMonitorId?: string;
};

export type DiscoveredLead = {
  id: string;
  searchId: string;
  companyName: string;
  websiteUrl?: string;
  linkedinUrl?: string;
  description?: string;
  location?: string;
  industry?: string;
  employeeRange?: string;
  matchReason?: string;
  sourceUrl?: string;
  score?: number;
  createdAt: number;
};

type SearchRow = {
  id: string;
  mode: DiscoveryMode;
  name: string;
  query_text: string;
  seed_companies: string | null;
  directory_config: string | null;
  max_results: number;
  status: DiscoveryStatus;
  created_at: number;
  updated_at: number;
  started_at: number | null;
  completed_at: number | null;
  discovered_count: number;
  cost_usd: number;
  discovery_log: string | null;
  agent_note: string | null;
  error: string | null;
  parent_monitor_id: string | null;
};

type LeadRow = {
  id: string;
  search_id: string;
  company_name: string;
  website_url: string | null;
  linkedin_url: string | null;
  description: string | null;
  location: string | null;
  industry: string | null;
  employee_range: string | null;
  match_reason: string | null;
  source_url: string | null;
  score: number | null;
  created_at: number;
};

function searchFromRow(r: SearchRow): DiscoverySearch {
  return {
    id: r.id,
    mode: r.mode,
    name: r.name,
    queryText: r.query_text,
    seedCompanies: r.seed_companies ? JSON.parse(r.seed_companies) : undefined,
    directoryConfig: r.directory_config ? JSON.parse(r.directory_config) : undefined,
    maxResults: r.max_results,
    status: r.status,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    startedAt: r.started_at ?? undefined,
    completedAt: r.completed_at ?? undefined,
    discoveredCount: r.discovered_count,
    costUsd: r.cost_usd,
    discoveryLog: r.discovery_log ? JSON.parse(r.discovery_log) : [],
    agentNote: r.agent_note ?? undefined,
    error: r.error ?? undefined,
    parentMonitorId: r.parent_monitor_id ?? undefined,
  };
}

function leadFromRow(r: LeadRow): DiscoveredLead {
  return {
    id: r.id,
    searchId: r.search_id,
    companyName: r.company_name,
    websiteUrl: r.website_url ?? undefined,
    linkedinUrl: r.linkedin_url ?? undefined,
    description: r.description ?? undefined,
    location: r.location ?? undefined,
    industry: r.industry ?? undefined,
    employeeRange: r.employee_range ?? undefined,
    matchReason: r.match_reason ?? undefined,
    sourceUrl: r.source_url ?? undefined,
    score: r.score ?? undefined,
    createdAt: r.created_at,
  };
}

export function createSearch(params: {
  mode: DiscoveryMode;
  name: string;
  queryText: string;
  seedCompanies?: string[];
  directoryConfig?: DirectoryConfig;
  maxResults: number;
  parentMonitorId?: string;
}): DiscoverySearch {
  const db = getDb();
  const id = uuidv4();
  const now = Date.now();
  db.prepare(
    `INSERT INTO discovery_searches (
      id, mode, name, query_text, seed_companies, directory_config, max_results, status,
      created_at, updated_at, parent_monitor_id
    ) VALUES (@id, @mode, @name, @queryText, @seedCompanies, @directoryConfig, @maxResults, 'queued',
              @now, @now, @parentMonitorId)`
  ).run({
    id,
    mode: params.mode,
    name: params.name,
    queryText: params.queryText,
    seedCompanies: params.seedCompanies?.length
      ? JSON.stringify(params.seedCompanies)
      : null,
    directoryConfig: params.directoryConfig
      ? JSON.stringify(params.directoryConfig)
      : null,
    maxResults: params.maxResults,
    parentMonitorId: params.parentMonitorId ?? null,
    now,
  });
  return getSearch(id)!;
}

export function getSearch(id: string): DiscoverySearch | undefined {
  const db = getDb();
  const row = db
    .prepare(`SELECT * FROM discovery_searches WHERE id = ?`)
    .get(id) as SearchRow | undefined;
  return row ? searchFromRow(row) : undefined;
}

export function listSearches(limit = 50): DiscoverySearch[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT * FROM discovery_searches ORDER BY created_at DESC LIMIT ?`
    )
    .all(limit) as SearchRow[];
  return rows.map(searchFromRow);
}

export function listSearchesByMonitor(
  monitorId: string,
  limit = 50
): DiscoverySearch[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT * FROM discovery_searches
         WHERE parent_monitor_id = ?
         ORDER BY created_at DESC LIMIT ?`
    )
    .all(monitorId, limit) as SearchRow[];
  return rows.map(searchFromRow);
}

export function listDomainsByMonitor(monitorId: string, limit = 500): string[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT DISTINCT dl.website_url AS url
         FROM discovered_leads dl
         JOIN discovery_searches ds ON ds.id = dl.search_id
         WHERE ds.parent_monitor_id = ?
           AND dl.website_url IS NOT NULL
         ORDER BY dl.created_at DESC
         LIMIT ?`
    )
    .all(monitorId, limit) as { url: string }[];
  const hosts = new Set<string>();
  for (const r of rows) {
    try {
      const host = new URL(r.url).hostname.replace(/^www\./, "").toLowerCase();
      if (host) hosts.add(host);
    } catch {
      // ignore malformed URLs
    }
  }
  return Array.from(hosts);
}

const SEARCH_FIELD_TO_COLUMN: Record<string, string> = {
  status: "status",
  startedAt: "started_at",
  completedAt: "completed_at",
  discoveredCount: "discovered_count",
  costUsd: "cost_usd",
  agentNote: "agent_note",
  error: "error",
};

export function updateSearch(id: string, partial: Partial<DiscoverySearch>): void {
  const db = getDb();
  const sets: string[] = [];
  const values: Record<string, unknown> = { id, updatedAt: Date.now() };
  for (const [key, value] of Object.entries(partial)) {
    if (key === "discoveryLog") {
      sets.push(`discovery_log = @discoveryLog`);
      values.discoveryLog = JSON.stringify(value ?? []);
      continue;
    }
    const col = SEARCH_FIELD_TO_COLUMN[key];
    if (!col) continue;
    sets.push(`${col} = @${key}`);
    values[key] = value ?? null;
  }
  if (sets.length === 0) {
    db.prepare(
      `UPDATE discovery_searches SET updated_at = @updatedAt WHERE id = @id`
    ).run(values);
    return;
  }
  db.prepare(
    `UPDATE discovery_searches SET ${sets.join(", ")}, updated_at = @updatedAt WHERE id = @id`
  ).run(values);
}

export function appendDiscoveryLog(searchId: string, line: string): void {
  const search = getSearch(searchId);
  if (!search) return;
  const log = [
    ...search.discoveryLog,
    `[${new Date().toISOString()}] ${line}`,
  ].slice(-200);
  updateSearch(searchId, { discoveryLog: log });
}

export function insertLead(params: {
  searchId: string;
  companyName: string;
  websiteUrl?: string;
  linkedinUrl?: string;
  description?: string;
  location?: string;
  industry?: string;
  employeeRange?: string;
  matchReason?: string;
  sourceUrl?: string;
  score?: number;
}): DiscoveredLead {
  const db = getDb();
  const id = uuidv4();
  const now = Date.now();
  db.prepare(
    `INSERT INTO discovered_leads (
      id, search_id, company_name, website_url, linkedin_url,
      description, location, industry, employee_range,
      match_reason, source_url, score, created_at
    ) VALUES (
      @id, @searchId, @companyName, @websiteUrl, @linkedinUrl,
      @description, @location, @industry, @employeeRange,
      @matchReason, @sourceUrl, @score, @now
    )`
  ).run({
    id,
    searchId: params.searchId,
    companyName: params.companyName,
    websiteUrl: params.websiteUrl ?? null,
    linkedinUrl: params.linkedinUrl ?? null,
    description: params.description ?? null,
    location: params.location ?? null,
    industry: params.industry ?? null,
    employeeRange: params.employeeRange ?? null,
    matchReason: params.matchReason ?? null,
    sourceUrl: params.sourceUrl ?? null,
    score: params.score ?? null,
    now,
  });
  const row = db
    .prepare(`SELECT * FROM discovered_leads WHERE id = ?`)
    .get(id) as LeadRow;
  return leadFromRow(row);
}

export function listLeadsBySearch(searchId: string): DiscoveredLead[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT * FROM discovered_leads WHERE search_id = ? ORDER BY
         CASE WHEN score IS NULL THEN 1 ELSE 0 END,
         score DESC,
         created_at ASC`
    )
    .all(searchId) as LeadRow[];
  return rows.map(leadFromRow);
}

export function listLeadsByIds(searchId: string, ids: string[]): DiscoveredLead[] {
  if (ids.length === 0) return [];
  const db = getDb();
  const placeholders = ids.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT * FROM discovered_leads WHERE search_id = ? AND id IN (${placeholders})`
    )
    .all(searchId, ...ids) as LeadRow[];
  return rows.map(leadFromRow);
}

type Globals = typeof globalThis & {
  __discoveryAborts?: Map<string, AbortController>;
};
const g = globalThis as Globals;
if (!g.__discoveryAborts) g.__discoveryAborts = new Map();

export function setSearchAbort(id: string, controller: AbortController): void {
  g.__discoveryAborts!.set(id, controller);
}

export function getSearchAbort(id: string): AbortController | undefined {
  return g.__discoveryAborts!.get(id);
}

export function clearSearchAbort(id: string): void {
  g.__discoveryAborts!.delete(id);
}
