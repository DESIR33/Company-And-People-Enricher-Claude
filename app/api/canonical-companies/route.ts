import { NextRequest, NextResponse } from "next/server";
import { listCanonicalCompaniesByWorkspace } from "@/lib/canonical-companies";
// Side-effect import: registers the lead-after-insert hook so any insertLead
// fired downstream of this route gets canonical resolution. Defensive — the
// hook is also registered by discovery-runner, but importing it here means
// API-only deployments never miss the wiring.
import "@/lib/canonical-companies";
import { getActiveWorkspaceId } from "@/lib/workspace-context";

export async function GET(request: NextRequest) {
  const workspaceId = await getActiveWorkspaceId();
  const url = new URL(request.url);
  const minSources = clampInt(url.searchParams.get("minSources"), 1, 1, 20);
  const limit = clampInt(url.searchParams.get("limit"), 100, 1, 1000);
  const companies = listCanonicalCompaniesByWorkspace(workspaceId, {
    minSources,
    limit,
  });
  return NextResponse.json({ companies });
}

function clampInt(
  raw: string | null,
  fallback: number,
  min: number,
  max: number
): number {
  if (raw === null) return fallback;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}
