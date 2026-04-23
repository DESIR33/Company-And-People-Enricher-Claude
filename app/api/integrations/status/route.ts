import { NextResponse } from "next/server";
import { isConfigured as firecrawlConfigured } from "@/lib/firecrawl";
import { checkSupabaseHealth, isSupabaseConfigured } from "@/lib/supabase";

export async function GET() {
  const supabaseConfigured = isSupabaseConfigured();
  return NextResponse.json({
    firecrawl: firecrawlConfigured(),
    prospeo: !!process.env.PROSPEO_API_KEY,
    supabase: {
      configured: supabaseConfigured,
      healthy: supabaseConfigured ? await checkSupabaseHealth() : false,
    },
  });
}
