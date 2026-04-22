import { NextRequest, NextResponse } from "next/server";
import { getJob } from "@/lib/job-store";
import { getWorkspace } from "@/lib/workspace-store";
import { getActiveWorkspaceId } from "@/lib/workspace-context";

// Returns the branded /r/<token>/<jobId> URL for a job — used by the Share
// button on the admin results page so the operator can copy a client-safe
// link without leaving the page. Requires the job to belong to the caller's
// active workspace (the admin cookie); this prevents an admin of workspace A
// from generating share URLs against workspace B's jobs just by guessing
// jobIds. The shareToken itself still gates the public surface.

type RouteContext = { params: Promise<{ jobId: string }> };

export async function GET(_request: NextRequest, ctx: RouteContext) {
  const { jobId } = await ctx.params;
  const job = getJob(jobId);
  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }
  const activeId = await getActiveWorkspaceId();
  if (job.workspaceId !== activeId) {
    return NextResponse.json(
      { error: "This job belongs to a different workspace. Switch workspace to share it." },
      { status: 403 }
    );
  }
  const workspace = getWorkspace(job.workspaceId);
  if (!workspace) {
    return NextResponse.json({ error: "Workspace missing" }, { status: 500 });
  }
  return NextResponse.json({
    shareUrl: `/r/${workspace.shareToken}/${jobId}`,
    workspace: {
      id: workspace.id,
      name: workspace.name,
      brandName: workspace.brandName,
    },
  });
}
