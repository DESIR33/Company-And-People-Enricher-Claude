import { discoverCompanies, type SignalAgentConfig } from "./discovery-agent";
import {
  appendDiscoveryLog,
  clearSearchAbort,
  createSearch,
  getSearch,
  insertLead,
  setSearchAbort,
  updateSearch,
  type DirectoryConfig,
  type DiscoveryMode,
  type DirectorySource,
} from "./discovery-store";
import { capStatus, getCurrentUsage, recordUsage } from "./usage-store";
import * as firecrawl from "./firecrawl";

export type StartSearchResult =
  | { status: "started"; searchId: string }
  | { status: "cap_exceeded"; reason: string };

export async function executeSearch(
  searchId: string,
  opts: { signalConfig?: SignalAgentConfig } = {}
): Promise<void> {
  const init = getSearch(searchId);
  if (!init) return;

  const abort = new AbortController();
  setSearchAbort(searchId, abort);

  const startedAt = Date.now();
  updateSearch(searchId, { status: "running", startedAt });
  appendDiscoveryLog(searchId, `Search started (mode=${init.mode})`);

  let totalCost = 0;
  let discoveredCount = 0;

  try {
    const preFetched = await firecrawlPreFetch(init, abort.signal, (line) =>
      appendDiscoveryLog(searchId, line)
    );

    const result = await discoverCompanies({
      mode: init.mode,
      queryText: init.queryText,
      seedCompanies: init.seedCompanies,
      signalConfig: opts.signalConfig,
      directoryConfig: init.directoryConfig,
      preFetched,
      maxResults: init.maxResults,
      signal: abort.signal,
      onLog: (line) => appendDiscoveryLog(searchId, line),
    });
    totalCost = result.costUsd;

    for (const c of result.companies) {
      if (abort.signal.aborted) break;
      insertLead({
        searchId,
        companyName: c.companyName,
        websiteUrl: c.websiteUrl,
        linkedinUrl: c.linkedinUrl,
        description: c.description,
        location: c.location,
        industry: c.industry,
        employeeRange: c.employeeRange,
        matchReason: c.matchReason,
        sourceUrl: c.sourceUrl,
        score: c.score,
      });
      discoveredCount += 1;
    }

    const completedAt = Date.now();
    const status = abort.signal.aborted ? "cancelled" : "completed";
    updateSearch(searchId, {
      status,
      completedAt,
      discoveredCount,
      costUsd: totalCost,
      agentNote: result.note,
    });
    if (totalCost > 0) recordUsage(0, totalCost);

    appendDiscoveryLog(
      searchId,
      `Search ${status}: ${discoveredCount} candidate(s), $${totalCost.toFixed(4)}`
    );
  } catch (err) {
    updateSearch(searchId, {
      status: "failed",
      error: String(err),
      completedAt: Date.now(),
      costUsd: totalCost,
      discoveredCount,
    });
    appendDiscoveryLog(searchId, `Search failed: ${String(err)}`);
  } finally {
    clearSearchAbort(searchId);
  }
}

// --- Firecrawl pre-fetch ---------------------------------------------------
// Before the agent runs, we use Firecrawl (when configured) to pull clean
// markdown from the most useful starting URL for the search. The agent then
// works from that content instead of trying to WebFetch a JS-heavy page and
// getting blocked. If Firecrawl isn't configured or fails, we return `undefined`
// and the agent falls back to its built-in tools.

const MAX_PREFETCH_CHARS = 35_000;

type DiscoverySearchInit = ReturnType<typeof getSearch>;

async function firecrawlPreFetch(
  search: NonNullable<DiscoverySearchInit>,
  signal: AbortSignal,
  log: (line: string) => void
): Promise<string | undefined> {
  if (!firecrawl.isConfigured()) return undefined;

  try {
    if (search.mode === "icp") {
      log(`Firecrawl: searching for ICP candidates`);
      const results = await firecrawl.search(search.queryText, {
        limit: 8,
        scrapeMarkdown: true,
        signal,
      });
      if (results.length === 0) {
        log(`Firecrawl: search returned no results — agent will fall back to WebSearch`);
        return undefined;
      }
      log(`Firecrawl: pulled ${results.length} search result(s) with markdown`);
      return firecrawl.formatSearchResultsForPrompt(results, 3000).slice(0, MAX_PREFETCH_CHARS);
    }

    if (search.mode === "directory" && search.directoryConfig) {
      return await prefetchForDirectory(search.directoryConfig, signal, log);
    }

    if (
      search.mode === "signal_funding" ||
      search.mode === "signal_hiring" ||
      search.mode === "signal_news" ||
      search.mode === "signal_reviews"
    ) {
      // Signal runs get a Firecrawl search seeded from the rendered queryText
      // — the runner already encodes filters + timeframe in that text.
      log(`Firecrawl: searching for signal candidates`);
      const results = await firecrawl.search(search.queryText, {
        limit: 6,
        scrapeMarkdown: true,
        tbs: "qdr:m",
        signal,
      });
      if (results.length === 0) return undefined;
      log(`Firecrawl: pulled ${results.length} signal result(s)`);
      return firecrawl.formatSearchResultsForPrompt(results, 2500).slice(0, MAX_PREFETCH_CHARS);
    }
  } catch (err) {
    log(`Firecrawl pre-fetch failed: ${String(err)} — agent will fall back to WebFetch`);
    return undefined;
  }

  return undefined;
}

async function prefetchForDirectory(
  cfg: DirectoryConfig,
  signal: AbortSignal,
  log: (line: string) => void
): Promise<string | undefined> {
  const { source } = cfg;

  // For sources with a predictable public search URL, scrape it directly.
  const directUrl = buildDirectoryUrl(source, cfg);
  if (directUrl) {
    log(`Firecrawl: scraping ${directUrl}`);
    const scraped = await firecrawl.scrape(directUrl, {
      formats: ["markdown", "links"],
      onlyMainContent: true,
      signal,
    });
    if (scraped?.markdown) {
      const truncated = firecrawl.truncateMarkdown(scraped.markdown, MAX_PREFETCH_CHARS);
      log(`Firecrawl: scraped ${scraped.markdown.length} chars of markdown from ${directUrl}`);
      return `### Source: ${directUrl}\n\n${truncated}`;
    }
    log(`Firecrawl: scrape returned no markdown for ${directUrl}`);
  }

  // For firecrawl_search and tech_stack, use /search to gather listicles and
  // vendor pages the agent would otherwise hunt for.
  if (source === "firecrawl_search" || source === "tech_stack") {
    const query = buildSearchQuery(cfg);
    if (!query) return undefined;
    log(`Firecrawl: searching "${query}"`);
    const results = await firecrawl.search(query, {
      limit: 10,
      scrapeMarkdown: true,
      signal,
    });
    if (results.length === 0) return undefined;
    log(`Firecrawl: pulled ${results.length} result(s)`);
    return firecrawl.formatSearchResultsForPrompt(results, 2500).slice(0, MAX_PREFETCH_CHARS);
  }

  return undefined;
}

function buildDirectoryUrl(
  source: DirectorySource,
  cfg: DirectoryConfig
): string | undefined {
  const q = (s: string) => encodeURIComponent(s);
  switch (source) {
    case "custom":
      return cfg.url;
    case "yelp":
      if (!cfg.category && !cfg.query) return undefined;
      return `https://www.yelp.com/search?find_desc=${q(cfg.category ?? cfg.query ?? "")}${cfg.geo ? `&find_loc=${q(cfg.geo)}` : ""}`;
    case "bbb":
      if (!cfg.category && !cfg.query) return undefined;
      return `https://www.bbb.org/search?find_country=USA&find_text=${q(cfg.category ?? cfg.query ?? "")}${cfg.geo ? `&find_loc=${q(cfg.geo)}` : ""}`;
    case "angi":
      if (!cfg.category && !cfg.query) return undefined;
      // Angi's category search is the most stable of the three.
      return `https://www.angi.com/companylist.htm?searchtext=${q(cfg.category ?? cfg.query ?? "")}${cfg.geo ? `&geolocation=${q(cfg.geo)}` : ""}`;
    case "google_maps":
      if (!cfg.category && !cfg.query) return undefined;
      return `https://www.google.com/maps/search/${q(`${cfg.category ?? cfg.query} in ${cfg.geo ?? ""}`)}`;
    case "yc":
      return `https://www.ycombinator.com/companies${cfg.batch ? `?batch=${q(cfg.batch)}` : ""}`;
    case "producthunt":
      return cfg.category
        ? `https://www.producthunt.com/topics/${q(cfg.category)}`
        : "https://www.producthunt.com";
    case "github":
      return cfg.category
        ? `https://github.com/topics/${q(cfg.category)}`
        : undefined;
    case "facebook_pages":
    case "tech_stack":
    case "firecrawl_search":
      return undefined;
  }
}

function buildSearchQuery(cfg: DirectoryConfig): string | undefined {
  if (cfg.source === "firecrawl_search") {
    return cfg.query ?? cfg.category;
  }
  if (cfg.source === "tech_stack") {
    const tech = cfg.techStack ?? cfg.query;
    if (!tech) return undefined;
    const geo = cfg.geo ? ` ${cfg.geo}` : "";
    return `"${tech}" customers OR "case study"${geo}`;
  }
  return undefined;
}

export function startSearch(params: {
  mode: DiscoveryMode;
  name: string;
  queryText: string;
  seedCompanies?: string[];
  directoryConfig?: DirectoryConfig;
  maxResults: number;
}): StartSearchResult {
  const usage = getCurrentUsage();
  const caps = capStatus(usage);
  if (caps.exceeded) {
    return {
      status: "cap_exceeded",
      reason: `Monthly cap reached ($${usage.costUsd.toFixed(2)}/$${caps.costCap} spend). Discovery also burns budget via web search — bump MONITOR_MONTHLY_COST_CAP to continue.`,
    };
  }

  const search = createSearch({
    mode: params.mode,
    name: params.name,
    queryText: params.queryText,
    seedCompanies: params.seedCompanies,
    directoryConfig: params.directoryConfig,
    maxResults: params.maxResults,
  });

  void executeSearch(search.id).catch((err) => {
    updateSearch(search.id, {
      status: "failed",
      error: String(err),
      completedAt: Date.now(),
    });
  });

  return { status: "started", searchId: search.id };
}
