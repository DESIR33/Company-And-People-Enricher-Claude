import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { deleteMonitor, getMonitor, updateMonitor } from "@/lib/monitor-store";
import { computeNextRunAt, isSchedulable } from "@/lib/monitor-scheduler";

const PatchSchema = z.object({
  active: z.boolean().optional(),
  schedule: z.enum(["manual", "once", "daily", "weekly", "monthly"]).optional(),
  name: z.string().trim().min(1).max(120).optional(),
  webhookUrl: z.string().trim().url().nullable().optional(),
  outreachContext: z.string().trim().max(1000).nullable().optional(),
});

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const monitor = getMonitor(id);
  if (!monitor) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ monitor });
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const monitor = getMonitor(id);
  if (!monitor) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let body: unknown;
  try {
    body = await req.json();
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

  const patch: Parameters<typeof updateMonitor>[1] = {};
  if (parsed.data.active !== undefined) patch.active = parsed.data.active;
  if (parsed.data.schedule) {
    patch.schedule = parsed.data.schedule;
    patch.nextRunAt = isSchedulable(parsed.data.schedule)
      ? computeNextRunAt(parsed.data.schedule)
      : undefined;
  }
  if (parsed.data.name !== undefined) patch.name = parsed.data.name;
  if (parsed.data.webhookUrl !== undefined)
    patch.webhookUrl = parsed.data.webhookUrl || undefined;
  if (parsed.data.outreachContext !== undefined)
    patch.outreachContext = parsed.data.outreachContext || undefined;

  if (parsed.data.active === false) patch.nextRunAt = undefined;
  if (parsed.data.active === true && !patch.schedule && isSchedulable(monitor.schedule)) {
    patch.nextRunAt = computeNextRunAt(monitor.schedule);
  }

  updateMonitor(id, patch);
  return NextResponse.json({ monitor: getMonitor(id) });
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const monitor = getMonitor(id);
  if (!monitor) return NextResponse.json({ error: "Not found" }, { status: 404 });
  deleteMonitor(id);
  return NextResponse.json({ ok: true });
}
