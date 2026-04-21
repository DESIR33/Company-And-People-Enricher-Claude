import { NextRequest, NextResponse } from "next/server";
import { getJob, updateJob, updateRow } from "@/lib/job-store";
import { enrichRow } from "@/lib/enrich-row";

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

  enrichRow(job, rowIndex, { model })
    .catch((err) => console.error(`Retry failed for job ${jobId} row ${rowIndex}:`, err))
    .finally(() => {
      const current = getJob(jobId);
      if (!current) return;
      const processed = current.rows.filter(
        (r) => r.status === "done" || r.status === "error"
      ).length;
      const allDone = processed === current.totalRows;
      updateJob(jobId, {
        processedRows: processed,
        status: allDone ? "completed" : "processing",
      });
    });

  return NextResponse.json({ ok: true }, { status: 202 });
}
