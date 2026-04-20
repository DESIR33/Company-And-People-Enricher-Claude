import { NextRequest, NextResponse } from "next/server";
import { getJob } from "@/lib/job-store";
import { mergeEnrichedRows, serializeCSV } from "@/lib/csv";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await params;
  const job = getJob(jobId);

  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  const { mergedRows, headers } = mergeEnrichedRows(job.rows, job.requestedFields);
  const csv = serializeCSV(mergedRows, headers);

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="enriched-${job.type}-${jobId.slice(0, 8)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
