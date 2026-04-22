import { enrichWithAgent } from "./agent";
import { discoverEngagers } from "./monitor-agent";
import {
  appendDiscoveryLog,
  clearRunAbort,
  createRun,
  getMonitor,
  getRun,
  incrementMonitorTotals,
  listPendingLeadsByRun,
  setRunAbort,
  updateLead,
  updateMonitor,
  updateRun,
  upsertLead,
  type ManualEngagerInput,
  type Monitor,
  type MonitorLead,
  type MonitorRun,
} from "./monitor-store";
import { computeNextRunAt } from "./monitor-scheduler";
import { capStatus, getCurrentUsage, recordUsage } from "./usage-store";

const ENRICHMENT_CONCURRENCY = 10;
const AWAITING_APPROVAL_THRESHOLD = 1000;

export type StartRunResult =
  | { status: "started"; runId: string }
  | { status: "awaiting_approval"; runId: string; estimatedLeads: number }
  | { status: "cap_exceeded"; reason: string };

export async function executeRun(runId: string): Promise<void> {
  const runInit = getRun(runId);
  if (!runInit) return;
  const monitor = getMonitor(runInit.monitorId);
  if (!monitor) {
    updateRun(runId, {
      status: "failed",
      error: "Monitor not found",
      completedAt: Date.now(),
    });
    return;
  }

  const abort = new AbortController();
  setRunAbort(runId, abort);

  const startedAt = Date.now();
  updateRun(runId, { status: "running", startedAt });
  appendDiscoveryLog(runId, `Run started (trigger=${runInit.trigger})`);

  let totalCost = 0;
  let discoveredCount = 0;
  let newCount = 0;
  let dedupCount = 0;
  let enrichedCount = 0;

  try {
    // --------- 1. Discovery ---------
    const manualEngagers = extractManualEngagers(monitor);
    if (manualEngagers.length > 0) {
      appendDiscoveryLog(runId, `Using ${manualEngagers.length} manual engager(s)`);
    }

    const skipAgentDiscovery =
      manualEngagers.length > 0 && monitor.mode !== "keyword" && monitor.mode !== "profile";

    let agentEngagers: Array<{
      linkedinUrl: string;
      name?: string;
      engagementType?: string;
      engagementText?: string;
      postUrl?: string;
    }> = [];

    if (!skipAgentDiscovery) {
      const discovery = await discoverEngagers({
        mode: monitor.mode,
        config: monitor.config,
        signal: abort.signal,
        onLog: (line) => appendDiscoveryLog(runId, line),
      });
      totalCost += discovery.costUsd;
      agentEngagers = discovery.engagers;
    }

    const combined = [...manualEngagers, ...agentEngagers];
    discoveredCount = combined.length;
    appendDiscoveryLog(runId, `Total discovered: ${discoveredCount}`);
    updateRun(runId, { discoveredCount, costUsd: totalCost });

    // --------- 2. Dedup + persist leads ---------
    const leadsToEnrich: MonitorLead[] = [];
    for (const engager of combined) {
      if (abort.signal.aborted) break;
      const { lead, isNew } = upsertLead({
        monitorId: monitor.id,
        runId,
        linkedinUrl: engager.linkedinUrl,
        profileName: engager.name,
        engagementType: engager.engagementType,
        engagementText: engager.engagementText,
        postUrl: engager.postUrl ?? firstPostUrl(monitor),
      });
      if (isNew) {
        newCount += 1;
        leadsToEnrich.push(lead);
      } else {
        dedupCount += 1;
      }
    }
    appendDiscoveryLog(
      runId,
      `Deduplicated: ${dedupCount} already seen, ${newCount} new`
    );
    updateRun(runId, { newCount, dedupCount });

    // --------- 3. Enrich in parallel ---------
    const pending = listPendingLeadsByRun(runId);
    appendDiscoveryLog(runId, `Enriching ${pending.length} lead(s)`);

    let nextIndex = 0;
    const worker = async () => {
      while (true) {
        if (abort.signal.aborted) return;
        const i = nextIndex++;
        const lead = pending[i];
        if (!lead) return;

        updateLead(lead.id, { enrichmentStatus: "processing" });
        try {
          const res = await enrichWithAgent({
            type: "people",
            identifier: lead.linkedinUrl,
            requestedFields: monitor.requestedFields,
            customFieldDefs: monitor.customFieldDefs,
            outreachContext: buildOutreachContext(monitor, lead),
            signal: abort.signal,
          });
          totalCost += res.costUsd;
          enrichedCount += 1;
          updateLead(lead.id, {
            enrichmentStatus: "done",
            enrichedData: res.fields,
            costUsd: res.costUsd,
          });

          if (monitor.webhookUrl) {
            const ok = await deliverWebhook(monitor.webhookUrl, {
              monitorId: monitor.id,
              runId,
              linkedinUrl: lead.linkedinUrl,
              profileName: lead.profileName,
              engagementType: lead.engagementType,
              engagementText: lead.engagementText,
              postUrl: lead.postUrl,
              enriched: res.fields,
            });
            updateLead(lead.id, { webhookStatus: ok ? "delivered" : "failed" });
          }
        } catch (err) {
          updateLead(lead.id, {
            enrichmentStatus: "error",
            enrichmentError: String(err),
          });
        } finally {
          updateRun(runId, {
            enrichedCount,
            costUsd: totalCost,
          });
        }
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(ENRICHMENT_CONCURRENCY, pending.length || 1) }, worker)
    );

    // --------- 4. Finalise ---------
    const completedAt = Date.now();
    const status = abort.signal.aborted ? "cancelled" : "completed";
    updateRun(runId, {
      status,
      completedAt,
      enrichedCount,
      costUsd: totalCost,
    });
    incrementMonitorTotals(monitor.id, newCount, totalCost, completedAt);
    if (newCount > 0 || totalCost > 0) recordUsage(newCount, totalCost);

    // Reschedule
    const next = computeNextRunAt(monitor.schedule, completedAt);
    if (next && monitor.active && monitor.schedule !== "manual" && monitor.schedule !== "once") {
      updateMonitor(monitor.id, { nextRunAt: next, lastRunAt: completedAt });
    } else if (monitor.schedule === "once") {
      updateMonitor(monitor.id, {
        active: false,
        nextRunAt: undefined,
        lastRunAt: completedAt,
      });
    } else {
      updateMonitor(monitor.id, { lastRunAt: completedAt });
    }

    appendDiscoveryLog(
      runId,
      `Run ${status}: ${newCount} new, ${dedupCount} dedup, ${enrichedCount} enriched, $${totalCost.toFixed(4)}`
    );
  } catch (err) {
    updateRun(runId, {
      status: "failed",
      error: String(err),
      completedAt: Date.now(),
      costUsd: totalCost,
    });
    appendDiscoveryLog(runId, `Run failed: ${String(err)}`);
  } finally {
    clearRunAbort(runId);
  }
}

function extractManualEngagers(monitor: Monitor): ManualEngagerInput[] {
  if (!monitor.manualEngagers?.length) return [];
  return monitor.manualEngagers
    .map((e) => ({
      linkedinUrl: e.linkedinUrl.trim(),
      name: e.name?.trim() || undefined,
      engagementType: e.engagementType?.trim() || undefined,
      engagementText: e.engagementText?.trim() || undefined,
      postUrl: e.postUrl?.trim() || undefined,
    }))
    .filter((e) => e.linkedinUrl.length > 0);
}

function firstPostUrl(monitor: Monitor): string | undefined {
  if (monitor.config.postUrls?.length) return monitor.config.postUrls[0];
  return undefined;
}

function buildOutreachContext(monitor: Monitor, lead: MonitorLead): string | undefined {
  const parts: string[] = [];
  if (monitor.outreachContext?.trim()) parts.push(monitor.outreachContext.trim());
  if (lead.postUrl) parts.push(`Context: they engaged with this LinkedIn post — ${lead.postUrl}.`);
  if (lead.engagementType) {
    const kind =
      lead.engagementType === "comment"
        ? `commented on the post${lead.engagementText ? ` with: "${lead.engagementText.slice(0, 200)}"` : ""}`
        : `${lead.engagementType}d the post`;
    parts.push(`They ${kind}.`);
  }
  if (monitor.mode === "keyword" && monitor.config.keywords?.length) {
    parts.push(`The post was about: ${monitor.config.keywords.join(", ")}.`);
  }
  const text = parts.join(" ");
  return text.length > 0 ? text : undefined;
}

async function deliverWebhook(
  url: string,
  payload: Record<string, unknown>
): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ----------- entry point for kicking off a run -----------

export function estimateLeadCount(monitor: Monitor): number {
  const manual = monitor.manualEngagers?.length ?? 0;
  if (monitor.mode === "instant" || monitor.mode === "post") {
    const posts = monitor.config.postUrls?.length ?? 0;
    return Math.max(manual, posts * 40);
  }
  if (monitor.mode === "profile") return Math.max(manual, 50);
  if (monitor.mode === "keyword") {
    const k = monitor.config.keywords?.length ?? 0;
    return Math.max(manual, k * 25);
  }
  return manual;
}

export function startMonitorRun(params: {
  monitorId: string;
  trigger: "manual" | "schedule" | "create";
  forceApproved?: boolean;
}): StartRunResult {
  const monitor = getMonitor(params.monitorId);
  if (!monitor) return { status: "cap_exceeded", reason: "Monitor not found" };

  const usage = getCurrentUsage();
  const caps = capStatus(usage);
  if (caps.exceeded) {
    return {
      status: "cap_exceeded",
      reason: `Monthly cap reached (${usage.leadCount}/${caps.leadCap} leads, $${usage.costUsd.toFixed(2)}/$${caps.costCap} spend).`,
    };
  }

  const estimatedLeads = estimateLeadCount(monitor);
  const needsApproval =
    !params.forceApproved &&
    estimatedLeads >= AWAITING_APPROVAL_THRESHOLD &&
    params.trigger !== "manual";

  if (needsApproval) {
    const run = requireQueuedRun(params, monitor.id, estimatedLeads, "awaiting_approval");
    return { status: "awaiting_approval", runId: run.id, estimatedLeads };
  }

  const run = requireQueuedRun(params, monitor.id, estimatedLeads, "queued");

  void executeRun(run.id).catch((err) => {
    updateRun(run.id, {
      status: "failed",
      error: String(err),
      completedAt: Date.now(),
    });
  });

  return { status: "started", runId: run.id };
}

function requireQueuedRun(
  params: { monitorId: string; trigger: "manual" | "schedule" | "create" },
  monitorId: string,
  estimatedLeads: number,
  status: "queued" | "awaiting_approval"
): MonitorRun {
  return createRun({
    monitorId,
    trigger: params.trigger,
    status,
    estimatedLeads,
  });
}
