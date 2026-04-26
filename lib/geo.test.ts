import { describe, expect, it } from "vitest";
import {
  expandZipsForMsa,
  expandZipsForRadius,
  formatGeoForAgent,
  haversineMiles,
  lookupZip,
  parseGeoString,
} from "./geo";

describe("geo", () => {
  describe("haversineMiles", () => {
    it("returns 0 for identical points", () => {
      expect(haversineMiles(40, -75, 40, -75)).toBe(0);
    });

    it("approximates known city pairs within ~5 mi", () => {
      // NYC (40.7506, -73.9971) to LA (34.0617, -118.2390) is ~2451 mi.
      const d = haversineMiles(40.7506, -73.9971, 34.0617, -118.239);
      expect(d).toBeGreaterThan(2440);
      expect(d).toBeLessThan(2460);
    });
  });

  describe("lookupZip", () => {
    it("returns a record for a known zip", () => {
      const r = lookupZip("30339");
      expect(r).toBeDefined();
      expect(r?.city).toBe("Atlanta");
      expect(r?.state).toBe("GA");
    });

    it("returns undefined for unknown zips", () => {
      expect(lookupZip("00000")).toBeUndefined();
      expect(lookupZip("")).toBeUndefined();
    });

    it("handles ZIP+4 format by taking the first 5 digits", () => {
      expect(lookupZip("30339-1234")?.city).toBe("Atlanta");
    });
  });

  describe("expandZipsForRadius", () => {
    it("returns at least the seed zip when radius covers it", () => {
      const seed = lookupZip("30339")!;
      const matches = expandZipsForRadius(seed.lat, seed.lng, 1);
      expect(matches.find((m) => m.zip === "30339")).toBeDefined();
      // closest match should be the seed itself
      expect(matches[0].zip).toBe("30339");
      expect(matches[0].distanceMiles).toBeLessThan(0.5);
    });

    it("expands to multiple zips within a reasonable metro radius", () => {
      const seed = lookupZip("30339")!;
      const matches = expandZipsForRadius(seed.lat, seed.lng, 25);
      // Atlanta metro should have several bundled zips within 25 mi.
      expect(matches.length).toBeGreaterThanOrEqual(3);
      // All matches should be within the radius (sanity check)
      for (const m of matches) {
        expect(m.distanceMiles).toBeLessThanOrEqual(25);
      }
    });

    it("respects the limit option", () => {
      const seed = lookupZip("10001")!;
      const matches = expandZipsForRadius(seed.lat, seed.lng, 100, { limit: 2 });
      expect(matches.length).toBeLessThanOrEqual(2);
    });
  });

  describe("expandZipsForMsa", () => {
    it("returns multiple zips for a known MSA code", () => {
      const dfw = expandZipsForMsa("19100");
      expect(dfw.length).toBeGreaterThan(2);
      expect(dfw.every((z) => z.state === "TX")).toBe(true);
    });

    it("returns empty for unknown MSA codes", () => {
      expect(expandZipsForMsa("00000")).toEqual([]);
    });
  });

  describe("parseGeoString", () => {
    it("recognises a known zip", () => {
      const r = parseGeoString("30339");
      expect(r.kind).toBe("zip");
      if (r.kind === "zip") {
        expect(r.city).toBe("Atlanta");
        expect(r.state).toBe("GA");
      }
    });

    it("parses lat,lng pairs", () => {
      const r = parseGeoString("33.879, -84.459");
      expect(r.kind).toBe("latlng");
      if (r.kind === "latlng") {
        expect(r.lat).toBeCloseTo(33.879, 3);
        expect(r.lng).toBeCloseTo(-84.459, 3);
      }
    });

    it("parses City, ST", () => {
      const r = parseGeoString("Austin, TX");
      expect(r.kind).toBe("city");
      if (r.kind === "city") {
        expect(r.city).toBe("Austin");
        expect(r.state).toBe("TX");
      }
    });

    it("returns unknown for empty / freeform", () => {
      expect(parseGeoString("").kind).toBe("unknown");
      expect(parseGeoString("near my house").kind).toBe("unknown");
    });

    it("rejects out-of-range lat/lng", () => {
      expect(parseGeoString("999, 999").kind).toBe("unknown");
    });
  });

  describe("formatGeoForAgent", () => {
    it("composes a multi-part geo description", () => {
      const out = formatGeoForAgent({
        lat: 33.879,
        lng: -84.459,
        radiusMiles: 25,
        zips: ["30339", "30303"],
        geoString: "Atlanta, GA",
      });
      expect(out).toContain("33.8790");
      expect(out).toContain("Radius: 25 mi");
      expect(out).toContain("30339");
      expect(out).toContain("Atlanta, GA");
    });

    it("returns empty string when nothing is provided", () => {
      expect(formatGeoForAgent({})).toBe("");
    });
  });
});
