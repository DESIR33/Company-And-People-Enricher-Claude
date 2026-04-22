import { NextRequest, NextResponse } from "next/server";
import { startSignalMonitorRun } from "@/lib/signal-runner";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(_request: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;
  const r = startSignalMonitorRun({ monitorId: id, trigger: "manual" });
  if (r.status === "not_found") {
    return NextResponse.json({ error: r.reason }, { status: 404 });
  }
  if (r.status === "cap_exceeded") {
    return NextResponse.json({ error: r.reason }, { status: 429 });
  }
  return NextResponse.json({ searchId: r.searchId }, { status: 202 });
}
