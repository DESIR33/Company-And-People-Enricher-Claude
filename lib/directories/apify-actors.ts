// Apify actor presets for SMB lead discovery.
//
// Each preset wires three things together:
//   1. an Apify actor ID (the scraper that does the work),
//   2. an `inputBuilder` that turns our DirectoryConfig into the actor's
//      expected input JSON,
//   3. an `itemToLead` adapter that maps the actor's output items into
//      the lead-input shape the runner inserts into the leads table.
//
// Actors evolve their input + output shapes over time. We keep adapters
// defensive (best-effort field picks, fallback paths) and isolated per
// actor so a breaking change to one actor doesn't ripple to the others.
//
// All adapters return the canonical lead-input shape used by insertLead.

import type { DirectoryConfig } from "../discovery-store";
import type { ApifyItem } from "../scrapers/apify";

export type ApifyLeadInput = {
  searchId: string;
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

export type ApifyActorPreset = {
  id: string;                   // stable preset key used in DirectoryConfig.actorId
  actorId: string;              // Apify actor (canonical username~actor)
  label: string;                // UI label
  hint: string;                 // UI hint shown in the source picker
  smbFriendly: boolean;         // surface in SMB lists by default
  defaultMaxItems: number;      // safety cap for actor input
  inputBuilder: (cfg: DirectoryConfig, maxResults: number) => Record<string, unknown>;
  itemToLead: (item: ApifyItem, searchId: string, cfg: DirectoryConfig) => ApifyLeadInput | undefined;
};

// --- Field-pick helpers ---------------------------------------------------
// Apify actors don't share a schema. These tolerate a variety of field
// names so adapters don't repeat the same fallback logic.

function str(item: ApifyItem, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = item[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

function num(item: ApifyItem, ...keys: string[]): number | undefined {
  for (const k of keys) {
    const v = item[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string") {
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
  }
  return undefined;
}

function nested<T = unknown>(item: ApifyItem, path: string[]): T | undefined {
  let cur: unknown = item;
  for (const p of path) {
    if (cur && typeof cur === "object" && p in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[p];
    } else {
      return undefined;
    }
  }
  return cur as T;
}

function normaliseUrl(raw?: string): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  if (/^https?:\/\//i.test(trimmed)) return trimmed.replace(/\/+$/, "");
  return `https://${trimmed.replace(/\/+$/, "")}`;
}

function scoreFromFields(input: ApifyLeadInput): number {
  let s = 50;
  if (input.websiteUrl) s += 15;
  if (input.phone) s += 15;
  if (input.streetAddress) s += 5;
  if (input.linkedinUrl) s += 5;
  if (input.hours) s += 3;
  return Math.max(0, Math.min(100, s));
}

// --- Generic fallback adapter --------------------------------------------
// Used when a custom actor isn't in the registry. Best-effort heuristic
// mapping over the most common field names.

export function genericItemToLead(
  item: ApifyItem,
  searchId: string,
  cfg: DirectoryConfig
): ApifyLeadInput | undefined {
  const companyName =
    str(item, "title", "name", "company", "companyName", "businessName", "displayName") ??
    nested<{ text?: string }>(item, ["displayName"])?.text;
  if (!companyName) return undefined;

  const lead: ApifyLeadInput = {
    searchId,
    companyName,
    websiteUrl: normaliseUrl(
      str(item, "website", "websiteUrl", "url", "domain", "homepage")
    ),
    linkedinUrl: str(item, "linkedinUrl", "linkedin", "linkedIn"),
    description: str(item, "description", "summary", "tagline", "categoryName", "industry"),
    location:
      str(item, "address", "formattedAddress", "fullAddress", "location") ??
      str(item, "city"),
    industry: str(item, "industry", "category", "categoryName", "primaryCategory") ?? cfg.category,
    employeeRange: str(item, "employees", "employeeRange", "size", "companySize"),
    matchReason: `Found via Apify actor ${cfg.actorId ?? "(custom)"}`,
    sourceUrl: str(item, "url", "profileUrl", "link", "permalink"),
    phone: str(item, "phone", "phoneNumber", "tel", "contactPhone"),
    streetAddress: str(item, "street", "streetAddress", "address1"),
    city: str(item, "city", "locality"),
    region: str(item, "state", "region", "province"),
    postalCode: str(item, "postalCode", "zip", "zipCode", "postcode"),
    countryCode: str(item, "country", "countryCode"),
    lat: num(item, "lat", "latitude") ?? num(nested<ApifyItem>(item, ["location"]) ?? {}, "lat", "latitude"),
    lng: num(item, "lng", "lon", "longitude") ?? num(nested<ApifyItem>(item, ["location"]) ?? {}, "lng", "lon", "longitude"),
    placeId: str(item, "placeId", "id", "fsq_id", "googleMapsId"),
    hours: str(item, "hours", "openingHours"),
  };
  lead.score = scoreFromFields(lead);
  return lead;
}

// --- Concrete actor presets ----------------------------------------------
// These are popular, well-maintained actors as of writing. Actor IDs
// pinned to the form `username~actor`. Users can swap them via the
// custom path if they prefer a different actor.

export const APIFY_ACTOR_PRESETS: ApifyActorPreset[] = [
  {
    id: "linkedin_companies",
    actorId: "apimaestro~linkedin-company-pages-scraper",
    label: "LinkedIn Companies",
    hint: "Scrape LinkedIn company pages by URL list or keyword search. Captures industry, employee count, headquarters, website, follower count.",
    smbFriendly: false,
    defaultMaxItems: 50,
    inputBuilder: (cfg, maxResults) => ({
      keywords: cfg.query ?? cfg.category,
      location: cfg.geo,
      maxItems: Math.min(maxResults, 200),
    }),
    itemToLead: (item, searchId, cfg) => {
      const companyName = str(item, "name", "companyName", "title");
      if (!companyName) return undefined;
      const lead: ApifyLeadInput = {
        searchId,
        companyName,
        websiteUrl: normaliseUrl(str(item, "website", "websiteUrl")),
        linkedinUrl: str(item, "linkedinUrl", "url", "profileUrl"),
        description: str(item, "description", "tagline", "about"),
        location: str(item, "headquarters", "location", "addresses"),
        industry: str(item, "industry") ?? cfg.category,
        employeeRange: str(item, "employeeCount", "companySize", "employees"),
        sourceUrl: str(item, "url", "linkedinUrl"),
        matchReason: `Found via Apify LinkedIn Companies actor`,
        countryCode: str(item, "country", "countryCode"),
        phone: str(item, "phone"),
      };
      lead.score = scoreFromFields(lead);
      return lead;
    },
  },
  {
    id: "glassdoor_companies",
    actorId: "epctex~glassdoor-scraper",
    label: "Glassdoor Companies",
    hint: "Glassdoor company pages — captures company name, rating, reviews, industry, headquarters, employee size, founded year.",
    smbFriendly: false,
    defaultMaxItems: 50,
    inputBuilder: (cfg, maxResults) => ({
      search: cfg.query ?? cfg.category,
      location: cfg.geo,
      maxItems: Math.min(maxResults, 200),
    }),
    itemToLead: (item, searchId, cfg) => {
      const companyName = str(item, "name", "companyName", "title");
      if (!companyName) return undefined;
      const lead: ApifyLeadInput = {
        searchId,
        companyName,
        websiteUrl: normaliseUrl(str(item, "website", "websiteUrl")),
        description: str(item, "description", "industry"),
        location: str(item, "headquarters", "location"),
        industry: str(item, "industry") ?? cfg.category,
        employeeRange: str(item, "size", "employees", "companySize"),
        sourceUrl: str(item, "url", "glassdoorUrl"),
        matchReason: `Found via Apify Glassdoor actor${
          item.rating ? ` · ${item.rating}★ Glassdoor rating` : ""
        }`,
      };
      lead.score = scoreFromFields(lead);
      return lead;
    },
  },
  {
    id: "crunchbase_companies",
    actorId: "epctex~crunchbase-scraper",
    label: "Crunchbase Companies",
    hint: "Crunchbase company profiles — captures funding stage, last raise, total funding, founders, headquarters, categories.",
    smbFriendly: false,
    defaultMaxItems: 50,
    inputBuilder: (cfg, maxResults) => ({
      search: cfg.query ?? cfg.category,
      location: cfg.geo,
      maxItems: Math.min(maxResults, 200),
    }),
    itemToLead: (item, searchId, cfg) => {
      const companyName = str(item, "name", "companyName", "title");
      if (!companyName) return undefined;
      const fundingNote =
        str(item, "lastFundingType", "fundingStage") ??
        (typeof item.totalFundingUsd === "number" ? `$${item.totalFundingUsd}` : undefined);
      const lead: ApifyLeadInput = {
        searchId,
        companyName,
        websiteUrl: normaliseUrl(str(item, "website", "homepageUrl", "websiteUrl")),
        linkedinUrl: str(item, "linkedinUrl"),
        description: str(item, "shortDescription", "description"),
        location: str(item, "headquarters", "location"),
        industry: str(item, "categories", "industry") ?? cfg.category,
        employeeRange: str(item, "employees", "numEmployeesEnum"),
        sourceUrl: str(item, "url", "crunchbaseUrl"),
        matchReason: `Found via Apify Crunchbase actor${fundingNote ? ` · ${fundingNote}` : ""}`,
      };
      lead.score = scoreFromFields(lead);
      return lead;
    },
  },
  {
    id: "yelp_businesses",
    actorId: "yin~yelp-scraper",
    label: "Yelp Businesses",
    hint: "Yelp business listings — captures phone, address, rating, review count, categories, hours. Higher fidelity than the agent-driven Yelp source.",
    smbFriendly: true,
    defaultMaxItems: 100,
    inputBuilder: (cfg, maxResults) => ({
      searchTerms: [cfg.query ?? cfg.category].filter(Boolean),
      location: cfg.geo,
      maxItems: Math.min(maxResults, 500),
    }),
    itemToLead: (item, searchId, cfg) => {
      const companyName = str(item, "name", "businessName", "title");
      if (!companyName) return undefined;
      const rating = num(item, "rating");
      const reviews = num(item, "reviewCount", "numReviews");
      const ratingNote =
        rating !== undefined && reviews
          ? ` · ${rating.toFixed(1)}★ (${reviews} reviews)`
          : "";
      const lead: ApifyLeadInput = {
        searchId,
        companyName,
        websiteUrl: normaliseUrl(str(item, "website", "businessUrl", "url")),
        description: str(item, "categories", "primaryCategory"),
        location: str(item, "address", "formattedAddress"),
        industry: str(item, "primaryCategory", "categories") ?? cfg.category,
        sourceUrl: str(item, "yelpUrl", "url"),
        matchReason: `Found via Apify Yelp actor${ratingNote}`,
        phone: str(item, "phone", "phoneNumber"),
        streetAddress: str(item, "street", "address1"),
        city: str(item, "city"),
        region: str(item, "state", "region"),
        postalCode: str(item, "zipCode", "postalCode"),
        countryCode: str(item, "country") ?? "US",
        lat: num(item, "latitude", "lat"),
        lng: num(item, "longitude", "lng"),
        placeId: str(item, "yelpId", "businessId", "id"),
        hours: str(item, "hours", "openingHours"),
      };
      lead.score = scoreFromFields(lead);
      return lead;
    },
  },
  {
    id: "google_maps_businesses",
    actorId: "compass~crawler-google-places",
    label: "Google Maps (Apify)",
    hint: "Apify's Google Maps actor — alternative to the native Google Places API when you don't have/want a Google Cloud key. Higher per-result cost but no API key wrangling.",
    smbFriendly: true,
    defaultMaxItems: 100,
    inputBuilder: (cfg, maxResults) => ({
      searchStringsArray: [cfg.query ?? cfg.category].filter(Boolean),
      locationQuery: cfg.geo,
      maxCrawledPlacesPerSearch: Math.min(maxResults, 500),
    }),
    itemToLead: (item, searchId, cfg) => {
      const companyName = str(item, "title", "name");
      if (!companyName) return undefined;
      const rating = num(item, "totalScore", "rating");
      const reviews = num(item, "reviewsCount", "reviewCount");
      const ratingNote =
        rating !== undefined && reviews
          ? ` · ${rating.toFixed(1)}★ (${reviews} reviews)`
          : "";
      const lead: ApifyLeadInput = {
        searchId,
        companyName,
        websiteUrl: normaliseUrl(str(item, "website", "websiteUrl")),
        description: str(item, "categoryName", "categories"),
        location: str(item, "address", "fullAddress"),
        industry: str(item, "categoryName") ?? cfg.category,
        sourceUrl: str(item, "url", "googleMapsUrl"),
        matchReason: `Found via Apify Google Maps actor${ratingNote}`,
        phone: str(item, "phone", "phoneUnformatted"),
        streetAddress: str(item, "street"),
        city: str(item, "city"),
        region: str(item, "state"),
        postalCode: str(item, "postalCode", "zip"),
        countryCode: str(item, "countryCode"),
        lat: num(nested<ApifyItem>(item, ["location"]) ?? {}, "lat") ?? num(item, "lat"),
        lng: num(nested<ApifyItem>(item, ["location"]) ?? {}, "lng") ?? num(item, "lng"),
        placeId: str(item, "placeId"),
        hours: str(item, "openingHours"),
      };
      lead.score = scoreFromFields(lead);
      return lead;
    },
  },
  {
    id: "instagram_business_search",
    actorId: "apify~instagram-search-scraper",
    label: "Instagram Business Search",
    hint: "Instagram search — captures handles + bios + follower counts. Useful for finding owner-personal social presence on top of a business search.",
    smbFriendly: true,
    defaultMaxItems: 100,
    inputBuilder: (cfg, maxResults) => ({
      search: cfg.query ?? cfg.category,
      searchType: "user",
      resultsLimit: Math.min(maxResults, 500),
    }),
    itemToLead: (item, searchId, cfg) => {
      const companyName = str(item, "fullName", "name", "username");
      if (!companyName) return undefined;
      const handle = str(item, "username");
      const lead: ApifyLeadInput = {
        searchId,
        companyName,
        websiteUrl: normaliseUrl(str(item, "externalUrl", "website", "url")),
        description: str(item, "biography", "bio"),
        sourceUrl: handle ? `https://instagram.com/${handle}` : str(item, "url"),
        industry: cfg.category,
        matchReason: `Found via Apify Instagram search${
          handle ? ` · @${handle}` : ""
        }${
          typeof item.followersCount === "number"
            ? ` · ${item.followersCount} followers`
            : ""
        }`,
      };
      lead.score = scoreFromFields(lead);
      return lead;
    },
  },
];

const PRESET_INDEX = new Map<string, ApifyActorPreset>(
  APIFY_ACTOR_PRESETS.map((p) => [p.id, p])
);

export function getApifyPreset(id: string): ApifyActorPreset | undefined {
  return PRESET_INDEX.get(id);
}

export function listApifyPresetIds(): string[] {
  return APIFY_ACTOR_PRESETS.map((p) => p.id);
}
