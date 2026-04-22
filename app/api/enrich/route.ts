import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { parseCSV } from "@/lib/csv";
import {
  createJob,
  updateJob,
  updateRow,
  getJob,
  setJobAbortController,
  clearJobAbortController,
} from "@/lib/job-store";
import { enrichRow } from "@/lib/enrich-row";
import {
  getFields,
  LEAD_SCORE_REQUIRED_FIELDS,
  BUYING_TRIGGER_REQUIRED_FIELDS,
  BUYING_TRIGGER_SIGNAL_FIELDS,
} from "@/lib/enrichment-fields";

const MAX_ROWS = 200;
const MAX_ROWS_LEAD_SCORE = 500;
const CONCURRENCY = 15;
const NEWS_KEY_RE = /^recent_news_\d+$/;
const CUSTOM_FIELD_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 _\-/&]{0,99}$/;

const CustomFieldDefSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Custom field name is required")
    .max(100, "Custom field name is too long")
    .regex(
      CUSTOM_FIELD_NAME_RE,
      "Custom field name must start alphanumeric and contain only letters, numbers, spaces, _ - / &"
    )
    .refine((s) => !NEWS_KEY_RE.test(s), "Custom field name conflicts with reserved 'recent_news_N' pattern"),
  description: z.string().max(500, "Description is too long").default(""),
});

const NewsParamsSchema = z.object({
  count: z.number().int().min(1).max(10),
  timeframe: z.string().min(1).max(50),
});

const ScoreRubricSchema = z.object({
  icpCriteria:  z.string().trim().min(1, "ICP criteria is required").max(1000, "ICP criteria is too long"),
  painSignals:  z.string().trim().max(1000, "Pain signals is too long").default(""),
  reachability: z.string().trim().max(1000, "Reachability is too long").default(""),
  weights: z
    .object({
      icp:   z.number().int().min(0).max(100),
      pain:  z.number().int().min(0).max(100),
      reach: z.number().int().min(0).max(100),
    })
    .refine(
      (w) => w.icp + w.pain + w.reach === 100,
      { message: "Weights must sum to 100" }
    ),
});

const EnrichRequestSchema = z.object({
  type: z.enum(["company", "people", "decision_maker", "lead_score", "buying_trigger"]),
  csvContent: z.string().min(1, "csvContent is required"),
  identifierColumn: z.string().min(1, "identifierColumn is required"),
  requestedFields: z
    .array(z.string().min(1))
    .min(1, "At least one field must be requested")
    .max(200, "Too many requested fields"),
  customFieldDefs: z.array(CustomFieldDefSchema).max(50).optional().default([]),
  newsParams: NewsParamsSchema.optional(),
  outreachContext: z.string().trim().max(500, "outreachContext is too long").optional(),
  scoreRubric: ScoreRubricSchema.optional(),
});

async function processJob(jobId: string): Promise<void> {
  const jobMaybe = getJob(jobId);
  if (!jobMaybe) return;
  const job = jobMaybe;

  updateJob(jobId, { status: "processing" });

  const abortController = new AbortController();
  setJobAbortController(jobId, abortController);

  let nextIndex = 0;

  async function worker() {
    while (true) {
      if (abortController.signal.aborted) return;

      const rowIndex = nextIndex++;
      const row = job.rows[rowIndex];
      if (!row) return;

      updateRow(jobId, rowIndex, { status: "processing" });
      await enrichRow(job, rowIndex, { signal: abortController.signal });

      const processed = getJob(jobId)!.rows.filter(
        (r) => r.status === "done" || r.status === "error"
      ).length;
      updateJob(jobId, { processedRows: processed });
    }
  }

  try {
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  } finally {
    clearJobAbortController(jobId);
  }

  if (getJob(jobId)?.status !== "cancelled") {
    updateJob(jobId, { status: "completed" });
  }
}

export async function POST(request: NextRequest) {
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 });
  }

  const parsed = EnrichRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => {
      const path = i.path.length > 0 ? i.path.join(".") : "(root)";
      return `${path}: ${i.message}`;
    });
    return NextResponse.json({ error: "Invalid request", issues }, { status: 400 });
  }

  const { type, csvContent, identifierColumn, requestedFields, customFieldDefs, newsParams, outreachContext, scoreRubric } = parsed.data;

  if (type === "lead_score" && !scoreRubric) {
    return NextResponse.json(
      { error: "scoreRubric is required for lead_score jobs" },
      { status: 400 }
    );
  }

  try {
    const { headers, rows } = parseCSV(csvContent);

    if (!headers.includes(identifierColumn)) {
      return NextResponse.json(
        { error: `Column "${identifierColumn}" not found in CSV` },
        { status: 400 }
      );
    }
    if (rows.length === 0) {
      return NextResponse.json({ error: "CSV has no data rows" }, { status: 400 });
    }
    const rowCap = type === "lead_score" ? MAX_ROWS_LEAD_SCORE : MAX_ROWS;
    if (rows.length > rowCap) {
      return NextResponse.json(
        { error: `CSV has ${rows.length} rows. Maximum allowed is ${rowCap}.` },
        { status: 400 }
      );
    }

    const standardKeys = new Set(getFields(type).map((f) => f.key));
    const headerSet    = new Set(headers);
    const customNames  = customFieldDefs.map((f) => f.name);
    const customNameSet = new Set<string>();

    for (const name of customNames) {
      if (customNameSet.has(name)) {
        return NextResponse.json(
          { error: `Duplicate custom field name: "${name}"` },
          { status: 400 }
        );
      }
      if (standardKeys.has(name)) {
        return NextResponse.json(
          { error: `Custom field name "${name}" collides with a built-in field` },
          { status: 400 }
        );
      }
      if (headerSet.has(name)) {
        return NextResponse.json(
          { error: `Custom field name "${name}" collides with an existing CSV column` },
          { status: 400 }
        );
      }
      customNameSet.add(name);
    }

    const invalidFields = requestedFields.filter(
      (f) => !standardKeys.has(f) && !customNameSet.has(f) && !NEWS_KEY_RE.test(f)
    );
    if (invalidFields.length > 0) {
      return NextResponse.json(
        { error: `Invalid fields: ${invalidFields.join(", ")}` },
        { status: 400 }
      );
    }

    const hasNewsField = requestedFields.some((f) => NEWS_KEY_RE.test(f));
    if (hasNewsField && !newsParams) {
      return NextResponse.json(
        { error: "recent_news_N fields requested but newsParams is missing" },
        { status: 400 }
      );
    }

    // Lead-score jobs must always produce the full scoring payload so the
    // priority view can sort and tier rows.
    let finalRequestedFields = requestedFields;
    if (type === "lead_score") {
      const existing = new Set(requestedFields);
      finalRequestedFields = [
        ...requestedFields,
        ...LEAD_SCORE_REQUIRED_FIELDS.filter((f) => !existing.has(f)),
      ];
    }

    // Buying-trigger jobs: the heat-score rollup + outreach payload is the
    // whole point, so always include it. If the caller did not pick any trigger
    // signals to look for, default to the full set — otherwise the agent has
    // nothing to count.
    if (type === "buying_trigger") {
      const existing = new Set(requestedFields);
      const hasAnySignal = BUYING_TRIGGER_SIGNAL_FIELDS.some((f) => existing.has(f));
      const signalFieldsToAdd = hasAnySignal
        ? []
        : BUYING_TRIGGER_SIGNAL_FIELDS.filter((f) => !existing.has(f));
      finalRequestedFields = [
        ...requestedFields,
        ...signalFieldsToAdd,
        ...BUYING_TRIGGER_REQUIRED_FIELDS.filter((f) => !existing.has(f)),
      ];
    }

    const job = createJob({
      type,
      identifierColumn,
      requestedFields: finalRequestedFields,
      customFieldDefs,
      newsParams,
      outreachContext,
      scoreRubric,
      rows,
    });

    processJob(job.id).catch((err) => {
      console.error(`processJob failed for ${job.id}:`, err);
      updateJob(job.id, { status: "failed", error: String(err) });
    });

    return NextResponse.json({ jobId: job.id }, { status: 202 });
  } catch (err) {
    console.error("POST /api/enrich failed:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
