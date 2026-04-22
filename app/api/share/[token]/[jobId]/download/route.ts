import { NextRequest, NextResponse } from "next/server";
import { getJob } from "@/lib/job-store";
import { getWorkspaceByShareToken } from "@/lib/workspace-store";
import { serializeCSV } from "@/lib/csv";

// Public CSV download for the branded results view. Mirrors the admin
// /api/download/[jobId] path but gates on the workspace shareToken instead
// of the admin cookie. The filename is derived from the workspace name so
// the downloaded file lands with client-facing branding.

type RouteContext = { params: Promise<{ token: string; jobId: string }> };

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "results";
}

export async function GET(_request: NextRequest, ctx: RouteContext) {
  const { token, jobId } = await ctx.params;
  const workspace = getWorkspaceByShareToken(token);
  if (!workspace) {
    return NextResponse.json({ error: "Invalid share link" }, { status: 404 });
  }
  const job = getJob(jobId);
  if (!job || job.workspaceId !== workspace.id) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  const originalHeaders =
    job.rows[0]?.originalData ? Object.keys(job.rows[0].originalData) : [];
  const enrichedHeaders = job.requestedFields;
  const headers = [...originalHeaders, ...enrichedHeaders];

  const records = job.rows.map((r) => {
    const out: Record<string, string> = {};
    for (const h of originalHeaders) out[h] = r.originalData[h] ?? "";
    for (const f of enrichedHeaders) out[f] = r.enrichedData?.[f] ?? "";
    return out;
  });

  const csv = serializeCSV(records, headers);
  const filename = `${slugify(workspace.brandName ?? workspace.name)}-${jobId.slice(0, 8)}.csv`;
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv;charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
