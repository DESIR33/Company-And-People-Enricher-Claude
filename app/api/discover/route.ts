import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { listSearchesByWorkspace } from "@/lib/discovery-store";
import { startSearch } from "@/lib/discovery-runner";
import { getActiveWorkspaceId } from "@/lib/workspace-context";

const MAX_RESULTS_LIMIT = 50;
const MAX_LOOKALIKE_SEEDS = 200;

const IcpSchema = z.object({
  mode: z.literal("icp"),
  name: z.string().trim().min(1).max(120),
  queryText: z
    .string()
    .trim()
    .min(10, "Describe the ICP in at least a sentence (≥10 chars)")
    .max(2000),
  maxResults: z.number().int().min(1).max(MAX_RESULTS_LIMIT).default(25),
  webhookUrl: z.string().trim().url().max(500).optional(),
});

// Phase 4.17: lookalike seed cap raised from 10 to MAX_LOOKALIKE_SEEDS so a
// CRM win list (often 50-200 companies) can drive discovery in one pass.
const LookalikeSchema = z.object({
  mode: z.literal("lookalike"),
  name: z.string().trim().min(1).max(120),
  seedCompanies: z
    .array(z.string().trim().min(1).max(300))
    .min(1, "Paste at least one seed company")
    .max(MAX_LOOKALIKE_SEEDS),
  queryText: z.string().trim().max(2000).default(""),
  maxResults: z.number().int().min(1).max(MAX_RESULTS_LIMIT).default(25),
  webhookUrl: z.string().trim().url().max(500).optional(),
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
      "osm_overpass",
      "google_lsa",
      "yellowpages",
      "manta",
      "houzz",
      "nextdoor",
      "opentable",
      "tripadvisor",
      "delivery_marketplace",
      "state_license_board",
      "state_sos",
      "google_places",
      "foursquare",
      "bing_places",
    ]),
    category: z.string().trim().max(200).optional(),
    query: z.string().trim().max(500).optional(),
    geo: z.string().trim().max(200).optional(),
    url: z.string().trim().url().max(500).optional(),
    techStack: z.string().trim().max(200).optional(),
    batch: z.string().trim().max(40).optional(),
    // Phase 1.3: precise geo inputs.
    lat: z.number().gte(-90).lte(90).optional(),
    lng: z.number().gte(-180).lte(180).optional(),
    radiusMiles: z.number().positive().max(500).optional(),
    zips: z.array(z.string().trim().regex(/^\d{5}$/)).max(50).optional(),
    msaCode: z.string().trim().max(10).optional(),
    state: z
      .string()
      .trim()
      .length(2)
      .toUpperCase()
      .optional(),
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
      if (
        v.source === "yellowpages" ||
        v.source === "manta" ||
        v.source === "houzz" ||
        v.source === "google_lsa" ||
        v.source === "nextdoor" ||
        v.source === "opentable" ||
        v.source === "tripadvisor" ||
        v.source === "delivery_marketplace"
      ) {
        return !!(v.category || v.query);
      }
      if (v.source === "osm_overpass") {
        // Needs either a category and a geo / lat-lng / zips.
        const hasCat = !!(v.category || v.query);
        const hasGeo = !!(v.geo || v.lat !== undefined || v.zips?.length);
        return hasCat && hasGeo;
      }
      if (v.source === "google_places") {
        // Text query alone is enough (Google Places Text Search). Nearby
        // mode needs lat/lng + a category preset.
        const hasQuery = !!(v.query || v.category);
        const hasNearby =
          v.lat !== undefined && v.lng !== undefined && !!v.category;
        return hasQuery || hasNearby;
      }
      if (v.source === "foursquare") {
        // Either a circle (lat/lng), a "near" string in `geo`, or a zip we
        // can resolve. Plus a category or free-text query so we don't pull
        // every place in the metro.
        const hasGeo =
          (v.lat !== undefined && v.lng !== undefined) ||
          !!v.geo ||
          !!v.zips?.length;
        const hasFilter = !!(v.category || v.query);
        return hasGeo && hasFilter;
      }
      if (v.source === "bing_places") {
        // Bing requires a userLocation point — we accept lat/lng directly,
        // a zip we can resolve, or a "near" string the runner can geocode.
        const hasGeo =
          (v.lat !== undefined && v.lng !== undefined) ||
          !!v.geo ||
          !!v.zips?.length;
        const hasFilter = !!(v.category || v.query);
        return hasGeo && hasFilter;
      }
      if (v.source === "state_license_board" || v.source === "state_sos") {
        return !!v.state;
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
  webhookUrl: z.string().trim().url().max(500).optional(),
});

const CreateSearchSchema = z.discriminatedUnion("mode", [
  IcpSchema,
  LookalikeSchema,
  DirectorySchema,
]);

export async function GET() {
  const workspaceId = await getActiveWorkspaceId();
  return NextResponse.json({ searches: listSearchesByWorkspace(workspaceId) });
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
  const workspaceId = await getActiveWorkspaceId();
  const result = startSearch({
    workspaceId,
    mode: data.mode,
    name: data.name,
    queryText: data.queryText,
    seedCompanies: data.mode === "lookalike" ? data.seedCompanies : undefined,
    directoryConfig: data.mode === "directory" ? data.directoryConfig : undefined,
    maxResults: data.maxResults,
    webhookUrl: data.webhookUrl,
  });

  if (result.status === "cap_exceeded") {
    return NextResponse.json({ error: result.reason }, { status: 429 });
  }

  return NextResponse.json({ searchId: result.searchId }, { status: 202 });
}
