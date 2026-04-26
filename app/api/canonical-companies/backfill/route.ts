import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { backfillCanonicalLinks } from "@/lib/canonical-companies";
import { getActiveWorkspaceId } from "@/lib/workspace-context";

const BodySchema = z.object({
  // Cap how many leads to sweep in a single call so the request can't
  // wedge a long-running serverless function. Re-run until processed=0.
  maxRows: z.number().int().min(1).max(5000).default(1000),
  batchSize: z.number().int().min(10).max(1000).default(200),
});

export async function POST(request: NextRequest) {
  const workspaceId = await getActiveWorkspaceId();
  let body: unknown = {};
  try {
    body = await request.json().catch(() => ({}));
  } catch {
    body = {};
  }
  const parsed = BodySchema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Invalid request",
        issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      },
      { status: 400 }
    );
  }
  const result = backfillCanonicalLinks({
    workspaceId,
    batchSize: parsed.data.batchSize,
    maxRows: parsed.data.maxRows,
  });
  return NextResponse.json(result);
}
