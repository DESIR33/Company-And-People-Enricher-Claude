import { enrichWithAgent } from "./agent";
import { findWorkEmail } from "./prospeo";
import { getFields } from "./enrichment-fields";
import { updateRow, type Job } from "./job-store";

const NEWS_KEY_RE = /^recent_news_\d+$/;

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
        model: opts.model,
        signal: opts.signal,
      });
      enrichedData = result.fields;
      rowCostUsd = result.costUsd;
      cacheReadTokens = result.cacheReadTokens;
      cacheCreationTokens = result.cacheCreationTokens;
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
