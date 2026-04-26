// BBB direct scraper (Playwright).
//
// Phase 2.2 — second concrete consumer of the Playwright pool. BBB
// (Better Business Bureau) is a high-signal SMB directory: every
// listing has been verified by BBB, and accredited businesses have
// passed a vetting process. The fields we capture beyond NAP:
//
//   - BBB letter rating (A+ … F / NR), strong "real, established
//     business" signal
//   - Accreditation status (yes/no)
//   - Years in business
//
// Approach mirrors yelp-direct.ts: JSON-LD-first parser (BBB embeds
// schema.org LocalBusiness blocks for SEO, durable across UI changes)
// with paginated listing fetches via the shared pool.

import { withPage, isPlaywrightAvailable } from "../scrapers/playwright-pool";

const BBB_HOST = "bbb.org";
const SEARCH_URL = "https://www.bbb.org/search";

export type BbbBusiness = {
  bbbId: string;
  name: string;
  bbbProfileUrl: string;
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
  rating?: number;          // numeric aggregateRating if BBB exposes one
  reviewCount?: number;
  bbbRating?: string;       // A+ … F / NR
  accredited?: boolean;
  yearsInBusiness?: number;
  lat?: number;
  lng?: number;
};

// --- Public API ---------------------------------------------------------

export async function searchBbbDirect(params: {
  category?: string;
  query?: string;
  geo: string;
  maxResults?: number;
  signal?: AbortSignal;
}): Promise<BbbBusiness[]> {
  if (!(await isPlaywrightAvailable())) {
    throw new Error(
      "Playwright is not available. Install with `npm install playwright && npx playwright install chromium`, or use the agent-driven `bbb` source instead."
    );
  }
  const want = Math.min(params.maxResults ?? 30, 300);
  const term = params.query ?? params.category ?? "";
  if (!term || !params.geo) return [];

  // BBB paginates ~30 results per page via ?page=N (1-indexed).
  const collected: BbbBusiness[] = [];
  for (let page = 1; collected.length < want; page++) {
    if (params.signal?.aborted) break;
    if (page > 10) break; // safety cap — ~300 results is plenty

    const url = buildSearchUrl(term, params.geo, page);
    const html = await fetchListingHtml(url, params.signal);
    const pageItems = parseBbbListingHTML(html, { fallbackUrl: url });
    if (pageItems.length === 0) break;
    collected.push(...pageItems);
  }
  return dedupe(collected).slice(0, want);
}

export function buildSearchUrl(term: string, geo: string, page = 1): string {
  const u = new URL(SEARCH_URL);
  u.searchParams.set("find_text", term);
  u.searchParams.set("find_loc", geo);
  u.searchParams.set("find_country", "USA");
  if (page > 1) u.searchParams.set("page", String(page));
  return u.toString();
}

async function fetchListingHtml(url: string, signal?: AbortSignal): Promise<string> {
  return withPage<string>(
    BBB_HOST,
    async (page) => {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
      try {
        await page.waitForSelector('script[type="application/ld+json"]', {
          timeout: 5_000,
        });
      } catch {
        // ignore — empty pages still parse cleanly
      }
      return page.content();
    },
    { signal }
  );
}

// --- Parser -------------------------------------------------------------

type LdItem = {
  "@type"?: string | string[];
  itemListElement?: LdItem[];
  item?: LdItem;
  position?: number;
  name?: string;
  url?: string;
  telephone?: string;
  foundingDate?: string;
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
  category?: string | string[];
  // BBB-specific surface fields some pages emit as schema.org additional
  // properties or namespaced extensions.
  additionalProperty?: { name?: string; value?: string | number }[];
};

const JSON_LD_RE =
  /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

export function parseBbbListingHTML(
  html: string,
  opts: { fallbackUrl?: string } = {}
): BbbBusiness[] {
  const blocks: LdItem[] = [];
  for (const m of html.matchAll(JSON_LD_RE)) {
    const raw = m[1].trim();
    if (!raw) continue;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) blocks.push(...(parsed as LdItem[]));
      else if (parsed && typeof parsed === "object") blocks.push(parsed as LdItem);
    } catch {
      // skip malformed blocks
    }
  }

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

  const out: BbbBusiness[] = [];
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
      x === "ProfessionalService" ||
      x === "Organization" ||
      x === "Corporation"
  );
}

function ldToBusiness(it: LdItem, fallbackUrl?: string): BbbBusiness | undefined {
  const name = typeof it.name === "string" ? it.name.trim() : undefined;
  if (!name) return undefined;

  const bbbProfileUrl = typeof it.url === "string" ? it.url : fallbackUrl;
  if (!bbbProfileUrl) return undefined;
  const bbbId = extractBbbId(bbbProfileUrl) ?? bbbProfileUrl;

  const rating = numFrom(it.aggregateRating?.ratingValue);
  const reviewCount = numFrom(it.aggregateRating?.reviewCount);
  const lat = numFrom(it.geo?.latitude);
  const lng = numFrom(it.geo?.longitude);

  const cats = catsFrom(it.category);
  const primaryCategory = cats?.[0];

  const a = it.address ?? {};
  const addrParts = [a.streetAddress, a.addressLocality, a.addressRegion, a.postalCode]
    .filter(Boolean)
    .join(", ");

  // BBB letter rating + accreditation + years in business may be exposed
  // as additionalProperty; pick them if present.
  const props = it.additionalProperty ?? [];
  const bbbRating = pickProp(props, "BBBRating", "bbbRating", "rating");
  const accreditedRaw = pickProp(props, "Accredited", "BBBAccredited", "accredited");
  const accredited =
    accreditedRaw === undefined
      ? undefined
      : ["true", "yes", "1"].includes(String(accreditedRaw).toLowerCase());
  const yearsInBusiness =
    yearsFromFoundingDate(it.foundingDate) ??
    numFrom(pickProp(props, "YearsInBusiness", "yearsInBusiness"));

  return {
    bbbId,
    name,
    bbbProfileUrl,
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
    bbbRating: typeof bbbRating === "string" ? bbbRating : undefined,
    accredited,
    yearsInBusiness,
    lat,
    lng,
  };
}

function pickProp(
  props: { name?: string; value?: string | number }[],
  ...names: string[]
): string | number | undefined {
  const wanted = new Set(names.map((n) => n.toLowerCase()));
  for (const p of props) {
    if (p.name && wanted.has(p.name.toLowerCase()) && p.value !== undefined) {
      return p.value;
    }
  }
  return undefined;
}

function yearsFromFoundingDate(s?: string): number | undefined {
  if (!s) return undefined;
  const year = parseInt(s.slice(0, 4), 10);
  if (!Number.isFinite(year)) return undefined;
  const diff = new Date().getUTCFullYear() - year;
  return diff >= 0 && diff <= 200 ? diff : undefined;
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
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string");
  return undefined;
}

function extractBbbId(profileUrl: string): string | undefined {
  try {
    const u = new URL(profileUrl);
    // BBB profile URLs look like /us/<state>/<city>/profile/<industry-slug>/<business-slug>-<id>
    // The trailing slug is the most stable identity.
    const parts = u.pathname.split("/").filter(Boolean);
    const profIdx = parts.indexOf("profile");
    if (profIdx >= 0 && parts.length > profIdx + 2) {
      return parts[parts.length - 1];
    }
    return parts[parts.length - 1];
  } catch {
    return undefined;
  }
}

function dedupe(items: BbbBusiness[]): BbbBusiness[] {
  const seen = new Set<string>();
  return items.filter((b) => {
    if (seen.has(b.bbbId)) return false;
    seen.add(b.bbbId);
    return true;
  });
}

// --- Lead-input adapter -------------------------------------------------

export function bbbDirectToLeadInput(
  b: BbbBusiness,
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
  const tags: string[] = ["BBB"];
  if (b.accredited) tags.push("Accredited");
  if (b.bbbRating) tags.push(`${b.bbbRating} rating`);
  if (b.yearsInBusiness !== undefined) tags.push(`${b.yearsInBusiness}y in business`);

  return {
    searchId,
    companyName: b.name,
    websiteUrl: b.websiteUrl,
    description: b.category,
    location: b.formattedAddress ?? geoLabel,
    industry: category ?? b.category,
    matchReason: `Found via ${tags.join(" · ")}${
      geoLabel ? ` near ${geoLabel}` : ""
    }`,
    sourceUrl: b.bbbProfileUrl,
    score: scoreBbb(b),
    phone: b.phone,
    streetAddress: b.streetAddress,
    city: b.city,
    region: b.region,
    postalCode: b.postalCode,
    countryCode: b.countryCode ?? "US",
    lat: b.lat,
    lng: b.lng,
    placeId: `bbb:${b.bbbId}`,
  };
}

// BBB rating maps roughly to outreachability + trust. Accredited businesses
// score higher because BBB has actually verified them. Years in business
// is a "real, established SMB" signal.
function scoreBbb(b: BbbBusiness): number {
  let s = 50;
  if (b.phone) s += 15;
  if (b.streetAddress) s += 10;
  if (b.accredited) s += 8;
  if (b.bbbRating) {
    const grade = b.bbbRating.toUpperCase();
    if (grade.startsWith("A")) s += 8;
    else if (grade.startsWith("B")) s += 4;
    else if (grade.startsWith("F")) s -= 10;
  }
  if (b.yearsInBusiness !== undefined) {
    if (b.yearsInBusiness >= 10) s += 5;
    else if (b.yearsInBusiness >= 3) s += 2;
  }
  return Math.max(0, Math.min(100, s));
}
