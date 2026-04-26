// Google Places API (New) client.
//
// Native connector for the New Places API at places.googleapis.com/v1.
// Replaces the agent-driven "google_maps" path with deterministic JSON so we
// stop paying Claude tokens to LLM-summarise structured data Google already
// returns. Two endpoints are wrapped:
//
//   1. searchText  (POST /places:searchText) — free-text query, optionally
//      biased to a circle. Up to 60 results across 3 paginated pages.
//   2. searchNearby (POST /places:searchNearby) — required circle restriction
//      with one-or-more includedTypes. Capped at 20 results per call. The
//      cap is real — to cover dense metros, drive multiple calls from a tile
//      grid via lib/geo-fan.ts.
//
// Auth is `X-Goog-Api-Key`. Field selection is `X-Goog-FieldMask`; we ask
// only for the fields we map to lead inputs to keep cost predictable (Google
// bills by SKU, and SKUs are determined by which fields you request).

const PLACES_BASE =
  process.env.GOOGLE_PLACES_BASE_URL ?? "https://places.googleapis.com/v1";

const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.addressComponents",
  "places.location",
  "places.nationalPhoneNumber",
  "places.internationalPhoneNumber",
  "places.websiteUri",
  "places.googleMapsUri",
  "places.rating",
  "places.userRatingCount",
  "places.regularOpeningHours",
  "places.types",
  "places.primaryType",
  "places.businessStatus",
  "nextPageToken",
].join(",");

const MILES_TO_METERS = 1609.344;

// A small set of high-signal SMB types Google supports as place types. Free
// text via searchText still works for anything not in this list — these
// presets just give callers a deterministic Nearby Search path.
//
// Reference: https://developers.google.com/maps/documentation/places/web-service/place-types
export const GOOGLE_PLACES_TYPES: Record<string, string[]> = {
  restaurant: ["restaurant"],
  cafe: ["cafe", "coffee_shop"],
  bar: ["bar", "pub"],
  bakery: ["bakery"],
  fast_food: ["fast_food_restaurant"],
  hotel: ["lodging", "hotel"],

  plumber: ["plumber"],
  electrician: ["electrician"],
  hvac: ["hvac_contractor"],
  roofer: ["roofing_contractor"],
  painter: ["painter"],
  general_contractor: ["general_contractor"],
  cleaning: ["laundry", "dry_cleaner"],
  locksmith: ["locksmith"],
  car_repair: ["car_repair"],
  car_wash: ["car_wash"],

  dentist: ["dentist"],
  doctor: ["doctor"],
  veterinarian: ["veterinary_care"],
  pharmacy: ["pharmacy"],
  hair: ["hair_salon", "hair_care"],
  beauty: ["beauty_salon"],
  fitness: ["gym", "fitness_center"],
  spa: ["spa"],
  pet: ["pet_store"],
  florist: ["florist"],
  realtor: ["real_estate_agency"],
  insurance: ["insurance_agency"],
  lawyer: ["lawyer"],
  accountant: ["accounting"],
};

export type GooglePlace = {
  placeId: string;
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
  primaryType?: string;
  types?: string[];
  rating?: number;
  reviewCount?: number;
  googleMapsUri?: string;
  businessStatus?: string;
};

type RawPlace = {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  addressComponents?: { types?: string[]; shortText?: string; longText?: string }[];
  location?: { latitude?: number; longitude?: number };
  nationalPhoneNumber?: string;
  internationalPhoneNumber?: string;
  websiteUri?: string;
  googleMapsUri?: string;
  rating?: number;
  userRatingCount?: number;
  regularOpeningHours?: { weekdayDescriptions?: string[] };
  types?: string[];
  primaryType?: string;
  businessStatus?: string;
};

type RawResponse = {
  places?: RawPlace[];
  nextPageToken?: string;
};

function apiKey(): string {
  const k = process.env.GOOGLE_PLACES_API_KEY;
  if (!k) {
    throw new Error(
      "GOOGLE_PLACES_API_KEY is not set. Get one at https://console.cloud.google.com → APIs & Services → Credentials, enable the Places API (New) on the project."
    );
  }
  return k;
}

async function postPlaces(
  path: string,
  body: Record<string, unknown>,
  signal?: AbortSignal
): Promise<RawResponse> {
  const res = await fetch(`${PLACES_BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey(),
      "X-Goog-FieldMask": FIELD_MASK,
    },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Google Places ${res.status}: ${text.slice(0, 400)}`);
  }
  return (await res.json()) as RawResponse;
}

function pickAddress(parts: RawPlace["addressComponents"]) {
  if (!parts) return {};
  const get = (...types: string[]) =>
    parts.find((p) => p.types?.some((t) => types.includes(t)))?.shortText ??
    parts.find((p) => p.types?.some((t) => types.includes(t)))?.longText;
  const number = get("street_number");
  const street = get("route");
  const streetAddress = [number, street].filter(Boolean).join(" ").trim() || undefined;
  return {
    streetAddress,
    city: get("locality", "postal_town", "sublocality"),
    region: get("administrative_area_level_1"),
    postalCode: get("postal_code"),
    countryCode: get("country"),
  };
}

function rawToPlace(p: RawPlace): GooglePlace | undefined {
  const placeId = p.id;
  const name = p.displayName?.text;
  const lat = p.location?.latitude;
  const lng = p.location?.longitude;
  if (!placeId || !name || lat === undefined || lng === undefined) return undefined;

  const addr = pickAddress(p.addressComponents);
  return {
    placeId,
    name,
    lat,
    lng,
    phone: p.nationalPhoneNumber ?? p.internationalPhoneNumber,
    websiteUrl: p.websiteUri,
    formattedAddress: p.formattedAddress,
    ...addr,
    hours: p.regularOpeningHours?.weekdayDescriptions?.join("; "),
    primaryType: p.primaryType,
    types: p.types,
    rating: p.rating,
    reviewCount: p.userRatingCount,
    googleMapsUri: p.googleMapsUri,
    businessStatus: p.businessStatus,
  };
}

// resolveTypes turns a free-text category into a Google `place type`. Returns
// undefined if the caller didn't pass a category (Text Search supports that)
// or if the category isn't in our preset map (Text Search query handles it).
function resolveTypes(category?: string): string[] | undefined {
  if (!category) return undefined;
  const key = category.toLowerCase().trim().replace(/[^a-z0-9_]/g, "_");
  return GOOGLE_PLACES_TYPES[key];
}

export async function searchPlacesByText(params: {
  query: string;
  lat?: number;
  lng?: number;
  radiusMiles?: number;
  category?: string;
  maxResults?: number;
  signal?: AbortSignal;
}): Promise<GooglePlace[]> {
  const out: GooglePlace[] = [];
  const max = Math.min(params.maxResults ?? 60, 60);
  const types = resolveTypes(params.category);
  let pageToken: string | undefined;

  // Text Search returns up to 60 results across 3 pages of 20. We keep
  // pulling pages until we hit the cap or the API stops returning a token.
  while (out.length < max) {
    const body: Record<string, unknown> = {
      textQuery: params.query,
      maxResultCount: Math.min(20, max - out.length),
    };
    if (types?.length) body.includedType = types[0];
    if (params.lat !== undefined && params.lng !== undefined && params.radiusMiles) {
      body.locationBias = {
        circle: {
          center: { latitude: params.lat, longitude: params.lng },
          radius: Math.min(50000, Math.round(params.radiusMiles * MILES_TO_METERS)),
        },
      };
    }
    if (pageToken) body.pageToken = pageToken;

    const json = await postPlaces("/places:searchText", body, params.signal);
    for (const raw of json.places ?? []) {
      const place = rawToPlace(raw);
      if (place) out.push(place);
    }
    pageToken = json.nextPageToken;
    if (!pageToken) break;
  }

  return dedupe(out).slice(0, max);
}

export async function searchPlacesNearby(params: {
  lat: number;
  lng: number;
  radiusMiles: number;
  category: string;
  maxResults?: number;
  signal?: AbortSignal;
}): Promise<GooglePlace[]> {
  const types = resolveTypes(params.category);
  if (!types?.length) {
    // Nearby Search requires structured types. Fall back to Text Search with
    // the category as the query so callers always get *something*.
    return searchPlacesByText({
      query: params.category,
      lat: params.lat,
      lng: params.lng,
      radiusMiles: params.radiusMiles,
      maxResults: params.maxResults,
      signal: params.signal,
    });
  }
  // Nearby Search hard-caps at 20 results per call. To cover a metro, the
  // caller drives multiple invocations across a tile grid (lib/geo-fan.ts).
  const radiusMeters = Math.min(50000, Math.round(params.radiusMiles * MILES_TO_METERS));
  const json = await postPlaces(
    "/places:searchNearby",
    {
      includedTypes: types,
      maxResultCount: Math.min(20, params.maxResults ?? 20),
      locationRestriction: {
        circle: {
          center: { latitude: params.lat, longitude: params.lng },
          radius: radiusMeters,
        },
      },
    },
    params.signal
  );
  const out: GooglePlace[] = [];
  for (const raw of json.places ?? []) {
    const place = rawToPlace(raw);
    if (place) out.push(place);
  }
  return dedupe(out);
}

function dedupe(places: GooglePlace[]): GooglePlace[] {
  const seen = new Set<string>();
  return places.filter((p) => {
    if (seen.has(p.placeId)) return false;
    seen.add(p.placeId);
    return true;
  });
}

export function googlePlaceToLeadInput(
  p: GooglePlace,
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
  const industry = category ?? p.primaryType ?? p.types?.[0];
  const ratingNote =
    p.rating !== undefined && p.reviewCount
      ? ` · ${p.rating.toFixed(1)}★ (${p.reviewCount} reviews)`
      : "";
  return {
    searchId,
    companyName: p.name,
    websiteUrl: p.websiteUrl,
    description: p.primaryType,
    location: p.formattedAddress ?? geoLabel,
    industry,
    matchReason: `Found via Google Places (${p.primaryType ?? industry ?? "place"})${ratingNote}${
      geoLabel ? ` near ${geoLabel}` : ""
    }`,
    sourceUrl:
      p.googleMapsUri ?? `https://www.google.com/maps/place/?q=place_id:${p.placeId}`,
    score: scoreGooglePlace(p),
    phone: p.phone,
    streetAddress: p.streetAddress,
    city: p.city,
    region: p.region,
    postalCode: p.postalCode,
    countryCode: p.countryCode,
    lat: p.lat,
    lng: p.lng,
    placeId: `gp:${p.placeId}`,
    hours: p.hours,
  };
}

// Score reflects outreachability + signal strength. Heavily-reviewed, recently-
// active businesses with a website + phone score highest. Suspended / closed
// places get demoted hard so the runner can still surface them but the CRM
// won't pursue them.
function scoreGooglePlace(p: GooglePlace): number {
  if (p.businessStatus === "CLOSED_PERMANENTLY") return 5;
  if (p.businessStatus === "CLOSED_TEMPORARILY") return 25;
  let s = 50;
  if (p.websiteUrl) s += 15;
  if (p.phone) s += 15;
  if (p.streetAddress) s += 5;
  if (p.hours) s += 3;
  if (p.rating !== undefined && p.reviewCount && p.reviewCount >= 5) {
    if (p.rating >= 4.5) s += 8;
    else if (p.rating >= 4.0) s += 5;
    else if (p.rating < 3.0) s -= 10;
  }
  return Math.max(0, Math.min(100, s));
}
