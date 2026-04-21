import { NextRequest, NextResponse } from "next/server";
import { getJob } from "@/lib/job-store";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await params;
  const job = getJob(jobId);

  if (!job) {
    return NextResponse.json({ error: "Job not found. The server may have restarted." }, { status: 404 });
  }

  const percentComplete =
    job.totalRows > 0 ? Math.round((job.processedRows / job.totalRows) * 100) : 0;

  return NextResponse.json(
    {
      jobId: job.id,
      type: job.type,
      status: job.status,
      totalRows: job.totalRows,
      processedRows: job.processedRows,
      percentComplete,
      requestedFields: job.requestedFields,
      identifierColumn: job.identifierColumn,
      rows: job.rows.map((r) => ({
        rowIndex: r.rowIndex,
        status: r.status,
        originalData: r.originalData,
        enrichedData: r.enrichedData,
        error: r.error,
        costUsd: r.costUsd,
      })),
      error: job.error,
    },
    {
      headers: { "Cache-Control": "no-store" },
    }
  );
}
