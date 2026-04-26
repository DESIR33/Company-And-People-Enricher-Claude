import { NextRequest, NextResponse } from "next/server";
import { getCanonicalCompany } from "@/lib/canonical-companies";
import { enrichCanonicalSignals } from "@/lib/signals/enrich-canonical";
import { getActiveWorkspaceId } from "@/lib/workspace-context";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(_request: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;
  const workspaceId = await getActiveWorkspaceId();

  // Workspace scoping: don't reveal that an id exists in another tenant.
  const existing = getCanonicalCompany(id);
  if (!existing || existing.workspaceId !== workspaceId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const result = await enrichCanonicalSignals(id);
  // Re-load so the response carries the row state the UI should render.
  const updated = getCanonicalCompany(id);
  return NextResponse.json({
    ok: result.ok,
    changed: result.changed,
    errors: result.errors,
    company: updated,
  });
}
