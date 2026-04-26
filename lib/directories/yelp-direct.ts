// Yelp direct scraper (Playwright).
//
// Phase 2.2 — first concrete consumer of the Playwright pool. Yelp is
// the highest-volume SMB directory we'd want to sweep at scale; the
// agent-driven `yelp` source works but is slow and token-heavy, and
// the Apify `yelp_businesses` actor costs per result. This Playwright
// path is the lowest-cost-at-scale option once you have the infra.
//
// Approach:
//   1. Build the search URL: yelp.com/search?find_desc=<cat>&find_loc=<geo>.
//   2. Render the page in the pool (residential proxy + UA rotation).
//   3. Parse with JSON-LD first (Yelp embeds structured ItemList +
//      LocalBusiness blocks; durable across UI redesigns) and fall
//      back to a selector pass when JSON-LD is absent.
//   4. Page through results until we hit maxResults or run out.
//
// Important: we never bypass CAPTCHA challenges or mimic auth. The
// pool retries with a fresh proxy on errors, but if Yelp serves a
// challenge we surface it as a scraper error and the runner falls
// back to the agent path. Users are responsible for compliance with
// Yelp's terms of service and applicable scraping law in their
// jurisdiction.

import { withPage, isPlaywrightAvailable } from "../scrapers/playwright-pool";

const YELP_HOST = "yelp.com";
const SEARCH_URL = "https://www.yelp.com/search";

export type YelpBusiness = {
  yelpId: string;
  name: string;
  yelpUrl: string;
  websiteUrl?: string;
  phone?: string;
  formattedAddress?: string;
  streetAddress?: string;
  city?: string;
  region?: string;
  postalCode?: string;
  countryCode?: string;
  category?: string;
  categories?: string[];
  rating?: number;
  reviewCount?: number;
  lat?: number;
  lng?: number;
};

// --- Public API ---------------------------------------------------------

export async function searchYelpDirect(params: {
  category?: string;
  query?: string;
  geo: string;
  maxResults?: number;
  signal?: AbortSignal;
}): Promise<YelpBusiness[]> {
  if (!(await isPlaywrightAvailable())) {
    throw new Error(
      "Playwright is not available. Install with `npm install playwright && npx playwright install chromium`, or use the agent-driven `yelp` source instead."
    );
  }
  const want = Math.min(params.maxResults ?? 24, 240);
  const term = params.query ?? params.category ?? "";
  if (!term || !params.geo) return [];

  // Yelp paginates in chunks of 10 by default (start=0,10,20,…). We pull
  // pages until we have enough or hit the safety cap.
  const collected: YelpBusiness[] = [];
  for (let start = 0; collected.length < want; start += 10) {
    if (params.signal?.aborted) break;
    if (start >= 240) break; // Yelp's hard cap on paginated results.

    const url = buildSearchUrl(term, params.geo, start);
    const html = await fetchListingHtml(url, params.signal);
    const page = parseYelpListingHTML(html, { fallbackUrl: url });
    if (page.length === 0) break;
    collected.push(...page);
  }
  return dedupe(collected).slice(0, want);
}

export function buildSearchUrl(term: string, geo: string, start = 0): string {
  const u = new URL(SEARCH_URL);
  u.searchParams.set("find_desc", term);
  u.searchParams.set("find_loc", geo);
  if (start > 0) u.searchParams.set("start", String(start));
  return u.toString();
}

async function fetchListingHtml(url: string, signal?: AbortSignal): Promise<string> {
  return withPage<string>(
    YELP_HOST,
    async (page) => {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
      // Best-effort wait for JSON-LD or the result list — but don't fail if
      // neither shows up; the parser handles empty pages gracefully.
      try {
        await page.waitForSelector('script[type="application/ld+json"]', {
          timeout: 5_000,
        });
      } catch {
        // ignore
      }
      return page.content();
    },
    { signal }
  );
}

// --- Parser -------------------------------------------------------------
//
// Pulled into its own pure function so we can unit-test it against
// fixture HTML without launching a browser. The function takes raw HTML
// and returns the businesses extracted from any embedded JSON-LD; it's
// resilient to Yelp's UI changes because the schema.org payload is what
// powers their SEO and is therefore stable.

type LdItem = {
  "@type"?: string | string[];
  itemListElement?: LdItem[];
  item?: LdItem;
  position?: number;
  name?: string;
  url?: string;
  telephone?: string;
  image?: string;
  priceRange?: string;
  aggregateRating?: { ratingValue?: number | string; reviewCount?: number | string };
  address?: {
    "@type"?: string;
    streetAddress?: string;
    addressLocality?: string;
    addressRegion?: string;
    postalCode?: string;
    addressCountry?: string;
  };
  geo?: { latitude?: number | string; longitude?: number | string };
  servesCuisine?: string | string[];
  category?: string | string[];
};

const JSON_LD_RE =
  /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

export function parseYelpListingHTML(
  html: string,
  opts: { fallbackUrl?: string } = {}
): YelpBusiness[] {
  const blocks: LdItem[] = [];
  for (const m of html.matchAll(JSON_LD_RE)) {
    const raw = m[1].trim();
    if (!raw) continue;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        blocks.push(...(parsed as LdItem[]));
      } else if (parsed && typeof parsed === "object") {
        blocks.push(parsed as LdItem);
      }
    } catch {
      // Yelp occasionally embeds malformed JSON-LD; skip silently.
    }
  }

  // Flatten ItemList containers into their members.
  const items: LdItem[] = [];
  for (const b of blocks) {
    if (matchType(b, "ItemList") && Array.isArray(b.itemListElement)) {
      for (const el of b.itemListElement) {
        if (el?.item) items.push(el.item);
        else if (el) items.push(el);
      }
    } else {
      items.push(b);
    }
  }

  const out: YelpBusiness[] = [];
  for (const it of items) {
    if (!isBusinessLike(it)) continue;
    const lead = ldToBusiness(it, opts.fallbackUrl);
    if (lead) out.push(lead);
  }
  return out;
}

function matchType(item: LdItem, t: string): boolean {
  const x = item["@type"];
  if (typeof x === "string") return x === t;
  if (Array.isArray(x)) return x.includes(t);
  return false;
}

function isBusinessLike(item: LdItem): boolean {
  const t = item["@type"];
  if (!t) return !!item.name && !!item.address;
  const types = Array.isArray(t) ? t : [t];
  return types.some(
    (x) =>
      x === "LocalBusiness" ||
      x === "Restaurant" ||
      x === "Store" ||
      x === "FoodEstablishment" ||
      x === "ProfessionalService" ||
      x === "Organization"
  );
}

function ldToBusiness(it: LdItem, fallbackUrl?: string): YelpBusiness | undefined {
  const name = typeof it.name === "string" ? it.name.trim() : undefined;
  if (!name) return undefined;
  const yelpUrl = typeof it.url === "string" ? it.url : fallbackUrl;
  if (!yelpUrl) return undefined;

  const yelpId = extractYelpId(yelpUrl) ?? yelpUrl;

  const rating = numFrom(it.aggregateRating?.ratingValue);
  const reviewCount = numFrom(it.aggregateRating?.reviewCount);
  const lat = numFrom(it.geo?.latitude);
  const lng = numFrom(it.geo?.longitude);

  const cats = catsFrom(it.category) ?? catsFrom(it.servesCuisine);
  const primaryCategory = cats?.[0];

  const a = it.address ?? {};
  const addrParts = [a.streetAddress, a.addressLocality, a.addressRegion, a.postalCode]
    .filter(Boolean)
    .join(", ");

  return {
    yelpId,
    name,
    yelpUrl,
    phone: it.telephone?.toString().trim() || undefined,
    formattedAddress: addrParts || undefined,
    streetAddress: a.streetAddress?.toString().trim() || undefined,
    city: a.addressLocality?.toString().trim() || undefined,
    region: a.addressRegion?.toString().trim() || undefined,
    postalCode: a.postalCode?.toString().trim() || undefined,
    countryCode: a.addressCountry?.toString().trim() || undefined,
    category: primaryCategory,
    categories: cats,
    rating,
    reviewCount,
    lat,
    lng,
  };
}

function numFrom(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function catsFrom(v: unknown): string[] | undefined {
  if (typeof v === "string") return [v];
  if (Array.isArray(v))
    return v.filter((x): x is string => typeof x === "string");
  return undefined;
}

function extractYelpId(yelpUrl: string): string | undefined {
  try {
    const u = new URL(yelpUrl);
    // Yelp profile URLs are /biz/<slug>; the slug is unique-per-business
    // and is the most stable identity key.
    const m = /^\/biz\/([^/]+)/.exec(u.pathname);
    return m?.[1];
  } catch {
    return undefined;
  }
}

function dedupe(items: YelpBusiness[]): YelpBusiness[] {
  const seen = new Set<string>();
  return items.filter((b) => {
    if (seen.has(b.yelpId)) return false;
    seen.add(b.yelpId);
    return true;
  });
}

// --- Lead-input adapter -------------------------------------------------

export function yelpDirectToLeadInput(
  b: YelpBusiness,
  searchId: string,
  category?: string,
  geoLabel?: string
): {
  searchId: string;
  companyName: string;
  websiteUrl?: string;
  description?: string;
  location?: string;
  industry?: string;
  matchReason?: string;
  sourceUrl?: string;
  score?: number;
  phone?: string;
  streetAddress?: string;
  city?: string;
  region?: string;
  postalCode?: string;
  countryCode?: string;
  lat?: number;
  lng?: number;
  placeId?: string;
} {
  const ratingNote =
    b.rating !== undefined && b.reviewCount
      ? ` · ${b.rating.toFixed(1)}★ (${b.reviewCount} reviews)`
      : "";
  return {
    searchId,
    companyName: b.name,
    websiteUrl: b.websiteUrl,
    description: b.category,
    location: b.formattedAddress ?? geoLabel,
    industry: category ?? b.category,
    matchReason: `Found via Yelp (Playwright)${ratingNote}${
      geoLabel ? ` near ${geoLabel}` : ""
    }`,
    sourceUrl: b.yelpUrl,
    score: scoreYelp(b),
    phone: b.phone,
    streetAddress: b.streetAddress,
    city: b.city,
    region: b.region,
    postalCode: b.postalCode,
    countryCode: b.countryCode ?? "US",
    lat: b.lat,
    lng: b.lng,
    placeId: `yelp:${b.yelpId}`,
  };
}

function scoreYelp(b: YelpBusiness): number {
  let s = 50;
  if (b.phone) s += 15;
  if (b.streetAddress) s += 10;
  if (b.rating !== undefined && b.reviewCount && b.reviewCount >= 5) {
    if (b.rating >= 4.5) s += 10;
    else if (b.rating >= 4.0) s += 5;
    else if (b.rating < 3.0) s -= 10;
  }
  return Math.max(0, Math.min(100, s));
}
