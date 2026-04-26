// Geo subdivision (tile grid) for capped-result discovery APIs.
//
// Google Places Nearby Search returns at most 20 results per call. Yelp
// Fusion caps at 50. Foursquare caps at 50 per page (~200 with cursor).
// In a dense metro (Manhattan, downtown LA, central Atlanta) a single
// 25-mile circle truncates badly — there are far more plumbers in those
// areas than 20-50 results can express.
//
// The fix is a tile grid: subdivide the bounding circle into N smaller
// circles and run one API call per tile. This module emits the tile
// centers + a uniform tile radius so callers can issue a fan-out of
// independent searches and merge by place_id.
//
// Spacing: square grid with `step = tileMiles * 1.4`. With circle radius
// = tileMiles, that overlap (~10%) ensures the union of tiles fully
// covers the original square; we then clip each tile center against the
// original circle. Slight overlap is fine — the connector dedupes by ID.

import { haversineMiles } from "./geo";

export type Tile = {
  lat: number;
  lng: number;
  radiusMiles: number;
};

const MILES_PER_DEG_LAT = 69.0;

// Build a grid of tiles covering a circle of `radiusMiles` around (lat, lng).
// `tileMiles` is the radius the caller will pass to each per-tile API call;
// pick it based on the API's result cap relative to expected SMB density:
//   - dense urban (Manhattan-grade): tileMiles = 1-2
//   - typical metro:                 tileMiles = 3-5
//   - rural / regional sweep:        tileMiles = 8-15
//
// `maxTiles` caps the fan-out so a 100-mile sweep at tileMiles=2 doesn't
// silently issue thousands of API calls; over the cap, the function falls
// back to a coarser grid that still covers the area.
export function tilesForRadius(
  lat: number,
  lng: number,
  radiusMiles: number,
  tileMiles: number,
  opts: { maxTiles?: number } = {}
): Tile[] {
  if (tileMiles <= 0) throw new Error("tileMiles must be > 0");
  if (radiusMiles <= 0) return [];

  // Single tile suffices when the requested radius fits in one tile.
  if (radiusMiles <= tileMiles) {
    return [{ lat, lng, radiusMiles: tileMiles }];
  }

  const maxTiles = opts.maxTiles ?? 200;
  let effectiveTile = tileMiles;
  let tiles = buildGrid(lat, lng, radiusMiles, effectiveTile);

  // If the grid blows past maxTiles, scale tile size up uniformly until we
  // fit. Doubling each pass keeps it O(log N).
  while (tiles.length > maxTiles) {
    effectiveTile *= 2;
    tiles = buildGrid(lat, lng, radiusMiles, effectiveTile);
    if (effectiveTile >= radiusMiles) {
      return [{ lat, lng, radiusMiles: effectiveTile }];
    }
  }
  return tiles;
}

function buildGrid(
  lat0: number,
  lng0: number,
  radiusMiles: number,
  tileMiles: number
): Tile[] {
  const stepMiles = tileMiles * 1.4;
  const milesPerDegLng = MILES_PER_DEG_LAT * Math.cos((lat0 * Math.PI) / 180);
  // Avoid divide-by-zero at the poles.
  const safeLngMiles = Math.max(milesPerDegLng, 1e-3);

  const stepLat = stepMiles / MILES_PER_DEG_LAT;
  const stepLng = stepMiles / safeLngMiles;
  const halfSteps = Math.ceil(radiusMiles / stepMiles);

  const tiles: Tile[] = [];
  for (let i = -halfSteps; i <= halfSteps; i++) {
    for (let j = -halfSteps; j <= halfSteps; j++) {
      const tLat = lat0 + i * stepLat;
      const tLng = lng0 + j * stepLng;
      // Keep tiles whose center is inside the original circle, plus a one-
      // tile margin so the union of tile circles fully covers the boundary.
      const d = haversineMiles(lat0, lng0, tLat, tLng);
      if (d <= radiusMiles + tileMiles) {
        tiles.push({ lat: tLat, lng: tLng, radiusMiles: tileMiles });
      }
    }
  }
  return tiles;
}

// Merge results across tiles by a stable identity key. The connector usually
// has a per-source ID (Google place_id, Foursquare fsq_id) — pass a key
// extractor and this returns a deduped, in-original-order array.
export function dedupeById<T>(items: T[], idOf: (item: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const id = idOf(item);
    if (id && !seen.has(id)) {
      seen.add(id);
      out.push(item);
    }
  }
  return out;
}

// Suggested tile size for a given API and an estimated SMB density. The
// discovery runner picks the tile size from the source so callers don't
// have to know each API's quirks.
//
// `provider` is the API. `density` is a coarse guess at how packed the area
// is — "high" for urban metros, "med" for suburban, "low" for rural. The
// returned tileMiles balances API cap vs. call count.
export function suggestedTileMiles(
  provider:
    | "google_places"
    | "foursquare"
    | "yelp"
    | "bing_places"
    | "tomtom"
    | "here_places",
  density: "high" | "med" | "low"
): number {
  // Caps roughly: google_places nearby = 20, foursquare = 50, yelp = 50,
  // bing_places = 25, tomtom = 100, here_places = 100. High-cap APIs can
  // use bigger tiles. High-density areas need smaller.
  const baseByProvider: Record<typeof provider, number> = {
    google_places: 2,
    foursquare: 4,
    yelp: 4,
    bing_places: 2,
    tomtom: 5,
    here_places: 5,
  };
  const factor = density === "high" ? 1 : density === "med" ? 2 : 4;
  return baseByProvider[provider] * factor;
}
