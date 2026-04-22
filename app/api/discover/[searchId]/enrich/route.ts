import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  getSearch,
  listLeadsByIds,
  listLeadsBySearch,
  type DiscoveredLead,
} from "@/lib/discovery-store";
import { COMPANY_FIELDS } from "@/lib/enrichment-fields";

const EnrichSelectedSchema = z.object({
  leadIds: z.array(z.string().min(1).max(100)).max(200).optional(),
  requestedFields: z
    .array(z.string().min(1))
    .min(1, "Pick at least one enrichment field")
    .max(50),
  outreachContext: z.string().trim().max(500).optional(),
});

type RouteContext = { params: Promise<{ searchId: string }> };

function escapeCsvCell(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function leadsToCsv(leads: DiscoveredLead[]): string {
  const headers = [
    "company_name",
    "website",
    "linkedin",
    "location",
    "industry",
    "match_reason",
  ];
  const rows = leads.map((l) => [
    l.companyName,
    l.websiteUrl ?? "",
    l.linkedinUrl ?? "",
    l.location ?? "",
    l.industry ?? "",
    l.matchReason ?? "",
  ]);
  return [headers, ...rows]
    .map((row) => row.map((cell) => escapeCsvCell(String(cell))).join(","))
    .join("\n");
}

function chooseIdentifier(leads: DiscoveredLead[]): "website" | "company_name" {
  const withWebsite = leads.filter((l) => l.websiteUrl).length;
  return withWebsite >= Math.ceil(leads.length / 2) ? "website" : "company_name";
}

export async function POST(request: NextRequest, ctx: RouteContext) {
  const { searchId } = await ctx.params;
  const search = getSearch(searchId);
  if (!search) {
    return NextResponse.json({ error: "Search not found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const parsed = EnrichSelectedSchema.safeParse(body);
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
  const leads =
    data.leadIds && data.leadIds.length > 0
      ? listLeadsByIds(searchId, data.leadIds)
      : listLeadsBySearch(searchId);

  if (leads.length === 0) {
    return NextResponse.json(
      { error: "No leads to enrich for this search" },
      { status: 400 }
    );
  }

  const validFieldKeys = new Set(COMPANY_FIELDS.map((f) => f.key));
  const invalid = data.requestedFields.filter((f) => !validFieldKeys.has(f));
  if (invalid.length > 0) {
    return NextResponse.json(
      { error: `Invalid company enrichment fields: ${invalid.join(", ")}` },
      { status: 400 }
    );
  }

  const csvContent = leadsToCsv(leads);
  const identifierColumn = chooseIdentifier(leads);

  const origin = new URL(request.url).origin;
  const enrichRes = await fetch(`${origin}/api/enrich`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "company",
      csvContent,
      identifierColumn,
      requestedFields: data.requestedFields,
      outreachContext: data.outreachContext,
    }),
  });

  const enrichBody = (await enrichRes.json().catch(() => ({}))) as {
    jobId?: string;
    error?: string;
    issues?: string[];
  };
  if (!enrichRes.ok) {
    return NextResponse.json(
      {
        error: enrichBody.error ?? "Failed to start enrichment job",
        issues: enrichBody.issues,
      },
      { status: enrichRes.status }
    );
  }

  return NextResponse.json({ jobId: enrichBody.jobId, leadCount: leads.length });
}
