import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  createSignalMonitor,
  listSignalMonitorsByWorkspace,
  type SignalType,
} from "@/lib/signal-store";
import { startSignalMonitorRun } from "@/lib/signal-runner";
import { computeNextRunAt, isSchedulable } from "@/lib/monitor-scheduler";
import { getActiveWorkspaceId } from "@/lib/workspace-context";

const SCHEDULE_ENUM = z.enum(["manual", "once", "daily", "weekly", "monthly"]);

const BaseSchema = z.object({
  name: z.string().trim().min(1).max(120),
  schedule: SCHEDULE_ENUM,
  maxResults: z.number().int().min(1).max(50).default(25),
  timeframe: z.string().trim().min(1).max(60).default("last 14 days"),
  runNow: z.boolean().optional().default(false),
  industryFilter: z.string().trim().max(300).optional(),
  geoFilter: z.string().trim().max(300).optional(),
  sizeFilter: z.string().trim().max(120).optional(),
  icpHint: z.string().trim().max(1000).optional(),
});

const FundingSchema = BaseSchema.extend({
  signalType: z.literal("funding"),
  stageFilter: z.array(z.string().trim().min(1).max(40)).max(10).optional(),
  minAmount: z.number().int().min(0).optional(),
  maxAmount: z.number().int().min(0).optional(),
});

const HiringSchema = BaseSchema.extend({
  signalType: z.literal("hiring"),
  roles: z
    .array(z.string().trim().min(1).max(100))
    .min(1, "Add at least one role")
    .max(15),
});

const NewsSchema = BaseSchema.extend({
  signalType: z.literal("news"),
  keywords: z
    .array(z.string().trim().min(1).max(100))
    .min(1, "Add at least one keyword")
    .max(20),
});

const ReviewsSchema = BaseSchema.extend({
  signalType: z.literal("reviews"),
  reviewPlatform: z.enum(["google", "yelp", "any"]).default("google"),
  reviewSentiment: z.enum(["positive", "negative", "any"]).default("any"),
  minReviewCount: z.number().int().min(1).max(100).default(3),
});

const CreateSignalSchema = z.discriminatedUnion("signalType", [
  FundingSchema,
  HiringSchema,
  NewsSchema,
  ReviewsSchema,
]);

export async function GET() {
  const workspaceId = await getActiveWorkspaceId();
  return NextResponse.json({ monitors: listSignalMonitorsByWorkspace(workspaceId) });
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const parsed = CreateSignalSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Invalid request",
        issues: parsed.error.issues.map(
          (i) => `${i.path.join(".")}: ${i.message}`
        ),
      },
      { status: 400 }
    );
  }

  const data = parsed.data;
  const shouldSchedule = isSchedulable(data.schedule);
  const nextRunAt = shouldSchedule ? computeNextRunAt(data.schedule) : undefined;

  const baseConfig = {
    industryFilter: data.industryFilter,
    geoFilter: data.geoFilter,
    sizeFilter: data.sizeFilter,
    icpHint: data.icpHint,
  };
  let config: Record<string, unknown>;
  let signalType: SignalType;
  if (data.signalType === "funding") {
    signalType = "funding";
    config = {
      ...baseConfig,
      stageFilter: data.stageFilter,
      minAmount: data.minAmount,
      maxAmount: data.maxAmount,
    };
  } else if (data.signalType === "hiring") {
    signalType = "hiring";
    config = { ...baseConfig, roles: data.roles };
  } else if (data.signalType === "news") {
    signalType = "news";
    config = { ...baseConfig, keywords: data.keywords };
  } else {
    signalType = "reviews";
    config = {
      ...baseConfig,
      reviewPlatform: data.reviewPlatform,
      reviewSentiment: data.reviewSentiment,
      minReviewCount: data.minReviewCount,
    };
  }

  const workspaceId = await getActiveWorkspaceId();
  const monitor = createSignalMonitor({
    workspaceId,
    name: data.name,
    signalType,
    config,
    schedule: data.schedule,
    maxResults: data.maxResults,
    timeframe: data.timeframe,
    nextRunAt,
  });

  let firstRun: { status: string; searchId?: string; reason?: string } | undefined;
  if (data.runNow) {
    const r = startSignalMonitorRun({ monitorId: monitor.id, trigger: "create" });
    firstRun = {
      status: r.status,
      searchId: "searchId" in r ? r.searchId : undefined,
      reason:
        r.status === "cap_exceeded" || r.status === "not_found"
          ? r.reason
          : undefined,
    };
  }

  return NextResponse.json({ monitor, run: firstRun }, { status: 201 });
}
