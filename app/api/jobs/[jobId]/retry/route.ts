import { NextRequest, NextResponse } from "next/server";
import { getJob, updateJob, updateRow, type Job } from "@/lib/job-store";
import { enrichWithAgent } from "@/lib/agent";
import { findWorkEmail } from "@/lib/prospeo";
import { getFields } from "@/lib/enrichment-fields";

const NEWS_KEY_RE = /^recent_news_\d+$/;

async function processRow(job: Job, rowIndex: number, model?: string): Promise<void> {
  const row        = job.rows[rowIndex];
  const identifier = row.originalData[job.identifierColumn]?.trim() ?? "";
  const jobId      = job.id;

  const validFieldKeys   = new Set(getFields(job.type).map((f) => f.key));
  const customFieldNames = new Set((job.customFieldDefs ?? []).map((f) => f.name));

  const nonProspeoFields = job.requestedFields.filter(
    (f) =>
      (validFieldKeys.has(f) || customFieldNames.has(f) || NEWS_KEY_RE.test(f)) &&
      f !== "work_email"
  );

  try {
    let enrichedData: Record<string, string> = {};
    let rowCostUsd = 0;

    if (nonProspeoFields.length > 0) {
      const result = await enrichWithAgent({
        type: job.type,
        identifier,
        requestedFields: nonProspeoFields,
        customFieldDefs: job.customFieldDefs ?? [],
        newsParams: job.newsParams,
        model,
      });
      enrichedData = result.fields;
      rowCostUsd   = result.costUsd;
    }

    if (job.type === "people" && job.requestedFields.includes("work_email")) {
      const prospeoResult = await findWorkEmail({ linkedinUrl: identifier });
      enrichedData.work_email = prospeoResult.email ?? "";
    }

    updateRow(jobId, rowIndex, { status: "done", enrichedData, costUsd: rowCostUsd });
  } catch (err) {
    updateRow(jobId, rowIndex, { status: "error", error: String(err), enrichedData: {} });
  } finally {
    const current   = getJob(jobId);
    if (!current) return;
    const processed = current.rows.filter((r) => r.status === "done" || r.status === "error").length;
    const allDone   = processed === current.totalRows;
    updateJob(jobId, { processedRows: processed, status: allDone ? "completed" : "processing" });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
): Promise<NextResponse> {
  const { jobId } = await params;
  const job = getJob(jobId);
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

  const body = await request.json();
  const { rowIndex, model }: { rowIndex: number; model?: string } = body;

  if (typeof rowIndex !== "number" || rowIndex < 0 || rowIndex >= job.rows.length) {
    return NextResponse.json({ error: "Invalid rowIndex" }, { status: 400 });
  }

  const row = job.rows[rowIndex];
  if (row.status === "pending" || row.status === "processing") {
    return NextResponse.json({ error: "Row is already being processed" }, { status: 409 });
  }

  updateRow(jobId, rowIndex, { status: "processing", error: undefined });
  updateJob(jobId, { status: "processing" });

  processRow(job, rowIndex, model).catch((err) =>
    console.error(`Retry failed for job ${jobId} row ${rowIndex}:`, err)
  );

  return NextResponse.json({ ok: true }, { status: 202 });
}
