import { NextRequest, NextResponse } from "next/server";
import { parseCSV } from "@/lib/csv";
import { createJob, updateJob, updateRow, getJob, type CustomFieldDef } from "@/lib/job-store";
import { enrichRow } from "@/lib/enrich-row";
import { getFields } from "@/lib/enrichment-fields";

const MAX_ROWS = 200;
const CONCURRENCY = 15;
const NEWS_KEY_RE = /^recent_news_\d+$/;

async function processJob(jobId: string): Promise<void> {
  const jobMaybe = getJob(jobId);
  if (!jobMaybe) return;
  const job = jobMaybe;

  updateJob(jobId, { status: "processing" });

  let nextIndex = 0;

  async function worker() {
    while (true) {
      if (getJob(jobId)?.status === "cancelled") return;

      const rowIndex = nextIndex++;
      const row = job.rows[rowIndex];
      if (!row) return;

      updateRow(jobId, rowIndex, { status: "processing" });
      await enrichRow(job, rowIndex);

      const processed = getJob(jobId)!.rows.filter(
        (r) => r.status === "done" || r.status === "error"
      ).length;
      updateJob(jobId, { processedRows: processed });
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  if (getJob(jobId)?.status !== "cancelled") {
    updateJob(jobId, { status: "completed" });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { type, csvContent, identifierColumn, requestedFields, customFieldDefs, newsParams } = body;

    if (type !== "company" && type !== "people") {
      return NextResponse.json({ error: "Invalid type" }, { status: 400 });
    }

    if (!csvContent || typeof csvContent !== "string") {
      return NextResponse.json({ error: "Missing CSV content" }, { status: 400 });
    }

    const { headers, rows } = parseCSV(csvContent);

    if (!headers.includes(identifierColumn)) {
      return NextResponse.json(
        { error: `Column "${identifierColumn}" not found in CSV` },
        { status: 400 }
      );
    }

    if (rows.length === 0) {
      return NextResponse.json({ error: "CSV has no data rows" }, { status: 400 });
    }

    if (rows.length > MAX_ROWS) {
      return NextResponse.json(
        { error: `CSV has ${rows.length} rows. Maximum allowed is ${MAX_ROWS}.` },
        { status: 400 }
      );
    }

    const validKeys   = new Set(getFields(type).map((f) => f.key));
    const customNames = new Set(
      ((customFieldDefs ?? []) as CustomFieldDef[]).map((f) => f.name)
    );
    const invalidFields = (requestedFields as string[]).filter(
      (f) => !validKeys.has(f) && !customNames.has(f) && !NEWS_KEY_RE.test(f)
    );
    if (invalidFields.length > 0) {
      return NextResponse.json(
        { error: `Invalid fields: ${invalidFields.join(", ")}` },
        { status: 400 }
      );
    }

    const job = createJob({ type, identifierColumn, requestedFields, customFieldDefs, newsParams, rows });

    processJob(job.id).catch((err) => {
      console.error(`processJob failed for ${job.id}:`, err);
      updateJob(job.id, { status: "failed", error: String(err) });
    });

    return NextResponse.json({ jobId: job.id }, { status: 202 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
