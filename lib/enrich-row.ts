import { enrichWithAgent } from "./agent";
import { findWorkEmail } from "./prospeo";
import { getFields, BUYING_TRIGGER_SIGNAL_FIELDS } from "./enrichment-fields";
import { updateRow, type Job } from "./job-store";
import { parseChannels } from "./channels/schema";
import { rescoreChannels } from "./channels/scoring";
import { rankChannels } from "./channels/ranker";
import { applySuppression, buildSuppressionIndex } from "./channels/suppression";
import type { Channel } from "./channels/types";

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

// The agent emits `channels` as a JSON array (stringified by normalizeFields).
// Parse, validate, apply suppression, rescore, rerank, and re-stringify so
// downstream code sees a trusted, ordered list under enrichedData.channels.
// Suppression runs BEFORE re-scoring so the compliance penalty on suppressed
// channels is baked into the final score.
function reconcileMultiChannel(
  enriched: Record<string, string>,
  suppressionList: readonly string[] | undefined
): Record<string, string> {
  const raw = enriched.channels;
  if (!raw) {
    return { ...enriched, channels: JSON.stringify([]) };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Agent returned something that wasn't JSON — drop silently and record empty.
    return { ...enriched, channels: JSON.stringify([]) };
  }
  const validated = parseChannels(parsed);
  const suppressionIndex = buildSuppressionIndex(suppressionList);
  const suppressed = applySuppression(validated, suppressionIndex);
  const rescored = rescoreChannels(suppressed);
  const ranked = rankChannels(rescored);
  return { ...enriched, channels: JSON.stringify(ranked) };
}

// Mirror the top-ranked channel of each kind into the legacy flat fields so
// existing consumers keep working. Only populates a flat field if a matching
// channel was actually found.
function mirrorChannelsToLegacyFields(
  enriched: Record<string, string>
): Record<string, string> {
  let channels: Channel[] = [];
  try {
    const parsed = JSON.parse(enriched.channels ?? "[]");
    if (Array.isArray(parsed)) channels = parsed as Channel[];
  } catch {
    // ignored — channels field is not valid JSON
  }
  if (channels.length === 0) return enriched;

  const top = (type: Channel["type"]) => channels.find((c) => c.type === type);
  const phone  = top("business_phone_call");
  const email  = top("email");
  const ig     = top("instagram_dm");
  const fb     = top("facebook_messenger");
  const best   = channels[0];

  const out = { ...enriched };
  if (phone?.value) out.business_phone    = phone.value;
  if (email?.value) out.business_email    = email.value;
  if (ig?.value)    out.instagram_handle  = ig.value;
  if (fb?.url || fb?.value) out.facebook_page = fb.url ?? fb.value;
  if (best) {
    out.best_contact_channel = best.type;
    out.best_contact_value   = best.value;
  }
  return out;
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

  const rawIdentifier = row.originalData[job.identifierColumn]?.trim() ?? "";
  if (rawIdentifier === "") {
    updateRow(jobId, rowIndex, {
      status: "error",
      error: "Missing identifier value",
      enrichedData: {},
    });
    return;
  }

  // When a separate city column is provided, append it to the identifier so
  // the agent can disambiguate common business names ("Joe's Pizza" → which
  // one?) without forcing users to pre-concatenate the CSV.
  const cityValue = job.cityColumn
    ? row.originalData[job.cityColumn]?.trim() ?? ""
    : "";
  const identifier = cityValue ? `${rawIdentifier}, ${cityValue}` : rawIdentifier;

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
        channelTypes: job.channelTypes,
        includeOwnerPersonal: job.includeOwnerPersonal,
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

    if (job.type === "multi_channel") {
      enrichedData = reconcileMultiChannel(enrichedData, job.suppressionList);
      enrichedData = mirrorChannelsToLegacyFields(enrichedData);
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
