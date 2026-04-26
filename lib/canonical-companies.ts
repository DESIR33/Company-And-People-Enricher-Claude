// Cross-source entity resolution.
//
// Phase 3 — every discovery source we ship (Google Places, Foursquare,
// Bing, TomTom, HERE, OSM, Apify actors, Yelp Playwright, BBB
// Playwright, agent-driven scrapes) finds the same SMB independently.
// Without dedup, a plumber on Google + Yelp + BBB + Foursquare creates
// 4 lead rows pointing at one real-world business.
//
// This module gives the system one canonical company record per real
// SMB. Each `discovered_lead` links to it via `canonical_company_id`.
// Match strength is graded:
//
//   STRONG (auto-merge on any one match):
//     - Same normalized phone (E.164 / digits)
//     - Same registered domain (apex of websiteUrl)
//   MEDIUM (auto-merge on 2+ matches):
//     - Same normalized name + same postal code
//     - Same normalized name + close geohash (~150m)
//     - Same normalized address (street + city + zip)
//
// Everything else stays separate — better to keep two records the
// system isn't sure about than to incorrectly fold a real business
// into a sibling. The idea is conservative dedup: false negatives are
// recoverable (a "merge these two" UI), false positives aren't.
//
// Field-level merge uses a source-authority order (highest wins). The
// authoritative source contributes its fields when the canonical
// record's slot is empty OR when the new source outranks the slot's
// current contributor. Per-source signals (Yelp rating, BBB
// accreditation, Google review count) are kept under their own field
// regardless of authority order — they're complementary, not
// competing.

import { v4 as uuidv4 } from "uuid";
import { getDb } from "./db";
import {
  canonicalLeadKey,
  getSearch,
  normalizeAddress,
  normalizeDomain,
  normalizeName,
  normalizePhone,
  registerLeadAfterInsertHook,
  type DiscoveredLead,
} from "./discovery-store";

// --- Source authority -----------------------------------------------------
//
// Higher = more trusted for general fields (name, address, NAP).
// Sources outside this map default to authority 0 (lowest).
//
// Rationale:
//   - google_places: most up-to-date verified business data
//   - bbb_direct / bbb: accredited businesses are vetted, addresses
//     verified by mail
//   - foursquare / tomtom / here_places: structured commercial mapping
//   - osm_overpass: community-edited; broad but not always fresh
//   - yelp / yelp_direct: user-generated, name/category strong but
//     phone/address lag updates
//   - agent-driven sources: scraped, lowest confidence
const SOURCE_AUTHORITY: Record<string, number> = {
  google_places: 100,
  bbb_direct: 90,
  bbb: 85,
  foursquare: 80,
  tomtom: 78,
  here_places: 78,
  bing_places: 70,
  osm_overpass: 60,
  google_lsa: 90,
  yellowpages: 50,
  manta: 50,
  state_license_board: 70,
  state_sos: 65,
  yelp_direct: 55,
  yelp: 50,
  apify: 50,
  google_maps: 70,
  angi: 45,
  facebook_pages: 40,
  nextdoor: 40,
  opentable: 60,
  tripadvisor: 50,
  delivery_marketplace: 45,
  houzz: 50,
  custom: 30,
  firecrawl_search: 30,
  yc: 60,
  producthunt: 50,
  github: 40,
  tech_stack: 40,
};

export function sourceAuthority(slug?: string): number {
  if (!slug) return 0;
  return SOURCE_AUTHORITY[slug] ?? 0;
}

// --- Geohash --------------------------------------------------------------
//
// Standard public-domain Niemeyer geohash. Precision 7 ≈ 153m × 153m
// cells, which is the right grain for "is this the same storefront?".

const GEOHASH_BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz";

export function geohashEncode(lat: number, lng: number, precision = 7): string {
  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    lat < -90 ||
    lat > 90 ||
    lng < -180 ||
    lng > 180
  ) {
    return "";
  }
  let latRange: [number, number] = [-90, 90];
  let lngRange: [number, number] = [-180, 180];
  let bits = 0;
  let bitCount = 0;
  let evenBit = true;
  let out = "";
  while (out.length < precision) {
    if (evenBit) {
      const mid = (lngRange[0] + lngRange[1]) / 2;
      if (lng >= mid) {
        bits = (bits << 1) | 1;
        lngRange = [mid, lngRange[1]];
      } else {
        bits = bits << 1;
        lngRange = [lngRange[0], mid];
      }
    } else {
      const mid = (latRange[0] + latRange[1]) / 2;
      if (lat >= mid) {
        bits = (bits << 1) | 1;
        latRange = [mid, latRange[1]];
      } else {
        bits = bits << 1;
        latRange = [latRange[0], mid];
      }
    }
    evenBit = !evenBit;
    bitCount += 1;
    if (bitCount === 5) {
      out += GEOHASH_BASE32[bits];
      bits = 0;
      bitCount = 0;
    }
  }
  return out;
}

// --- Types ----------------------------------------------------------------

export type CanonicalSource = string;

export type CanonicalCompany = {
  id: string;
  workspaceId: string;
  identityKey: string;
  companyName: string;
  websiteUrl?: string;
  domain?: string;
  phone?: string;
  streetAddress?: string;
  city?: string;
  region?: string;
  postalCode?: string;
  countryCode?: string;
  lat?: number;
  lng?: number;
  geohash?: string;
  industry?: string;
  categories: string[];
  hours?: string;
  googleRating?: number;
  googleReviewCount?: number;
  yelpRating?: number;
  yelpReviewCount?: number;
  bbbRating?: string;
  bbbAccredited?: boolean;
  yearsInBusiness?: number;
  naicsCode?: string;
  licenseNumber?: string;
  seenInSources: CanonicalSource[];
  sourceCount: number;
  firstSeenAt: number;
  lastSeenAt: number;
  createdAt: number;
  updatedAt: number;
};

export type CanonicalUpsertInput = {
  workspaceId: string;
  source: CanonicalSource;
  companyName: string;
  websiteUrl?: string;
  phone?: string;
  streetAddress?: string;
  city?: string;
  region?: string;
  postalCode?: string;
  countryCode?: string;
  lat?: number;
  lng?: number;
  industry?: string;
  hours?: string;
  rating?: number;          // generic — bucketed into source-specific slot below
  reviewCount?: number;
  bbbRating?: string;
  bbbAccredited?: boolean;
  yearsInBusiness?: number;
  naicsCode?: string;
  licenseNumber?: string;
};

type CanonicalRow = {
  id: string;
  workspace_id: string;
  identity_key: string;
  company_name: string;
  website_url: string | null;
  domain: string | null;
  phone: string | null;
  street_address: string | null;
  city: string | null;
  region: string | null;
  postal_code: string | null;
  country_code: string | null;
  lat: number | null;
  lng: number | null;
  geohash: string | null;
  industry: string | null;
  categories: string | null;
  hours: string | null;
  google_rating: number | null;
  google_review_count: number | null;
  yelp_rating: number | null;
  yelp_review_count: number | null;
  bbb_rating: string | null;
  bbb_accredited: number | null;
  years_in_business: number | null;
  naics_code: string | null;
  license_number: string | null;
  seen_in_sources: string;
  source_count: number;
  first_seen_at: number;
  last_seen_at: number;
  created_at: number;
  updated_at: number;
};

function rowToCompany(r: CanonicalRow): CanonicalCompany {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    identityKey: r.identity_key,
    companyName: r.company_name,
    websiteUrl: r.website_url ?? undefined,
    domain: r.domain ?? undefined,
    phone: r.phone ?? undefined,
    streetAddress: r.street_address ?? undefined,
    city: r.city ?? undefined,
    region: r.region ?? undefined,
    postalCode: r.postal_code ?? undefined,
    countryCode: r.country_code ?? undefined,
    lat: r.lat ?? undefined,
    lng: r.lng ?? undefined,
    geohash: r.geohash ?? undefined,
    industry: r.industry ?? undefined,
    categories: r.categories ? safeParseArray(r.categories) : [],
    hours: r.hours ?? undefined,
    googleRating: r.google_rating ?? undefined,
    googleReviewCount: r.google_review_count ?? undefined,
    yelpRating: r.yelp_rating ?? undefined,
    yelpReviewCount: r.yelp_review_count ?? undefined,
    bbbRating: r.bbb_rating ?? undefined,
    bbbAccredited:
      r.bbb_accredited === null ? undefined : r.bbb_accredited === 1,
    yearsInBusiness: r.years_in_business ?? undefined,
    naicsCode: r.naics_code ?? undefined,
    licenseNumber: r.license_number ?? undefined,
    seenInSources: safeParseArray(r.seen_in_sources),
    sourceCount: r.source_count,
    firstSeenAt: r.first_seen_at,
    lastSeenAt: r.last_seen_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function safeParseArray(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter((x) => typeof x === "string");
    return [];
  } catch {
    return [];
  }
}

// --- Match logic ----------------------------------------------------------
//
// Returns the best canonical match candidate for `incoming` within the
// given workspace, or undefined if nothing meets the threshold.

export function findCanonicalMatch(
  workspaceId: string,
  incoming: CanonicalUpsertInput
): CanonicalCompany | undefined {
  const db = getDb();
  const phone = normalizePhone(incoming.phone);
  const domain = normalizeDomain(incoming.websiteUrl);
  const name = normalizeName(incoming.companyName);
  const addr = normalizeAddress(incoming.streetAddress);
  const postal = incoming.postalCode?.trim() || undefined;
  const gh =
    incoming.lat !== undefined && incoming.lng !== undefined
      ? geohashEncode(incoming.lat, incoming.lng, 7)
      : undefined;

  // STRONG match — same phone, anywhere in the workspace.
  if (phone) {
    const row = db
      .prepare(
        `SELECT * FROM canonical_companies WHERE workspace_id = ? AND phone = ? LIMIT 1`
      )
      .get(workspaceId, phone) as CanonicalRow | undefined;
    if (row) return rowToCompany(row);
  }

  // STRONG match — same domain, anywhere in the workspace.
  if (domain) {
    const row = db
      .prepare(
        `SELECT * FROM canonical_companies WHERE workspace_id = ? AND domain = ? LIMIT 1`
      )
      .get(workspaceId, domain) as CanonicalRow | undefined;
    if (row) return rowToCompany(row);
  }

  // MEDIUM match — geohash bucket + name overlap.
  if (gh && name) {
    const candidates = db
      .prepare(
        `SELECT * FROM canonical_companies WHERE workspace_id = ? AND geohash = ?`
      )
      .all(workspaceId, gh) as CanonicalRow[];
    for (const r of candidates) {
      if (normalizeName(r.company_name) === name) return rowToCompany(r);
    }
  }

  // MEDIUM match — same normalized name + postal code.
  if (name && postal) {
    const candidates = db
      .prepare(
        `SELECT * FROM canonical_companies WHERE workspace_id = ? AND postal_code = ?`
      )
      .all(workspaceId, postal) as CanonicalRow[];
    for (const r of candidates) {
      if (normalizeName(r.company_name) === name) return rowToCompany(r);
    }
  }

  // MEDIUM match — same normalized name + same normalized address.
  if (name && addr) {
    const candidates = db
      .prepare(
        `SELECT * FROM canonical_companies WHERE workspace_id = ? AND street_address IS NOT NULL`
      )
      .all(workspaceId) as CanonicalRow[];
    for (const r of candidates) {
      if (
        normalizeName(r.company_name) === name &&
        normalizeAddress(r.street_address ?? undefined) === addr
      ) {
        return rowToCompany(r);
      }
    }
  }

  return undefined;
}

// --- Merge logic ---------------------------------------------------------

// Pure merge — given the existing canonical record + an incoming source's
// data, return what the canonical fields should look like after the
// merge. Per-source signal slots (google_*, yelp_*, bbb_*) update only
// from their owning source family. NAP fields update when the incoming
// source's authority equals or exceeds the implied authority of the
// existing slot.
export function mergeCanonical(
  existing: CanonicalCompany,
  incoming: CanonicalUpsertInput
): CanonicalCompany {
  const incomingAuth = sourceAuthority(incoming.source);
  const merged: CanonicalCompany = { ...existing };

  // Helper: replace if incoming source's authority is at least the
  // tag-implied authority of whatever currently sits in the slot.
  // Practically: prefer keeping the higher-authority value, but always
  // accept incoming when the slot is empty.
  const authoritativePick = <K extends keyof CanonicalCompany>(
    key: K,
    incomingValue: CanonicalCompany[K] | undefined
  ): void => {
    if (incomingValue === undefined || incomingValue === null) return;
    if (existing[key] === undefined || existing[key] === null) {
      merged[key] = incomingValue;
      return;
    }
    // The existing slot's effective authority isn't tracked per-field
    // (would require a side table); we approximate by saying "an
    // incoming source can overwrite if its authority is >= the highest
    // authority currently in seenInSources." This keeps high-auth data
    // sticky even when low-auth sources arrive later.
    const existingMaxAuth = Math.max(
      0,
      ...existing.seenInSources.map(sourceAuthority)
    );
    if (incomingAuth >= existingMaxAuth) merged[key] = incomingValue;
  };

  authoritativePick("companyName", incoming.companyName);
  authoritativePick("websiteUrl", incoming.websiteUrl);
  authoritativePick("phone", normalizePhone(incoming.phone) ?? incoming.phone);
  authoritativePick("streetAddress", incoming.streetAddress);
  authoritativePick("city", incoming.city);
  authoritativePick("region", incoming.region);
  authoritativePick("postalCode", incoming.postalCode);
  authoritativePick("countryCode", incoming.countryCode);
  authoritativePick("lat", incoming.lat);
  authoritativePick("lng", incoming.lng);
  authoritativePick("hours", incoming.hours);
  authoritativePick("industry", incoming.industry);
  authoritativePick("naicsCode", incoming.naicsCode);
  authoritativePick("licenseNumber", incoming.licenseNumber);

  // Domain is derived; recompute if websiteUrl changed.
  merged.domain = normalizeDomain(merged.websiteUrl) ?? existing.domain;
  // Geohash recomputes when lat/lng exist.
  if (merged.lat !== undefined && merged.lng !== undefined) {
    merged.geohash = geohashEncode(merged.lat, merged.lng, 7);
  }

  // Per-source signal slots — never overwrite from the wrong source family.
  if (
    incoming.source === "google_places" ||
    incoming.source === "google_maps" ||
    incoming.source === "google_lsa"
  ) {
    if (incoming.rating !== undefined) merged.googleRating = incoming.rating;
    if (incoming.reviewCount !== undefined)
      merged.googleReviewCount = incoming.reviewCount;
  }
  if (incoming.source === "yelp_direct" || incoming.source === "yelp") {
    if (incoming.rating !== undefined) merged.yelpRating = incoming.rating;
    if (incoming.reviewCount !== undefined)
      merged.yelpReviewCount = incoming.reviewCount;
  }
  if (incoming.source === "bbb_direct" || incoming.source === "bbb") {
    if (incoming.bbbRating !== undefined) merged.bbbRating = incoming.bbbRating;
    if (incoming.bbbAccredited !== undefined)
      merged.bbbAccredited = incoming.bbbAccredited;
  }
  if (incoming.yearsInBusiness !== undefined) {
    // Keep the larger number — both sources usually report a lower bound.
    merged.yearsInBusiness = Math.max(
      existing.yearsInBusiness ?? 0,
      incoming.yearsInBusiness
    );
  }

  // Categories union (preserve order, dedup case-insensitively).
  if (incoming.industry) {
    const lc = new Set(existing.categories.map((c) => c.toLowerCase()));
    if (!lc.has(incoming.industry.toLowerCase())) {
      merged.categories = [...existing.categories, incoming.industry];
    }
  }

  // Source set — add the incoming source if not already present.
  if (!existing.seenInSources.includes(incoming.source)) {
    merged.seenInSources = [...existing.seenInSources, incoming.source];
    merged.sourceCount = merged.seenInSources.length;
  }

  merged.lastSeenAt = Date.now();
  merged.updatedAt = Date.now();
  return merged;
}

// --- Upsert ---------------------------------------------------------------

export function upsertCanonicalCompany(
  input: CanonicalUpsertInput
): CanonicalCompany {
  const db = getDb();
  const now = Date.now();

  const existing = findCanonicalMatch(input.workspaceId, input);
  if (existing) {
    const merged = mergeCanonical(existing, input);
    db.prepare(
      `UPDATE canonical_companies SET
         company_name        = @companyName,
         website_url         = @websiteUrl,
         domain              = @domain,
         phone               = @phone,
         street_address      = @streetAddress,
         city                = @city,
         region              = @region,
         postal_code         = @postalCode,
         country_code        = @countryCode,
         lat                 = @lat,
         lng                 = @lng,
         geohash             = @geohash,
         industry            = @industry,
         categories          = @categories,
         hours               = @hours,
         google_rating       = @googleRating,
         google_review_count = @googleReviewCount,
         yelp_rating         = @yelpRating,
         yelp_review_count   = @yelpReviewCount,
         bbb_rating          = @bbbRating,
         bbb_accredited      = @bbbAccredited,
         years_in_business   = @yearsInBusiness,
         naics_code          = @naicsCode,
         license_number      = @licenseNumber,
         seen_in_sources     = @seenInSources,
         source_count        = @sourceCount,
         last_seen_at        = @lastSeenAt,
         updated_at          = @updatedAt
       WHERE id = @id`
    ).run({
      id: merged.id,
      companyName: merged.companyName,
      websiteUrl: merged.websiteUrl ?? null,
      domain: merged.domain ?? null,
      phone: merged.phone ?? null,
      streetAddress: merged.streetAddress ?? null,
      city: merged.city ?? null,
      region: merged.region ?? null,
      postalCode: merged.postalCode ?? null,
      countryCode: merged.countryCode ?? null,
      lat: merged.lat ?? null,
      lng: merged.lng ?? null,
      geohash: merged.geohash ?? null,
      industry: merged.industry ?? null,
      categories: JSON.stringify(merged.categories),
      hours: merged.hours ?? null,
      googleRating: merged.googleRating ?? null,
      googleReviewCount: merged.googleReviewCount ?? null,
      yelpRating: merged.yelpRating ?? null,
      yelpReviewCount: merged.yelpReviewCount ?? null,
      bbbRating: merged.bbbRating ?? null,
      bbbAccredited:
        merged.bbbAccredited === undefined ? null : merged.bbbAccredited ? 1 : 0,
      yearsInBusiness: merged.yearsInBusiness ?? null,
      naicsCode: merged.naicsCode ?? null,
      licenseNumber: merged.licenseNumber ?? null,
      seenInSources: JSON.stringify(merged.seenInSources),
      sourceCount: merged.sourceCount,
      lastSeenAt: merged.lastSeenAt,
      updatedAt: merged.updatedAt,
    });
    return merged;
  }

  const id = uuidv4();
  const phone = normalizePhone(input.phone);
  const domain = normalizeDomain(input.websiteUrl);
  const geohash =
    input.lat !== undefined && input.lng !== undefined
      ? geohashEncode(input.lat, input.lng, 7)
      : undefined;
  const identityKey = canonicalLeadKey({
    companyName: input.companyName,
    websiteUrl: input.websiteUrl,
    phone: input.phone,
    streetAddress: input.streetAddress,
    postalCode: input.postalCode,
  });

  const isGoogle =
    input.source === "google_places" ||
    input.source === "google_maps" ||
    input.source === "google_lsa";
  const isYelp = input.source === "yelp_direct" || input.source === "yelp";
  const isBbb = input.source === "bbb_direct" || input.source === "bbb";

  const row: CanonicalCompany = {
    id,
    workspaceId: input.workspaceId,
    identityKey,
    companyName: input.companyName,
    websiteUrl: input.websiteUrl,
    domain,
    phone,
    streetAddress: input.streetAddress,
    city: input.city,
    region: input.region,
    postalCode: input.postalCode,
    countryCode: input.countryCode,
    lat: input.lat,
    lng: input.lng,
    geohash,
    industry: input.industry,
    categories: input.industry ? [input.industry] : [],
    hours: input.hours,
    googleRating: isGoogle ? input.rating : undefined,
    googleReviewCount: isGoogle ? input.reviewCount : undefined,
    yelpRating: isYelp ? input.rating : undefined,
    yelpReviewCount: isYelp ? input.reviewCount : undefined,
    bbbRating: isBbb ? input.bbbRating : undefined,
    bbbAccredited: isBbb ? input.bbbAccredited : undefined,
    yearsInBusiness: input.yearsInBusiness,
    naicsCode: input.naicsCode,
    licenseNumber: input.licenseNumber,
    seenInSources: [input.source],
    sourceCount: 1,
    firstSeenAt: now,
    lastSeenAt: now,
    createdAt: now,
    updatedAt: now,
  };

  db.prepare(
    `INSERT INTO canonical_companies (
      id, workspace_id, identity_key, company_name, website_url, domain,
      phone, street_address, city, region, postal_code, country_code,
      lat, lng, geohash, industry, categories, hours,
      google_rating, google_review_count, yelp_rating, yelp_review_count,
      bbb_rating, bbb_accredited, years_in_business, naics_code, license_number,
      seen_in_sources, source_count, first_seen_at, last_seen_at, created_at, updated_at
    ) VALUES (
      @id, @workspaceId, @identityKey, @companyName, @websiteUrl, @domain,
      @phone, @streetAddress, @city, @region, @postalCode, @countryCode,
      @lat, @lng, @geohash, @industry, @categories, @hours,
      @googleRating, @googleReviewCount, @yelpRating, @yelpReviewCount,
      @bbbRating, @bbbAccredited, @yearsInBusiness, @naicsCode, @licenseNumber,
      @seenInSources, @sourceCount, @firstSeenAt, @lastSeenAt, @createdAt, @updatedAt
    )`
  ).run({
    id: row.id,
    workspaceId: row.workspaceId,
    identityKey: row.identityKey,
    companyName: row.companyName,
    websiteUrl: row.websiteUrl ?? null,
    domain: row.domain ?? null,
    phone: row.phone ?? null,
    streetAddress: row.streetAddress ?? null,
    city: row.city ?? null,
    region: row.region ?? null,
    postalCode: row.postalCode ?? null,
    countryCode: row.countryCode ?? null,
    lat: row.lat ?? null,
    lng: row.lng ?? null,
    geohash: row.geohash ?? null,
    industry: row.industry ?? null,
    categories: JSON.stringify(row.categories),
    hours: row.hours ?? null,
    googleRating: row.googleRating ?? null,
    googleReviewCount: row.googleReviewCount ?? null,
    yelpRating: row.yelpRating ?? null,
    yelpReviewCount: row.yelpReviewCount ?? null,
    bbbRating: row.bbbRating ?? null,
    bbbAccredited:
      row.bbbAccredited === undefined ? null : row.bbbAccredited ? 1 : 0,
    yearsInBusiness: row.yearsInBusiness ?? null,
    naicsCode: row.naicsCode ?? null,
    licenseNumber: row.licenseNumber ?? null,
    seenInSources: JSON.stringify(row.seenInSources),
    sourceCount: row.sourceCount,
    firstSeenAt: row.firstSeenAt,
    lastSeenAt: row.lastSeenAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
  return row;
}

export function getCanonicalCompany(id: string): CanonicalCompany | undefined {
  const db = getDb();
  const row = db
    .prepare(`SELECT * FROM canonical_companies WHERE id = ? LIMIT 1`)
    .get(id) as CanonicalRow | undefined;
  return row ? rowToCompany(row) : undefined;
}

// Convenience wrapper called by the discovery runner after each
// insertLead. Resolves workspace + source from the search row, upserts
// the canonical record, and writes the canonical id back onto the
// originating lead. Best-effort: returns undefined if the search has
// vanished or the upsert fails — leads still get a row even if the
// canonical link couldn't be established.
export function linkLeadToCanonical(
  searchId: string,
  lead: DiscoveredLead
): CanonicalCompany | undefined {
  const search = getSearch(searchId);
  if (!search) return undefined;

  // Source attribution priority:
  //   - directoryConfig.source (e.g. "google_places", "yelp_direct") for
  //     directory mode runs;
  //   - the search's mode itself ("icp", "lookalike", "signal_*") so
  //     non-directory leads still get a meaningful source slug for the
  //     authority/merge logic.
  const source = search.directoryConfig?.source ?? search.mode;

  let company: CanonicalCompany;
  try {
    company = upsertCanonicalCompany({
      workspaceId: search.workspaceId,
      source,
      companyName: lead.companyName,
      websiteUrl: lead.websiteUrl,
      phone: lead.phone,
      streetAddress: lead.streetAddress,
      city: lead.city,
      region: lead.region,
      postalCode: lead.postalCode,
      countryCode: lead.countryCode,
      lat: lead.lat,
      lng: lead.lng,
      industry: lead.industry,
      hours: lead.hours,
      naicsCode: lead.naicsCode,
      licenseNumber: lead.licenseNumber,
    });
  } catch {
    return undefined;
  }

  const db = getDb();
  db.prepare(
    `UPDATE discovered_leads SET canonical_company_id = ? WHERE id = ?`
  ).run(company.id, lead.id);
  return company;
}

// Register the runner-side hook at module load time. Importing this
// module anywhere (the runner already does for its types) wires the
// linker globally — the discovery-store.insertLead path then fires the
// hook for every lead landed by every source.
registerLeadAfterInsertHook((searchId, lead) => {
  linkLeadToCanonical(searchId, lead);
});

export function listCanonicalCompaniesByWorkspace(
  workspaceId: string,
  opts: { limit?: number; minSources?: number } = {}
): CanonicalCompany[] {
  const db = getDb();
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 1000);
  const minSources = opts.minSources ?? 1;
  const rows = db
    .prepare(
      `SELECT * FROM canonical_companies
       WHERE workspace_id = ? AND source_count >= ?
       ORDER BY last_seen_at DESC
       LIMIT ?`
    )
    .all(workspaceId, minSources, limit) as CanonicalRow[];
  return rows.map(rowToCompany);
}
