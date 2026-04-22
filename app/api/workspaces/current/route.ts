import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { cookies } from "next/headers";
import { getActiveWorkspace, WORKSPACE_COOKIE, workspaceCookieAttrs } from "@/lib/workspace-context";
import { getWorkspace } from "@/lib/workspace-store";

// Reads / sets the cookie that selects the "active workspace" for the current
// browser session. Switching here is purely cosmetic — it rescopes list views
// and stamps new jobs with the chosen workspace, but public share URLs are
// separately gated by their shareToken.

export async function GET() {
  const ws = await getActiveWorkspace();
  return NextResponse.json({ workspace: ws });
}

const PutSchema = z.object({
  workspaceId: z.string().uuid(),
});

export async function PUT(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }
  const parsed = PutSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "workspaceId must be a UUID" }, { status: 400 });
  }
  const ws = getWorkspace(parsed.data.workspaceId);
  if (!ws) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }
  const store = await cookies();
  store.set(WORKSPACE_COOKIE, ws.id, workspaceCookieAttrs());
  return NextResponse.json({ workspace: ws });
}
