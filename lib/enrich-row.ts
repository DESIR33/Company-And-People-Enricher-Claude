import { enrichWithAgent } from "./agent";
import { findWorkEmail } from "./prospeo";
import { getFields } from "./enrichment-fields";
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
