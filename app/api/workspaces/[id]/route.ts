import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  deleteWorkspace,
  getWorkspace,
  rotateShareToken,
  updateWorkspace,
  getWorkspaceStats,
  HEX_COLOR_RE,
} from "@/lib/workspace-store";

const PatchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  brandName: z.string().trim().max(120).nullable().optional(),
  logoUrl: z.string().trim().url().max(500).nullable().optional(),
  primaryColor: z
    .string()
    .trim()
    .regex(HEX_COLOR_RE, "Must be a #RRGGBB hex colour")
    .nullable()
    .optional(),
  accentColor: z
    .string()
    .trim()
    .regex(HEX_COLOR_RE, "Must be a #RRGGBB hex colour")
    .nullable()
    .optional(),
  supportEmail: z.string().trim().email().max(200).nullable().optional(),
  footerText: z.string().trim().max(500).nullable().optional(),
  rotateShareToken: z.boolean().optional(),
});

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;
  const ws = getWorkspace(id);
  if (!ws) return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  return NextResponse.json({ workspace: { ...ws, stats: getWorkspaceStats(ws.id) } });
}

export async function PATCH(request: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;
  const existing = getWorkspace(id);
  if (!existing) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
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
  const { rotateShareToken: rotate, ...rest } = parsed.data;
  let updated = updateWorkspace(id, rest);
  if (rotate) updated = rotateShareToken(id);
  return NextResponse.json({ workspace: updated });
}

export async function DELETE(_request: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;
  const result = deleteWorkspace(id);
  if (!result.ok) {
    return NextResponse.json({ error: result.reason ?? "Cannot delete" }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
