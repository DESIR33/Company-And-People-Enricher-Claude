// OpenStreetMap / Overpass API client.
//
// Overpass is a free public read-only query API over the OSM database.
// No key, no auth, no rate-limit headers (just be polite). It's the only
// source in this project that supports true lat/lng + radius queries
// out-of-the-box, which is why it's the foundation for SMB radius
// discovery.
//
// We support two query shapes:
//   1. nodes/ways/relations with a category tag inside a bounding circle
//      (lat, lng, radiusMiles) — the radius mode used when the user gives
//      a point + radius.
//   2. nodes/ways with a category tag inside an administrative area —
//      e.g. "shop=hairdresser inside Atlanta city limits". Used when the
//      caller has only a city name.
//
// Categories map to OSM tags. Restaurants and home services have decent
// tag coverage (amenity=restaurant, shop=*, craft=*, office=*).

const OVERPASS_BASE = process.env.OVERPASS_BASE_URL ?? "https://overpass-api.de/api/interpreter";
const OVERPASS_TIMEOUT_S = 30;

export type OsmTag = {
  key: string;
  value?: string; // omit to match any value of `key` (e.g. "craft" alone)
};

// Category presets. Each preset is one OR more tag clauses; Overpass takes
// the union. Designed for the priority verticals: restaurants/hospitality
// and home services (HVAC, plumbing, roofing, contractors).
export const OSM_CATEGORY_PRESETS: Record<string, OsmTag[]> = {
  restaurant: [{ key: "amenity", value: "restaurant" }],
  cafe: [{ key: "amenity", value: "cafe" }],
  bar: [{ key: "amenity", value: "bar" }, { key: "amenity", value: "pub" }],
  bakery: [{ key: "shop", value: "bakery" }],
  fast_food: [{ key: "amenity", value: "fast_food" }],
  food_truck: [{ key: "amenity", value: "food_court" }],
  hotel: [{ key: "tourism", value: "hotel" }, { key: "tourism", value: "motel" }],

  plumber: [{ key: "craft", value: "plumber" }, { key: "shop", value: "plumber" }],
  electrician: [{ key: "craft", value: "electrician" }],
  hvac: [{ key: "craft", value: "hvac" }, { key: "office", value: "hvac" }],
  roofer: [{ key: "craft", value: "roofer" }],
  carpenter: [{ key: "craft", value: "carpenter" }],
  painter: [{ key: "craft", value: "painter" }],
  landscaper: [
    { key: "shop", value: "garden_centre" },
    { key: "craft", value: "gardener" },
    { key: "landuse", value: "plant_nursery" },
  ],
  general_contractor: [
    { key: "craft", value: "builder" },
    { key: "office", value: "construction_company" },
  ],
  cleaning: [
    { key: "shop", value: "dry_cleaning" },
    { key: "craft", value: "cleaning" },
  ],
  locksmith: [{ key: "shop", value: "locksmith" }, { key: "craft", value: "key_cutter" }],

  hair: [{ key: "shop", value: "hairdresser" }],
  beauty: [{ key: "shop", value: "beauty" }],
  dentist: [{ key: "amenity", value: "dentist" }],
  doctor: [{ key: "amenity", value: "doctors" }],
  veterinarian: [{ key: "amenity", value: "veterinary" }],
  pharmacy: [{ key: "amenity", value: "pharmacy" }],
  car_repair: [{ key: "shop", value: "car_repair" }],
  fitness: [{ key: "leisure", value: "fitness_centre" }],
};

export type OsmBusiness = {
  osmId: string;
  type: "node" | "way" | "relation";
  name: string;
  lat: number;
  lng: number;
  phone?: string;
  websiteUrl?: string;
  email?: string;
  streetAddress?: string;
  city?: string;
  region?: string;
  postalCode?: string;
  countryCode?: string;
  hours?: string;
  category?: string;
  tags: Record<string, string>;
};

type OverpassElement = {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
};

type OverpassResponse = {
  elements?: OverpassElement[];
};

const MILES_TO_METERS = 1609.344;

// Build a single Overpass QL query that runs each tag clause as a node/way/
// relation lookup, unions the results, and outputs centers+tags. We skip
// elements that have no `name` tag — those are usually unmapped or generic.
function buildRadiusQuery(
  lat: number,
  lng: number,
  miles: number,
  tags: OsmTag[]
): string {
  const r = Math.round(miles * MILES_TO_METERS);
  const around = `(around:${r},${lat},${lng})`;
  const clauses: string[] = [];
  for (const t of tags) {
    const tag = t.value ? `[${t.key}=${quote(t.value)}]` : `[${t.key}]`;
    clauses.push(`  node${tag}["name"]${around};`);
    clauses.push(`  way${tag}["name"]${around};`);
    clauses.push(`  relation${tag}["name"]${around};`);
  }
  return `[out:json][timeout:${OVERPASS_TIMEOUT_S}];
(
${clauses.join("\n")}
);
out center tags;`;
}

function buildAreaQuery(areaName: string, tags: OsmTag[]): string {
  const a = quote(areaName);
  const clauses: string[] = [];
  for (const t of tags) {
    const tag = t.value ? `[${t.key}=${quote(t.value)}]` : `[${t.key}]`;
    clauses.push(`  node${tag}["name"](area.searchArea);`);
    clauses.push(`  way${tag}["name"](area.searchArea);`);
    clauses.push(`  relation${tag}["name"](area.searchArea);`);
  }
  return `[out:json][timeout:${OVERPASS_TIMEOUT_S}];
area[name=${a}]->.searchArea;
(
${clauses.join("\n")}
);
out center tags;`;
}

function quote(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}

function elementToBusiness(el: OverpassElement, fallbackCategory: string): OsmBusiness | undefined {
  const tags = el.tags ?? {};
  const name = tags["name"];
  if (!name) return undefined;
  const lat = el.lat ?? el.center?.lat;
  const lng = el.lon ?? el.center?.lon;
  if (lat === undefined || lng === undefined) return undefined;

  const websiteUrl =
    tags["website"] ??
    tags["contact:website"] ??
    tags["url"] ??
    undefined;

  return {
    osmId: `${el.type[0]}${el.id}`,
    type: el.type,
    name,
    lat,
    lng,
    phone: tags["phone"] ?? tags["contact:phone"] ?? undefined,
    websiteUrl: normaliseUrl(websiteUrl),
    email: tags["email"] ?? tags["contact:email"] ?? undefined,
    streetAddress: composeAddress(tags),
    city: tags["addr:city"],
    region: tags["addr:state"] ?? tags["addr:province"],
    postalCode: tags["addr:postcode"],
    countryCode: tags["addr:country"],
    hours: tags["opening_hours"],
    category: tags["amenity"] ?? tags["shop"] ?? tags["craft"] ?? tags["office"] ?? fallbackCategory,
    tags,
  };
}

function composeAddress(tags: Record<string, string>): string | undefined {
  const street = tags["addr:street"];
  const num = tags["addr:housenumber"];
  if (!street && !num) return undefined;
  return [num, street].filter(Boolean).join(" ").trim() || undefined;
}

function normaliseUrl(raw?: string): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  if (/^https?:\/\//i.test(trimmed)) return trimmed.replace(/\/$/, "");
  return `https://${trimmed.replace(/\/$/, "")}`;
}

export async function queryOsmRadius(params: {
  lat: number;
  lng: number;
  radiusMiles: number;
  category: string;
  signal?: AbortSignal;
}): Promise<OsmBusiness[]> {
  const tags = OSM_CATEGORY_PRESETS[params.category] ?? guessTags(params.category);
  if (tags.length === 0) return [];
  const ql = buildRadiusQuery(params.lat, params.lng, params.radiusMiles, tags);
  return await runOverpass(ql, params.category, params.signal);
}

export async function queryOsmArea(params: {
  areaName: string;
  category: string;
  signal?: AbortSignal;
}): Promise<OsmBusiness[]> {
  const tags = OSM_CATEGORY_PRESETS[params.category] ?? guessTags(params.category);
  if (tags.length === 0) return [];
  const ql = buildAreaQuery(params.areaName, tags);
  return await runOverpass(ql, params.category, params.signal);
}

// Best-effort fallback: if the user passes a free-text category we don't have
// a preset for, try common tag keys with the literal string as value.
function guessTags(category: string): OsmTag[] {
  const v = category.toLowerCase().replace(/[^a-z0-9_]/g, "_");
  return [
    { key: "amenity", value: v },
    { key: "shop", value: v },
    { key: "craft", value: v },
    { key: "office", value: v },
  ];
}

async function runOverpass(
  ql: string,
  fallbackCategory: string,
  signal?: AbortSignal
): Promise<OsmBusiness[]> {
  const res = await fetch(OVERPASS_BASE, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `data=${encodeURIComponent(ql)}`,
    signal,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Overpass ${res.status}: ${text.slice(0, 300)}`);
  }
  const json = (await res.json()) as OverpassResponse;
  const out: OsmBusiness[] = [];
  for (const el of json.elements ?? []) {
    const b = elementToBusiness(el, fallbackCategory);
    if (b) out.push(b);
  }
  // Dedup by osmId (Overpass can return the same element under multiple
  // tag clauses if the node carries both shop=plumber and craft=plumber).
  const seen = new Set<string>();
  return out.filter((b) => {
    if (seen.has(b.osmId)) return false;
    seen.add(b.osmId);
    return true;
  });
}

// Convert the Overpass result list to lead inserts. The runner uses this
// after queryOsmRadius/queryOsmArea returns.
export function osmBusinessToLeadInput(
  b: OsmBusiness,
  searchId: string,
  category: string,
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
  const locParts = [b.streetAddress, b.city, b.region, b.postalCode]
    .filter(Boolean)
    .join(", ");
  return {
    searchId,
    companyName: b.name,
    websiteUrl: b.websiteUrl,
    description:
      b.category && b.category !== category
        ? `${b.category} (${category})`
        : b.category,
    location: locParts || geoLabel,
    industry: category,
    matchReason: `Found via OpenStreetMap (${b.category ?? category})${
      geoLabel ? ` near ${geoLabel}` : ""
    }${b.hours ? ` · hours: ${b.hours}` : ""}`,
    sourceUrl: `https://www.openstreetmap.org/${b.type}/${b.osmId.slice(1)}`,
    score: scoreOsmBusiness(b),
    phone: b.phone,
    streetAddress: b.streetAddress,
    city: b.city,
    region: b.region,
    postalCode: b.postalCode,
    countryCode: b.countryCode,
    lat: b.lat,
    lng: b.lng,
    placeId: b.osmId,
    hours: b.hours,
  };
}

// Score reflects how usable the lead is for outreach, not how good the
// business is. A row with website + phone + address is worth more than a
// pin with just a name.
function scoreOsmBusiness(b: OsmBusiness): number {
  let s = 50;
  if (b.websiteUrl) s += 15;
  if (b.phone) s += 15;
  if (b.streetAddress) s += 10;
  if (b.hours) s += 5;
  if (b.email) s += 5;
  return Math.min(100, s);
}
