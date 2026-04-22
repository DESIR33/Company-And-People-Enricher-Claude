import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { listSearches } from "@/lib/discovery-store";
import { startSearch } from "@/lib/discovery-runner";

const MAX_RESULTS_LIMIT = 50;

const IcpSchema = z.object({
  mode: z.literal("icp"),
  name: z.string().trim().min(1).max(120),
  queryText: z
    .string()
    .trim()
    .min(10, "Describe the ICP in at least a sentence (≥10 chars)")
    .max(2000),
  maxResults: z.number().int().min(1).max(MAX_RESULTS_LIMIT).default(25),
});

const LookalikeSchema = z.object({
  mode: z.literal("lookalike"),
  name: z.string().trim().min(1).max(120),
  seedCompanies: z
    .array(z.string().trim().min(1).max(300))
    .min(1, "Paste at least one seed company")
    .max(10),
  queryText: z.string().trim().max(2000).default(""),
  maxResults: z.number().int().min(1).max(MAX_RESULTS_LIMIT).default(25),
});

const CreateSearchSchema = z.discriminatedUnion("mode", [IcpSchema, LookalikeSchema]);

export async function GET() {
  return NextResponse.json({ searches: listSearches() });
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const parsed = CreateSearchSchema.safeParse(body);
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
  const result = startSearch({
    mode: data.mode,
    name: data.name,
    queryText: data.queryText,
    seedCompanies: data.mode === "lookalike" ? data.seedCompanies : undefined,
    maxResults: data.maxResults,
  });

  if (result.status === "cap_exceeded") {
    return NextResponse.json({ error: result.reason }, { status: 429 });
  }

  return NextResponse.json({ searchId: result.searchId }, { status: 202 });
}
