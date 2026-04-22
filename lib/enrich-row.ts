import { enrichWithAgent } from "./agent";
import { findWorkEmail } from "./prospeo";
import { getFields, BUYING_TRIGGER_SIGNAL_FIELDS } from "./enrichment-fields";
import { updateRow, type Job } from "./job-store";

const NEWS_KEY_RE = /^recent_news_\d+$/;

function clampInt(value: unknown, min: number, max: number): number | null {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function tierFromScore(total: number): "A" | "B" | "C" | "D" {
  if (total >= 80) return "A";
  if (total >= 65) return "B";
  if (total >= 45) return "C";
  return "D";
}

// The agent computes total_score, but the maths can drift (typos, forgetting to
// apply the weights). Recompute from the sub-scores when we have them so the
// downstream sort + top-50 logic is trustworthy.
function reconcileLeadScores(
  enriched: Record<string, string>,
  weights: { icp: number; pain: number; reach: number }
): Record<string, string> {
  const icp   = clampInt(enriched.icp_fit_score, 0, 100);
  const pain  = clampInt(enriched.pain_signal_score, 0, 100);
  const reach = clampInt(enriched.reachability_score, 0, 100);

  const out = { ...enriched };
  if (icp   !== null) out.icp_fit_score       = String(icp);
  if (pain  !== null) out.pain_signal_score   = String(pain);
  if (reach !== null) out.reachability_score  = String(reach);

  if (icp !== null && pain !== null && reach !== null) {
    const weightSum = weights.icp + weights.pain + weights.reach || 100;
    const total = Math.round(
      (icp * weights.icp + pain * weights.pain + reach * weights.reach) / weightSum
    );
    out.total_score    = String(total);
    out.priority_tier  = tierFromScore(total);
  } else {
    const reported = clampInt(enriched.total_score, 0, 100);
    if (reported !== null) {
      out.total_score   = String(reported);
      out.priority_tier = tierFromScore(reported);
    }
  }
  return out;
}

function heatTierFromScore(total: number): "A" | "B" | "C" | "D" {
  if (total >= 80) return "A";
  if (total >= 65) return "B";
  if (total >= 45) return "C";
  return "D";
}

function isRealTrigger(value: string | undefined): boolean {
  if (!value) return false;
  const trimmed = value.trim().toLowerCase();
  if (trimmed === "" || trimmed === "na" || trimmed === "n/a" || trimmed === "none") return false;
  return true;
}

function actionFromTier(tier: "A" | "B" | "C" | "D"): string {
  switch (tier) {
    case "A": return "Reach out today";
    case "B": return "Reach out this week";
    case "C": return "Nurture";
    case "D": return "Skip";
  }
}

// The agent fills trigger_count and heat_tier, but it can drift (counting "NA"
// as a trigger, picking a tier that doesn't match the score). Recompute both
// from the observable signal fields so the downstream sort is trustworthy.
// Also keep recommended_action aligned with the tier so an SDR doesn't get
// "Skip" on an A-tier row.
function reconcileBuyingTriggers(
  enriched: Record<string, string>,
  requestedFields: string[]
): Record<string, string> {
  const requested = new Set(requestedFields);
  const signalFieldsInPlay = BUYING_TRIGGER_SIGNAL_FIELDS.filter((f) => requested.has(f));
  const out = { ...enriched };

  if (signalFieldsInPlay.length > 0) {
    const actualCount = signalFieldsInPlay.filter((f) => isRealTrigger(enriched[f])).length;
    out.trigger_count = String(actualCount);
    if (actualCount === 0) {
      out.strongest_trigger = "none";
    }
  }

  const score = clampInt(enriched.heat_score, 0, 100);
  if (score !== null) {
    out.heat_score = String(score);
    const tier = heatTierFromScore(score);
    out.heat_tier = tier;
    // If the agent already picked a recommended_action and it's one of the
    // four valid labels, keep it (lets the trigger-recency upgrade rule stand).
    // Otherwise, derive from tier.
    const validActions = new Set([
      "Reach out today",
      "Reach out this week",
      "Nurture",
      "Skip",
    ]);
    if (!validActions.has(out.recommended_action)) {
      out.recommended_action = actionFromTier(tier);
    }
  }

  return out;
}

export async function enrichRow(
  job: Job,
  rowIndex: number,
  opts: { model?: string; signal?: AbortSignal } = {}
): Promise<void> {
  const jobId = job.id;
  const row = job.rows[rowIndex];
  if (!row) return;

  const identifier = row.originalData[job.identifierColumn]?.trim() ?? "";
  if (identifier === "") {
    updateRow(jobId, rowIndex, {
      status: "error",
      error: "Missing identifier value",
      enrichedData: {},
    });
    return;
  }

  const validFieldKeys = new Set(getFields(job.type).map((f) => f.key));
  const customFieldNames = new Set((job.customFieldDefs ?? []).map((f) => f.name));

  const nonProspeoFields = job.requestedFields.filter(
    (f) =>
      (validFieldKeys.has(f) || customFieldNames.has(f) || NEWS_KEY_RE.test(f)) &&
      f !== "work_email"
  );

  try {
    let enrichedData: Record<string, string> = {};
    let rowCostUsd = 0;
    let cacheReadTokens = 0;
    let cacheCreationTokens = 0;

    if (nonProspeoFields.length > 0) {
      const result = await enrichWithAgent({
        type: job.type,
        identifier,
        requestedFields: nonProspeoFields,
        customFieldDefs: job.customFieldDefs ?? [],
        newsParams: job.newsParams,
        outreachContext: job.outreachContext,
        scoreRubric: job.scoreRubric,
        model: opts.model,
        signal: opts.signal,
      });
      enrichedData = result.fields;
      rowCostUsd = result.costUsd;
      cacheReadTokens = result.cacheReadTokens;
      cacheCreationTokens = result.cacheCreationTokens;
    }

    if (job.type === "lead_score" && job.scoreRubric) {
      enrichedData = reconcileLeadScores(enrichedData, job.scoreRubric.weights);
    }

    if (job.type === "buying_trigger") {
      enrichedData = reconcileBuyingTriggers(enrichedData, job.requestedFields);
    }

    if (job.type === "people" && job.requestedFields.includes("work_email")) {
      const prospeoResult = await findWorkEmail({
        linkedinUrl: identifier,
        signal: opts.signal,
      });
      enrichedData.work_email = prospeoResult.email ?? "";
    }

    updateRow(jobId, rowIndex, {
      status: "done",
      enrichedData,
      costUsd: rowCostUsd,
      cacheReadTokens,
      cacheCreationTokens,
    });
  } catch (err) {
    const cancelled = opts.signal?.aborted === true;
    updateRow(jobId, rowIndex, {
      status: "error",
      error: cancelled ? "Cancelled" : String(err),
      enrichedData: {},
    });
  }
}
