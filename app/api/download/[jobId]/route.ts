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

  // For lead_score jobs, sort by total_score descending and prepend a Rank column
  // so the downloaded CSV is already a prioritised list.
  let finalRows = mergedRows;
  let finalHeaders = headers;
  if (job.type === "lead_score") {
    const scored = mergedRows.map((row, originalIdx) => {
      const s = Number(row.total_score);
      return { row, originalIdx, score: Number.isFinite(s) ? s : -1 };
    });
    scored.sort((a, b) => {
      if (a.score >= 0 && b.score < 0) return -1;
      if (b.score >= 0 && a.score < 0) return 1;
      return b.score - a.score;
    });
    finalRows = scored.map(({ row, score }, i) => ({
      Rank: score >= 0 ? String(i + 1) : "",
      ...row,
    }));
    finalHeaders = ["Rank", ...headers];
  }

  const csv = serializeCSV(finalRows, finalHeaders);

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="enriched-${job.type}-${jobId.slice(0, 8)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
