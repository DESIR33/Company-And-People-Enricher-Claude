import { NextResponse } from "next/server";
import { isConfigured as firecrawlConfigured } from "@/lib/firecrawl";

export async function GET() {
  return NextResponse.json({
    firecrawl: firecrawlConfigured(),
    prospeo: !!process.env.PROSPEO_API_KEY,
  });
}
