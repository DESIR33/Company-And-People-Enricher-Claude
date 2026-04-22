import { query, SYSTEM_PROMPT_DYNAMIC_BOUNDARY } from "@anthropic-ai/claude-agent-sdk";
import type { DirectoryConfig, DiscoveryMode } from "./discovery-store";

export type SignalAgentConfig = {
  signalType: "funding" | "hiring" | "news";
  timeframe: string;
  industryFilter?: string;
  geoFilter?: string;
  sizeFilter?: string;
  stageFilter?: string[];
  minAmount?: number;
  maxAmount?: number;
  roles?: string[];
  keywords?: string[];
  excludeDomains?: string[];
};

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
  signalConfig?: SignalAgentConfig;
  directoryConfig?: DirectoryConfig;
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

function renderFilters(cfg: SignalAgentConfig): string {
  const parts: string[] = [];
  if (cfg.industryFilter) parts.push(`Industry: ${cfg.industryFilter}`);
  if (cfg.geoFilter) parts.push(`Geography: ${cfg.geoFilter}`);
  if (cfg.sizeFilter) parts.push(`Size: ${cfg.sizeFilter}`);
  if (cfg.stageFilter?.length) parts.push(`Stages: ${cfg.stageFilter.join(", ")}`);
  if (cfg.minAmount !== undefined)
    parts.push(`Min raise: $${cfg.minAmount.toLocaleString()}`);
  if (cfg.maxAmount !== undefined)
    parts.push(`Max raise: $${cfg.maxAmount.toLocaleString()}`);
  if (cfg.roles?.length) parts.push(`Roles: ${cfg.roles.join(", ")}`);
  if (cfg.keywords?.length) parts.push(`Keywords: ${cfg.keywords.join(", ")}`);
  return parts.length === 0 ? "(none)" : parts.join(" · ");
}

function buildSignalUser(params: DiscoveryParams): string {
  const cfg = params.signalConfig!;
  const filters = renderFilters(cfg);
  const extra = params.queryText.trim()
    ? `\n\nAdditional ICP constraints: ${params.queryText.trim()}`
    : "";
  const exclude = cfg.excludeDomains?.length
    ? `\n\nEXCLUDE these domains (already found in prior runs): ${cfg.excludeDomains.slice(0, 50).join(", ")}`
    : "";

  if (cfg.signalType === "funding") {
    return `Find up to ${params.maxResults} companies that recently raised funding within ${cfg.timeframe}.

Filters: ${filters}${extra}${exclude}

Workflow:
1. Search funding news sources: TechCrunch, Crunchbase News, Axios Pro Rata, VentureBeat, Fortune Term Sheet, PitchBook News, Reuters deals, SEC Form D filings (efts.sec.gov).
2. For each funding announcement within ${cfg.timeframe}, verify the company matches the filters above.
3. matchReason MUST include the round size, round stage, and announcement date — e.g. "Raised $12M Series A on 2026-04-15".
4. Skip rumour/unconfirmed raises. Prefer announcements with a press release or TechCrunch byline.
5. Skip companies already in the exclude list.

Target: ${params.maxResults} verified companies with fresh funding.`;
  }

  if (cfg.signalType === "hiring") {
    const roles = cfg.roles?.join(", ") || "any revenue-facing role";
    return `Find up to ${params.maxResults} companies that are actively hiring for: ${roles}. Postings must be fresh within ${cfg.timeframe}.

Filters: ${filters}${extra}${exclude}

Workflow:
1. Search LinkedIn Jobs, Indeed, company /careers pages, Wellfound (AngelList), Y Combinator Jobs. Google queries like: "${roles}" site:linkedin.com/jobs "posted <timeframe>" / "hiring ${roles}" intitle:careers.
2. Prefer roles posted within ${cfg.timeframe}. Skip postings older than that.
3. matchReason MUST name the role and where the posting was found — e.g. "Hiring 2 SDRs on LinkedIn Jobs, posted 5 days ago".
4. Hiring for GTM / growth / leadership roles is a strong buying signal — weight those higher in the score.
5. Skip companies already in the exclude list.

Target: ${params.maxResults} companies hiring within the timeframe.`;
  }

  // news
  const keywords =
    cfg.keywords?.join(", ") ||
    "expansion, new location, product launch, partnership, acquisition, rebrand";
  return `Find up to ${params.maxResults} companies in the news for these signals: ${keywords}. News must be within ${cfg.timeframe}.

Filters: ${filters}${extra}${exclude}

Workflow:
1. Search Google News, Reuters, Bloomberg, industry trade press, local business journals (Biz Journals, Crain's), PR wires.
2. Prefer concrete events (ribbon cuttings, store openings, product launches) over vague puff pieces.
3. matchReason MUST cite the headline and publication date — e.g. "Opened new Dallas office — Dallas Business Journal, 2026-04-10".
4. Skip companies already in the exclude list.

Target: ${params.maxResults} companies with a fresh news signal.`;
}

function buildDirectoryUser(params: DiscoveryParams): string {
  const cfg = params.directoryConfig!;
  const extra = params.queryText.trim()
    ? `\n\nAdditional ICP constraints: ${params.queryText.trim()}`
    : "";

  switch (cfg.source) {
    case "yc": {
      const filters: string[] = [];
      if (cfg.batch) filters.push(`Batch: ${cfg.batch}`);
      if (cfg.category) filters.push(`Category/industry: ${cfg.category}`);
      if (cfg.query) filters.push(`Free-text: ${cfg.query}`);
      const f = filters.length ? filters.join(" · ") : "(no filters — return a representative sample)";
      return `Pull up to ${params.maxResults} Y Combinator companies from the YC directory.

Filters: ${f}${extra}

Workflow:
1. Start at https://www.ycombinator.com/companies — there is a list with filters for batch, industry, location, and status.
2. Apply the filters above. If the directory URL supports query params (e.g. ?batch=W24), prefer those.
3. WebFetch the filtered results page. The YC directory is JS-heavy but the HTML skeleton usually contains company slugs and names.
4. If fetching the directory fails, fall back to Google: site:ycombinator.com/companies/ <batch-or-category>.
5. For each company: companyName, websiteUrl (from the YC profile page), and a matchReason that cites the batch and category.
6. Skip YC's own internal pages or defunct companies.

Target: ${params.maxResults} YC-listed companies.`;
    }

    case "producthunt": {
      const filters: string[] = [];
      if (cfg.category) filters.push(`Topic/category: ${cfg.category}`);
      if (cfg.query) filters.push(`Free-text: ${cfg.query}`);
      const f = filters.length ? filters.join(" · ") : "(no filters — most recent launches)";
      return `Pull up to ${params.maxResults} Product Hunt launches that represent real, reachable companies.

Filters: ${f}${extra}

Workflow:
1. Start at https://www.producthunt.com/topics/${encodeURIComponent(cfg.category ?? "")} or the launch feed if no topic is given.
2. Prefer products with a distinct company behind them. Skip side projects and single-dev tools unless the ICP asks for them.
3. For each launch, follow the external link to confirm the real company website.
4. matchReason MUST include the launch date and what the product does in one phrase.
5. Deduplicate — a company can appear in PH multiple times; return it once using the primary domain.

Target: ${params.maxResults} companies with recent PH launches.`;
    }

    case "github": {
      const filters: string[] = [];
      if (cfg.category) filters.push(`Topic: ${cfg.category}`);
      if (cfg.query) filters.push(`Free-text: ${cfg.query}`);
      const f = filters.length ? filters.join(" · ") : "(no filters)";
      return `Pull up to ${params.maxResults} companies that sponsor/maintain active GitHub repos matching the filters.

Filters: ${f}${extra}

Workflow:
1. Start at https://github.com/topics/${encodeURIComponent(cfg.category ?? "")} (or search GitHub repos by query).
2. Focus on repos with a commercial org behind them — look at the org profile page for a website, LinkedIn, or "company" indicator.
3. Skip individual-developer repos unless the ICP specifically targets solo maintainers.
4. For each commercial org, return one row with companyName, websiteUrl (from the org profile), and matchReason citing the repo + stars.
5. Dedupe by domain — one company per row even if they own multiple repos.

Target: ${params.maxResults} companies behind relevant GitHub projects.`;
    }

    case "google_maps": {
      const category = cfg.category ?? cfg.query ?? "(none)";
      const geo = cfg.geo ?? "(none)";
      return `Pull up to ${params.maxResults} local businesses from Google Maps.

Category: ${category}
Geography: ${geo}${extra}

Workflow:
1. Query https://www.google.com/maps/search/ with "<category> in <geo>".
2. Also try Google Search: "<category>" "<geo>" site:google.com/maps OR just "<category> <geo>".
3. Prefer businesses with a verified Google Business Profile, real website, and recent reviews.
4. Skip franchise locations of the same parent — return the parent brand once.
5. For each: companyName, websiteUrl, location (specific address if available), matchReason citing the Google listing.

Target: ${params.maxResults} local businesses.`;
    }

    case "tech_stack": {
      const tech = cfg.techStack ?? cfg.query ?? "(unspecified tech)";
      const extraFilters: string[] = [];
      if (cfg.category) extraFilters.push(`Industry: ${cfg.category}`);
      if (cfg.geo) extraFilters.push(`Geography: ${cfg.geo}`);
      const f = extraFilters.length ? extraFilters.join(" · ") : "(no additional filters)";
      return `Pull up to ${params.maxResults} companies that use ${tech} in their stack.

Additional filters: ${f}${extra}

Workflow:
1. Look at public signals of usage:
   - BuiltWith public "${tech} customers" pages or Google search: "${tech}" "customers" OR "case study"
   - The vendor's own customer logo wall / case-study page.
   - G2 / Capterra reviews of "${tech}" — the reviewers' companies show the tech in use.
   - Job postings requiring "${tech}" experience indicate it's part of their stack.
2. matchReason MUST cite the source of evidence — e.g. "Listed on Shopify Plus customers page" or "Case study published 2026-01-15".
3. Prefer evidence that is less than 2 years old — tech stacks churn.
4. Dedupe by domain.

Target: ${params.maxResults} companies visibly using ${tech}.`;
    }

    case "custom": {
      const url = cfg.url ?? "(no URL provided)";
      const hint = cfg.query ?? "";
      return `Extract up to ${params.maxResults} companies from this directory URL: ${url}

Extraction hint: ${hint || "(none — extract all companies listed)"}${extra}

Workflow:
1. WebFetch ${url}. Parse the companies listed on the page.
2. If the directory paginates (?page=2 etc.), fetch additional pages up to ${params.maxResults} total.
3. For each entry: capture companyName and websiteUrl. If the directory includes industry/location, capture those too.
4. matchReason MUST cite that it came from this directory and the specific row/position if possible.
5. If the URL is behind auth or returns a login wall, report that honestly and return an empty list.

Target: ${params.maxResults} companies from the directory.`;
    }
  }
}

function buildPrompts(params: DiscoveryParams): { system: string; user: string } {
  if (params.mode === "directory") {
    if (!params.directoryConfig) {
      throw new Error("directoryConfig is required for directory mode");
    }
    return { system: COMMON_SYSTEM, user: buildDirectoryUser(params) };
  }

  if (
    params.mode === "signal_funding" ||
    params.mode === "signal_hiring" ||
    params.mode === "signal_news"
  ) {
    if (!params.signalConfig) {
      throw new Error("signalConfig is required for signal_* modes");
    }
    return { system: COMMON_SYSTEM, user: buildSignalUser(params) };
  }

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
