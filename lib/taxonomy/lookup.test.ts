import { describe, expect, it } from "vitest";
import {
  findVerticalByQuery,
  getNaicsCode,
  getNaicsCodes,
  getSicCode,
  getVertical,
  listVerticals,
  listVerticalsByParent,
  suggestVerticals,
} from "./lookup";

describe("getVertical", () => {
  it("returns the vertical for an exact slug", () => {
    expect(getVertical("plumber")?.label).toBe("Plumber");
    expect(getVertical("hvac")?.label).toBe("HVAC Contractor");
  });

  it("is case-insensitive and trims whitespace", () => {
    expect(getVertical("  Plumber  ")?.slug).toBe("plumber");
    expect(getVertical("HVAC")?.slug).toBe("hvac");
  });

  it("returns undefined for unknown slugs", () => {
    expect(getVertical("not_a_real_vertical")).toBeUndefined();
    expect(getVertical("")).toBeUndefined();
  });
});

describe("findVerticalByQuery", () => {
  it("matches an exact alias", () => {
    expect(findVerticalByQuery("plumbing services")?.slug).toBe("plumber");
    expect(findVerticalByQuery("ac repair")?.slug).toBe("hvac");
    expect(findVerticalByQuery("attorney")?.slug).toBe("lawyer");
  });

  it("matches the human label", () => {
    expect(findVerticalByQuery("HVAC Contractor")?.slug).toBe("hvac");
  });

  it("substring-matches longer free-text queries by picking the most specific alias", () => {
    // The full query mentions multiple verticals — the longer alias
    // ('roofing contractor' > 'roofer') should win.
    expect(
      findVerticalByQuery("looking for a roofing contractor in Austin")?.slug
    ).toBe("roofer");
  });

  it("falls back to reverse-substring (query inside alias) for short queries", () => {
    // The query "elec" is shorter than any alias but is contained in
    // "electrician" / "electrical contractor" / "electrical services".
    expect(findVerticalByQuery("elec")?.slug).toBe("electrician");
  });

  it("ignores reverse-substring matches under 3 chars to avoid noise", () => {
    expect(findVerticalByQuery("a")).toBeUndefined();
    expect(findVerticalByQuery("ax")).toBeUndefined();
  });

  it("returns undefined for fully unrelated text", () => {
    expect(findVerticalByQuery("xylophone repair specialists")).toBeUndefined();
  });

  it("returns undefined for empty / whitespace input", () => {
    expect(findVerticalByQuery("")).toBeUndefined();
    expect(findVerticalByQuery("   ")).toBeUndefined();
  });
});

describe("suggestVerticals", () => {
  it("returns prefix matches across slug / label / aliases", () => {
    const results = suggestVerticals("plu");
    expect(results.map((v) => v.slug)).toContain("plumber");
  });

  it("dedupes when multiple aliases match the same vertical", () => {
    const results = suggestVerticals("ha"); // "handyman", "hair salon"
    const slugs = results.map((v) => v.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("respects the limit parameter", () => {
    const results = suggestVerticals("p", 3);
    expect(results.length).toBeLessThanOrEqual(3);
  });

  it("returns empty for empty prefix", () => {
    expect(suggestVerticals("")).toEqual([]);
    expect(suggestVerticals("   ")).toEqual([]);
  });
});

describe("NAICS / SIC accessors", () => {
  it("getNaicsCode returns the primary NAICS for a slug", () => {
    expect(getNaicsCode("plumber")).toBe("238220");
    expect(getNaicsCode("dentist")).toBe("621210");
    expect(getNaicsCode("restaurant")).toBe("722511");
  });

  it("getNaicsCode resolves free-text via findVerticalByQuery", () => {
    expect(getNaicsCode("plumbing contractor")).toBe("238220");
    expect(getNaicsCode("hvac")).toBe("238220");
  });

  it("getNaicsCodes returns all codes (primary first)", () => {
    const accountantCodes = getNaicsCodes("accountant");
    expect(accountantCodes[0]).toBe("541211");
    expect(accountantCodes).toContain("541213");
  });

  it("getSicCode returns the primary SIC", () => {
    expect(getSicCode("plumber")).toBe("1711");
    expect(getSicCode("restaurant")).toBe("5812");
  });

  it("returns undefined / [] for unknown verticals", () => {
    expect(getNaicsCode("not_a_thing")).toBeUndefined();
    expect(getNaicsCodes("not_a_thing")).toEqual([]);
    expect(getSicCode("not_a_thing")).toBeUndefined();
  });
});

describe("listVerticals / listVerticalsByParent", () => {
  it("listVerticals exposes the full taxonomy", () => {
    const all = listVerticals();
    expect(all.length).toBeGreaterThan(40);
    expect(all.find((v) => v.slug === "plumber")).toBeDefined();
  });

  it("listVerticalsByParent groups verticals", () => {
    const home = listVerticalsByParent("home_services");
    expect(home.find((v) => v.slug === "plumber")).toBeDefined();
    expect(home.find((v) => v.slug === "restaurant")).toBeUndefined();
    const food = listVerticalsByParent("food");
    expect(food.find((v) => v.slug === "restaurant")).toBeDefined();
  });

  it("every vertical has at least one NAICS code", () => {
    for (const v of listVerticals()) {
      expect(v.naics.length).toBeGreaterThan(0);
      expect(v.naics[0]).toMatch(/^\d{6}$/);
    }
  });

  it("aliases include the slug and label for symmetric lookup", () => {
    // Lookup by either slug or label should always succeed.
    for (const v of listVerticals()) {
      expect(findVerticalByQuery(v.slug)?.slug).toBe(v.slug);
      expect(findVerticalByQuery(v.label)?.slug).toBe(v.slug);
    }
  });

  it("slugs are unique across the taxonomy", () => {
    const slugs = listVerticals().map((v) => v.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});
