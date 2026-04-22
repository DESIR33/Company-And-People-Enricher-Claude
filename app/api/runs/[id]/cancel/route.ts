import { NextRequest, NextResponse } from "next/server";
import { getRun, getRunAbort, updateRun } from "@/lib/monitor-store";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const run = getRun(id);
  if (!run) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (run.status !== "running" && run.status !== "queued" && run.status !== "awaiting_approval") {
    return NextResponse.json(
      { error: `Run is already ${run.status}` },
      { status: 409 }
    );
  }
  const ctrl = getRunAbort(id);
  if (ctrl) ctrl.abort();
  updateRun(id, { status: "cancelled", completedAt: Date.now() });
  return NextResponse.json({ ok: true });
}
