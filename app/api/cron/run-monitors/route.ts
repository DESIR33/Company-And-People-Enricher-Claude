import { NextRequest, NextResponse } from "next/server";
import { pickDueMonitors } from "@/lib/monitor-store";
import { startMonitorRun } from "@/lib/monitor-runner";
import { pickDueSignalMonitors } from "@/lib/signal-store";
import { startSignalMonitorRun } from "@/lib/signal-runner";

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
  const now = Date.now();

  const socialResults: Array<{
    kind: "social";
    monitorId: string;
    status: string;
    runId?: string;
    reason?: string;
  }> = [];
  for (const m of pickDueMonitors(now)) {
    const r = startMonitorRun({ monitorId: m.id, trigger: "schedule" });
    socialResults.push({
      kind: "social",
      monitorId: m.id,
      status: r.status,
      runId: "runId" in r ? r.runId : undefined,
      reason: r.status === "cap_exceeded" ? r.reason : undefined,
    });
  }

  const signalResults: Array<{
    kind: "signal";
    monitorId: string;
    status: string;
    searchId?: string;
    reason?: string;
  }> = [];
  for (const m of pickDueSignalMonitors(now)) {
    const r = startSignalMonitorRun({ monitorId: m.id, trigger: "schedule" });
    signalResults.push({
      kind: "signal",
      monitorId: m.id,
      status: r.status,
      searchId: "searchId" in r ? r.searchId : undefined,
      reason:
        r.status === "cap_exceeded" || r.status === "not_found" ? r.reason : undefined,
    });
  }

  return [...socialResults, ...signalResults];
}

export async function GET(req: NextRequest) {
  if (!authorised(req)) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  return NextResponse.json({ picked: pickAndRun() });
}

export async function POST(req: NextRequest) {
  if (!authorised(req)) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  return NextResponse.json({ picked: pickAndRun() });
}
