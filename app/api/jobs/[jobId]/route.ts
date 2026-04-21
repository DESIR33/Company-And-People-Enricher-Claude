import { NextRequest, NextResponse } from "next/server";
import { getJob, updateJob, abortJob } from "@/lib/job-store";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await params;
  const job = getJob(jobId);
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

  if (job.status === "completed" || job.status === "failed") {
    return NextResponse.json({ error: "Job already finished" }, { status: 409 });
  }

  updateJob(jobId, { status: "cancelled" });
  abortJob(jobId);
  return NextResponse.json({ ok: true });
}
