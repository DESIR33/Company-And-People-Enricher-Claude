// Foursquare Places API (v3) client.
//
// Foursquare's Places dataset has the broadest international SMB coverage of
// any free-tier API and is especially strong on retail + hospitality. We use
// it as a complement to Google Places: Google has the freshest US data,
// Foursquare picks up long-tail places Google missed and covers ex-US metros
// where Google Places quotas get expensive.
//
// One endpoint is wrapped:
//   - GET /places/search — combines text query, optional categories, and
//     either a circle (ll + radius in meters, max 100km) or a near=<city>
//     bias. Returns up to 50 results per call. Pagination is via the cursor
//     param returned in the JSON body.
//
// Auth header format is the bare API key in `Authorization` (no "Bearer"
// prefix — that's how Foursquare's service keys work).

const FOURSQUARE_BASE =
  process.env.FOURSQUARE_BASE_URL ?? "https://api.foursquare.com/v3";

const MILES_TO_METERS = 1609.344;
// Foursquare's circle radius caps at 100km (62 mi). Anything larger we clamp.
const MAX_RADIUS_METERS = 100_000;

// Subset of Foursquare's category IDs that map cleanly to common SMB types.
// Numeric IDs come from Foursquare's category taxonomy (integer-valued).
//
// Reference: https://docs.foursquare.com/data-products/docs/categories
export const FOURSQUARE_CATEGORIES: Record<string, number[]> = {
  restaurant: [13065],
  cafe: [13032, 13035],
  bar: [13003],
  bakery: [13002],
  fast_food: [13145],
  hotel: [19014],

  plumber: [11144],
  electrician: [11129],
  hvac: [11141],
  roofer: [11150],
  general_contractor: [11125],
  cleaning: [11099, 11142],
  locksmith: [11143],
  car_repair: [11045],

  dentist: [15014],
  doctor: [15022],
  veterinarian: [15029],
  pharmacy: [17142, 11160],
  hair: [11062],
  beauty: [11061],
  fitness: [18021],
  spa: [18068],
  pet: [11163],
  florist: [17035],
  realtor: [11168],
  insurance: [11140],
  lawyer: [11118],
  accountant: [11078],
};

export type FoursquarePlace = {
  fsqId: string;
  name: string;
  lat: number;
  lng: number;
  phone?: string;
  websiteUrl?: string;
  formattedAddress?: string;
  streetAddress?: string;
  city?: string;
  region?: string;
  postalCode?: string;
  countryCode?: string;
  hours?: string;
  categories?: { id: number; name: string }[];
  primaryCategory?: string;
  rating?: number;
  popularity?: number;
  distanceMeters?: number;
};

type RawCategory = {
  id?: number;
  name?: string;
  short_name?: string;
};

type RawPlace = {
  fsq_id?: string;
  name?: string;
  geocodes?: { main?: { latitude?: number; longitude?: number } };
  location?: {
    address?: string;
    locality?: string;
    region?: string;
    postcode?: string;
    country?: string;
    formatted_address?: string;
  };
  tel?: string;
  website?: string;
  hours?: { display?: string; open_now?: boolean };
  categories?: RawCategory[];
  rating?: number;
  popularity?: number;
  distance?: number;
};

type RawResponse = {
  results?: RawPlace[];
  context?: { cursor?: string };
};

function apiKey(): string {
  const k = process.env.FOURSQUARE_API_KEY;
  if (!k) {
    throw new Error(
      "FOURSQUARE_API_KEY is not set. Get one at https://foursquare.com/developers — create a Service API key."
    );
  }
  return k;
}

async function getPlaces(
  query: URLSearchParams,
  signal?: AbortSignal
): Promise<RawResponse> {
  const res = await fetch(`${FOURSQUARE_BASE}/places/search?${query.toString()}`, {
    method: "GET",
    headers: {
      Authorization: apiKey(),
      Accept: "application/json",
    },
    signal,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Foursquare ${res.status}: ${text.slice(0, 400)}`);
  }
  return (await res.json()) as RawResponse;
}

function rawToPlace(p: RawPlace): FoursquarePlace | undefined {
  const fsqId = p.fsq_id;
  const name = p.name;
  const lat = p.geocodes?.main?.latitude;
  const lng = p.geocodes?.main?.longitude;
  if (!fsqId || !name || lat === undefined || lng === undefined) return undefined;

  const cats = (p.categories ?? [])
    .filter((c) => c.id !== undefined && c.name !== undefined)
    .map((c) => ({ id: c.id as number, name: c.name as string }));

  return {
    fsqId,
    name,
    lat,
    lng,
    phone: p.tel,
    websiteUrl: normaliseUrl(p.website),
    formattedAddress: p.location?.formatted_address,
    streetAddress: p.location?.address,
    city: p.location?.locality,
    region: p.location?.region,
    postalCode: p.location?.postcode,
    countryCode: p.location?.country,
    hours: p.hours?.display,
    categories: cats,
    primaryCategory: cats[0]?.name,
    rating: p.rating,
    popularity: p.popularity,
    distanceMeters: p.distance,
  };
}

function normaliseUrl(raw?: string): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  if (/^https?:\/\//i.test(trimmed)) return trimmed.replace(/\/$/, "");
  return `https://${trimmed.replace(/\/$/, "")}`;
}

function resolveCategories(category?: string): number[] | undefined {
  if (!category) return undefined;
  const key = category.toLowerCase().trim().replace(/[^a-z0-9_]/g, "_");
  return FOURSQUARE_CATEGORIES[key];
}

const FIELDS = [
  "fsq_id",
  "name",
  "geocodes",
  "location",
  "tel",
  "website",
  "hours",
  "categories",
  "rating",
  "popularity",
  "distance",
].join(",");

export async function searchFoursquareRadius(params: {
  lat: number;
  lng: number;
  radiusMiles: number;
  category?: string;
  query?: string;
  maxResults?: number;
  signal?: AbortSignal;
}): Promise<FoursquarePlace[]> {
  const want = Math.min(params.maxResults ?? 50, 200);
  const categories = resolveCategories(params.category);
  const radiusMeters = Math.min(
    MAX_RADIUS_METERS,
    Math.round(params.radiusMiles * MILES_TO_METERS)
  );
  const out: FoursquarePlace[] = [];
  let cursor: string | undefined;

  while (out.length < want) {
    const qs = new URLSearchParams({
      ll: `${params.lat},${params.lng}`,
      radius: String(radiusMeters),
      limit: String(Math.min(50, want - out.length)),
      fields: FIELDS,
    });
    if (params.query) qs.set("query", params.query);
    if (categories?.length) qs.set("categories", categories.join(","));
    if (cursor) qs.set("cursor", cursor);

    const json = await getPlaces(qs, params.signal);
    for (const raw of json.results ?? []) {
      const place = rawToPlace(raw);
      if (place) out.push(place);
    }
    cursor = json.context?.cursor;
    if (!cursor || (json.results?.length ?? 0) === 0) break;
  }

  return dedupe(out).slice(0, want);
}

export async function searchFoursquareNear(params: {
  near: string;
  category?: string;
  query?: string;
  maxResults?: number;
  signal?: AbortSignal;
}): Promise<FoursquarePlace[]> {
  const want = Math.min(params.maxResults ?? 50, 200);
  const categories = resolveCategories(params.category);
  const out: FoursquarePlace[] = [];
  let cursor: string | undefined;

  while (out.length < want) {
    const qs = new URLSearchParams({
      near: params.near,
      limit: String(Math.min(50, want - out.length)),
      fields: FIELDS,
    });
    if (params.query) qs.set("query", params.query);
    if (categories?.length) qs.set("categories", categories.join(","));
    if (cursor) qs.set("cursor", cursor);

    const json = await getPlaces(qs, params.signal);
    for (const raw of json.results ?? []) {
      const place = rawToPlace(raw);
      if (place) out.push(place);
    }
    cursor = json.context?.cursor;
    if (!cursor || (json.results?.length ?? 0) === 0) break;
  }

  return dedupe(out).slice(0, want);
}

function dedupe(places: FoursquarePlace[]): FoursquarePlace[] {
  const seen = new Set<string>();
  return places.filter((p) => {
    if (seen.has(p.fsqId)) return false;
    seen.add(p.fsqId);
    return true;
  });
}

export function foursquarePlaceToLeadInput(
  p: FoursquarePlace,
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
  hours?: string;
} {
  const industry = category ?? p.primaryCategory;
  const ratingNote =
    p.rating !== undefined ? ` · rating ${p.rating.toFixed(1)}/10` : "";
  return {
    searchId,
    companyName: p.name,
    websiteUrl: p.websiteUrl,
    description: p.primaryCategory,
    location: p.formattedAddress ?? geoLabel,
    industry,
    matchReason: `Found via Foursquare (${p.primaryCategory ?? industry ?? "place"})${ratingNote}${
      geoLabel ? ` near ${geoLabel}` : ""
    }`,
    sourceUrl: `https://foursquare.com/v/${p.fsqId}`,
    score: scoreFoursquarePlace(p),
    phone: p.phone,
    streetAddress: p.streetAddress,
    city: p.city,
    region: p.region,
    postalCode: p.postalCode,
    countryCode: p.countryCode,
    lat: p.lat,
    lng: p.lng,
    placeId: `fsq:${p.fsqId}`,
    hours: p.hours,
  };
}

// Foursquare ratings are 0-10 (note: not 0-5 like most platforms). Popularity
// is a 0-1 normalised score. We weight reachability fields harder than
// popularity since the goal is "can we contact them?", not "are they buzzy?".
function scoreFoursquarePlace(p: FoursquarePlace): number {
  let s = 50;
  if (p.websiteUrl) s += 15;
  if (p.phone) s += 15;
  if (p.streetAddress) s += 5;
  if (p.hours) s += 3;
  if (p.rating !== undefined) {
    if (p.rating >= 9.0) s += 8;
    else if (p.rating >= 8.0) s += 5;
    else if (p.rating < 6.0) s -= 5;
  }
  if (p.popularity !== undefined && p.popularity >= 0.7) s += 4;
  return Math.max(0, Math.min(100, s));
}
