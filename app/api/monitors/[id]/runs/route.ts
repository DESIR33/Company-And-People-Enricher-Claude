import { NextRequest, NextResponse } from "next/server";
import { getMonitor, listRunsByMonitor } from "@/lib/monitor-store";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const monitor = getMonitor(id);
  if (!monitor) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ runs: listRunsByMonitor(id) });
}
