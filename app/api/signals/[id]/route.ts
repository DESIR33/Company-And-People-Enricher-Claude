import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  deleteSignalMonitor,
  getSignalMonitor,
  updateSignalMonitor,
} from "@/lib/signal-store";
import { listSearchesByMonitor } from "@/lib/discovery-store";
import { computeNextRunAt, isSchedulable } from "@/lib/monitor-scheduler";

const PatchSchema = z.object({
  active: z.boolean().optional(),
  schedule: z.enum(["manual", "once", "daily", "weekly", "monthly"]).optional(),
  maxResults: z.number().int().min(1).max(50).optional(),
  timeframe: z.string().trim().min(1).max(60).optional(),
});

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;
  const monitor = getSignalMonitor(id);
  if (!monitor) {
    return NextResponse.json({ error: "Signal monitor not found" }, { status: 404 });
  }
  const runs = listSearchesByMonitor(id);
  return NextResponse.json({ monitor, runs });
}

export async function PATCH(request: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;
  const existing = getSignalMonitor(id);
  if (!existing) {
    return NextResponse.json({ error: "Signal monitor not found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Invalid request",
        issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      },
      { status: 400 }
    );
  }

  const data = parsed.data;
  const patch: Parameters<typeof updateSignalMonitor>[1] = {};
  if (data.active !== undefined) patch.active = data.active;
  if (data.schedule !== undefined) patch.schedule = data.schedule;
  if (data.maxResults !== undefined) patch.maxResults = data.maxResults;
  if (data.timeframe !== undefined) patch.timeframe = data.timeframe;

  if (data.schedule !== undefined) {
    patch.nextRunAt = isSchedulable(data.schedule)
      ? computeNextRunAt(data.schedule)
      : undefined;
  } else if (data.active === true && existing.nextRunAt === undefined) {
    patch.nextRunAt = isSchedulable(existing.schedule)
      ? computeNextRunAt(existing.schedule)
      : undefined;
  } else if (data.active === false) {
    patch.nextRunAt = undefined;
  }

  updateSignalMonitor(id, patch);
  return NextResponse.json({ monitor: getSignalMonitor(id) });
}

export async function DELETE(_request: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;
  const existing = getSignalMonitor(id);
  if (!existing) {
    return NextResponse.json({ error: "Signal monitor not found" }, { status: 404 });
  }
  deleteSignalMonitor(id);
  return NextResponse.json({ ok: true });
}
