import type { SignalAgentConfig } from "./discovery-agent";
import {
  createSearch,
  getSearch,
  listDomainsByMonitor,
  type DiscoveryMode,
} from "./discovery-store";
import { executeSearch } from "./discovery-runner";
import { computeNextRunAt } from "./monitor-scheduler";
import {
  getSignalMonitor,
  incrementSignalMonitorTotals,
  updateSignalMonitor,
  type SignalConfig,
  type SignalMonitor,
  type SignalType,
} from "./signal-store";
import { capStatus, getCurrentUsage } from "./usage-store";

const MODE_BY_SIGNAL: Record<SignalType, DiscoveryMode> = {
  funding: "signal_funding",
  hiring: "signal_hiring",
  news: "signal_news",
};

export type StartSignalRunResult =
  | { status: "started"; searchId: string }
  | { status: "cap_exceeded"; reason: string }
  | { status: "not_found"; reason: string };

function buildAgentConfig(
  monitor: SignalMonitor,
  excludeDomains: string[]
): SignalAgentConfig {
  const c: SignalConfig = monitor.config;
  return {
    signalType: monitor.signalType,
    timeframe: monitor.timeframe,
    industryFilter: c.industryFilter,
    geoFilter: c.geoFilter,
    sizeFilter: c.sizeFilter,
    stageFilter: c.stageFilter,
    minAmount: c.minAmount,
    maxAmount: c.maxAmount,
    roles: c.roles,
    keywords: c.keywords,
    excludeDomains,
  };
}

function buildQueryText(monitor: SignalMonitor): string {
  const { config, signalType, timeframe } = monitor;
  const bits: string[] = [];
  bits.push(`Signal type: ${signalType}`);
  bits.push(`Timeframe: ${timeframe}`);
  if (config.industryFilter) bits.push(`Industry: ${config.industryFilter}`);
  if (config.geoFilter) bits.push(`Geography: ${config.geoFilter}`);
  if (config.sizeFilter) bits.push(`Size: ${config.sizeFilter}`);
  if (signalType === "funding") {
    if (config.stageFilter?.length)
      bits.push(`Stages: ${config.stageFilter.join(", ")}`);
    if (config.minAmount !== undefined)
      bits.push(`Min raise: $${config.minAmount.toLocaleString()}`);
    if (config.maxAmount !== undefined)
      bits.push(`Max raise: $${config.maxAmount.toLocaleString()}`);
  }
  if (signalType === "hiring" && config.roles?.length) {
    bits.push(`Roles: ${config.roles.join(", ")}`);
  }
  if (signalType === "news" && config.keywords?.length) {
    bits.push(`Keywords: ${config.keywords.join(", ")}`);
  }
  if (config.icpHint) bits.push(`ICP hint: ${config.icpHint}`);
  return bits.join(" · ");
}

async function runSignalSearch(
  monitor: SignalMonitor,
  searchId: string
): Promise<void> {
  const agentConfig = buildAgentConfig(
    monitor,
    listDomainsByMonitor(monitor.id, 500)
  );

  try {
    await executeSearch(searchId, { signalConfig: agentConfig });
  } finally {
    const finalSearch = getSearch(searchId);
    const finishedAt = finalSearch?.completedAt ?? Date.now();
    const leadDelta = finalSearch?.discoveredCount ?? 0;
    const costDelta = finalSearch?.costUsd ?? 0;
    incrementSignalMonitorTotals(monitor.id, leadDelta, costDelta, finishedAt);

    const next = computeNextRunAt(monitor.schedule, finishedAt);
    if (
      next &&
      monitor.active &&
      monitor.schedule !== "manual" &&
      monitor.schedule !== "once"
    ) {
      updateSignalMonitor(monitor.id, {
        nextRunAt: next,
        lastRunAt: finishedAt,
      });
    } else if (monitor.schedule === "once") {
      updateSignalMonitor(monitor.id, {
        active: false,
        nextRunAt: undefined,
        lastRunAt: finishedAt,
      });
    } else {
      updateSignalMonitor(monitor.id, { lastRunAt: finishedAt });
    }
  }
}

export function startSignalMonitorRun(params: {
  monitorId: string;
  trigger: "manual" | "schedule" | "create";
}): StartSignalRunResult {
  const monitor = getSignalMonitor(params.monitorId);
  if (!monitor) {
    return { status: "not_found", reason: "Signal monitor not found" };
  }

  const usage = getCurrentUsage();
  const caps = capStatus(usage);
  if (caps.exceeded) {
    return {
      status: "cap_exceeded",
      reason: `Monthly cap reached ($${usage.costUsd.toFixed(2)}/$${caps.costCap} spend). Signal monitors also burn web-search budget — bump MONITOR_MONTHLY_COST_CAP to continue.`,
    };
  }

  const search = createSearch({
    mode: MODE_BY_SIGNAL[monitor.signalType],
    name: `${monitor.name} — ${new Date().toISOString().slice(0, 10)}`,
    queryText: buildQueryText(monitor),
    maxResults: monitor.maxResults,
    parentMonitorId: monitor.id,
  });

  void runSignalSearch(monitor, search.id).catch((err) => {
    console.error(`signal-runner failed for monitor ${monitor.id}:`, err);
  });

  return { status: "started", searchId: search.id };
}
