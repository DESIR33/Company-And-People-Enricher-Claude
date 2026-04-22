import { NextRequest, NextResponse } from "next/server";
import Papa from "papaparse";
import { getMonitor, listLeadsByMonitor } from "@/lib/monitor-store";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const monitor = getMonitor(id);
  if (!monitor) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const format = req.nextUrl.searchParams.get("format");
  const leads = listLeadsByMonitor(id, 5000);

  if (format === "csv") {
    const enrichedKeys = new Set<string>();
    for (const l of leads) for (const k of Object.keys(l.enrichedData)) enrichedKeys.add(k);
    const enrichedCols = Array.from(enrichedKeys);
    const rows = leads.map((l) => {
      const base: Record<string, string> = {
        linkedin_url: l.linkedinUrl,
        profile_name: l.profileName ?? "",
        engagement_type: l.engagementType ?? "",
        engagement_text: l.engagementText ?? "",
        post_url: l.postUrl ?? "",
        enrichment_status: l.enrichmentStatus,
        first_seen_at: new Date(l.createdAt).toISOString(),
      };
      for (const k of enrichedCols) base[k] = l.enrichedData[k] ?? "";
      return base;
    });
    const headers = [
      "linkedin_url",
      "profile_name",
      "engagement_type",
      "engagement_text",
      "post_url",
      "enrichment_status",
      "first_seen_at",
      ...enrichedCols,
    ];
    const csv = Papa.unparse(rows, { columns: headers });
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${monitor.name.replace(/[^a-z0-9]+/gi, "_")}-leads.csv"`,
      },
    });
  }

  return NextResponse.json({ leads });
}
