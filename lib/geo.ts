// Geographic helpers for SMB discovery (Phase 1.3).
//
// SMB lead lists are radius-bound by nature — "all plumbers within 25 mi of
// 30339" is a much more useful query than "plumbers in Atlanta." This module
// provides:
//
//   - lookupZip(zip): basic zip → lat/lng/city/state for a small bundled set
//     of US zips (largest metro areas). Returns undefined for unknown zips.
//   - haversineMiles(...): great-circle distance in miles.
//   - expandZipsForRadius(lat, lng, miles): every bundled zip within `miles`,
//     sorted by distance. Used by the runner to fan a single radius search
//     out into N zip-scoped sub-queries.
//   - expandZipsForMsa(msaCode): every bundled zip in a CBSA.
//   - parseGeoString(input): best-effort parser for "City, ST", "30339", or
//     "lat,lng" so the existing free-text geo input still works.
//
// The bundled dataset intentionally covers only the largest US metros — it's
// enough to power radius queries in those metros without shipping a 30k-row
// zip database. Outside the bundled metros the caller falls back to the
// agent's free-text geo search.

export type ZipRecord = {
  zip: string;
  lat: number;
  lng: number;
  city: string;
  state: string;
  msaCode?: string;
  msaName?: string;
};

// A compact set of high-population US zips covering the top ~30 metros plus a
// scatter of state capitals. Coordinates are zip centroids, ~4-decimal
// precision. Sources: USPS/Census public zip centroid data; values are public
// knowledge and stable enough for radius math to ±0.5 mi.
const US_ZIPS: ZipRecord[] = [
  // New York metro (35620)
  { zip: "10001", lat: 40.7506, lng: -73.9971, city: "New York", state: "NY", msaCode: "35620", msaName: "New York-Newark-Jersey City" },
  { zip: "10002", lat: 40.7155, lng: -73.9863, city: "New York", state: "NY", msaCode: "35620" },
  { zip: "10025", lat: 40.7990, lng: -73.9684, city: "New York", state: "NY", msaCode: "35620" },
  { zip: "11201", lat: 40.6957, lng: -73.9897, city: "Brooklyn", state: "NY", msaCode: "35620" },
  { zip: "11211", lat: 40.7129, lng: -73.9534, city: "Brooklyn", state: "NY", msaCode: "35620" },
  { zip: "11385", lat: 40.7050, lng: -73.8869, city: "Ridgewood", state: "NY", msaCode: "35620" },
  { zip: "07030", lat: 40.7440, lng: -74.0324, city: "Hoboken", state: "NJ", msaCode: "35620" },
  { zip: "07302", lat: 40.7178, lng: -74.0431, city: "Jersey City", state: "NJ", msaCode: "35620" },

  // Los Angeles metro (31080)
  { zip: "90001", lat: 33.9731, lng: -118.2479, city: "Los Angeles", state: "CA", msaCode: "31080", msaName: "Los Angeles-Long Beach-Anaheim" },
  { zip: "90012", lat: 34.0617, lng: -118.2390, city: "Los Angeles", state: "CA", msaCode: "31080" },
  { zip: "90028", lat: 34.0989, lng: -118.3267, city: "Hollywood", state: "CA", msaCode: "31080" },
  { zip: "90064", lat: 34.0444, lng: -118.4304, city: "West Los Angeles", state: "CA", msaCode: "31080" },
  { zip: "90210", lat: 34.0901, lng: -118.4065, city: "Beverly Hills", state: "CA", msaCode: "31080" },
  { zip: "90405", lat: 34.0118, lng: -118.4685, city: "Santa Monica", state: "CA", msaCode: "31080" },
  { zip: "91101", lat: 34.1485, lng: -118.1419, city: "Pasadena", state: "CA", msaCode: "31080" },
  { zip: "92614", lat: 33.6862, lng: -117.8131, city: "Irvine", state: "CA", msaCode: "31080" },
  { zip: "92660", lat: 33.6189, lng: -117.8730, city: "Newport Beach", state: "CA", msaCode: "31080" },

  // Chicago metro (16980)
  { zip: "60601", lat: 41.8858, lng: -87.6181, city: "Chicago", state: "IL", msaCode: "16980", msaName: "Chicago-Naperville-Elgin" },
  { zip: "60607", lat: 41.8743, lng: -87.6493, city: "Chicago", state: "IL", msaCode: "16980" },
  { zip: "60614", lat: 41.9226, lng: -87.6505, city: "Chicago", state: "IL", msaCode: "16980" },
  { zip: "60622", lat: 41.9020, lng: -87.6783, city: "Chicago", state: "IL", msaCode: "16980" },
  { zip: "60661", lat: 41.8830, lng: -87.6450, city: "Chicago", state: "IL", msaCode: "16980" },
  { zip: "60714", lat: 42.0102, lng: -87.7993, city: "Niles", state: "IL", msaCode: "16980" },

  // Dallas-Fort Worth metro (19100)
  { zip: "75201", lat: 32.7843, lng: -96.7995, city: "Dallas", state: "TX", msaCode: "19100", msaName: "Dallas-Fort Worth-Arlington" },
  { zip: "75202", lat: 32.7793, lng: -96.8061, city: "Dallas", state: "TX", msaCode: "19100" },
  { zip: "75204", lat: 32.8021, lng: -96.7886, city: "Dallas", state: "TX", msaCode: "19100" },
  { zip: "75230", lat: 32.9061, lng: -96.7795, city: "Dallas", state: "TX", msaCode: "19100" },
  { zip: "76102", lat: 32.7553, lng: -97.3320, city: "Fort Worth", state: "TX", msaCode: "19100" },
  { zip: "75038", lat: 32.8740, lng: -96.9696, city: "Irving", state: "TX", msaCode: "19100" },
  { zip: "75024", lat: 33.0820, lng: -96.7969, city: "Plano", state: "TX", msaCode: "19100" },
  { zip: "76011", lat: 32.7494, lng: -97.0925, city: "Arlington", state: "TX", msaCode: "19100" },

  // Houston metro (26420)
  { zip: "77002", lat: 29.7589, lng: -95.3677, city: "Houston", state: "TX", msaCode: "26420", msaName: "Houston-The Woodlands-Sugar Land" },
  { zip: "77019", lat: 29.7553, lng: -95.4097, city: "Houston", state: "TX", msaCode: "26420" },
  { zip: "77024", lat: 29.7620, lng: -95.5155, city: "Houston", state: "TX", msaCode: "26420" },
  { zip: "77056", lat: 29.7406, lng: -95.4647, city: "Houston", state: "TX", msaCode: "26420" },
  { zip: "77449", lat: 29.8311, lng: -95.7333, city: "Katy", state: "TX", msaCode: "26420" },
  { zip: "77479", lat: 29.6051, lng: -95.6394, city: "Sugar Land", state: "TX", msaCode: "26420" },

  // Atlanta metro (12060)
  { zip: "30303", lat: 33.7536, lng: -84.3865, city: "Atlanta", state: "GA", msaCode: "12060", msaName: "Atlanta-Sandy Springs-Alpharetta" },
  { zip: "30308", lat: 33.7717, lng: -84.3711, city: "Atlanta", state: "GA", msaCode: "12060" },
  { zip: "30309", lat: 33.7973, lng: -84.3858, city: "Atlanta", state: "GA", msaCode: "12060" },
  { zip: "30318", lat: 33.7917, lng: -84.4321, city: "Atlanta", state: "GA", msaCode: "12060" },
  { zip: "30339", lat: 33.8786, lng: -84.4586, city: "Atlanta", state: "GA", msaCode: "12060" },
  { zip: "30022", lat: 34.0708, lng: -84.2435, city: "Alpharetta", state: "GA", msaCode: "12060" },
  { zip: "30075", lat: 34.0432, lng: -84.3621, city: "Roswell", state: "GA", msaCode: "12060" },
  { zip: "30062", lat: 34.0327, lng: -84.4827, city: "Marietta", state: "GA", msaCode: "12060" },

  // Washington DC metro (47900)
  { zip: "20001", lat: 38.9123, lng: -77.0173, city: "Washington", state: "DC", msaCode: "47900", msaName: "Washington-Arlington-Alexandria" },
  { zip: "20009", lat: 38.9197, lng: -77.0379, city: "Washington", state: "DC", msaCode: "47900" },
  { zip: "20036", lat: 38.9069, lng: -77.0410, city: "Washington", state: "DC", msaCode: "47900" },
  { zip: "22201", lat: 38.8869, lng: -77.0939, city: "Arlington", state: "VA", msaCode: "47900" },
  { zip: "22102", lat: 38.9354, lng: -77.2197, city: "McLean", state: "VA", msaCode: "47900" },
  { zip: "20910", lat: 39.0007, lng: -77.0339, city: "Silver Spring", state: "MD", msaCode: "47900" },

  // Philadelphia metro (37980)
  { zip: "19103", lat: 39.9522, lng: -75.1741, city: "Philadelphia", state: "PA", msaCode: "37980", msaName: "Philadelphia-Camden-Wilmington" },
  { zip: "19104", lat: 39.9594, lng: -75.1962, city: "Philadelphia", state: "PA", msaCode: "37980" },
  { zip: "19147", lat: 39.9354, lng: -75.1564, city: "Philadelphia", state: "PA", msaCode: "37980" },
  { zip: "19002", lat: 40.1614, lng: -75.1830, city: "Ambler", state: "PA", msaCode: "37980" },

  // Miami metro (33100)
  { zip: "33101", lat: 25.7741, lng: -80.1936, city: "Miami", state: "FL", msaCode: "33100", msaName: "Miami-Fort Lauderdale-Pompano Beach" },
  { zip: "33130", lat: 25.7656, lng: -80.2003, city: "Miami", state: "FL", msaCode: "33100" },
  { zip: "33139", lat: 25.7825, lng: -80.1342, city: "Miami Beach", state: "FL", msaCode: "33100" },
  { zip: "33301", lat: 26.1224, lng: -80.1373, city: "Fort Lauderdale", state: "FL", msaCode: "33100" },
  { zip: "33401", lat: 26.7152, lng: -80.0668, city: "West Palm Beach", state: "FL", msaCode: "33100" },

  // Boston metro (14460)
  { zip: "02108", lat: 42.3576, lng: -71.0639, city: "Boston", state: "MA", msaCode: "14460", msaName: "Boston-Cambridge-Newton" },
  { zip: "02116", lat: 42.3494, lng: -71.0744, city: "Boston", state: "MA", msaCode: "14460" },
  { zip: "02139", lat: 42.3650, lng: -71.1037, city: "Cambridge", state: "MA", msaCode: "14460" },
  { zip: "02451", lat: 42.3973, lng: -71.2342, city: "Waltham", state: "MA", msaCode: "14460" },

  // San Francisco / Bay Area (41860 + 41940)
  { zip: "94102", lat: 37.7799, lng: -122.4189, city: "San Francisco", state: "CA", msaCode: "41860", msaName: "San Francisco-Oakland-Berkeley" },
  { zip: "94103", lat: 37.7726, lng: -122.4099, city: "San Francisco", state: "CA", msaCode: "41860" },
  { zip: "94107", lat: 37.7665, lng: -122.3957, city: "San Francisco", state: "CA", msaCode: "41860" },
  { zip: "94110", lat: 37.7484, lng: -122.4146, city: "San Francisco", state: "CA", msaCode: "41860" },
  { zip: "94612", lat: 37.8067, lng: -122.2685, city: "Oakland", state: "CA", msaCode: "41860" },
  { zip: "94704", lat: 37.8669, lng: -122.2664, city: "Berkeley", state: "CA", msaCode: "41860" },
  { zip: "95110", lat: 37.3414, lng: -121.9034, city: "San Jose", state: "CA", msaCode: "41940", msaName: "San Jose-Sunnyvale-Santa Clara" },
  { zip: "95113", lat: 37.3340, lng: -121.8923, city: "San Jose", state: "CA", msaCode: "41940" },
  { zip: "94043", lat: 37.4234, lng: -122.0837, city: "Mountain View", state: "CA", msaCode: "41940" },
  { zip: "94301", lat: 37.4418, lng: -122.1519, city: "Palo Alto", state: "CA", msaCode: "41940" },

  // Seattle metro (42660)
  { zip: "98101", lat: 47.6101, lng: -122.3344, city: "Seattle", state: "WA", msaCode: "42660", msaName: "Seattle-Tacoma-Bellevue" },
  { zip: "98109", lat: 47.6332, lng: -122.3478, city: "Seattle", state: "WA", msaCode: "42660" },
  { zip: "98115", lat: 47.6850, lng: -122.2989, city: "Seattle", state: "WA", msaCode: "42660" },
  { zip: "98004", lat: 47.6189, lng: -122.2008, city: "Bellevue", state: "WA", msaCode: "42660" },

  // Phoenix metro (38060)
  { zip: "85003", lat: 33.4524, lng: -112.0788, city: "Phoenix", state: "AZ", msaCode: "38060", msaName: "Phoenix-Mesa-Chandler" },
  { zip: "85016", lat: 33.5061, lng: -112.0349, city: "Phoenix", state: "AZ", msaCode: "38060" },
  { zip: "85251", lat: 33.4961, lng: -111.9249, city: "Scottsdale", state: "AZ", msaCode: "38060" },
  { zip: "85283", lat: 33.3779, lng: -111.9216, city: "Tempe", state: "AZ", msaCode: "38060" },

  // Denver metro (19740)
  { zip: "80202", lat: 39.7493, lng: -104.9985, city: "Denver", state: "CO", msaCode: "19740", msaName: "Denver-Aurora-Lakewood" },
  { zip: "80203", lat: 39.7327, lng: -104.9806, city: "Denver", state: "CO", msaCode: "19740" },
  { zip: "80206", lat: 39.7324, lng: -104.9530, city: "Denver", state: "CO", msaCode: "19740" },
  { zip: "80301", lat: 40.0334, lng: -105.2435, city: "Boulder", state: "CO", msaCode: "14500", msaName: "Boulder" },

  // Austin metro (12420)
  { zip: "78701", lat: 30.2700, lng: -97.7416, city: "Austin", state: "TX", msaCode: "12420", msaName: "Austin-Round Rock-Georgetown" },
  { zip: "78704", lat: 30.2410, lng: -97.7657, city: "Austin", state: "TX", msaCode: "12420" },
  { zip: "78745", lat: 30.2107, lng: -97.7972, city: "Austin", state: "TX", msaCode: "12420" },
  { zip: "78758", lat: 30.3911, lng: -97.7148, city: "Austin", state: "TX", msaCode: "12420" },
  { zip: "78664", lat: 30.5187, lng: -97.6713, city: "Round Rock", state: "TX", msaCode: "12420" },

  // Nashville (34980)
  { zip: "37203", lat: 36.1490, lng: -86.7929, city: "Nashville", state: "TN", msaCode: "34980", msaName: "Nashville-Davidson-Murfreesboro-Franklin" },
  { zip: "37206", lat: 36.1808, lng: -86.7384, city: "Nashville", state: "TN", msaCode: "34980" },

  // Charlotte (16740)
  { zip: "28202", lat: 35.2266, lng: -80.8434, city: "Charlotte", state: "NC", msaCode: "16740", msaName: "Charlotte-Concord-Gastonia" },
  { zip: "28203", lat: 35.2079, lng: -80.8595, city: "Charlotte", state: "NC", msaCode: "16740" },

  // Minneapolis (33460)
  { zip: "55402", lat: 44.9759, lng: -93.2725, city: "Minneapolis", state: "MN", msaCode: "33460", msaName: "Minneapolis-St. Paul-Bloomington" },
  { zip: "55101", lat: 44.9540, lng: -93.0884, city: "St. Paul", state: "MN", msaCode: "33460" },

  // Portland OR (38900)
  { zip: "97204", lat: 45.5198, lng: -122.6781, city: "Portland", state: "OR", msaCode: "38900", msaName: "Portland-Vancouver-Hillsboro" },
  { zip: "97232", lat: 45.5327, lng: -122.6435, city: "Portland", state: "OR", msaCode: "38900" },

  // Las Vegas (29820)
  { zip: "89101", lat: 36.1727, lng: -115.1372, city: "Las Vegas", state: "NV", msaCode: "29820", msaName: "Las Vegas-Henderson-Paradise" },
  { zip: "89109", lat: 36.1216, lng: -115.1716, city: "Las Vegas", state: "NV", msaCode: "29820" },

  // San Diego (41740)
  { zip: "92101", lat: 32.7197, lng: -117.1647, city: "San Diego", state: "CA", msaCode: "41740", msaName: "San Diego-Chula Vista-Carlsbad" },
  { zip: "92103", lat: 32.7493, lng: -117.1683, city: "San Diego", state: "CA", msaCode: "41740" },

  // Detroit (19820)
  { zip: "48201", lat: 42.3473, lng: -83.0573, city: "Detroit", state: "MI", msaCode: "19820", msaName: "Detroit-Warren-Dearborn" },
  { zip: "48226", lat: 42.3290, lng: -83.0450, city: "Detroit", state: "MI", msaCode: "19820" },

  // St. Louis (41180)
  { zip: "63101", lat: 38.6304, lng: -90.1937, city: "St. Louis", state: "MO", msaCode: "41180", msaName: "St. Louis" },

  // Tampa (45300)
  { zip: "33602", lat: 27.9595, lng: -82.4572, city: "Tampa", state: "FL", msaCode: "45300", msaName: "Tampa-St. Petersburg-Clearwater" },
  { zip: "33701", lat: 27.7724, lng: -82.6402, city: "St. Petersburg", state: "FL", msaCode: "45300" },

  // Orlando (36740)
  { zip: "32801", lat: 28.5421, lng: -81.3779, city: "Orlando", state: "FL", msaCode: "36740", msaName: "Orlando-Kissimmee-Sanford" },

  // Pittsburgh (38300)
  { zip: "15222", lat: 40.4470, lng: -79.9991, city: "Pittsburgh", state: "PA", msaCode: "38300", msaName: "Pittsburgh" },

  // Sacramento (40900)
  { zip: "95814", lat: 38.5818, lng: -121.4934, city: "Sacramento", state: "CA", msaCode: "40900", msaName: "Sacramento-Roseville-Folsom" },

  // Salt Lake City (41620)
  { zip: "84101", lat: 40.7598, lng: -111.8939, city: "Salt Lake City", state: "UT", msaCode: "41620", msaName: "Salt Lake City" },

  // Indianapolis (26900)
  { zip: "46204", lat: 39.7723, lng: -86.1571, city: "Indianapolis", state: "IN", msaCode: "26900", msaName: "Indianapolis-Carmel-Anderson" },

  // Cincinnati (17140)
  { zip: "45202", lat: 39.1056, lng: -84.5083, city: "Cincinnati", state: "OH", msaCode: "17140", msaName: "Cincinnati" },

  // Cleveland (17460)
  { zip: "44113", lat: 41.4842, lng: -81.7034, city: "Cleveland", state: "OH", msaCode: "17460", msaName: "Cleveland-Elyria" },

  // Kansas City (28140)
  { zip: "64108", lat: 39.0901, lng: -94.5870, city: "Kansas City", state: "MO", msaCode: "28140", msaName: "Kansas City" },

  // Columbus (18140)
  { zip: "43215", lat: 39.9719, lng: -83.0040, city: "Columbus", state: "OH", msaCode: "18140", msaName: "Columbus" },
];

const ZIP_INDEX = new Map<string, ZipRecord>(US_ZIPS.map((z) => [z.zip, z]));

const MSA_INDEX = new Map<string, ZipRecord[]>();
for (const z of US_ZIPS) {
  if (!z.msaCode) continue;
  const list = MSA_INDEX.get(z.msaCode) ?? [];
  list.push(z);
  MSA_INDEX.set(z.msaCode, list);
}

export function lookupZip(zip: string): ZipRecord | undefined {
  if (!zip) return undefined;
  return ZIP_INDEX.get(zip.trim().slice(0, 5));
}

export function listMsa(msaCode: string): ZipRecord[] {
  return MSA_INDEX.get(msaCode.trim()) ?? [];
}

export function listAllZips(): readonly ZipRecord[] {
  return US_ZIPS;
}

const EARTH_R_MI = 3958.7613;

export function haversineMiles(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_R_MI * c;
}

export type ZipMatch = ZipRecord & { distanceMiles: number };

export function expandZipsForRadius(
  lat: number,
  lng: number,
  miles: number,
  opts: { limit?: number } = {}
): ZipMatch[] {
  const limit = opts.limit ?? 25;
  const matches: ZipMatch[] = [];
  for (const z of US_ZIPS) {
    const d = haversineMiles(lat, lng, z.lat, z.lng);
    if (d <= miles) matches.push({ ...z, distanceMiles: d });
  }
  matches.sort((a, b) => a.distanceMiles - b.distanceMiles);
  return matches.slice(0, limit);
}

export function expandZipsForMsa(msaCode: string): ZipRecord[] {
  return listMsa(msaCode);
}

// Best-effort parser: accepts "30339", "Atlanta, GA", "33.879,-84.459", or
// the agent's free-text geo. Used by the runner so the existing UI's "City,
// ST" inputs still work alongside the new lat/lng/zip inputs.
export type ParsedGeo =
  | { kind: "zip"; zip: string; lat: number; lng: number; city: string; state: string }
  | { kind: "latlng"; lat: number; lng: number }
  | { kind: "city"; city: string; state?: string }
  | { kind: "unknown"; raw: string };

const LAT_LNG_RE = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/;
const ZIP_RE = /^\s*(\d{5})(?:-\d{4})?\s*$/;
const CITY_STATE_RE = /^\s*([^,]+),\s*([A-Za-z]{2})\s*$/;

export function parseGeoString(input?: string): ParsedGeo {
  if (!input) return { kind: "unknown", raw: "" };
  const trimmed = input.trim();
  const zipMatch = ZIP_RE.exec(trimmed);
  if (zipMatch) {
    const rec = lookupZip(zipMatch[1]);
    if (rec)
      return {
        kind: "zip",
        zip: rec.zip,
        lat: rec.lat,
        lng: rec.lng,
        city: rec.city,
        state: rec.state,
      };
  }
  const ll = LAT_LNG_RE.exec(trimmed);
  if (ll) {
    const lat = parseFloat(ll[1]);
    const lng = parseFloat(ll[2]);
    if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
      return { kind: "latlng", lat, lng };
    }
  }
  const cs = CITY_STATE_RE.exec(trimmed);
  if (cs) {
    return { kind: "city", city: cs[1].trim(), state: cs[2].toUpperCase() };
  }
  return { kind: "unknown", raw: trimmed };
}

export function formatGeoForAgent(opts: {
  lat?: number;
  lng?: number;
  radiusMiles?: number;
  zips?: string[];
  msaCode?: string;
  geoString?: string;
}): string {
  const parts: string[] = [];
  if (opts.lat !== undefined && opts.lng !== undefined) {
    parts.push(`Lat/Lng: ${opts.lat.toFixed(4)}, ${opts.lng.toFixed(4)}`);
  }
  if (opts.radiusMiles !== undefined) {
    parts.push(`Radius: ${opts.radiusMiles} mi`);
  }
  if (opts.zips?.length) {
    parts.push(`Zip codes: ${opts.zips.slice(0, 25).join(", ")}`);
  }
  if (opts.msaCode) {
    const name = MSA_INDEX.get(opts.msaCode)?.[0]?.msaName;
    parts.push(`MSA: ${opts.msaCode}${name ? ` (${name})` : ""}`);
  }
  if (opts.geoString) {
    parts.push(`Geography: ${opts.geoString}`);
  }
  return parts.join(" · ");
}
