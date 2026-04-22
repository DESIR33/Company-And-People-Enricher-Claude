// Thin Firecrawl API client. Gated on FIRECRAWL_API_KEY — every caller should
// check `isConfigured()` first and fall back to the Claude Agent SDK's built-in
// WebFetch/WebSearch if Firecrawl isn't available.
//
// Firecrawl shines where WebFetch struggles (JS-heavy directories, bot walls,
// aggressive rate limits). We use it two ways:
//   1. As a pre-fetch layer ahead of the agent so the LLM works from cleaned
//      markdown instead of blocked HTML (search + scrape + map).
//   2. As a deterministic structured-extraction path that skips the agent
//      entirely for pure structured field pulls (extract). Structured extract
//      is cheaper per row and has no LLM drift — the tradeoff is no web
//      reasoning, so it's only appropriate when all requested fields are
//      present on a single known URL.
//
// Each public function returns the data plus `credits` + `costUsd` so callers
// can roll Firecrawl spend into their own cost totals. Credit-to-USD
// conversion is configurable via FIRECRAWL_CREDIT_USD (defaults to $0.001,
// roughly the Hobby/Standard-plan rate).
//
// Docs: https://docs.firecrawl.dev/api-reference/introduction

const BASE_URL = process.env.FIRECRAWL_BASE_URL ?? "https://api.firecrawl.dev";
const DEFAULT_TIMEOUT_MS = 45_000;

// Credits charged per operation, by type. Firecrawl's public pricing is
// 1 credit per scraped page / search result, 1 credit per /map call up to
// 5000 URLs, and 5 credits per /extract URL. Kept as constants so cost
// tracking stays in one place.
export const CREDITS = {
  scrape: 1,
  searchBase: 1, // charged once per /search call
  searchResultScraped: 1, // additional credit per scraped result
  map: 1,
  extractPerUrl: 5,
} as const;

export function isConfigured(): boolean {
  return !!process.env.FIRECRAWL_API_KEY;
}

export function creditCostUsd(): number {
  const raw = process.env.FIRECRAWL_CREDIT_USD;
  const n = raw ? Number(raw) : 0.001;
  return Number.isFinite(n) && n > 0 ? n : 0.001;
}

function costFor(credits: number): number {
  return credits * creditCostUsd();
}

function apiKey(): string {
  const key = process.env.FIRECRAWL_API_KEY;
  if (!key) throw new Error("FIRECRAWL_API_KEY is not set");
  return key;
}

type RequestOpts = {
  signal?: AbortSignal;
  timeoutMs?: number;
};

async function request<T>(
  method: "GET" | "POST",
  path: string,
  body: Record<string, unknown> | undefined,
  opts: RequestOpts = {}
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  );
  if (opts.signal) {
    if (opts.signal.aborted) controller.abort();
    else opts.signal.addEventListener("abort", () => controller.abort(), { once: true });
  }
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey()}`,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Firecrawl ${method} ${path} ${res.status}: ${text.slice(0, 300)}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
}

function post<T>(path: string, body: Record<string, unknown>, opts: RequestOpts = {}): Promise<T> {
  return request<T>("POST", path, body, opts);
}

function get<T>(path: string, opts: RequestOpts = {}): Promise<T> {
  return request<T>("GET", path, undefined, opts);
}

export type FirecrawlCost = { credits: number; costUsd: number };

function emptyCost(): FirecrawlCost {
  return { credits: 0, costUsd: 0 };
}

// ---------- /v1/search ----------

export type FirecrawlSearchResult = {
  url: string;
  title?: string;
  description?: string;
  markdown?: string;
  html?: string;
};

type SearchResponse = {
  success: boolean;
  data?: FirecrawlSearchResult[];
  warning?: string;
};

export type SearchOutcome = {
  results: FirecrawlSearchResult[];
  cost: FirecrawlCost;
};

export async function search(
  query: string,
  opts: {
    limit?: number;
    scrapeMarkdown?: boolean;
    timeoutMs?: number;
    signal?: AbortSignal;
    tbs?: "qdr:d" | "qdr:w" | "qdr:m" | "qdr:y";
  } = {}
): Promise<SearchOutcome> {
  if (!isConfigured()) return { results: [], cost: emptyCost() };
  const body: Record<string, unknown> = {
    query,
    limit: opts.limit ?? 10,
  };
  if (opts.scrapeMarkdown) {
    body.scrapeOptions = { formats: ["markdown"], onlyMainContent: true };
  }
  if (opts.tbs) body.tbs = opts.tbs;
  const json = await post<SearchResponse>("/v1/search", body, {
    timeoutMs: opts.timeoutMs,
    signal: opts.signal,
  });
  const results = json.data ?? [];
  const credits =
    CREDITS.searchBase + (opts.scrapeMarkdown ? results.length * CREDITS.searchResultScraped : 0);
  return { results, cost: { credits, costUsd: costFor(credits) } };
}

// ---------- /v1/scrape ----------

export type FirecrawlScrapeResult = {
  url: string;
  markdown?: string;
  html?: string;
  metadata?: Record<string, unknown>;
  links?: string[];
};

type ScrapeResponse = {
  success: boolean;
  data?: {
    markdown?: string;
    html?: string;
    metadata?: Record<string, unknown>;
    links?: string[];
  };
  warning?: string;
};

export type ScrapeOutcome = {
  result: FirecrawlScrapeResult | null;
  cost: FirecrawlCost;
};

export async function scrape(
  url: string,
  opts: {
    formats?: Array<"markdown" | "html" | "links">;
    onlyMainContent?: boolean;
    timeoutMs?: number;
    signal?: AbortSignal;
  } = {}
): Promise<ScrapeOutcome> {
  if (!isConfigured()) return { result: null, cost: emptyCost() };
  const body: Record<string, unknown> = {
    url,
    formats: opts.formats ?? ["markdown", "links"],
    onlyMainContent: opts.onlyMainContent ?? true,
  };
  const json = await post<ScrapeResponse>("/v1/scrape", body, {
    timeoutMs: opts.timeoutMs,
    signal: opts.signal,
  });
  const credits = CREDITS.scrape;
  const cost: FirecrawlCost = { credits, costUsd: costFor(credits) };
  if (!json.data) return { result: null, cost };
  return {
    result: {
      url,
      markdown: json.data.markdown,
      html: json.data.html,
      metadata: json.data.metadata,
      links: json.data.links,
    },
    cost,
  };
}

// ---------- /v1/map ----------
// Returns all URLs discoverable under a site (via sitemap + HTML crawl).
// Useful when we have a directory root and want to enumerate company profile
// pages under it (e.g. chamber of commerce, state association member list).
// Firecrawl bills /v1/map as 1 credit regardless of URL count.

export type FirecrawlMapResult = {
  url: string;
  links: string[];
};

type MapResponse = {
  success: boolean;
  links?: string[];
};

export type MapOutcome = {
  result: FirecrawlMapResult | null;
  cost: FirecrawlCost;
};

export async function map(
  url: string,
  opts: {
    search?: string;
    limit?: number;
    timeoutMs?: number;
    signal?: AbortSignal;
  } = {}
): Promise<MapOutcome> {
  if (!isConfigured()) return { result: null, cost: emptyCost() };
  const body: Record<string, unknown> = { url };
  if (opts.search) body.search = opts.search;
  if (opts.limit !== undefined) body.limit = opts.limit;
  const json = await post<MapResponse>("/v1/map", body, {
    timeoutMs: opts.timeoutMs,
    signal: opts.signal,
  });
  const credits = CREDITS.map;
  const cost: FirecrawlCost = { credits, costUsd: costFor(credits) };
  if (!json.links) return { result: null, cost };
  return { result: { url, links: json.links }, cost };
}

// ---------- /v1/extract ----------
// Structured JSON extraction across one or more URLs. Firecrawl fetches each
// URL, runs an internal LLM pass against the supplied JSON schema, and returns
// a single JSON object conforming to the schema. Bills 5 credits per URL.
//
// /v1/extract is asynchronous: POST returns a job ID, then we poll
// /v1/extract/:id until status === "completed". Polling gives up after
// `timeoutMs` and returns null; the caller should fall back to the agent
// path in that case.

export type ExtractJsonSchema = {
  type: "object";
  properties: Record<string, { type: string; description?: string; enum?: unknown[] }>;
  required?: string[];
};

type ExtractStartResponse = {
  success: boolean;
  id?: string;
  // Some Firecrawl deployments return the data synchronously for single-URL
  // extracts — handle that shape too.
  data?: unknown;
  status?: string;
};

type ExtractStatusResponse = {
  success: boolean;
  status?: "pending" | "processing" | "completed" | "failed" | "cancelled";
  data?: unknown;
  error?: string;
};

export type ExtractOutcome = {
  data: Record<string, unknown> | null;
  cost: FirecrawlCost;
};

const EXTRACT_POLL_INTERVAL_MS = 1500;
const EXTRACT_DEFAULT_POLL_TIMEOUT_MS = 60_000;

export async function extract(
  urls: string | string[],
  schema: ExtractJsonSchema,
  opts: {
    prompt?: string;
    pollTimeoutMs?: number;
    signal?: AbortSignal;
  } = {}
): Promise<ExtractOutcome> {
  const urlList = Array.isArray(urls) ? urls : [urls];
  if (urlList.length === 0) return { data: null, cost: emptyCost() };
  const credits = CREDITS.extractPerUrl * urlList.length;
  const cost: FirecrawlCost = { credits, costUsd: costFor(credits) };
  if (!isConfigured()) return { data: null, cost: emptyCost() };

  const body: Record<string, unknown> = {
    urls: urlList,
    schema,
  };
  if (opts.prompt) body.prompt = opts.prompt;

  const start = await post<ExtractStartResponse>("/v1/extract", body, {
    timeoutMs: 20_000,
    signal: opts.signal,
  });

  // Synchronous completion path (Firecrawl returns data immediately for some
  // single-URL extracts).
  if (start.data !== undefined && (!start.status || start.status === "completed")) {
    return { data: asRecord(start.data), cost };
  }

  if (!start.id) return { data: null, cost };

  const deadline = Date.now() + (opts.pollTimeoutMs ?? EXTRACT_DEFAULT_POLL_TIMEOUT_MS);
  while (Date.now() < deadline) {
    if (opts.signal?.aborted) return { data: null, cost };
    await sleep(EXTRACT_POLL_INTERVAL_MS, opts.signal);
    const status = await get<ExtractStatusResponse>(`/v1/extract/${start.id}`, {
      timeoutMs: 15_000,
      signal: opts.signal,
    });
    if (status.status === "completed") return { data: asRecord(status.data), cost };
    if (status.status === "failed" || status.status === "cancelled") {
      return { data: null, cost };
    }
  }
  // Timed out waiting for the async job. Caller will fall back.
  return { data: null, cost };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

// ---------- helpers ----------

export function truncateMarkdown(md: string | undefined, maxChars: number): string {
  if (!md) return "";
  if (md.length <= maxChars) return md;
  return md.slice(0, maxChars) + `\n\n…[truncated, ${md.length - maxChars} chars omitted]`;
}

export function formatSearchResultsForPrompt(
  results: FirecrawlSearchResult[],
  maxCharsPerResult = 1500
): string {
  if (results.length === 0) return "";
  const blocks = results.map((r, i) => {
    const header = `### ${i + 1}. ${r.title ?? r.url}\nURL: ${r.url}${r.description ? `\nDescription: ${r.description}` : ""}`;
    const body = r.markdown ? `\n\n${truncateMarkdown(r.markdown, maxCharsPerResult)}` : "";
    return `${header}${body}`;
  });
  return blocks.join("\n\n---\n\n");
}
