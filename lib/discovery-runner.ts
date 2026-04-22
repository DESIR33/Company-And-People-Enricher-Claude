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
} from "./discovery-store";
import { capStatus, getCurrentUsage, recordUsage } from "./usage-store";

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
    const result = await discoverCompanies({
      mode: init.mode,
      queryText: init.queryText,
      seedCompanies: init.seedCompanies,
      signalConfig: opts.signalConfig,
      directoryConfig: init.directoryConfig,
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
