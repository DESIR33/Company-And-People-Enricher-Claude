import { NextRequest, NextResponse } from "next/server";
import { pickDueMonitors } from "@/lib/monitor-store";
import { startMonitorRun } from "@/lib/monitor-runner";

// Protect the cron endpoint with a shared secret when CRON_SECRET is set.
// Intended to be called by Vercel Cron, a curl from an external scheduler,
// or any timer — on every invocation it picks up monitors whose next_run_at
// has passed and kicks off runs.
function authorised(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const header = req.headers.get("authorization");
  if (header === `Bearer ${secret}`) return true;
  const q = req.nextUrl.searchParams.get("secret");
  return q === secret;
}

function pickAndRun() {
  const due = pickDueMonitors(Date.now());
  const results: Array<{ monitorId: string; status: string; runId?: string; reason?: string }> = [];
  for (const m of due) {
    const r = startMonitorRun({ monitorId: m.id, trigger: "schedule" });
    results.push({
      monitorId: m.id,
      status: r.status,
      runId: "runId" in r ? r.runId : undefined,
      reason: r.status === "cap_exceeded" ? r.reason : undefined,
    });
  }
  return results;
}

export async function GET(req: NextRequest) {
  if (!authorised(req)) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  return NextResponse.json({ picked: pickAndRun() });
}

export async function POST(req: NextRequest) {
  if (!authorised(req)) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  return NextResponse.json({ picked: pickAndRun() });
}
