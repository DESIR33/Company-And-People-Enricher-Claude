import { query, SYSTEM_PROMPT_DYNAMIC_BOUNDARY } from "@anthropic-ai/claude-agent-sdk";
import { resolveClaudeCodeExecutable } from "./claude-runtime";
import { extractFirstJsonObject } from "./json-extract";
import type { DirectoryConfig, DiscoveryMode } from "./discovery-store";

export type SignalAgentConfig = {
  signalType: "funding" | "hiring" | "news" | "reviews" | "new_business" | "license";
  timeframe: string;
  industryFilter?: string;
  geoFilter?: string;
  sizeFilter?: string;
  stageFilter?: string[];
  minAmount?: number;
  maxAmount?: number;
  roles?: string[];
  keywords?: string[];
  reviewPlatform?: "google" | "yelp" | "tripadvisor" | "any";
  reviewSentiment?: "positive" | "negative" | "new_on_platform" | "any";
  minReviewCount?: number;
  states?: string[];
  naicsCodes?: string[];
  licenseTypes?: string[];
  excludeDomains?: string[];
  excludePhones?: string[];
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
  // Phase 1.1 — agents are asked to populate these where the source supports
  // it (Yelp/BBB profiles, state license boards, OSM-derived markdown). The
  // runner persists them on the lead row.
  phone?: string;
  streetAddress?: string;
  city?: string;
  region?: string;
  postalCode?: string;
  countryCode?: string;
  lat?: number;
  lng?: number;
  placeId?: string;
  hours?: string;
  naicsCode?: string;
  licenseNumber?: string;
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
  preFetched?: string;
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
      "score": 85,
      "phone": "+1 512-555-0199",
      "streetAddress": "123 Oltorf St",
      "city": "Austin",
      "region": "TX",
      "postalCode": "78704",
      "countryCode": "US",
      "lat": 30.241,
      "lng": -97.7657,
      "placeId": "ChIJ...",
      "hours": "Mon-Fri 8a-5p",
      "naicsCode": "238160",
      "licenseNumber": "TX-RC-12345"
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
- phone, streetAddress, city, region, postalCode, hours — populate these
  whenever the source surfaces them (Yelp profile, BBB profile, Google
  Business Profile, state filings, OSM tags). Do NOT guess. SMB outreach
  needs phone+address as much as it needs website.
- placeId — the source's stable identifier (Google place_id, OSM node id,
  state filing number) when available. Used downstream for dedup.
- naicsCode / licenseNumber — only include when the source explicitly lists
  them (state contractor boards, SoS filings).

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
  const excludeBits: string[] = [];
  if (cfg.excludeDomains?.length) {
    excludeBits.push(
      `EXCLUDE these domains (already found in prior runs): ${cfg.excludeDomains.slice(0, 50).join(", ")}`
    );
  }
  if (cfg.excludePhones?.length) {
    excludeBits.push(
      `EXCLUDE these phone numbers (already found in prior runs): ${cfg.excludePhones.slice(0, 50).join(", ")}`
    );
  }
  const exclude = excludeBits.length ? `\n\n${excludeBits.join("\n")}` : "";

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

  if (cfg.signalType === "reviews") {
    const platform = cfg.reviewPlatform ?? "google";
    const sentiment = cfg.reviewSentiment ?? "any";
    const minCount = cfg.minReviewCount ?? 3;
    const platformLabel =
      platform === "google" ? "Google Maps / Google Business Profile" :
      platform === "yelp" ? "Yelp" :
      platform === "tripadvisor" ? "TripAdvisor" :
      "Google + Yelp + TripAdvisor";
    const sentimentGuidance =
      sentiment === "positive"
        ? "Only include businesses with recent POSITIVE reviews (4★ or 5★). Lots of recent positive reviews = growth + reachable, engaged owner."
        : sentiment === "negative"
          ? "Only include businesses with recent NEGATIVE reviews (1★ or 2★). Recent negative reviews = distress / churn risk — often an opportunity pitch for competitors."
          : sentiment === "new_on_platform"
            ? "Only include businesses that JUST APPEARED on the platform within the timeframe — first review, claimed-listing date, or page-creation date inside the timeframe. New-on-platform = brand-new business or a long-time business that just started caring about online presence (perfect time to pitch SaaS / marketing)."
            : "Include businesses with either recent positive OR negative reviews — volume change is the intent signal.";
    const platformSpecific =
      platform === "tripadvisor"
        ? "Use https://www.tripadvisor.com/Search?q=<category>+<geo> — TripAdvisor surfaces hotels/restaurants/tours best."
        : platform === "yelp"
          ? "Use Yelp category search at https://www.yelp.com/search?find_desc=<category>&find_loc=<geo>."
          : platform === "google"
            ? "Use Google Maps search and the Google Business Profile listing for each candidate."
            : "Use Google Maps + Yelp + TripAdvisor and dedupe across them by phone/address.";
    return `Find up to ${params.maxResults} local businesses that have fresh review activity within ${cfg.timeframe}.

Platform: ${platformLabel}
Sentiment filter: ${sentiment}
Minimum fresh reviews required per business: ${minCount}
Filters: ${filters}${extra}${exclude}

${sentimentGuidance}

Workflow:
1. ${platformSpecific}
2. For each candidate, WebFetch the platform profile and check recent review dates / first-review date.
3. Require at least ${minCount} reviews within ${cfg.timeframe} (skip the count check for new_on_platform sentiment).
4. matchReason MUST cite the platform, review count, and sentiment — e.g. "7 Google reviews in the last 14 days, avg 4.8★" or "First review 6 days ago — new on TripAdvisor".
5. Capture phone + streetAddress when shown on the profile (these are SMB outreach essentials). Use sourceUrl for the profile URL, and a score that reflects fit + review momentum.

Target: ${params.maxResults} local businesses with fresh review activity.`;
  }

  if (cfg.signalType === "new_business") {
    const states = cfg.states?.length
      ? `States: ${cfg.states.join(", ")}`
      : "Geography: any";
    const naics = cfg.naicsCodes?.length
      ? `NAICS codes: ${cfg.naicsCodes.join(", ")}`
      : "NAICS: any (filter by category in queryText if provided)";
    return `Find up to ${params.maxResults} businesses NEWLY REGISTERED within ${cfg.timeframe}.

${states}
${naics}
Filters: ${filters}${extra}${exclude}

Workflow:
1. Pull state Secretary-of-State filings: CA BizFile Online, TX SOS, FL Sunbiz (search.sunbiz.org), NY DOS Entity Search, GA eCorp. Where each state exposes a date-range filter, restrict to ${cfg.timeframe}.
2. Cross-check with "grand opening" / "now open" Google news for the geo + category — many newly opened businesses appear in local press before they hit directories.
3. For each: companyName, streetAddress, city, region, postalCode, entity type, formation date, NAICS (if listed), placeId = filing number, score 70+.
4. matchReason MUST include the formation date and source — e.g. "LLC filed 2026-04-08 in Travis Co, TX (TX SOS) · grand opening covered by Austin Business Journal 2026-04-12".
5. Skip dissolved or inactive filings, and out-of-state shells with PO box only.

Target: ${params.maxResults} newly registered businesses.`;
  }

  if (cfg.signalType === "license") {
    const states = cfg.states?.length
      ? `States: ${cfg.states.join(", ")}`
      : "Geography: any";
    const types = cfg.licenseTypes?.length
      ? `License types: ${cfg.licenseTypes.join(", ")}`
      : "License type: any";
    return `Find up to ${params.maxResults} contractors with a license issued or renewed within ${cfg.timeframe}.

${states}
${types}
Filters: ${filters}${extra}${exclude}

Workflow:
1. Use state contractor-license boards: CA CSLB, TX TDLR, FL DBPR, NY DOS Licensing, GA SOS Verify. Most expose a search by issue date.
2. For each license record: companyName, phone (when listed), streetAddress, city, region, licenseNumber, license type/classification, issue date.
3. matchReason MUST include the license number, board, type, and issue date — e.g. "CSLB #1234567, C-36 Plumbing, issued 2026-04-01".
4. A newly-issued license is one of the strongest "just-licensed, needs leads/software/insurance" buying signals — score 80+ for fresh issues, 65 for recent renewals.
5. Skip expired/revoked. Dedupe by license number.

Target: ${params.maxResults} freshly licensed contractors.`;
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

function renderGeoBlock(cfg: DirectoryConfig): string {
  // Compose a one-line geo description that surfaces every input the user
  // provided — agents work much better when given lat/lng + radius + zip
  // list together instead of just a city name.
  const parts: string[] = [];
  if (cfg.lat !== undefined && cfg.lng !== undefined) {
    parts.push(`lat/lng ${cfg.lat.toFixed(4)},${cfg.lng.toFixed(4)}`);
  }
  if (cfg.radiusMiles !== undefined) parts.push(`${cfg.radiusMiles} mi radius`);
  if (cfg.zips?.length) parts.push(`zips ${cfg.zips.slice(0, 12).join(", ")}`);
  if (cfg.msaCode) parts.push(`MSA ${cfg.msaCode}`);
  if (cfg.geo) parts.push(cfg.geo);
  if (cfg.state && !cfg.geo?.toUpperCase().includes(cfg.state)) parts.push(cfg.state);
  return parts.length === 0 ? "(none)" : parts.join(" · ");
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

    case "yelp": {
      const category = cfg.category ?? cfg.query ?? "(none)";
      const geo = cfg.geo ?? "(none)";
      return `Pull up to ${params.maxResults} local businesses from Yelp.

Category: ${category}
Geography: ${geo}${extra}

Workflow:
1. Start at https://www.yelp.com/search?find_desc=${encodeURIComponent(category)}&find_loc=${encodeURIComponent(geo)} — Yelp's category search is stable and paginates deterministically.
2. For each business on the results page, capture: name, website (from the Yelp profile's "Business website" field), phone, address, star rating, review count.
3. Prefer businesses with ≥10 reviews and a linked website — solo/inactive listings are often dead numbers.
4. Skip chains if a single location listing doesn't represent the parent brand. Return the independent operators.
5. matchReason MUST include the Yelp rating + review count — e.g. "4.6★ with 142 reviews on Yelp".
6. If Yelp blocks the fetch, fall back to Google: "<category> <geo> site:yelp.com/biz".

Target: ${params.maxResults} Yelp-listed local businesses.`;
    }

    case "bbb": {
      const category = cfg.category ?? cfg.query ?? "(none)";
      const geo = cfg.geo ?? "(none)";
      return `Pull up to ${params.maxResults} accredited local businesses from the Better Business Bureau (BBB) directory.

Category: ${category}
Geography: ${geo}${extra}

Workflow:
1. Start at https://www.bbb.org/search?find_country=USA&find_text=${encodeURIComponent(category)}&find_loc=${encodeURIComponent(geo)}.
2. Prefer BBB-accredited businesses (A+ / A rating) — they tend to be established SMBs with real operations.
3. Capture: business name, website (from the BBB profile), phone, address, years in business, BBB rating.
4. matchReason MUST cite the BBB rating and years in business — e.g. "A+ rated, 14 years in business, BBB accredited".
5. Skip franchises of national chains; BBB sometimes lists them alongside independents.
6. If BBB blocks the fetch, fall back to Google: "site:bbb.org/us/<state> <category> <city>".

Target: ${params.maxResults} BBB-listed local businesses.`;
    }

    case "angi": {
      const category = cfg.category ?? cfg.query ?? "(none)";
      const geo = cfg.geo ?? "(none)";
      return `Pull up to ${params.maxResults} home-services contractors from Angi, HomeAdvisor, or Thumbtack.

Category: ${category}
Geography: ${geo}${extra}

Workflow:
1. Try all three sources — Angi (https://www.angi.com/companylist/us/<state>/<city>/<category>), HomeAdvisor (https://www.homeadvisor.com/c.<category>.<state>.<city>.html), and Thumbtack (https://www.thumbtack.com/<state>/<city>/<category>).
2. These are contractor-heavy directories — focus on businesses with a profile that shows photos, reviews, and completed jobs.
3. For each: capture name, website (from the Angi/HA/TT profile), phone, service area, category, rating + reviews.
4. matchReason MUST cite the platform + rating + project volume — e.g. "HomeAdvisor Top Rated, 87 completed projects, 4.8★".
5. Many contractors are listed on multiple platforms — dedupe by phone number or website.
6. If fetching fails, fall back to Google: "<category> <geo> site:angi.com OR site:homeadvisor.com OR site:thumbtack.com".

Target: ${params.maxResults} home-services contractors.`;
    }

    case "facebook_pages": {
      const category = cfg.category ?? cfg.query ?? "(none)";
      const geo = cfg.geo ?? "(none)";
      return `Pull up to ${params.maxResults} local businesses that are ACTIVE on Facebook — many SMBs have a FB page as their primary web presence.

Category: ${category}
Geography: ${geo}${extra}

Workflow:
1. Search Google for: site:facebook.com/<slug-patterns> OR 'facebook.com "<category>" "<geo>"'.
2. Also try Facebook's own search: https://www.facebook.com/search/pages/?q=${encodeURIComponent(`${category} ${geo}`)} (may require login — fall back if blocked).
3. Prefer pages with: recent posts (last 30 days), >100 likes, a website link in the About section, a verified business badge.
4. For each: capture business name, website (from the FB About section), facebook_page URL, phone, location.
5. matchReason MUST cite recent FB activity — e.g. "Posts weekly, 2.3k likes, 4.7★ on FB reviews".
6. Skip pages that are clearly personal/hobbyist or have had no activity in 6+ months.

Target: ${params.maxResults} local businesses with an active Facebook presence.`;
    }

    case "firecrawl_search": {
      const q = cfg.query ?? cfg.category ?? "(no query)";
      return `Extract up to ${params.maxResults} companies from the Firecrawl web-search results below.

Search query: "${q}"${extra}

Pre-fetched search results are included BELOW under "PRE-FETCHED CONTENT". Each block is the cleaned markdown of a top search result, with a real URL.

Workflow:
1. Read the pre-fetched blocks. Identify distinct companies mentioned with enough signal to verify (name, website, a sentence about what they do).
2. When a block IS a company homepage, take companyName from the page title/hero and websiteUrl from the block's URL header.
3. When a block is a listicle or aggregator, extract the individual companies mentioned, using the aggregator URL as the sourceUrl.
4. matchReason MUST reference which pre-fetched result the company came from — e.g. "Listed in result #3: 'Top 10 Austin roofers'".
5. Dedupe by domain. Skip companies that don't have a verifiable website.

Target: ${params.maxResults} companies extracted from the search results.`;
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

    case "osm_overpass": {
      // OSM is normally fetched directly by the runner (no agent loop). This
      // case fires only as a fallback when the runner sees a category that's
      // not in OSM_CATEGORY_PRESETS and the radius/area query returned 0
      // results — agent then takes over with WebSearch over openstreetmap.org.
      const category = cfg.category ?? cfg.query ?? "(none)";
      const geo = renderGeoBlock(cfg);
      return `Find up to ${params.maxResults} businesses in OpenStreetMap matching the criteria.

Category: ${category}
Geo: ${geo}${extra}

Workflow:
1. Try Nominatim search (https://nominatim.openstreetmap.org/search) for the category in the geo, JSON output.
2. For each result, capture name, websiteUrl, phone, streetAddress, city, region, postalCode, lat, lng — these come straight from OSM tags.
3. Skip nodes without a name or contact info.
4. matchReason MUST cite OSM (e.g. "OSM node 12345, tagged shop=plumber").

Target: ${params.maxResults} OSM-listed businesses.`;
    }

    case "google_lsa": {
      // Google Local Services Ads — Google's vetted, license-verified pro
      // listings. Ultra-high intent for home services (plumbers, HVAC,
      // electricians, roofers, etc.) because Google has already verified
      // the business is licensed and insured.
      const category = cfg.category ?? cfg.query ?? "(none)";
      const geo = renderGeoBlock(cfg);
      return `Find up to ${params.maxResults} Google-verified local pros from Google Local Services Ads.

Category: ${category}
Geo: ${geo}${extra}

Workflow:
1. Query https://www.google.com/localservices/prolist?q=${encodeURIComponent(`${category} ${cfg.geo ?? ""}`)} (LSA pro list page).
2. Each LSA card shows business name, phone, rating, "Google Guaranteed" or "Google Screened" badge, service area.
3. Capture: companyName, phone, streetAddress (when shown), city, region, score (start at 80 — these are Google-vetted).
4. matchReason MUST mention the Google Guaranteed/Screened status — e.g. "Google Guaranteed plumber, 4.9★ over 234 reviews".
5. The LSA pages are JS-heavy. If the direct fetch is blocked, fall back to a Google search: "<category> <geo> google guaranteed".
6. Skip pros with fewer than 5 reviews — usually too new to outreach.

Target: ${params.maxResults} Google-verified pros (highest-intent SMB lead source).`;
    }

    case "yellowpages": {
      const category = cfg.category ?? cfg.query ?? "(none)";
      const geo = renderGeoBlock(cfg);
      return `Find up to ${params.maxResults} businesses on Yellow Pages (yellowpages.com).

Category: ${category}
Geo: ${geo}${extra}

Workflow:
1. Start at https://www.yellowpages.com/search?search_terms=${encodeURIComponent(category)}&geo_location_terms=${encodeURIComponent(cfg.geo ?? "")}.
2. Yellow Pages is one of the broadest US SMB directories — list pages paginate cleanly.
3. For each listing capture: business name, phone, streetAddress, city, region, postalCode, websiteUrl (when listed), rating, review count, years in business.
4. Prefer listings with ≥3 years in business and a phone — solo / new listings are noisier.
5. matchReason MUST cite the YP listing position and any "AYP" (Authorized Yellow Pages) badge — e.g. "YP #4, AYP-verified, 8 years in business".
6. If YP blocks the fetch, fall back to a Google query: "<category> <geo> site:yellowpages.com".

Target: ${params.maxResults} YP-listed businesses.`;
    }

    case "manta": {
      const category = cfg.category ?? cfg.query ?? "(none)";
      const geo = renderGeoBlock(cfg);
      return `Find up to ${params.maxResults} businesses on Manta (manta.com), a US SMB directory with NAICS codes.

Category: ${category}
Geo: ${geo}${extra}

Workflow:
1. Start at https://www.manta.com/search?search=${encodeURIComponent(category)}&search_location=${encodeURIComponent(cfg.geo ?? "")}.
2. Manta profiles include NAICS code, year established, employee range, annual revenue band — capture all of these when present (naicsCode, employeeRange).
3. For each listing: business name, phone, streetAddress, city, region, postalCode, websiteUrl, naicsCode, employeeRange.
4. matchReason MUST cite the NAICS classification when available — e.g. "Manta-listed, NAICS 238220, est. 2014, 5-10 employees".
5. If Manta blocks the fetch, fall back to a Google query: "<category> <geo> site:manta.com".

Target: ${params.maxResults} Manta-listed SMBs.`;
    }

    case "houzz": {
      const category = cfg.category ?? cfg.query ?? "(none)";
      const geo = renderGeoBlock(cfg);
      return `Find up to ${params.maxResults} home pros (designers, contractors, landscapers, remodelers) on Houzz.

Category: ${category}
Geo: ${geo}${extra}

Workflow:
1. Start at https://www.houzz.com/professionals/${encodeURIComponent(category.toLowerCase().replace(/\s+/g, "-"))}/${encodeURIComponent(cfg.geo ?? "")}.
2. Houzz pro profiles include portfolio photos, project count, review rating, years on Houzz, badges (Best of Houzz).
3. For each listing: companyName, phone, streetAddress, city, region, websiteUrl, score reflecting badges + reviews.
4. matchReason MUST cite Houzz badges and project volume — e.g. "Best of Houzz 2024, 47 projects on Houzz, 4.9★".
5. Skip pros with fewer than 5 projects — too thin for outreach.

Target: ${params.maxResults} Houzz home pros.`;
    }

    case "nextdoor": {
      const category = cfg.category ?? cfg.query ?? "(none)";
      const geo = renderGeoBlock(cfg);
      return `Find up to ${params.maxResults} local SMBs on Nextdoor's business pages. NOTE: Nextdoor aggressively blocks unauthenticated fetches — best-effort only.

Category: ${category}
Geo: ${geo}${extra}

Workflow:
1. Search Google for "site:nextdoor.com/pages/ <category> <geo>" — pages indexed there are publicly readable.
2. Each Nextdoor business page shows recommendation count, badges, response time, sometimes phone + website.
3. For each: companyName, phone, streetAddress (often partial), city, region, websiteUrl, score reflecting recommendation count.
4. matchReason MUST cite the Nextdoor recommendation count — e.g. "Recommended by 38 neighbours on Nextdoor".
5. If you can't reach Nextdoor or Google has too few indexed pages, return what you have honestly. This source is best-effort like LinkedIn.

Target: up to ${params.maxResults} Nextdoor-recommended SMBs (best-effort).`;
    }

    case "opentable": {
      const category = cfg.category ?? cfg.query ?? "restaurant";
      const geo = renderGeoBlock(cfg);
      return `Find up to ${params.maxResults} restaurants on OpenTable.

Cuisine / category: ${category}
Geo: ${geo}${extra}

Workflow:
1. Start at https://www.opentable.com/s?term=${encodeURIComponent(cfg.geo ?? "")}&cuisineIds=${encodeURIComponent(category)}.
2. Each OpenTable card includes restaurant name, address, phone, cuisine, price tier, review count.
3. For each: companyName, phone, streetAddress, city, region, postalCode, websiteUrl, hours, score reflecting review count + tier.
4. matchReason MUST cite the OpenTable review count + cuisine — e.g. "Italian, 4.6★ over 1,200 OpenTable reviews".
5. Skip national chains; focus on independents.

Target: ${params.maxResults} OpenTable-listed restaurants.`;
    }

    case "tripadvisor": {
      const category = cfg.category ?? cfg.query ?? "restaurant";
      const geo = renderGeoBlock(cfg);
      return `Find up to ${params.maxResults} hospitality businesses on TripAdvisor.

Category: ${category}
Geo: ${geo}${extra}

Workflow:
1. Start at https://www.tripadvisor.com/Search?q=${encodeURIComponent(`${category} ${cfg.geo ?? ""}`)} or browse by category (Restaurants_g123/Hotels_g123).
2. TripAdvisor profiles include name, address, phone, rating, review count, ranking ("#7 of 320 restaurants in Atlanta").
3. For each: companyName, phone, streetAddress, city, region, postalCode, websiteUrl, score reflecting ranking + review count.
4. matchReason MUST cite the TripAdvisor ranking — e.g. "#23 of 412 restaurants in Atlanta, 4.5★, 890 reviews".
5. If TripAdvisor blocks the fetch, fall back to "site:tripadvisor.com <category> <geo>" via Google.

Target: ${params.maxResults} TripAdvisor-listed hospitality businesses.`;
    }

    case "delivery_marketplace": {
      const category = cfg.category ?? cfg.query ?? "restaurant";
      const geo = renderGeoBlock(cfg);
      return `Find up to ${params.maxResults} restaurants/businesses listed on at least one of the major US delivery marketplaces (DoorDash, Uber Eats, Grubhub).

Category: ${category}
Geo: ${geo}${extra}

Workflow:
1. Try all three: https://www.doordash.com/store-search/?query=${encodeURIComponent(`${category} ${cfg.geo ?? ""}`)}, https://www.ubereats.com/search?q=${encodeURIComponent(`${category} ${cfg.geo ?? ""}`)}, and https://www.grubhub.com/search?searchType=keyword&search_terms=${encodeURIComponent(category)}&location=${encodeURIComponent(cfg.geo ?? "")}.
2. Listings on these platforms are *signed up* — every one is reachable for outreach (delivery sales, marketing, software).
3. For each: companyName, phone (often missing — sourceUrl OK), streetAddress, city, region, websiteUrl, score reflecting cross-platform presence (3 platforms = 90, 1 = 60).
4. matchReason MUST cite which marketplaces list the business — e.g. "Listed on DoorDash + Grubhub, 4.7★ on DD".
5. Dedupe across marketplaces by name+address normalisation.

Target: ${params.maxResults} marketplace-active SMBs (great for vendor/SaaS pitches).`;
    }

    case "state_license_board": {
      const state = cfg.state ?? "(none)";
      const licenseType = cfg.category ?? cfg.query ?? "(any license type)";
      const geo = renderGeoBlock(cfg);
      return `Find up to ${params.maxResults} licensed businesses from a state contractor-license board.

State: ${state}
License type: ${licenseType}
Geo: ${geo}${extra}

Workflow:
1. Use the state-specific board search. Common ones: CA CSLB (https://www.cslb.ca.gov/OnlineServices/CheckLicenseII/), TX TDLR (https://www.tdlr.texas.gov/LicenseSearch/), FL DBPR (https://www.myfloridalicense.com/wl11.asp), NY DOS Licensing, GA SOS Verify (https://verify.sos.ga.gov/verification/Search.aspx).
2. License records include businessName, licenseNumber, licenseType, status (active/expired), issue date, address, phone (sometimes).
3. For each: companyName, phone (when listed), streetAddress, city, region, postalCode, licenseNumber, naicsCode (if classification given), score 70+ (active license = qualified lead).
4. matchReason MUST include the license number, type, and issue date — e.g. "TX-RC-12345, plumbing license, issued 2024-03-12".
5. Prefer recently issued / renewed licenses (last 90 days) when timeframe applies.
6. Skip expired or revoked licenses.

Target: ${params.maxResults} actively-licensed businesses.`;
    }

    case "state_sos": {
      const state = cfg.state ?? "(none)";
      const naics = cfg.category ?? cfg.query ?? "(any industry)";
      const geo = renderGeoBlock(cfg);
      return `Find up to ${params.maxResults} businesses recently registered with a state Secretary of State.

State: ${state}
NAICS / industry: ${naics}
Geo: ${geo}${extra}

Workflow:
1. Use the state-specific filings search. Common ones: CA BizFile Online (https://bizfileonline.sos.ca.gov), TX Comptroller (https://mycpa.cpa.state.tx.us/coa/), FL Sunbiz (https://search.sunbiz.org), NY DOS Entity Search, GA eCorp (https://ecorp.sos.ga.gov/BusinessSearch).
2. SoS filings include entity name, formation date, registered agent, principal address, entity type (LLC/Inc/PLLC), status.
3. Filter to entities formed within the timeframe and matching the NAICS / industry where data is exposed.
4. For each: companyName, streetAddress (principal address), city, region, postalCode, naicsCode (if listed), placeId (filing #), score 70+ (newly formed = high intent).
5. matchReason MUST include formation date and entity type — e.g. "LLC formed 2026-04-02 in Travis County, TX".
6. Skip dissolved or inactive filings.

Target: ${params.maxResults} newly registered businesses.`;
    }

    case "google_places": {
      // Normally served by the runner via the Google Places API (New).
      // Agent fallback runs only if GOOGLE_PLACES_API_KEY is missing or the
      // direct call failed.
      const category = cfg.category ?? cfg.query ?? "(none)";
      const geo = renderGeoBlock(cfg);
      return `Find up to ${params.maxResults} businesses on Google Maps matching the criteria.

Category: ${category}
Geo: ${geo}${extra}

Workflow:
1. Search Google Maps for the category in the geo. Extract business name, website, phone, full address, lat/lng, hours, rating, review count.
2. For each: companyName, websiteUrl, phone, streetAddress, city, region, postalCode, lat, lng, hours.
3. matchReason MUST cite Google Maps and rating (e.g. "Google Maps · 4.7★ (412 reviews)").
4. Skip permanently closed listings.

Target: ${params.maxResults} Google Maps-listed businesses.`;
    }

    case "foursquare": {
      // Normally served by the runner via the Foursquare Places API. Agent
      // fallback runs only if FOURSQUARE_API_KEY is missing or the direct
      // call failed.
      const category = cfg.category ?? cfg.query ?? "(none)";
      const geo = renderGeoBlock(cfg);
      return `Find up to ${params.maxResults} businesses on Foursquare matching the criteria.

Category: ${category}
Geo: ${geo}${extra}

Workflow:
1. Search Foursquare (https://foursquare.com) or its city pages for the category in the geo.
2. For each: companyName, websiteUrl, phone, streetAddress, city, region, postalCode, lat, lng.
3. matchReason MUST cite Foursquare and the venue category.
4. Skip closed venues.

Target: ${params.maxResults} Foursquare-listed businesses.`;
    }

    case "bing_places": {
      // Normally served by the runner via Bing Local Search. Agent fallback
      // runs only if BING_MAPS_API_KEY is missing or the direct call failed.
      const category = cfg.category ?? cfg.query ?? "(none)";
      const geo = renderGeoBlock(cfg);
      return `Find up to ${params.maxResults} businesses on Bing Maps matching the criteria.

Category: ${category}
Geo: ${geo}${extra}

Workflow:
1. Search Bing Maps (https://www.bing.com/maps) for the category in the geo.
2. For each: companyName, websiteUrl, phone, streetAddress, city, region, postalCode, lat, lng.
3. matchReason MUST cite Bing Maps and the listing's category.
4. Skip closed listings.

Target: ${params.maxResults} Bing Maps-listed businesses.`;
    }

    case "tomtom": {
      // Normally served by the runner via TomTom Search API. Agent
      // fallback runs only if TOMTOM_API_KEY is missing or the direct
      // call failed.
      const category = cfg.category ?? cfg.query ?? "(none)";
      const geo = renderGeoBlock(cfg);
      return `Find up to ${params.maxResults} businesses on TomTom maps matching the criteria.

Category: ${category}
Geo: ${geo}${extra}

Workflow:
1. Search TomTom (https://www.tomtom.com/maps/) for the category in the geo.
2. For each: companyName, websiteUrl, phone, streetAddress, city, region, postalCode, lat, lng.
3. matchReason MUST cite TomTom and the listing's category.
4. Skip closed listings.

Target: ${params.maxResults} TomTom-listed businesses.`;
    }

    case "here_places": {
      // Normally served by the runner via HERE Discover/Browse APIs.
      // Agent fallback runs only if HERE_API_KEY is missing or the
      // direct call failed.
      const category = cfg.category ?? cfg.query ?? "(none)";
      const geo = renderGeoBlock(cfg);
      return `Find up to ${params.maxResults} businesses on HERE / Wego maps matching the criteria.

Category: ${category}
Geo: ${geo}${extra}

Workflow:
1. Search HERE / Wego (https://wego.here.com) for the category in the geo. HERE has strong European coverage.
2. For each: companyName, websiteUrl, phone, streetAddress, city, region, postalCode, lat, lng, countryCode.
3. matchReason MUST cite HERE / Wego and the listing's category.
4. Skip closed listings.

Target: ${params.maxResults} HERE-listed businesses.`;
    }

    case "bbb_direct": {
      // Normally served by the runner via Playwright + the BBB listing
      // page parser. Agent fallback runs when Playwright isn't installed
      // (e.g. Vercel) or the scraper failed. Mirrors the existing `bbb`
      // case workflow.
      const category = cfg.category ?? cfg.query ?? "(none)";
      const geo = cfg.geo ?? "(none)";
      return `Pull up to ${params.maxResults} BBB-listed local businesses (Playwright unavailable — use web search).

Category: ${category}
Geography: ${geo}${extra}

Workflow:
1. Start at https://www.bbb.org/search?find_country=USA&find_text=${encodeURIComponent(category)}&find_loc=${encodeURIComponent(geo)}.
2. Prefer accredited (A+ / A) listings.
3. Capture name, website (from the BBB profile, NOT the BBB URL), phone, address, years in business, BBB letter rating, accreditation status.
4. matchReason MUST cite BBB rating + years in business + accreditation when present.
5. If BBB blocks the fetch, fall back to "site:bbb.org/us/<state> <category> <city>" web search.

Target: ${params.maxResults} BBB-listed local businesses.`;
    }

    case "yelp_direct": {
      // Normally served by the runner via Playwright + the Yelp listing
      // page parser. Agent fallback runs when Playwright isn't installed
      // on the host (e.g. Vercel serverless deploys) or the scraper
      // failed. Imitates the same query through web search.
      const category = cfg.category ?? cfg.query ?? "(none)";
      const geo = renderGeoBlock(cfg);
      return `Find up to ${params.maxResults} businesses on Yelp matching the criteria.

Category: ${category}
Geo: ${geo}${extra}

Workflow:
1. Use Yelp's site: search — site:yelp.com/biz <category> <geo>.
2. For each result, capture name, websiteUrl (the external link from the Yelp profile, NOT the Yelp URL), phone, streetAddress, city, region, postalCode, rating, review count.
3. matchReason MUST cite Yelp + rating + review count.
4. Skip closed businesses ("Yelp users report this business is closed").

Target: ${params.maxResults} Yelp-listed businesses.`;
    }

    case "apify": {
      // Normally served by the runner via the Apify API. This agent
      // fallback only runs if APIFY_API_TOKEN is missing or the actor
      // failed — we describe what the actor would have searched for so
      // the agent can imitate it via the open web.
      const category = cfg.category ?? cfg.query ?? "(none)";
      const geo = renderGeoBlock(cfg);
      const actor = cfg.actorId ?? "(unspecified)";
      return `An Apify actor (${actor}) was requested but is unavailable. Approximate the same query through the open web.

Search target: ${category}
Geo: ${geo}${extra}

Workflow:
1. Identify what the actor was meant to scrape from its name (e.g. "linkedin-companies" → LinkedIn company pages, "yelp-scraper" → Yelp listings, "crunchbase-scraper" → Crunchbase profiles).
2. Run a web search constrained to that platform: site:linkedin.com/company, site:yelp.com/biz, site:crunchbase.com/organization, etc.
3. For each: companyName, websiteUrl, phone, location, and a matchReason that cites the source page.

Target: ${params.maxResults} companies imitating the requested actor.`;
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
    params.mode === "signal_news" ||
    params.mode === "signal_reviews" ||
    params.mode === "signal_new_business" ||
    params.mode === "signal_license"
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
    const candidate = extractFirstJsonObject(raw);
    if (!candidate) return { companies: [] };
    try {
      return JSON.parse(candidate);
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
  const lat =
    typeof c.lat === "number" && c.lat >= -90 && c.lat <= 90 ? c.lat : undefined;
  const lng =
    typeof c.lng === "number" && c.lng >= -180 && c.lng <= 180 ? c.lng : undefined;
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
    phone: c.phone?.toString().trim() || undefined,
    streetAddress: c.streetAddress?.trim() || undefined,
    city: c.city?.trim() || undefined,
    region: c.region?.trim() || undefined,
    postalCode: c.postalCode?.toString().trim() || undefined,
    countryCode: c.countryCode?.trim() || undefined,
    lat,
    lng,
    placeId: c.placeId?.trim() || undefined,
    hours: c.hours?.trim() || undefined,
    naicsCode: c.naicsCode?.toString().trim() || undefined,
    licenseNumber: c.licenseNumber?.toString().trim() || undefined,
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
  const { system, user: baseUser } = buildPrompts(params);
  const user = params.preFetched
    ? `${baseUser}\n\n=== PRE-FETCHED CONTENT (from Firecrawl) ===\n\n${params.preFetched}\n\n=== END PRE-FETCHED CONTENT ===\n\nPrefer the pre-fetched content above as your primary source. Use WebSearch/WebFetch only to fill gaps or verify specific facts.`
    : baseUser;
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
        pathToClaudeCodeExecutable: resolveClaudeCodeExecutable(),
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
    if (params.signal?.aborted) {
      push("Discovery aborted by user");
      return { companies: [], costUsd, note: "Discovery aborted" };
    }
    // Surface real failures (missing native binary, network errors, SDK
    // crashes) instead of returning an empty result that the runner would
    // mark as a clean "completed" search with 0 leads.
    push(`Discovery failed: ${String(err)}`);
    throw err;
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
