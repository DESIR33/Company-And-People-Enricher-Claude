// TomTom Search API client.
//
// TomTom has the strongest international POI dataset of the major
// commercial mapping providers and a generous free tier. We use it to
// fill ex-US gaps where Google Places quotas get expensive and
// Foursquare's coverage thins out.
//
// Two endpoints are wrapped:
//   - GET /search/2/poiSearch/{query}.json — free-text POI search with
//     optional lat/lon/radius bias. Up to 100 results per call.
//   - GET /search/2/categorySearch/{query}.json — text + restrict to
//     a category code from TomTom's POI taxonomy.
//
// Reference:
//   https://developer.tomtom.com/search-api/documentation/search-service/poi-search
//   https://developer.tomtom.com/search-api/documentation/search-service/category-search
//
// Auth: bare API key in `?key=...` query param.

const TOMTOM_BASE =
  process.env.TOMTOM_BASE_URL ?? "https://api.tomtom.com";

const MILES_TO_METERS = 1609.344;
// TomTom radius caps at 50000m (~31 mi).
const MAX_RADIUS_METERS = 50_000;

// Subset of TomTom's POI category codes that map cleanly to the SMB
// verticals we target. The values are TomTom's `categorySet` IDs
// (numeric or ID strings used by categorySearch). When a preset doesn't
// exist we fall back to free-text poiSearch with the category as query.
//
// Reference: https://developer.tomtom.com/search-api/documentation/product-information/supported-poi-categories
export const TOMTOM_CATEGORIES: Record<string, number[]> = {
  restaurant: [7315],
  cafe: [9376],
  bar: [9379],
  fast_food: [7315017],
  hotel: [7314],

  plumber: [7321053],
  electrician: [7321024],
  hvac: [7321034],
  roofer: [7321068],
  general_contractor: [7321001],
  cleaning: [9376068],
  locksmith: [7321055],
  car_repair: [7311],

  dentist: [7392005],
  doctor: [7392006],
  veterinarian: [9663],
  pharmacy: [7326],
  hair: [9377004],
  beauty: [9377002],
  fitness: [7320004],
  spa: [9377005],
  florist: [9361023],
  realtor: [7321065],
  lawyer: [7332016],
};

export type TomTomPlace = {
  ttId: string;
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
  streetNumber?: string;
  streetName?: string;
  municipality?: string;
  countrySubdivision?: string;
  postalCode?: string;
  countryCode?: string;
  freeformAddress?: string;
};

type RawPoi = {
  name?: string;
  phone?: string;
  url?: string;
  categories?: string[];
  classifications?: { code?: string; names?: { name?: string }[] }[];
};

type RawResult = {
  id?: string;
  type?: string;
  poi?: RawPoi;
  address?: RawAddress;
  position?: { lat?: number; lon?: number };
};

type RawResponse = {
  results?: RawResult[];
  summary?: { numResults?: number; totalResults?: number };
};

function apiKey(): string {
  const k = process.env.TOMTOM_API_KEY;
  if (!k) {
    throw new Error(
      "TOMTOM_API_KEY is not set. Get one at https://developer.tomtom.com — register an app and copy the API key."
    );
  }
  return k;
}

async function getSearch(
  path: string,
  query: URLSearchParams,
  signal?: AbortSignal
): Promise<RawResponse> {
  query.set("key", apiKey());
  const url = `${TOMTOM_BASE}${path}?${query.toString()}`;
  const res = await fetch(url, { method: "GET", signal });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`TomTom ${res.status}: ${text.slice(0, 400)}`);
  }
  return (await res.json()) as RawResponse;
}

function rawToPlace(r: RawResult): TomTomPlace | undefined {
  const name = r.poi?.name;
  const lat = r.position?.lat;
  const lng = r.position?.lon;
  if (!name || lat === undefined || lng === undefined) return undefined;

  const ttId = r.id ?? `${name}|${lat.toFixed(5)}|${lng.toFixed(5)}`;
  const a = r.address ?? {};
  const street = [a.streetNumber, a.streetName].filter(Boolean).join(" ").trim() || undefined;
  const primaryClass =
    r.poi?.classifications?.[0]?.names?.[0]?.name ?? r.poi?.categories?.[0];

  return {
    ttId,
    name,
    lat,
    lng,
    phone: r.poi?.phone,
    websiteUrl: normaliseUrl(r.poi?.url),
    formattedAddress: a.freeformAddress,
    streetAddress: street,
    city: a.municipality,
    region: a.countrySubdivision,
    postalCode: a.postalCode,
    countryCode: a.countryCode,
    category: primaryClass,
    categories: r.poi?.categories,
  };
}

function normaliseUrl(raw?: string): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  if (/^https?:\/\//i.test(trimmed)) return trimmed.replace(/\/$/, "");
  return `https://${trimmed.replace(/\/$/, "")}`;
}

function resolveCategorySet(category?: string): number[] | undefined {
  if (!category) return undefined;
  const key = category.toLowerCase().trim().replace(/[^a-z0-9_]/g, "_");
  return TOMTOM_CATEGORIES[key];
}

export async function searchTomTomRadius(params: {
  lat: number;
  lng: number;
  radiusMiles: number;
  category?: string;
  query?: string;
  maxResults?: number;
  signal?: AbortSignal;
}): Promise<TomTomPlace[]> {
  const want = Math.min(params.maxResults ?? 100, 100);
  const radiusMeters = Math.min(
    MAX_RADIUS_METERS,
    Math.round(params.radiusMiles * MILES_TO_METERS)
  );
  const categorySet = resolveCategorySet(params.category);

  // categorySearch takes a free-text query plus an optional categorySet
  // restrict; poiSearch is purely free-text. Prefer categorySearch when
  // we have a preset — it's much more precise.
  const queryText = params.query ?? params.category ?? "";
  if (!queryText && !categorySet) return [];

  const path = categorySet
    ? `/search/2/categorySearch/${encodeURIComponent(queryText || "*")}.json`
    : `/search/2/poiSearch/${encodeURIComponent(queryText)}.json`;

  const qs = new URLSearchParams({
    lat: String(params.lat),
    lon: String(params.lng),
    radius: String(radiusMeters),
    limit: String(want),
  });
  if (categorySet?.length) qs.set("categorySet", categorySet.join(","));

  const json = await getSearch(path, qs, params.signal);
  const out: TomTomPlace[] = [];
  for (const r of json.results ?? []) {
    const place = rawToPlace(r);
    if (place) out.push(place);
  }
  return dedupe(out);
}

function dedupe(places: TomTomPlace[]): TomTomPlace[] {
  const seen = new Set<string>();
  return places.filter((p) => {
    if (seen.has(p.ttId)) return false;
    seen.add(p.ttId);
    return true;
  });
}

export function tomtomPlaceToLeadInput(
  p: TomTomPlace,
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
    matchReason: `Found via TomTom Search (${p.category ?? industry ?? "place"})${
      geoLabel ? ` near ${geoLabel}` : ""
    }`,
    sourceUrl: `https://www.tomtom.com/maps/?q=${encodeURIComponent(p.name)}@${p.lat},${p.lng}`,
    score: scoreTomTomPlace(p),
    phone: p.phone,
    streetAddress: p.streetAddress,
    city: p.city,
    region: p.region,
    postalCode: p.postalCode,
    countryCode: p.countryCode,
    lat: p.lat,
    lng: p.lng,
    placeId: `tt:${p.ttId}`,
  };
}

function scoreTomTomPlace(p: TomTomPlace): number {
  let s = 50;
  if (p.websiteUrl) s += 15;
  if (p.phone) s += 15;
  if (p.streetAddress) s += 5;
  return Math.max(0, Math.min(100, s));
}
