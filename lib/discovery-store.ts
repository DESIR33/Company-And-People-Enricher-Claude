import { v4 as uuidv4 } from "uuid";
import { getDb } from "./db";

export type DiscoveryMode =
  | "icp"
  | "lookalike"
  | "signal_funding"
  | "signal_hiring"
  | "signal_news"
  | "signal_reviews"
  | "signal_new_business"
  | "signal_license"
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
  | "facebook_pages"
  | "firecrawl_search"
  | "osm_overpass"
  | "google_lsa"
  | "yellowpages"
  | "manta"
  | "houzz"
  | "nextdoor"
  | "opentable"
  | "tripadvisor"
  | "delivery_marketplace"
  | "state_license_board"
  | "state_sos"
  | "google_places"
  | "foursquare"
  | "bing_places"
  | "tomtom"
  | "here_places";

export type DirectoryConfig = {
  source: DirectorySource;
  category?: string;
  query?: string;
  geo?: string;
  url?: string;
  techStack?: string;
  batch?: string;
  // Geo precision (Phase 1.3). When `lat`/`lng` are set, the runner can fan a
  // single search out into multiple zip-scoped queries up to `radiusMiles`. If
  // `zips[]` is set explicitly, the fan-out uses that list verbatim. `msaCode`
  // (CBSA code, e.g. "19100" for DFW) expands to its constituent zips.
  lat?: number;
  lng?: number;
  radiusMiles?: number;
  zips?: string[];
  msaCode?: string;
  // For state-scoped directories (state_license_board, state_sos): two-letter
  // postal abbreviation, e.g. "CA", "TX".
  state?: string;
};

export type DiscoveryStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type DiscoverySearch = {
  id: string;
  workspaceId: string;
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
  webhookUrl?: string;
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
  // Phase 1.1: NAP + structured fields. Populated where the source provides
  // them (OSM Overpass, Yelp scrape, BBB profile, state filings) so the CRM
  // gets enrichment-grade data on first pass instead of needing a follow-up
  // multi-channel run.
  phone?: string;
  streetAddress?: string;
  city?: string;
  region?: string;
  postalCode?: string;
  countryCode?: string;
  lat?: number;
  lng?: number;
  placeId?: string;
  hours?: string;
  naicsCode?: string;
  licenseNumber?: string;
  firstSeenAt?: number;
};

type SearchRow = {
  id: string;
  workspace_id: string;
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
  webhook_url: string | null;
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
  phone: string | null;
  street_address: string | null;
  city: string | null;
  region: string | null;
  postal_code: string | null;
  country_code: string | null;
  lat: number | null;
  lng: number | null;
  place_id: string | null;
  hours: string | null;
  naics_code: string | null;
  license_number: string | null;
  first_seen_at: number | null;
  identity_key: string | null;
};

function searchFromRow(r: SearchRow): DiscoverySearch {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
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
    webhookUrl: r.webhook_url ?? undefined,
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
    phone: r.phone ?? undefined,
    streetAddress: r.street_address ?? undefined,
    city: r.city ?? undefined,
    region: r.region ?? undefined,
    postalCode: r.postal_code ?? undefined,
    countryCode: r.country_code ?? undefined,
    lat: r.lat ?? undefined,
    lng: r.lng ?? undefined,
    placeId: r.place_id ?? undefined,
    hours: r.hours ?? undefined,
    naicsCode: r.naics_code ?? undefined,
    licenseNumber: r.license_number ?? undefined,
    firstSeenAt: r.first_seen_at ?? undefined,
  };
}

// --------------------------------------------------------------------------
// Identity-based dedup (Phase 1.2)
// --------------------------------------------------------------------------
// SMB directories list the same business under different domains, different
// company-name spellings (LLC vs Inc vs DBA), or with no website at all. So
// dedup by website hostname alone collapses the wrong rows. The canonical key
// is "phone OR (address+name)" — both extremely stable identifiers — falling
// back to "domain" and finally "name". Whatever we pick, every row that maps
// to the same physical business gets the same key.
//
// Phone normalization: strip everything non-digit, drop a leading "1" so
// `+1 (404) 555-1234` and `4045551234` collapse. Address normalization:
// lowercase, strip suite/apt/unit/floor/#, collapse whitespace, drop trailing
// punctuation. Name normalization: lowercase, strip common entity suffixes
// (LLC, Inc, Co, Corp, Ltd) and punctuation.

const ENTITY_SUFFIXES_RE =
  /\s+(llc|l\.l\.c\.|inc|inc\.|incorporated|co|co\.|corp|corp\.|corporation|ltd|ltd\.|plc|pllc|pc|limited)$/i;

// Suite-style locator regex. Longer alternatives MUST come first so `floor`
// matches before `fl`, otherwise `fl` greedily consumes the `fl` prefix of
// `floor` and the trailing `oor 2` survives as an apparent unit number.
// Also strip leading street-direction tokens that appear after the keyword.
const SUITE_RE =
  /\b(apartment|suite|floor|ste|apt|unit|fl|#|no\.?)\s*[a-z0-9-]+\b/gi;

// Common abbreviation pairs we want to fold so "St" / "Street" / "Ave" /
// "Avenue" don't fingerprint as different addresses.
const STREET_ABBREV: Array<[RegExp, string]> = [
  [/\bstreet\b/gi, "st"],
  [/\bavenue\b/gi, "ave"],
  [/\bboulevard\b/gi, "blvd"],
  [/\bdrive\b/gi, "dr"],
  [/\broad\b/gi, "rd"],
  [/\bcourt\b/gi, "ct"],
  [/\bplace\b/gi, "pl"],
  [/\blane\b/gi, "ln"],
  [/\bhighway\b/gi, "hwy"],
];

export function normalizePhone(raw?: string): string | undefined {
  if (!raw) return undefined;
  const digits = raw.replace(/\D/g, "");
  if (!digits) return undefined;
  // Drop a leading 1 only if the result is 11 digits starting with 1
  // (US/CA NANP). Other 11-digit numbers (e.g. UK +44...) are kept as-is.
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  return digits;
}

export function normalizeAddress(raw?: string): string | undefined {
  if (!raw) return undefined;
  let s = raw.toLowerCase();
  for (const [re, sub] of STREET_ABBREV) s = s.replace(re, sub);
  return (
    s
      .replace(SUITE_RE, " ")
      .replace(/[.,]/g, " ")
      .replace(/\s+/g, " ")
      .trim() || undefined
  );
}

export function normalizeName(raw?: string): string | undefined {
  if (!raw) return undefined;
  return (
    raw
      .toLowerCase()
      .replace(ENTITY_SUFFIXES_RE, "")
      // Strip apostrophes and quotes BEFORE collapsing other punctuation to
      // spaces — otherwise "Joe's" turns into "joe s" instead of "joes".
      .replace(/['’`"]/g, "")
      .replace(/[^a-z0-9 ]+/g, " ")
      .replace(/\s+/g, " ")
      .trim() || undefined
  );
}

export function normalizeDomain(raw?: string): string | undefined {
  if (!raw) return undefined;
  try {
    return new URL(raw).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return undefined;
  }
}

export function canonicalLeadKey(input: {
  companyName?: string;
  websiteUrl?: string;
  phone?: string;
  streetAddress?: string;
  postalCode?: string;
}): string {
  const phone = normalizePhone(input.phone);
  if (phone) return `phone:${phone}`;
  const addr = normalizeAddress(input.streetAddress);
  const name = normalizeName(input.companyName);
  if (addr && name) return `addr:${name}|${addr}|${input.postalCode ?? ""}`;
  const dom = normalizeDomain(input.websiteUrl);
  if (dom) return `dom:${dom}`;
  if (name) return `name:${name}`;
  return `id:${uuidv4()}`;
}

export function createSearch(params: {
  workspaceId: string;
  mode: DiscoveryMode;
  name: string;
  queryText: string;
  seedCompanies?: string[];
  directoryConfig?: DirectoryConfig;
  maxResults: number;
  parentMonitorId?: string;
  webhookUrl?: string;
}): DiscoverySearch {
  const db = getDb();
  const id = uuidv4();
  const now = Date.now();
  db.prepare(
    `INSERT INTO discovery_searches (
      id, workspace_id, mode, name, query_text, seed_companies, directory_config, max_results, status,
      created_at, updated_at, parent_monitor_id, webhook_url
    ) VALUES (@id, @workspaceId, @mode, @name, @queryText, @seedCompanies, @directoryConfig, @maxResults, 'queued',
              @now, @now, @parentMonitorId, @webhookUrl)`
  ).run({
    id,
    workspaceId: params.workspaceId,
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
    webhookUrl: params.webhookUrl ?? null,
    now,
  });
  return getSearch(id)!;
}

export function listSearchesByWorkspace(
  workspaceId: string,
  limit = 50
): DiscoverySearch[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT * FROM discovery_searches
         WHERE workspace_id = ?
         ORDER BY created_at DESC LIMIT ?`
    )
    .all(workspaceId, limit) as SearchRow[];
  return rows.map(searchFromRow);
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
    const host = normalizeDomain(r.url);
    if (host) hosts.add(host);
  }
  return Array.from(hosts);
}

export type LeadIdentity = {
  domain?: string;
  phone?: string;
  identityKey?: string;
};

// Returns every distinct lead identity already discovered by this monitor's
// past runs. Used by signal-runner to build a comprehensive `excludeDomains`
// + `excludePhones` list for the agent prompt.
export function listIdentitiesByMonitor(
  monitorId: string,
  limit = 500
): LeadIdentity[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT DISTINCT dl.website_url AS url, dl.phone AS phone, dl.identity_key AS identity_key
         FROM discovered_leads dl
         JOIN discovery_searches ds ON ds.id = dl.search_id
         WHERE ds.parent_monitor_id = ?
         ORDER BY dl.created_at DESC
         LIMIT ?`
    )
    .all(monitorId, limit) as {
    url: string | null;
    phone: string | null;
    identity_key: string | null;
  }[];
  return rows.map((r) => ({
    domain: r.url ? normalizeDomain(r.url) : undefined,
    phone: r.phone ? normalizePhone(r.phone) : undefined,
    identityKey: r.identity_key ?? undefined,
  }));
}

const SEARCH_FIELD_TO_COLUMN: Record<string, string> = {
  status: "status",
  startedAt: "started_at",
  completedAt: "completed_at",
  discoveredCount: "discovered_count",
  costUsd: "cost_usd",
  agentNote: "agent_note",
  error: "error",
  webhookUrl: "webhook_url",
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

export type InsertLeadInput = {
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
  phone?: string;
  streetAddress?: string;
  city?: string;
  region?: string;
  postalCode?: string;
  countryCode?: string;
  lat?: number;
  lng?: number;
  placeId?: string;
  hours?: string;
  naicsCode?: string;
  licenseNumber?: string;
};

export type InsertLeadResult = {
  lead: DiscoveredLead;
  isNew: boolean;
};

// Upsert a lead by canonical identity. Identity dedup operates within the
// scope of a single search — two runs of the same monitor still see distinct
// rows so each run records what *it* found, but inside one search we fold
// duplicates so a Yelp scrape that lists "Joe's Plumbing" twice doesn't
// produce two leads. Cross-run dedup happens at the agent prompt level via
// listIdentitiesByMonitor.
export function insertLead(params: InsertLeadInput): InsertLeadResult {
  const db = getDb();
  const identityKey = canonicalLeadKey({
    companyName: params.companyName,
    websiteUrl: params.websiteUrl,
    phone: params.phone,
    streetAddress: params.streetAddress,
    postalCode: params.postalCode,
  });
  const phoneNorm = normalizePhone(params.phone);

  // Look for an existing lead in this search with the same identity. If
  // found, prefer to merge (fill nullable fields from the new payload) over
  // creating a duplicate row.
  const existing = db
    .prepare(
      `SELECT * FROM discovered_leads WHERE search_id = ? AND identity_key = ? LIMIT 1`
    )
    .get(params.searchId, identityKey) as LeadRow | undefined;

  if (existing) {
    const merged = mergeLeadFields(existing, params);
    db.prepare(
      `UPDATE discovered_leads SET
         website_url    = @websiteUrl,
         linkedin_url   = @linkedinUrl,
         description    = @description,
         location       = @location,
         industry       = @industry,
         employee_range = @employeeRange,
         match_reason   = @matchReason,
         source_url     = @sourceUrl,
         score          = @score,
         phone          = @phone,
         street_address = @streetAddress,
         city           = @city,
         region         = @region,
         postal_code    = @postalCode,
         country_code   = @countryCode,
         lat            = @lat,
         lng            = @lng,
         place_id       = @placeId,
         hours          = @hours,
         naics_code     = @naicsCode,
         license_number = @licenseNumber
       WHERE id = @id`
    ).run({
      id: existing.id,
      websiteUrl: merged.websiteUrl ?? null,
      linkedinUrl: merged.linkedinUrl ?? null,
      description: merged.description ?? null,
      location: merged.location ?? null,
      industry: merged.industry ?? null,
      employeeRange: merged.employeeRange ?? null,
      matchReason: merged.matchReason ?? null,
      sourceUrl: merged.sourceUrl ?? null,
      score: merged.score ?? null,
      phone: merged.phone ?? null,
      streetAddress: merged.streetAddress ?? null,
      city: merged.city ?? null,
      region: merged.region ?? null,
      postalCode: merged.postalCode ?? null,
      countryCode: merged.countryCode ?? null,
      lat: merged.lat ?? null,
      lng: merged.lng ?? null,
      placeId: merged.placeId ?? null,
      hours: merged.hours ?? null,
      naicsCode: merged.naicsCode ?? null,
      licenseNumber: merged.licenseNumber ?? null,
    });
    const row = db
      .prepare(`SELECT * FROM discovered_leads WHERE id = ?`)
      .get(existing.id) as LeadRow;
    return { lead: leadFromRow(row), isNew: false };
  }

  const id = uuidv4();
  const now = Date.now();
  db.prepare(
    `INSERT INTO discovered_leads (
      id, search_id, company_name, website_url, linkedin_url,
      description, location, industry, employee_range,
      match_reason, source_url, score, created_at,
      phone, street_address, city, region, postal_code, country_code,
      lat, lng, place_id, hours, naics_code, license_number,
      first_seen_at, identity_key
    ) VALUES (
      @id, @searchId, @companyName, @websiteUrl, @linkedinUrl,
      @description, @location, @industry, @employeeRange,
      @matchReason, @sourceUrl, @score, @now,
      @phone, @streetAddress, @city, @region, @postalCode, @countryCode,
      @lat, @lng, @placeId, @hours, @naicsCode, @licenseNumber,
      @now, @identityKey
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
    phone: phoneNorm ?? params.phone ?? null,
    streetAddress: params.streetAddress ?? null,
    city: params.city ?? null,
    region: params.region ?? null,
    postalCode: params.postalCode ?? null,
    countryCode: params.countryCode ?? null,
    lat: params.lat ?? null,
    lng: params.lng ?? null,
    placeId: params.placeId ?? null,
    hours: params.hours ?? null,
    naicsCode: params.naicsCode ?? null,
    licenseNumber: params.licenseNumber ?? null,
    identityKey,
    now,
  });
  const row = db
    .prepare(`SELECT * FROM discovered_leads WHERE id = ?`)
    .get(id) as LeadRow;
  return { lead: leadFromRow(row), isNew: true };
}

function mergeLeadFields(existing: LeadRow, incoming: InsertLeadInput) {
  const phoneNorm = normalizePhone(incoming.phone);
  const pick = <T,>(a: T | null | undefined, b: T | undefined): T | undefined =>
    a !== null && a !== undefined ? a : b;
  return {
    websiteUrl: pick(existing.website_url, incoming.websiteUrl),
    linkedinUrl: pick(existing.linkedin_url, incoming.linkedinUrl),
    description: pick(existing.description, incoming.description),
    location: pick(existing.location, incoming.location),
    industry: pick(existing.industry, incoming.industry),
    employeeRange: pick(existing.employee_range, incoming.employeeRange),
    matchReason: pick(existing.match_reason, incoming.matchReason),
    sourceUrl: pick(existing.source_url, incoming.sourceUrl),
    score:
      existing.score !== null && existing.score !== undefined
        ? Math.max(existing.score, incoming.score ?? 0)
        : incoming.score,
    phone: pick(existing.phone, phoneNorm ?? incoming.phone),
    streetAddress: pick(existing.street_address, incoming.streetAddress),
    city: pick(existing.city, incoming.city),
    region: pick(existing.region, incoming.region),
    postalCode: pick(existing.postal_code, incoming.postalCode),
    countryCode: pick(existing.country_code, incoming.countryCode),
    lat: pick(existing.lat, incoming.lat),
    lng: pick(existing.lng, incoming.lng),
    placeId: pick(existing.place_id, incoming.placeId),
    hours: pick(existing.hours, incoming.hours),
    naicsCode: pick(existing.naics_code, incoming.naicsCode),
    licenseNumber: pick(existing.license_number, incoming.licenseNumber),
  };
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
