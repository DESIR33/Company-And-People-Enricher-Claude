import { query, SYSTEM_PROMPT_DYNAMIC_BOUNDARY } from "@anthropic-ai/claude-agent-sdk";
import type { DiscoveryMode } from "./discovery-store";

export type DiscoveredCompany = {
  companyName: string;
  websiteUrl?: string;
  linkedinUrl?: string;
  description?: string;
  location?: string;
  industry?: string;
  employeeRange?: string;
  matchReason?: string;
  sourceUrl?: string;
  score?: number;
};

export type DiscoveryAgentResult = {
  companies: DiscoveredCompany[];
  costUsd: number;
  note?: string;
};

type DiscoveryParams = {
  mode: DiscoveryMode;
  queryText: string;
  seedCompanies?: string[];
  maxResults: number;
  signal?: AbortSignal;
  model?: string;
  onLog?: (line: string) => void;
};

const MAX_DISCOVERY_TURNS = 30;

const COMMON_SYSTEM = `You are a B2B lead-sourcing agent. Your job is to find REAL companies that match an Ideal Customer Profile (ICP) using public web search.

HONESTY RULES:
1. Every company you return MUST be a real, verifiable business. Prefer companies whose website you can cite.
2. Never invent company names or websites. If you cannot verify a candidate, skip it.
3. Prefer specificity over volume. A smaller list of well-matched companies is more useful than a large list of generic ones.
4. Do NOT return consulting firms, staffing agencies, or marketplaces UNLESS those are explicitly part of the ICP.
5. Skip franchises of the same parent — return the parent brand once, not every location.

RESEARCH TOOLS:
- WebSearch — Google-style queries. Use operators: site:, intitle:, "exact phrase".
- WebFetch — load a URL to verify a candidate is real and matches the ICP.

TACTICS (use several, not just one):
- Industry directories (Yelp, Google Maps category pages, chamber of commerce, trade association member lists).
- Category/listicle pages ("top 50 X companies", "best Y in Z").
- Local business listings when the ICP is geographic.
- Competitor pages ("alternatives to X", "vs Y") when the ICP names a category leader.
- Crunchbase / PitchBook / LinkedIn company pages surfaced via Google.
- Job-board searches when the ICP wants companies hiring for a specific role (a strong buying signal).

OUTPUT FORMAT — return ONLY a single JSON object, no prose, no code fences:
{
  "note": "one-sentence summary of what you found and what you couldn't",
  "companies": [
    {
      "companyName": "Acme Roofing",
      "websiteUrl": "https://acmeroofing.com",
      "linkedinUrl": "https://www.linkedin.com/company/acme-roofing",
      "description": "Family-owned residential roofing in Austin, TX",
      "location": "Austin, TX, USA",
      "industry": "Roofing contractor",
      "employeeRange": "10-50",
      "matchReason": "Residential roofing in Austin metro, ~20 employees, matches ICP",
      "sourceUrl": "https://www.google.com/maps/search/roofers+austin",
      "score": 85
    }
  ]
}

Rules for fields:
- companyName — REQUIRED. The brand name as used publicly.
- websiteUrl — strongly preferred. Skip if you cannot identify the primary domain.
- linkedinUrl — include ONLY if you have a verifiable company slug (https://www.linkedin.com/company/<slug>).
- score — 0-100 fit score against the ICP; be honest, most candidates are 50-80.
- sourceUrl — the page where you confirmed the candidate exists.
- matchReason — one sentence explaining why this company matches the ICP.

If you find nothing, return {"note":"...","companies":[]}. DO NOT include markdown.`;

function buildPrompts(params: DiscoveryParams): { system: string; user: string } {
  if (params.mode === "lookalike") {
    const seeds = (params.seedCompanies ?? []).filter(Boolean);
    const list = seeds.map((s, i) => `${i + 1}. ${s}`).join("\n");
    const extra = params.queryText.trim()
      ? `\n\nAdditional constraints from the user: ${params.queryText.trim()}`
      : "";
    return {
      system: COMMON_SYSTEM,
      user: `Find up to ${params.maxResults} companies that look like these seed companies:

${list}${extra}

Workflow:
1. Visit each seed company's website or LinkedIn to understand: what they sell, who they sell to, their size range, their geography.
2. Identify the 2-3 shared traits that define the cohort (industry vertical, business model, stage, geography).
3. Use WebSearch to find other companies sharing those traits. Try:
   - "alternatives to <seed>"
   - "<seed> competitors"
   - "companies like <seed>"
   - Industry listicles: "top <category> companies"
4. Skip the seed companies themselves in the output.
5. Score each candidate against the shared cohort traits.

Target: ${params.maxResults} well-matched companies.`,
    };
  }

  // icp mode
  return {
    system: COMMON_SYSTEM,
    user: `Find up to ${params.maxResults} companies matching this Ideal Customer Profile:

"""
${params.queryText.trim()}
"""

Workflow:
1. Parse the ICP into discrete, searchable attributes (industry, size, geography, stage, tech stack, buying signals).
2. Run at least 3 different search strategies — a directory search, a listicle search, and a targeted Google query. Don't stop after one.
3. For each candidate, verify it matches the attributes before including it. If unsure, fetch the homepage to confirm.
4. Deduplicate by website domain — same company, different subdomain is still one company.
5. Score each candidate 0-100 on how well they fit the ICP; include a one-sentence matchReason.

Target: ${params.maxResults} verified candidates.`,
  };
}

type DiscoveryJSON = {
  note?: string;
  companies?: Array<Partial<DiscoveredCompany>>;
};

function parseDiscovery(raw: string): DiscoveryJSON {
  const cleaned = raw
    .replace(/^```json\s*/im, "")
    .replace(/^```\s*/im, "")
    .replace(/```\s*$/m, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return { companies: [] };
    try {
      return JSON.parse(match[0]);
    } catch {
      return { companies: [] };
    }
  }
}

const LINKEDIN_COMPANY_RE =
  /^https?:\/\/(www\.)?linkedin\.com\/company\/[^/?#\s]+\/?/i;
const URL_RE = /^https?:\/\/[^\s]+$/i;

function cleanUrl(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  if (!URL_RE.test(trimmed)) return undefined;
  return trimmed.replace(/\/$/, "");
}

function normaliseCompany(c: Partial<DiscoveredCompany>): DiscoveredCompany | undefined {
  const name = (c.companyName ?? "").trim();
  if (!name) return undefined;
  const website = cleanUrl(c.websiteUrl);
  const linkedin = cleanUrl(c.linkedinUrl);
  const linkedinUrl =
    linkedin && LINKEDIN_COMPANY_RE.test(linkedin) ? linkedin : undefined;
  const rawScore = typeof c.score === "number" ? c.score : undefined;
  const score =
    rawScore === undefined
      ? undefined
      : Math.max(0, Math.min(100, Math.round(rawScore)));
  return {
    companyName: name,
    websiteUrl: website,
    linkedinUrl,
    description: c.description?.trim() || undefined,
    location: c.location?.trim() || undefined,
    industry: c.industry?.trim() || undefined,
    employeeRange: c.employeeRange?.trim() || undefined,
    matchReason: c.matchReason?.trim() || undefined,
    sourceUrl: cleanUrl(c.sourceUrl),
    score,
  };
}

function dedupKey(c: DiscoveredCompany): string {
  if (c.websiteUrl) {
    try {
      return new URL(c.websiteUrl).hostname.replace(/^www\./, "").toLowerCase();
    } catch {
      // fall through
    }
  }
  return c.companyName.trim().toLowerCase();
}

export async function discoverCompanies(
  params: DiscoveryParams
): Promise<DiscoveryAgentResult> {
  const { system, user } = buildPrompts(params);
  const push = (line: string): void => params.onLog?.(line);

  push(`Discovery started — mode=${params.mode}, maxResults=${params.maxResults}`);

  let raw = "";
  let costUsd = 0;

  try {
    for await (const message of query({
      prompt: user,
      options: {
        model: params.model ?? "claude-haiku-4-5-20251001",
        systemPrompt: [system, SYSTEM_PROMPT_DYNAMIC_BOUNDARY],
        allowedTools: ["WebSearch", "WebFetch"],
        maxTurns: MAX_DISCOVERY_TURNS,
        permissionMode: "acceptEdits",
        abortController: (() => {
          const ctrl = new AbortController();
          if (params.signal) {
            if (params.signal.aborted) ctrl.abort();
            else
              params.signal.addEventListener("abort", () => ctrl.abort(), {
                once: true,
              });
          }
          return ctrl;
        })(),
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
        };
        costUsd += msg.total_cost_usd ?? 0;
        if (msg.subtype === "success") raw = String(msg.result ?? "");
      }
    }
  } catch (err) {
    push(`Discovery aborted: ${String(err)}`);
    return { companies: [], costUsd, note: "Discovery aborted" };
  }

  if (!raw) {
    push("Agent returned no result");
    return { companies: [], costUsd, note: "No discovery output" };
  }

  const parsed = parseDiscovery(raw);
  const seen = new Set<string>();
  const companies: DiscoveredCompany[] = [];
  for (const c of parsed.companies ?? []) {
    const n = normaliseCompany(c);
    if (!n) continue;
    const key = dedupKey(n);
    if (seen.has(key)) continue;
    seen.add(key);
    companies.push(n);
    if (companies.length >= params.maxResults) break;
  }

  push(`Discovery complete — ${companies.length} company/companies returned`);
  if (parsed.note) push(`Agent note: ${parsed.note}`);

  return { companies, costUsd, note: parsed.note };
}
