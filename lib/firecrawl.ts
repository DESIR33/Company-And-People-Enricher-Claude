// Thin Firecrawl API client. Gated on FIRECRAWL_API_KEY — every caller should
// check `isConfigured()` first and fall back to the Claude Agent SDK's built-in
// WebFetch/WebSearch if Firecrawl isn't available.
//
// Firecrawl shines where WebFetch struggles (JS-heavy directories, bot walls,
// aggressive rate limits). We use it as a pre-fetch layer ahead of the agent
// so the LLM works from cleaned markdown instead of blocked HTML.
//
// Docs: https://docs.firecrawl.dev/api-reference/introduction

const BASE_URL = process.env.FIRECRAWL_BASE_URL ?? "https://api.firecrawl.dev";
const DEFAULT_TIMEOUT_MS = 45_000;

export function isConfigured(): boolean {
  return !!process.env.FIRECRAWL_API_KEY;
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

async function post<T>(
  path: string,
  body: Record<string, unknown>,
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
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey()}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Firecrawl ${path} ${res.status}: ${text.slice(0, 300)}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
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

export async function search(
  query: string,
  opts: {
    limit?: number;
    scrapeMarkdown?: boolean;
    timeoutMs?: number;
    signal?: AbortSignal;
    tbs?: "qdr:d" | "qdr:w" | "qdr:m" | "qdr:y";
  } = {}
): Promise<FirecrawlSearchResult[]> {
  if (!isConfigured()) return [];
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
  return json.data ?? [];
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

export async function scrape(
  url: string,
  opts: {
    formats?: Array<"markdown" | "html" | "links">;
    onlyMainContent?: boolean;
    timeoutMs?: number;
    signal?: AbortSignal;
  } = {}
): Promise<FirecrawlScrapeResult | null> {
  if (!isConfigured()) return null;
  const body: Record<string, unknown> = {
    url,
    formats: opts.formats ?? ["markdown", "links"],
    onlyMainContent: opts.onlyMainContent ?? true,
  };
  const json = await post<ScrapeResponse>("/v1/scrape", body, {
    timeoutMs: opts.timeoutMs,
    signal: opts.signal,
  });
  if (!json.data) return null;
  return {
    url,
    markdown: json.data.markdown,
    html: json.data.html,
    metadata: json.data.metadata,
    links: json.data.links,
  };
}

// ---------- /v1/map ----------
// Returns all URLs discoverable under a site (via sitemap + HTML crawl).
// Useful when we have a directory root and want to enumerate company profile
// pages under it (e.g. chamber of commerce, state association member list).

export type FirecrawlMapResult = {
  url: string;
  links: string[];
};

type MapResponse = {
  success: boolean;
  links?: string[];
};

export async function map(
  url: string,
  opts: {
    search?: string;
    limit?: number;
    timeoutMs?: number;
    signal?: AbortSignal;
  } = {}
): Promise<FirecrawlMapResult | null> {
  if (!isConfigured()) return null;
  const body: Record<string, unknown> = { url };
  if (opts.search) body.search = opts.search;
  if (opts.limit !== undefined) body.limit = opts.limit;
  const json = await post<MapResponse>("/v1/map", body, {
    timeoutMs: opts.timeoutMs,
    signal: opts.signal,
  });
  if (!json.links) return null;
  return { url, links: json.links };
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
