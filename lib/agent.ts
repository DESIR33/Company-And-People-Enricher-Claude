import { query, SYSTEM_PROMPT_DYNAMIC_BOUNDARY } from "@anthropic-ai/claude-agent-sdk";
import { COMPANY_FIELDS, PEOPLE_FIELDS, type FieldDefinition } from "./enrichment-fields";

export type CustomFieldDef = { name: string; description: string };

type AgentEnrichParams = {
  type: "company" | "people";
  identifier: string;
  requestedFields: string[];
  customFieldDefs?: CustomFieldDef[];
  newsParams?: { count: number; timeframe: string };
  model?: string;
  signal?: AbortSignal;
};

const NEWS_KEY_RE = /^recent_news_\d+$/;
const MAX_AGENT_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 8000;

// SDKResultError subtypes we consider transient and worth retrying. Quota /
// budget / max-turns failures are terminal — retrying burns money to hit the
// same wall.
const RETRYABLE_RESULT_SUBTYPES = new Set(["error_during_execution"]);

function backoffDelay(attemptIndex: number): number {
  const base = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** attemptIndex);
  const jitter = base * (0.5 + Math.random() * 0.5);
  return Math.floor(jitter);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

type PromptParts = { systemPrompt: string; userPrompt: string };

function buildPromptParts(params: AgentEnrichParams): PromptParts {
  const allFields = params.type === "company" ? COMPANY_FIELDS : PEOPLE_FIELDS;
  const customFieldDefs = params.customFieldDefs ?? [];

  const standardFields = allFields.filter(
    (f) => params.requestedFields.includes(f.key) && !f.requiresProspeo && !f.isParameterized
  );

  const newsFields = params.requestedFields.filter((f) => NEWS_KEY_RE.test(f));

  const standardFieldLines = standardFields
    .map((f: FieldDefinition) => `- ${f.key}: ${f.description}`)
    .join("\n");

  const customFieldLines =
    customFieldDefs.length > 0
      ? `\nADDITIONAL CUSTOM FIELDS TO EXTRACT:\n` +
        customFieldDefs.map((f) => `- ${f.name}: ${f.description || f.name}`).join("\n")
      : "";

  const fieldsSection = standardFieldLines + customFieldLines;

  const standardKeys = standardFields
    .map((f: FieldDefinition) => `"${f.key}": ""`)
    .join(",\n  ");
  const customKeys = customFieldDefs.map((f) => `"${f.name}": ""`).join(",\n  ");
  const newsKeys   = newsFields.map((f) => `"${f}": ""`).join(",\n  ");
  const allKeys = [standardKeys, customKeys, newsKeys].filter(Boolean).join(",\n  ");

  const newsSection =
    newsFields.length > 0 && params.newsParams
      ? `\nRECENT NEWS (${params.newsParams.timeframe}, ${params.newsParams.count} article${params.newsParams.count !== 1 ? "s" : ""}):\n` +
        `Search "[company name] news" to find the ${params.newsParams.count} most recent articles published in the ${params.newsParams.timeframe}.\n` +
        `Return each as a separate JSON field in this format: "[Mon YYYY] Headline — One sentence summary"\n` +
        newsFields.map((f, i) => `- ${f}: Article #${i + 1} (most recent first)`).join("\n") +
        `\nUse "NA" if fewer articles exist within the timeframe.`
      : "";

  if (params.type === "company") {
    const systemPrompt = `You are a company research specialist. Find specific information about a company.

FIELDS TO FIND:
${fieldsSection}${newsSection}

INSTRUCTIONS:
1. Use WebSearch to find the company's website and LinkedIn page
2. Use WebFetch to load the company LinkedIn page and website to extract accurate data
3. For funding and revenue, search "[company name] funding revenue crunchbase"
4. For technologies, search "[company name] tech stack" or fetch their jobs page
5. For news, search "[company name] news [current year]" and use recent results
6. For contact channels (phone, Instagram, Facebook, Google Business Profile), check the website's footer and contact page first, then search "[company name] [city] google maps" for the Google Business Profile and "[company name] instagram" / "[company name] facebook" for socials. Prefer accounts with recent activity over abandoned ones.

OUTPUT FORMAT:
Respond with ONLY a valid JSON object. No markdown, no prose, no code fences.
Use "NA" for any field you cannot find.

{
  ${allKeys}
}`;
    const userPrompt = `COMPANY IDENTIFIER: ${params.identifier}
(This is the company's website URL or LinkedIn URL)`;
    return { systemPrompt, userPrompt };
  }

  const systemPrompt = `You are a professional researcher specializing in business professionals.

FIELDS TO FIND:
${fieldsSection}${newsSection}

INSTRUCTIONS:
1. Use WebFetch to load the LinkedIn profile URL directly
2. Extract job title, company, location, seniority, and headline from the page
3. For seniority level, infer from title: Junior/Mid/Senior/Lead/Manager/Director/VP/C-Suite
4. If the LinkedIn page is blocked, use WebSearch for the person's name + "linkedin"
5. Do NOT attempt to find email — that is handled separately

OUTPUT FORMAT:
Respond with ONLY a valid JSON object. No markdown, no prose, no code fences.
Use "NA" for any field you cannot find.

{
  ${allKeys}
}`;
  const userPrompt = `PERSON IDENTIFIER: ${params.identifier}
(This is the person's LinkedIn profile URL)`;
  return { systemPrompt, userPrompt };
}

function parseAgentOutput(
  raw: string,
  requestedFields: string[]
): Record<string, string> {
  const emptyResult = Object.fromEntries(requestedFields.map((f) => [f, ""]));

  const cleaned = raw
    .replace(/^```json\s*/im, "")
    .replace(/^```\s*/im, "")
    .replace(/```\s*$/m, "")
    .trim();

  try {
    const parsed = JSON.parse(cleaned);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return normalizeFields(parsed, requestedFields);
    }
  } catch {
    // fallthrough
  }

  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      if (typeof parsed === "object" && parsed !== null) {
        return normalizeFields(parsed, requestedFields);
      }
    } catch {
      // fallthrough
    }
  }

  return emptyResult;
}

function normalizeFields(
  parsed: Record<string, unknown>,
  requestedFields: string[]
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const key of requestedFields) {
    const val = parsed[key];
    if (val === null || val === undefined) {
      result[key] = "";
    } else {
      let str = String(val);
      if (key === "description" && str.length > 500) {
        str = str.slice(0, 497) + "...";
      }
      result[key] = str;
    }
  }
  return result;
}

export async function enrichWithAgent(
  params: AgentEnrichParams
): Promise<{
  fields: Record<string, string>;
  costUsd: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}> {
  const customFieldNames = new Set((params.customFieldDefs ?? []).map((f) => f.name));

  const nonProspeoFields = params.requestedFields.filter((f) => {
    if (customFieldNames.has(f) || NEWS_KEY_RE.test(f)) return true;
    const allFields = params.type === "company" ? COMPANY_FIELDS : PEOPLE_FIELDS;
    const def = allFields.find((d) => d.key === f);
    return def && !def.requiresProspeo;
  });

  if (nonProspeoFields.length === 0) {
    return { fields: {}, costUsd: 0, cacheReadTokens: 0, cacheCreationTokens: 0 };
  }

  const { systemPrompt, userPrompt } = buildPromptParts({
    ...params,
    requestedFields: nonProspeoFields,
  });

  // Cost and cache counters accumulate across attempts — a failed attempt
  // that never produced a parseable result still bills tokens.
  let rawResult = "";
  let costUsd = 0;
  let cacheReadTokens = 0;
  let cacheCreationTokens = 0;
  let lastError: unknown;
  let lastErrorSubtype: string | undefined;

  for (let attempt = 0; attempt < MAX_AGENT_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      try {
        await sleep(backoffDelay(attempt - 1), params.signal);
      } catch {
        // Aborted during backoff — fall through to the abort handling below.
        throw lastError ?? new DOMException("Aborted", "AbortError");
      }
      console.warn(
        `enrichWithAgent: retrying (attempt ${attempt + 1}/${MAX_AGENT_ATTEMPTS}) after ${
          lastErrorSubtype ?? (lastError instanceof Error ? lastError.message : "error")
        }`
      );
    }

    const attemptAbort = new AbortController();
    if (params.signal) {
      if (params.signal.aborted) attemptAbort.abort();
      else params.signal.addEventListener("abort", () => attemptAbort.abort(), { once: true });
    }

    let attemptRaw = "";
    let attemptSubtype: string | undefined;

    try {
      for await (const message of query({
        prompt: userPrompt,
        options: {
          model: params.model ?? "claude-haiku-4-5-20251001",
          systemPrompt: [systemPrompt, SYSTEM_PROMPT_DYNAMIC_BOUNDARY],
          allowedTools: ["WebSearch", "WebFetch"],
          maxTurns: params.type === "people" ? 15 : 10,
          permissionMode: "acceptEdits",
          abortController: attemptAbort,
        },
      })) {
        if (
          typeof message === "object" &&
          message !== null &&
          (message as { type?: string }).type === "result"
        ) {
          const msg = message as {
            subtype?: string;
            result?: unknown;
            total_cost_usd?: number;
            modelUsage?: Record<string, { cacheReadInputTokens?: number; cacheCreationInputTokens?: number }>;
          };
          costUsd += msg.total_cost_usd ?? 0;
          for (const usage of Object.values(msg.modelUsage ?? {})) {
            cacheReadTokens += usage.cacheReadInputTokens ?? 0;
            cacheCreationTokens += usage.cacheCreationInputTokens ?? 0;
          }
          if (msg.subtype === "success") {
            attemptRaw = String(msg.result ?? "");
          } else if (msg.subtype) {
            attemptSubtype = msg.subtype;
          }
        }
      }
    } catch (err) {
      if (params.signal?.aborted) throw err;
      lastError = err;
      lastErrorSubtype = undefined;
      continue;
    }

    if (attemptRaw) {
      rawResult = attemptRaw;
      lastError = undefined;
      lastErrorSubtype = undefined;
      break;
    }

    // No usable result from this attempt.
    lastError = undefined;
    lastErrorSubtype = attemptSubtype;
    if (attemptSubtype && !RETRYABLE_RESULT_SUBTYPES.has(attemptSubtype)) {
      console.warn(`enrichWithAgent: terminal result subtype "${attemptSubtype}", not retrying`);
      break;
    }
  }

  if (!rawResult) {
    if (lastError) console.error("Agent error:", lastError);
    return {
      fields: Object.fromEntries(nonProspeoFields.map((f) => [f, ""])),
      costUsd,
      cacheReadTokens,
      cacheCreationTokens,
    };
  }

  const fields = parseAgentOutput(rawResult, nonProspeoFields);
  return { fields, costUsd, cacheReadTokens, cacheCreationTokens };
}
