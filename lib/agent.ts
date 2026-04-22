import { query, SYSTEM_PROMPT_DYNAMIC_BOUNDARY } from "@anthropic-ai/claude-agent-sdk";
import { getFields, type FieldDefinition } from "./enrichment-fields";
import type { ScoreRubric } from "./job-store";

export type CustomFieldDef = { name: string; description: string };

type AgentEnrichParams = {
  type: "company" | "people" | "decision_maker" | "lead_score";
  identifier: string;
  requestedFields: string[];
  customFieldDefs?: CustomFieldDef[];
  newsParams?: { count: number; timeframe: string };
  outreachContext?: string;
  scoreRubric?: ScoreRubric;
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
  const allFields = getFields(params.type);
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

  const outreachContext = params.outreachContext?.trim();
  const firstLineSection = params.requestedFields.includes("first_line")
    ? `\nFIRST LINE (outreach opener):\n` +
      `Generate ONE SENTENCE (max ~25 words) that could be pasted as the opening line of an outreach email, DM, or LinkedIn message. Rules:\n` +
      `- Reference something SPECIFIC you found in your research — a recent funding round, a new location, a hire, a product launch, a news headline, a tenure milestone, a tech choice, a job title change. Generic "Hi, I saw your company is in X industry" style openers are NOT acceptable.\n` +
      `- Write in first person, casual and curious, not salesy. Think "how a human would actually open a cold message", not a templated mail merge.\n` +
      `- Vary openings. AVOID the overused "I noticed…" / "Hope you're well…" / "Quick question…" templates.\n` +
      `- Do NOT pitch, do NOT ask for a meeting, do NOT include greetings like "Hi [Name]," — just the one sentence that comes right after the greeting.\n` +
      (outreachContext
        ? `- The sender's context / angle is: "${outreachContext}". Lightly connect your opener to something in the research that would make this angle relevant, WITHOUT pitching the product.\n`
        : "") +
      `- If nothing concrete is known, return "NA" rather than a generic line.`
    : "";

  if (params.type === "decision_maker") {
    const systemPrompt = `You are a B2B prospecting researcher for cold outreach to LOCAL BUSINESSES (restaurants, dentists, plumbers, boutiques, med spas, agencies, etc.). Given a business name (optionally with city), you must identify the real decision maker, enumerate reachable contact channels, and score how qualified the lead is.

FIELDS TO FIND:
${fieldsSection}${firstLineSection}

RESEARCH PLAYBOOK:
1. RESOLVE THE BUSINESS. The input is a business name — possibly ambiguous (many "Joe's Pizza"). Search '"[name]" [city if given]' and identify the most likely single business. Confirm with Google Maps / Google Business Profile + website. If the name is generic and no city is given, prefer the business with the strongest web footprint.
2. EXTRACT BUSINESS CHANNELS. Visit the website (footer, /contact, /about), Google Business Profile, Facebook page, Instagram bio. Capture phone, email, socials, Google Business URL.
3. FIND THE DECISION MAKER. Try these sources in order, stopping when you have a confident match:
   a. LinkedIn: search 'site:linkedin.com/in "[business name]" (owner OR founder OR "general manager" OR principal)'.
   b. Google Business Profile / Google Maps: owner is sometimes listed in responses to reviews or the profile itself.
   c. Facebook About / Page Transparency: often lists page admins or a named owner.
   d. Website About / Team / Meet the Owner pages.
   e. Local news, press releases, chamber-of-commerce listings.
   If several candidates appear, prefer the one whose role is explicitly Owner/Founder/Principal, then General Manager, then Manager. For franchises, prefer the local operator, not the corporate CEO.
4. PICK THE BEST CONTACT CHANNEL. Choose the ONE channel most likely to actually get a reply based on observable signals: a freshly-updated LinkedIn > an actively-posting Instagram > Google Business Message enabled > phone > generic info@ email. If the decision maker has a personal LinkedIn with recent activity, that almost always wins.
5. SCORE QUALIFICATION. This is a JUDGEMENT, not a fact. Use this rubric; award partial credit where appropriate; the five sub-scores MUST sum to qualification_score:
   - DM Identified (0–25): 25 = named owner confirmed by ≥2 sources. 15 = single strong source. 8 = inferred (e.g. small-team LinkedIn search). 0 = unknown.
   - Reachability (0–25): 25 = direct personal channel (LinkedIn DM / Instagram DM of the owner). 15 = warm business channel (Google Business Messages enabled, active Facebook page). 8 = phone/email only. 0 = no working channel.
   - Digital Presence (0–25): 25 = website + GBP + active social. 15 = two of the three. 8 = one. 0 = none.
   - Activity Signal (0–15): recent posts / recent review replies / recent news within 90 days. 0 = dormant.
   - Fit (0–10): if an outreach context is provided, score how well this business matches. If no context is provided, default to 7.
   Then: qualification_tier = A (80–100) / B (60–79) / C (40–59) / D (0–39).
   qualification_breakdown MUST follow: 'DM Identified: X/25; Reachability: X/25; Digital Presence: X/25; Activity Signal: X/15; Fit: X/10'.
6. HONESTY RULES. Do NOT invent an owner name. If you cannot identify a specific decision maker with reasonable confidence, return 'NA' for decision_maker_name/title/linkedin and set decision_maker_confidence to 'Low' — this is better than hallucinating. Do NOT guess personal email addresses; return 'NA' unless the email is published and clearly tied to this person.
${params.outreachContext?.trim() ? `\nOUTREACH CONTEXT (use to tune 'Fit' score and first_line): "${params.outreachContext.trim()}"\n` : ""}
OUTPUT FORMAT:
Respond with ONLY a valid JSON object. No markdown, no prose, no code fences.
Use "NA" for any field you genuinely cannot find. Do NOT use "NA" for qualification fields — always produce a score based on what you did find.

{
  ${allKeys}
}`;
    const userPrompt = `BUSINESS IDENTIFIER: ${params.identifier}
(This is a local business name. It may include a city or location hint — if so, use it to disambiguate. If not, identify the most likely single business from web signals.)`;
    return { systemPrompt, userPrompt };
  }

  if (params.type === "lead_score") {
    const rubric = params.scoreRubric ?? {
      icpCriteria: "(no ICP provided — default to moderate fit)",
      painSignals: "(no pain signals provided — default to neutral)",
      reachability: "(no reachability preferences — use general signals: named leaders, active LinkedIn, public contact info)",
      weights: { icp: 40, pain: 35, reach: 25 },
    };
    const wIcp   = rubric.weights.icp;
    const wPain  = rubric.weights.pain;
    const wReach = rubric.weights.reach;

    const systemPrompt = `You are a B2B lead scoring analyst. Given a company URL, you will research the company and then score it against a CONFIGURABLE RUBRIC across three dimensions: ICP fit, pain signal, and reachability. Your output feeds a prioritised top-N list that a human SDR works through — accuracy of the SCORE and honesty of the REASONING matter more than filling every field.

FIELDS TO FIND:
${fieldsSection}${firstLineSection}

RUBRIC (defined by the user — score against THIS, not a generic definition):

1. ICP FIT (weight: ${wIcp}%)
   Criteria: ${rubric.icpCriteria}
   Score 0–100:
     - 90–100 = textbook match on every dimension in the criteria
     - 70–89  = strong match on most dimensions, one or two soft misses
     - 50–69  = partial match — right industry/segment but off on size/geo/stage
     - 30–49  = adjacent space, weak match
     - 0–29   = clearly not the ICP

2. PAIN SIGNAL (weight: ${wPain}%)
   Signals to look for: ${rubric.painSignals}
   Score 0–100 based on observable evidence within the last ~12 months:
     - 90–100 = multiple strong, recent signals (e.g. just raised + actively hiring for the role + public job postings match)
     - 70–89  = one strong recent signal
     - 50–69  = weaker / older signal, or adjacent pain (e.g. growth without specific trigger)
     - 30–49  = inferred pain only — no concrete signal
     - 0–29   = no visible pain / company appears stable and unmotivated to change
   NEVER invent signals. If you cannot find evidence of a signal, say so and score low.

3. REACHABILITY (weight: ${wReach}%)
   Preferences: ${rubric.reachability}
   Score 0–100 based on what you can actually find:
     - 90–100 = named decision maker with active personal LinkedIn AND a second channel (public email / Twitter / personal site)
     - 70–89  = named decision maker with ONE active channel
     - 50–69  = company-level contact only (generic email, LinkedIn company page), but named leadership visible
     - 30–49  = only generic company contact form / info@ email
     - 0–29   = no workable channel found

TOTAL SCORE:
total_score = round((icp_fit_score × ${wIcp} + pain_signal_score × ${wPain} + reachability_score × ${wReach}) / 100)
priority_tier = A (80–100) / B (65–79) / C (45–64) / D (0–44)

RESEARCH PLAYBOOK:
1. WebSearch for the company website and LinkedIn page. Use WebFetch to read the site (especially /about, /careers, /blog, /customers) and the LinkedIn company page.
2. Search "[company name] funding" / "[company name] news [current year]" for recent signals. Check their /careers or a jobs board search for active hiring.
3. Search 'site:linkedin.com/in "[company name]" (founder OR CEO OR "VP ${wReach >= 25 ? "Engineering OR VP Sales" : "Sales"}")' to find a named decision maker with an active profile. Check whether the profile has recent posts / recent activity.
4. Extract standard company snapshot fields along the way — they are evidence for the scores and let a human sanity-check your judgement.

HONESTY RULES:
- Reasoning fields MUST cite concrete evidence from your research. If you write "actively hiring", name the role or link; if you write "named DM", give the name and title. Generic reasoning like "fits the ICP" without specifics is unacceptable — downgrade the score instead.
- NEVER invent funding rounds, headcounts, or hiring signals. Use "NA" for fields you cannot find, and let the score reflect that gap.
- The three sub-scores feed total_score via the weighted formula. Compute it. Do NOT fudge.
- score_explanation is the one text field a human reads first — write TWO sentences: one that explains the score, one that tells the SDR what to do ("Prioritise — ICP fit + recent Series B + CEO posts weekly" / "Skip — wrong vertical, no visible trigger").
${params.outreachContext?.trim() ? `\nOUTREACH CONTEXT (use in first_line and let it influence pain-signal interpretation): "${params.outreachContext.trim()}"\n` : ""}
OUTPUT FORMAT:
Respond with ONLY a valid JSON object. No markdown, no prose, no code fences.
Use "NA" for company-snapshot fields you cannot find.
Scoring fields (icp_fit_score, pain_signal_score, reachability_score, total_score, priority_tier, *_reasoning, score_explanation) MUST always be populated — they are a judgement grounded in what you DID find.

{
  ${allKeys}
}`;
    const userPrompt = `COMPANY IDENTIFIER: ${params.identifier}
(This is the company's website URL or LinkedIn URL. Score it against the rubric above.)`;
    return { systemPrompt, userPrompt };
  }

  if (params.type === "company") {
    const systemPrompt = `You are a company research specialist. Find specific information about a company.

FIELDS TO FIND:
${fieldsSection}${newsSection}${firstLineSection}

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
${fieldsSection}${newsSection}${firstLineSection}

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
    const def = getFields(params.type).find((d) => d.key === f);
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
          maxTurns:
            params.type === "decision_maker" ? 20 :
            params.type === "lead_score"     ? 18 :
            params.type === "people"         ? 15 : 10,
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
