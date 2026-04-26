import { describe, expect, it } from "vitest";
import { dedupeById, suggestedTileMiles, tilesForRadius } from "./geo-fan";
import { haversineMiles } from "./geo";

describe("geo-fan", () => {
  describe("tilesForRadius", () => {
    it("returns a single tile when radius fits in tileMiles", () => {
      const tiles = tilesForRadius(33.749, -84.388, 5, 10);
      expect(tiles).toHaveLength(1);
      expect(tiles[0]).toEqual({ lat: 33.749, lng: -84.388, radiusMiles: 10 });
    });

    it("subdivides a large radius into many tiles", () => {
      const tiles = tilesForRadius(33.749, -84.388, 25, 5);
      expect(tiles.length).toBeGreaterThan(10);
      for (const t of tiles) {
        expect(t.radiusMiles).toBe(5);
      }
    });

    it("emits tile centers within radius + tileMiles of origin", () => {
      const lat = 40.7506;
      const lng = -73.9971;
      const radiusMiles = 20;
      const tileMiles = 4;
      const tiles = tilesForRadius(lat, lng, radiusMiles, tileMiles);
      for (const t of tiles) {
        const d = haversineMiles(lat, lng, t.lat, t.lng);
        expect(d).toBeLessThanOrEqual(radiusMiles + tileMiles + 0.1);
      }
    });

    it("respects maxTiles by widening the tile size", () => {
      const tiles = tilesForRadius(33.749, -84.388, 100, 1, { maxTiles: 50 });
      expect(tiles.length).toBeLessThanOrEqual(50);
    });

    it("returns empty array for non-positive radius", () => {
      expect(tilesForRadius(0, 0, 0, 5)).toEqual([]);
      expect(tilesForRadius(0, 0, -10, 5)).toEqual([]);
    });

    it("throws if tileMiles is non-positive", () => {
      expect(() => tilesForRadius(0, 0, 10, 0)).toThrow();
      expect(() => tilesForRadius(0, 0, 10, -1)).toThrow();
    });

    it("covers the boundary — at least one tile within tileMiles of any boundary point", () => {
      const lat = 40.7506;
      const lng = -73.9971;
      const radiusMiles = 10;
      const tileMiles = 3;
      const tiles = tilesForRadius(lat, lng, radiusMiles, tileMiles);

      // Sample points around the boundary; for each, at least one tile center
      // must be within tileMiles so the tile circle covers it.
      const samples = 12;
      for (let k = 0; k < samples; k++) {
        const angle = (2 * Math.PI * k) / samples;
        // Move radiusMiles miles from origin in this direction.
        const dLat = (radiusMiles * Math.cos(angle)) / 69;
        const dLng =
          (radiusMiles * Math.sin(angle)) /
          (69 * Math.cos((lat * Math.PI) / 180));
        const sLat = lat + dLat;
        const sLng = lng + dLng;
        const minD = Math.min(
          ...tiles.map((t) => haversineMiles(t.lat, t.lng, sLat, sLng))
        );
        expect(minD).toBeLessThanOrEqual(tileMiles + 0.5);
      }
    });
  });

  describe("dedupeById", () => {
    it("preserves first occurrence and order", () => {
      const items = [
        { id: "a", n: 1 },
        { id: "b", n: 2 },
        { id: "a", n: 3 },
        { id: "c", n: 4 },
      ];
      const out = dedupeById(items, (i) => i.id);
      expect(out.map((i) => i.id)).toEqual(["a", "b", "c"]);
      expect(out[0].n).toBe(1);
    });

    it("skips items with empty id", () => {
      const items = [
        { id: "", n: 1 },
        { id: "a", n: 2 },
      ];
      expect(dedupeById(items, (i) => i.id)).toEqual([{ id: "a", n: 2 }]);
    });
  });

  describe("suggestedTileMiles", () => {
    it("returns smaller tiles for high density", () => {
      expect(suggestedTileMiles("google_places", "high")).toBeLessThan(
        suggestedTileMiles("google_places", "low")
      );
    });

    it("higher-cap providers (Foursquare, Yelp) get bigger tiles", () => {
      expect(suggestedTileMiles("foursquare", "med")).toBeGreaterThan(
        suggestedTileMiles("google_places", "med")
      );
    });
  });
});
