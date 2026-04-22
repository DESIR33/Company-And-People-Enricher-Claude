import { NextRequest, NextResponse } from "next/server";
import { startMonitorRun } from "@/lib/monitor-runner";
import { getMonitor } from "@/lib/monitor-store";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const monitor = getMonitor(id);
  if (!monitor) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const result = startMonitorRun({ monitorId: id, trigger: "manual" });
  if (result.status === "cap_exceeded") {
    return NextResponse.json({ error: result.reason }, { status: 429 });
  }
  return NextResponse.json(result, { status: 202 });
}
