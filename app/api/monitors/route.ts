import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createMonitor, listMonitors } from "@/lib/monitor-store";
import { computeNextRunAt, isSchedulable } from "@/lib/monitor-scheduler";
import { startMonitorRun } from "@/lib/monitor-runner";
import { PEOPLE_FIELDS } from "@/lib/enrichment-fields";

const CUSTOM_FIELD_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 _\-/&]{0,99}$/;

const ManualEngagerSchema = z.object({
  linkedinUrl: z
    .string()
    .trim()
    .regex(/^https?:\/\/(www\.)?linkedin\.com\/in\/[^/?#\s]+\/?$/i, "Must be a LinkedIn profile URL"),
  name: z.string().trim().max(200).optional(),
  engagementType: z.enum(["like", "comment", "reaction"]).optional(),
  engagementText: z.string().max(2000).optional(),
  postUrl: z.string().url().optional(),
});

const ConfigSchema = z.object({
  keywords: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
  profileUrl: z.string().trim().url().optional(),
  postUrls: z.array(z.string().trim().url()).max(20).optional(),
});

const CreateMonitorSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    mode: z.enum(["keyword", "profile", "post", "instant"]),
    config: ConfigSchema,
    schedule: z.enum(["manual", "once", "daily", "weekly", "monthly"]),
    active: z.boolean().optional().default(true),
    webhookUrl: z.string().trim().url().optional(),
    requestedFields: z
      .array(z.string().min(1))
      .min(1, "At least one enrichment field required")
      .max(50),
    customFieldDefs: z
      .array(
        z.object({
          name: z
            .string()
            .trim()
            .min(1)
            .max(100)
            .regex(CUSTOM_FIELD_NAME_RE, "Invalid custom field name"),
          description: z.string().max(500).default(""),
        })
      )
      .max(20)
      .optional()
      .default([]),
    outreachContext: z.string().trim().max(1000).optional(),
    manualEngagers: z.array(ManualEngagerSchema).max(500).optional(),
    runNow: z.boolean().optional().default(false),
  })
  .refine(
    (v) => {
      switch (v.mode) {
        case "keyword":
          return (v.config.keywords?.length ?? 0) > 0;
        case "profile":
          return !!v.config.profileUrl;
        case "post":
        case "instant":
          return (v.config.postUrls?.length ?? 0) > 0 || (v.manualEngagers?.length ?? 0) > 0;
        default:
          return false;
      }
    },
    { message: "Config does not match selected mode" }
  );

export async function GET() {
  return NextResponse.json({ monitors: listMonitors() });
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const parsed = CreateMonitorSchema.safeParse(body);
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

  const validFieldKeys = new Set(PEOPLE_FIELDS.map((f) => f.key));
  const customNameSet = new Set(data.customFieldDefs.map((f) => f.name));
  const invalid = data.requestedFields.filter(
    (f) => !validFieldKeys.has(f) && !customNameSet.has(f)
  );
  if (invalid.length > 0) {
    return NextResponse.json(
      { error: `Invalid enrichment fields: ${invalid.join(", ")}` },
      { status: 400 }
    );
  }

  const shouldSchedule = isSchedulable(data.schedule);
  const nextRunAt = shouldSchedule ? computeNextRunAt(data.schedule) : undefined;

  const monitor = createMonitor({
    name: data.name,
    mode: data.mode,
    config: data.config,
    schedule: data.schedule,
    webhookUrl: data.webhookUrl,
    requestedFields: data.requestedFields,
    customFieldDefs: data.customFieldDefs,
    outreachContext: data.outreachContext,
    manualEngagers: data.manualEngagers,
    nextRunAt,
  });

  let firstRun: { status: string; runId?: string; reason?: string } | undefined;
  if (data.runNow || data.mode === "instant") {
    const r = startMonitorRun({ monitorId: monitor.id, trigger: "create" });
    firstRun = { status: r.status, runId: "runId" in r ? r.runId : undefined };
    if (r.status === "cap_exceeded") firstRun.reason = r.reason;
  }

  return NextResponse.json({ monitor, run: firstRun }, { status: 201 });
}
