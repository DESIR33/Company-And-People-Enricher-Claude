import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  createWorkspace,
  getWorkspaceBySlug,
  listWorkspaces,
  getWorkspaceStats,
  SLUG_RE,
  HEX_COLOR_RE,
} from "@/lib/workspace-store";

const CreateSchema = z.object({
  slug: z
    .string()
    .trim()
    .min(1)
    .max(50)
    .regex(SLUG_RE, "Slug must be lowercase letters, numbers, and hyphens"),
  name: z.string().trim().min(1).max(120),
  brandName: z.string().trim().max(120).optional(),
  logoUrl: z.string().trim().url().max(500).optional(),
  primaryColor: z.string().trim().regex(HEX_COLOR_RE, "Must be a #RRGGBB hex colour").optional(),
  accentColor: z.string().trim().regex(HEX_COLOR_RE, "Must be a #RRGGBB hex colour").optional(),
  supportEmail: z.string().trim().email().max(200).optional(),
  footerText: z.string().trim().max(500).optional(),
});

export async function GET() {
  const workspaces = listWorkspaces().map((w) => ({
    ...w,
    stats: getWorkspaceStats(w.id),
  }));
  return NextResponse.json({ workspaces });
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Invalid request",
        issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      },
      { status: 400 }
    );
  }
  if (getWorkspaceBySlug(parsed.data.slug)) {
    return NextResponse.json(
      { error: `Slug "${parsed.data.slug}" is already taken` },
      { status: 409 }
    );
  }
  const workspace = createWorkspace(parsed.data);
  return NextResponse.json({ workspace }, { status: 201 });
}
