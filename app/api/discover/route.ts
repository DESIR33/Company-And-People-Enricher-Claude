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

const DirectoryConfigSchema = z
  .object({
    source: z.enum([
      "yc",
      "producthunt",
      "github",
      "google_maps",
      "tech_stack",
      "custom",
      "yelp",
      "bbb",
      "angi",
      "facebook_pages",
      "firecrawl_search",
    ]),
    category: z.string().trim().max(200).optional(),
    query: z.string().trim().max(500).optional(),
    geo: z.string().trim().max(200).optional(),
    url: z.string().trim().url().max(500).optional(),
    techStack: z.string().trim().max(200).optional(),
    batch: z.string().trim().max(40).optional(),
  })
  .refine(
    (v) => {
      if (v.source === "custom") return !!v.url;
      if (v.source === "google_maps") return !!(v.category || v.query);
      if (v.source === "tech_stack") return !!(v.techStack || v.query);
      if (v.source === "firecrawl_search") return !!(v.query || v.category);
      if (v.source === "yelp" || v.source === "bbb" || v.source === "angi" || v.source === "facebook_pages") {
        return !!(v.category || v.query);
      }
      return true;
    },
    { message: "Directory config is missing required fields for the chosen source" }
  );

const DirectorySchema = z.object({
  mode: z.literal("directory"),
  name: z.string().trim().min(1).max(120),
  directoryConfig: DirectoryConfigSchema,
  queryText: z.string().trim().max(2000).default(""),
  maxResults: z.number().int().min(1).max(MAX_RESULTS_LIMIT).default(25),
});

const CreateSearchSchema = z.discriminatedUnion("mode", [
  IcpSchema,
  LookalikeSchema,
  DirectorySchema,
]);

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
    directoryConfig: data.mode === "directory" ? data.directoryConfig : undefined,
    maxResults: data.maxResults,
  });

  if (result.status === "cap_exceeded") {
    return NextResponse.json({ error: result.reason }, { status: 429 });
  }

  return NextResponse.json({ searchId: result.searchId }, { status: 202 });
}
