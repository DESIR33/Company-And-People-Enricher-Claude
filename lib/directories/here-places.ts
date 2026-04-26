// HERE Discover / Browse API client.
//
// HERE has best-in-class European POI coverage and detailed structured
// addresses (vehicle-routing-grade). Pairs well with Foursquare for
// international SMB sweeps and is the strongest non-Google option for
// EU markets.
//
// Two endpoints are wrapped:
//   - GET /v1/discover — free-text search at a point. `q=<text>&at=lat,lng`
//     OR `q=<text>&in=circle:lat,lng;r=meters`. Up to 100 results.
//   - GET /v1/browse — category browse without a query. Requires `at`
//     and accepts `categories=<id1,id2>` from the HERE category taxonomy.
//
// Reference:
//   https://www.here.com/docs/bundle/geocoding-and-search-api-developer-guide/page/topics/endpoint-discover-brief.html
//   https://www.here.com/docs/bundle/geocoding-and-search-api-developer-guide/page/topics/endpoint-browse-brief.html
//
// Auth: bare API key in `?apiKey=...` query param.

const HERE_BASE =
  process.env.HERE_BASE_URL ?? "https://discover.search.hereapi.com/v1";

const MILES_TO_METERS = 1609.344;

// HERE category IDs for common SMB verticals. The taxonomy is hierarchical
// strings (e.g. "100-1000-0000" = Restaurant). When a preset doesn't exist
// we fall back to /discover with the category as the query string.
//
// Reference: https://www.here.com/docs/bundle/places-api-developer-guide-ml/page/topics/categories.html
export const HERE_CATEGORIES: Record<string, string[]> = {
  restaurant: ["100-1000-0000"],
  cafe: ["100-1100-0010"],
  bar: ["200-2000-0011"],
  bakery: ["100-1000-0009"],
  fast_food: ["100-1000-0001"],
  hotel: ["500-5000-0053"],

  plumber: ["700-7400-0142"],
  electrician: ["700-7400-0144"],
  hvac: ["700-7400-0143"],
  general_contractor: ["700-7400-0141"],
  cleaning: ["700-7400-0146"],
  car_repair: ["700-7600-0322"],

  dentist: ["800-8000-0159"],
  doctor: ["800-8000-0162"],
  veterinarian: ["800-8000-0167"],
  pharmacy: ["600-6400-0000"],
  hair: ["800-8200-0173"],
  beauty: ["800-8200-0174"],
  fitness: ["800-8600-0188"],
  spa: ["800-8200-0295"],
  florist: ["600-6300-0066"],
  realtor: ["700-7400-0145"],
  insurance: ["700-7300-0117"],
  lawyer: ["700-7400-0140"],
};

export type HerePlace = {
  hereId: string;
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
  category?: string;
  categories?: string[];
};

type RawAddress = {
  label?: string;
  countryCode?: string;
  countryName?: string;
  state?: string;
  county?: string;
  city?: string;
  district?: string;
  street?: string;
  postalCode?: string;
  houseNumber?: string;
};

type RawContactValue = { value?: string };
type RawContactGroup = {
  phone?: RawContactValue[];
  www?: RawContactValue[];
  mobile?: RawContactValue[];
};

type RawCategory = { id?: string; name?: string; primary?: boolean };

type RawItem = {
  id?: string;
  title?: string;
  position?: { lat?: number; lng?: number };
  address?: RawAddress;
  contacts?: RawContactGroup[];
  categories?: RawCategory[];
};

type RawResponse = {
  items?: RawItem[];
};

function apiKey(): string {
  const k = process.env.HERE_API_KEY;
  if (!k) {
    throw new Error(
      "HERE_API_KEY is not set. Get one at https://platform.here.com — register an app and create an API key."
    );
  }
  return k;
}

async function getSearch(
  path: string,
  query: URLSearchParams,
  signal?: AbortSignal
): Promise<RawResponse> {
  query.set("apiKey", apiKey());
  const url = `${HERE_BASE}${path}?${query.toString()}`;
  const res = await fetch(url, { method: "GET", signal });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HERE ${res.status}: ${text.slice(0, 400)}`);
  }
  return (await res.json()) as RawResponse;
}

function rawToPlace(item: RawItem): HerePlace | undefined {
  const name = item.title;
  const lat = item.position?.lat;
  const lng = item.position?.lng;
  if (!name || lat === undefined || lng === undefined) return undefined;

  const hereId = item.id ?? `${name}|${lat.toFixed(5)}|${lng.toFixed(5)}`;
  const a = item.address ?? {};
  const street = [a.houseNumber, a.street].filter(Boolean).join(" ").trim() || undefined;

  // contacts is an array of groups, each with phone/www/mobile arrays. We
  // collapse to a single primary phone and url.
  const phone = item.contacts?.[0]?.phone?.[0]?.value
    ?? item.contacts?.[0]?.mobile?.[0]?.value;
  const websiteUrl = normaliseUrl(item.contacts?.[0]?.www?.[0]?.value);

  const primary = item.categories?.find((c) => c.primary) ?? item.categories?.[0];

  return {
    hereId,
    name,
    lat,
    lng,
    phone,
    websiteUrl,
    formattedAddress: a.label,
    streetAddress: street,
    city: a.city ?? a.district,
    region: a.state ?? a.county,
    postalCode: a.postalCode,
    countryCode: a.countryCode,
    category: primary?.name,
    categories: item.categories
      ?.map((c) => c.id)
      .filter((id): id is string => !!id),
  };
}

function normaliseUrl(raw?: string): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  if (/^https?:\/\//i.test(trimmed)) return trimmed.replace(/\/$/, "");
  return `https://${trimmed.replace(/\/$/, "")}`;
}

function resolveCategoryIds(category?: string): string[] | undefined {
  if (!category) return undefined;
  const key = category.toLowerCase().trim().replace(/[^a-z0-9_]/g, "_");
  return HERE_CATEGORIES[key];
}

// Discover (text search). Use when the caller has a free-text query.
// `at` biases ranking; `in=circle:` restricts the search radius.
export async function searchHereDiscover(params: {
  lat: number;
  lng: number;
  radiusMiles?: number;
  query: string;
  maxResults?: number;
  signal?: AbortSignal;
}): Promise<HerePlace[]> {
  const want = Math.min(params.maxResults ?? 100, 100);
  const qs = new URLSearchParams({
    q: params.query,
    at: `${params.lat},${params.lng}`,
    limit: String(want),
  });
  if (params.radiusMiles) {
    const r = Math.round(params.radiusMiles * MILES_TO_METERS);
    qs.set("in", `circle:${params.lat},${params.lng};r=${r}`);
  }
  const json = await getSearch("/discover", qs, params.signal);
  const out: HerePlace[] = [];
  for (const item of json.items ?? []) {
    const place = rawToPlace(item);
    if (place) out.push(place);
  }
  return dedupe(out);
}

// Browse (category-only). Use when the caller has a category preset and
// wants strict taxonomic restriction without keyword noise.
export async function searchHereBrowse(params: {
  lat: number;
  lng: number;
  radiusMiles?: number;
  categoryIds: string[];
  maxResults?: number;
  signal?: AbortSignal;
}): Promise<HerePlace[]> {
  const want = Math.min(params.maxResults ?? 100, 100);
  const qs = new URLSearchParams({
    at: `${params.lat},${params.lng}`,
    categories: params.categoryIds.join(","),
    limit: String(want),
  });
  if (params.radiusMiles) {
    const r = Math.round(params.radiusMiles * MILES_TO_METERS);
    qs.set("in", `circle:${params.lat},${params.lng};r=${r}`);
  }
  const json = await getSearch("/browse", qs, params.signal);
  const out: HerePlace[] = [];
  for (const item of json.items ?? []) {
    const place = rawToPlace(item);
    if (place) out.push(place);
  }
  return dedupe(out);
}

// High-level: pick browse when we have a structured category preset,
// fall back to discover with the category text otherwise.
export async function searchHerePlaces(params: {
  lat: number;
  lng: number;
  radiusMiles?: number;
  category?: string;
  query?: string;
  maxResults?: number;
  signal?: AbortSignal;
}): Promise<HerePlace[]> {
  const ids = resolveCategoryIds(params.category);
  if (ids?.length) {
    return searchHereBrowse({
      lat: params.lat,
      lng: params.lng,
      radiusMiles: params.radiusMiles,
      categoryIds: ids,
      maxResults: params.maxResults,
      signal: params.signal,
    });
  }
  const queryText = params.query ?? params.category;
  if (!queryText) return [];
  return searchHereDiscover({
    lat: params.lat,
    lng: params.lng,
    radiusMiles: params.radiusMiles,
    query: queryText,
    maxResults: params.maxResults,
    signal: params.signal,
  });
}

function dedupe(places: HerePlace[]): HerePlace[] {
  const seen = new Set<string>();
  return places.filter((p) => {
    if (seen.has(p.hereId)) return false;
    seen.add(p.hereId);
    return true;
  });
}

export function herePlaceToLeadInput(
  p: HerePlace,
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
  const industry = category ?? p.category;
  return {
    searchId,
    companyName: p.name,
    websiteUrl: p.websiteUrl,
    description: p.category,
    location: p.formattedAddress ?? geoLabel,
    industry,
    matchReason: `Found via HERE (${p.category ?? industry ?? "place"})${
      geoLabel ? ` near ${geoLabel}` : ""
    }`,
    sourceUrl: `https://wego.here.com/?map=${p.lat},${p.lng},17`,
    score: scoreHerePlace(p),
    phone: p.phone,
    streetAddress: p.streetAddress,
    city: p.city,
    region: p.region,
    postalCode: p.postalCode,
    countryCode: p.countryCode,
    lat: p.lat,
    lng: p.lng,
    placeId: `here:${p.hereId}`,
  };
}

function scoreHerePlace(p: HerePlace): number {
  let s = 50;
  if (p.websiteUrl) s += 15;
  if (p.phone) s += 15;
  if (p.streetAddress) s += 5;
  return Math.max(0, Math.min(100, s));
}
