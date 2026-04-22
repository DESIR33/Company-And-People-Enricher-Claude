import { NextRequest, NextResponse } from "next/server";
import { getRun, listLeadsByRun } from "@/lib/monitor-store";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const run = getRun(id);
  if (!run) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const leads = listLeadsByRun(id);
  return NextResponse.json({ run, leads });
}
