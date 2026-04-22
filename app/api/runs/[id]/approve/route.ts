import { NextRequest, NextResponse } from "next/server";
import { getRun, updateRun } from "@/lib/monitor-store";
import { executeRun } from "@/lib/monitor-runner";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const run = getRun(id);
  if (!run) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (run.status !== "awaiting_approval") {
    return NextResponse.json(
      { error: `Run is not awaiting approval (status=${run.status})` },
      { status: 409 }
    );
  }
  updateRun(id, { status: "queued" });
  void executeRun(id).catch((err) => {
    updateRun(id, {
      status: "failed",
      error: String(err),
      completedAt: Date.now(),
    });
  });
  return NextResponse.json({ ok: true }, { status: 202 });
}
