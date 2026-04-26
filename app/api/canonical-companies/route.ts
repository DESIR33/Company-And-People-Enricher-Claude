import { NextRequest, NextResponse } from "next/server";
import { listCanonicalCompaniesByWorkspace } from "@/lib/canonical-companies";
// Side-effect imports — register the lead-after-insert hook (canonical
// resolution) and the canonical-after-upsert hook (background signal
// auto-enrich). Defensive: both hooks are also registered by
// discovery-runner, but importing them here means API-only deployments
// never miss the wiring.
import "@/lib/canonical-companies";
import "@/lib/signals/enrich-canonical";
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
