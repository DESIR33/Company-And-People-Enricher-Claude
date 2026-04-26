// Bing Maps Local Search API client.
//
// Bing's Local Search REST API. Useful as a Google Places fallback in
// regions where Google quotas / coverage thin out, and Microsoft's free
// tier is generous enough for moderate-volume SMB sweeps.
//
// One endpoint is wrapped:
//   - GET /LocalSearch — supports `query` (free text or category type) +
//     `userLocation=lat,lng,radiusMeters`. Cap is 25 results per call,
//     no pagination. Use lib/geo-fan.tilesForRadius to cover dense metros.
//
// Reference: https://learn.microsoft.com/en-us/bingmaps/rest-services/locations/local-search
//
// Auth is a bare API key passed as `?key=...` query param. Microsoft has
// announced retirement of the Bing Maps for Enterprise platform; the
// successor is Azure Maps. We expose `BING_MAPS_BASE_URL` so callers can
// redirect to a self-hosted proxy or the Azure Maps equivalent without
// touching code.

const BING_BASE =
  process.env.BING_MAPS_BASE_URL ?? "https://dev.virtualearth.net/REST/v1";

const MILES_TO_METERS = 1609.344;

// Bing's Local Search type list. These are the valid `type` values for the
// Local Search endpoint; supplying one filters to a single business
// vertical. Free text via `query` works for everything else.
//
// Reference: https://learn.microsoft.com/en-us/bingmaps/rest-services/common-parameters-and-types/type-identifiers/business-and-financial-services
//            https://learn.microsoft.com/en-us/bingmaps/rest-services/common-parameters-and-types/type-identifiers/eat-or-drink
export const BING_LOCAL_TYPES: Record<string, string[]> = {
  restaurant: ["Restaurants"],
  cafe: ["CoffeeAndTea"],
  bar: ["BarsGrillsAndPubs"],
  hotel: ["HotelsAndMotels"],
  fast_food: ["FastFood"],

  plumber: ["Plumbers"],
  electrician: ["Electricians"],
  hvac: ["HeatingAndAirConditioning"],
  roofer: ["RoofingAndGutters"],
  general_contractor: ["GeneralContractors"],
  cleaning: ["CleaningServices"],
  locksmith: ["Locksmiths"],
  car_repair: ["AutoRepair"],

  dentist: ["Dentists"],
  doctor: ["Physicians"],
  veterinarian: ["Veterinarians"],
  pharmacy: ["Pharmacies"],
  hair: ["HairSalons"],
  beauty: ["BeautySalons"],
  fitness: ["GymsAndFitness"],
  spa: ["SpasAndMassage"],
  florist: ["Florists"],
  realtor: ["RealEstateAgents"],
  insurance: ["InsuranceCompanies"],
  lawyer: ["AttorneysAndLawFirms"],
  accountant: ["AccountantsAndTaxPreparation"],
};

export type BingPlace = {
  bingId: string;
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
};

type RawAddress = {
  addressLine?: string;
  locality?: string;
  adminDistrict?: string;
  postalCode?: string;
  countryRegionIso2?: string;
  formattedAddress?: string;
};

type RawResource = {
  entityType?: string;
  name?: string;
  point?: { coordinates?: [number, number] };
  Address?: RawAddress;
  PhoneNumber?: string;
  Website?: string;
  bbox?: number[];
  Identifier?: string;
};

type RawResponse = {
  resourceSets?: { resources?: RawResource[] }[];
  statusCode?: number;
  errorDetails?: string[];
};

function apiKey(): string {
  const k = process.env.BING_MAPS_API_KEY;
  if (!k) {
    throw new Error(
      "BING_MAPS_API_KEY is not set. Get one at https://www.bingmapsportal.com — create a Basic key (free tier) or upgrade as needed."
    );
  }
  return k;
}

async function getLocal(
  query: URLSearchParams,
  signal?: AbortSignal
): Promise<RawResponse> {
  const url = `${BING_BASE}/LocalSearch/?${query.toString()}`;
  const res = await fetch(url, { method: "GET", signal });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Bing Local Search ${res.status}: ${text.slice(0, 400)}`);
  }
  const json = (await res.json()) as RawResponse;
  if (json.statusCode && json.statusCode >= 400) {
    throw new Error(
      `Bing Local Search ${json.statusCode}: ${(json.errorDetails ?? []).join("; ").slice(0, 400)}`
    );
  }
  return json;
}

function rawToPlace(r: RawResource): BingPlace | undefined {
  const name = r.name;
  const coords = r.point?.coordinates;
  if (!name || !coords || coords.length < 2) return undefined;

  const [lat, lng] = coords;
  const addr = r.Address ?? {};
  // Bing doesn't always return an Identifier; build a stable composite key
  // from name + lat/lng so cross-tile dedup still works.
  const bingId =
    r.Identifier ?? `${name}|${lat.toFixed(5)}|${lng.toFixed(5)}`;

  return {
    bingId,
    name,
    lat,
    lng,
    phone: r.PhoneNumber,
    websiteUrl: normaliseUrl(r.Website),
    formattedAddress: addr.formattedAddress,
    streetAddress: addr.addressLine,
    city: addr.locality,
    region: addr.adminDistrict,
    postalCode: addr.postalCode,
    countryCode: addr.countryRegionIso2,
    category: r.entityType,
  };
}

function normaliseUrl(raw?: string): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  if (/^https?:\/\//i.test(trimmed)) return trimmed.replace(/\/$/, "");
  return `https://${trimmed.replace(/\/$/, "")}`;
}

function resolveTypes(category?: string): string[] | undefined {
  if (!category) return undefined;
  const key = category.toLowerCase().trim().replace(/[^a-z0-9_]/g, "_");
  return BING_LOCAL_TYPES[key];
}

export async function searchBingLocal(params: {
  lat: number;
  lng: number;
  radiusMiles: number;
  category?: string;
  query?: string;
  maxResults?: number;
  signal?: AbortSignal;
}): Promise<BingPlace[]> {
  // Bing caps at 25 results per Local Search call; no pagination param. To
  // cover a metro, the caller drives multiple invocations across a tile
  // grid (lib/geo-fan.ts).
  const want = Math.min(params.maxResults ?? 25, 25);
  const radiusMeters = Math.round(params.radiusMiles * MILES_TO_METERS);
  const types = resolveTypes(params.category);

  const qs = new URLSearchParams({
    userLocation: `${params.lat},${params.lng},${radiusMeters}`,
    maxResults: String(want),
    key: apiKey(),
  });
  // Use `type` when we have a structured match, otherwise free-text `query`.
  if (types?.length) {
    qs.set("type", types.join(","));
  } else if (params.query) {
    qs.set("query", params.query);
  } else if (params.category) {
    qs.set("query", params.category);
  } else {
    return [];
  }

  const json = await getLocal(qs, params.signal);
  const out: BingPlace[] = [];
  for (const set of json.resourceSets ?? []) {
    for (const r of set.resources ?? []) {
      const place = rawToPlace(r);
      if (place) out.push(place);
    }
  }
  return dedupe(out);
}

function dedupe(places: BingPlace[]): BingPlace[] {
  const seen = new Set<string>();
  return places.filter((p) => {
    if (seen.has(p.bingId)) return false;
    seen.add(p.bingId);
    return true;
  });
}

export function bingPlaceToLeadInput(
  p: BingPlace,
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
    matchReason: `Found via Bing Local Search (${p.category ?? industry ?? "place"})${
      geoLabel ? ` near ${geoLabel}` : ""
    }`,
    sourceUrl: `https://www.bing.com/maps?q=${encodeURIComponent(p.name)}&cp=${p.lat}~${p.lng}`,
    score: scoreBingPlace(p),
    phone: p.phone,
    streetAddress: p.streetAddress,
    city: p.city,
    region: p.region,
    postalCode: p.postalCode,
    countryCode: p.countryCode,
    lat: p.lat,
    lng: p.lng,
    placeId: `bing:${p.bingId}`,
  };
}

function scoreBingPlace(p: BingPlace): number {
  let s = 50;
  if (p.websiteUrl) s += 15;
  if (p.phone) s += 15;
  if (p.streetAddress) s += 5;
  return Math.max(0, Math.min(100, s));
}
