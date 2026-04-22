import { NextRequest, NextResponse } from "next/server";
import { getJob } from "@/lib/job-store";
import { getWorkspaceByShareToken } from "@/lib/workspace-store";

// Public, unauthenticated read-only feed for the branded /r/<token>/<jobId>
// page. Dual-gated: the shareToken proves the requester has access to this
// workspace's data, and the jobId must actually belong to that workspace
// (so a leaked token cannot be paired with a UUID guess from another
// tenant). Returns a trimmed view — no error strings or internal controls.

type RouteContext = { params: Promise<{ token: string; jobId: string }> };

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

  const percentComplete =
    job.totalRows > 0 ? Math.round((job.processedRows / job.totalRows) * 100) : 0;

  return NextResponse.json(
    {
      workspace: {
        id: workspace.id,
        name: workspace.name,
        brandName: workspace.brandName,
        logoUrl: workspace.logoUrl,
        primaryColor: workspace.primaryColor,
        accentColor: workspace.accentColor,
        supportEmail: workspace.supportEmail,
        footerText: workspace.footerText,
      },
      job: {
        id: job.id,
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
        })),
      },
    },
    {
      // Not cached — job state changes as rows enrich.
      headers: { "Cache-Control": "no-store" },
    }
  );
}
