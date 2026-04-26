import { describe, expect, it } from "vitest";
import {
  bbbDirectToLeadInput,
  buildSearchUrl,
  parseBbbListingHTML,
  type BbbBusiness,
} from "./bbb-direct";

const FIXTURE_LISTING_HTML = `
<!doctype html><html><head>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "ItemList",
  "itemListElement": [
    {
      "@type": "ListItem",
      "position": 1,
      "item": {
        "@type": "LocalBusiness",
        "name": "Acme Plumbing LLC",
        "url": "https://www.bbb.org/us/tx/austin/profile/plumber/acme-plumbing-llc-0825-90123456",
        "telephone": "+1-512-555-0303",
        "foundingDate": "2003-06-15",
        "address": {
          "@type": "PostalAddress",
          "streetAddress": "500 W 6th St",
          "addressLocality": "Austin",
          "addressRegion": "TX",
          "postalCode": "78701",
          "addressCountry": "US"
        },
        "geo": { "latitude": "30.2700", "longitude": "-97.7416" },
        "category": "Plumber",
        "additionalProperty": [
          { "name": "BBBRating", "value": "A+" },
          { "name": "Accredited", "value": "true" }
        ],
        "aggregateRating": { "ratingValue": "4.8", "reviewCount": "47" }
      }
    },
    {
      "@type": "ListItem",
      "position": 2,
      "item": {
        "@type": "ProfessionalService",
        "name": "Hill Country Roofing",
        "url": "https://www.bbb.org/us/tx/austin/profile/roofing-contractors/hill-country-roofing-0825-90999111",
        "telephone": "(512) 555-0404",
        "address": {
          "streetAddress": "100 Burnet Rd",
          "addressLocality": "Austin",
          "addressRegion": "TX",
          "postalCode": "78757"
        },
        "additionalProperty": [
          { "name": "BBBRating", "value": "B" },
          { "name": "Accredited", "value": "no" },
          { "name": "YearsInBusiness", "value": 8 }
        ]
      }
    }
  ]
}
</script>
<script type="application/ld+json">
{ "@type": "WebSite", "name": "BBB" }
</script>
<script type="application/ld+json">
not valid json {[
</script>
</head><body></body></html>
`;

describe("bbb-direct parser", () => {
  describe("buildSearchUrl", () => {
    it("encodes term, geo, and country into the query string", () => {
      const url = buildSearchUrl("plumber", "Austin, TX");
      expect(url).toContain("find_text=plumber");
      expect(url).toContain("find_loc=Austin%2C+TX");
      expect(url).toContain("find_country=USA");
    });

    it("only adds page param when > 1", () => {
      expect(buildSearchUrl("plumber", "Austin")).not.toContain("page=");
      expect(buildSearchUrl("plumber", "Austin", 3)).toContain("page=3");
    });
  });

  describe("parseBbbListingHTML", () => {
    it("extracts businesses from JSON-LD ItemList with mixed @type", () => {
      const items = parseBbbListingHTML(FIXTURE_LISTING_HTML);
      expect(items).toHaveLength(2);
      const acme = items.find((b) => b.name === "Acme Plumbing LLC")!;
      expect(acme.bbbId).toBe("acme-plumbing-llc-0825-90123456");
      expect(acme.phone).toBe("+1-512-555-0303");
      expect(acme.streetAddress).toBe("500 W 6th St");
      expect(acme.city).toBe("Austin");
      expect(acme.region).toBe("TX");
      expect(acme.postalCode).toBe("78701");
      expect(acme.lat).toBe(30.27);
      expect(acme.lng).toBe(-97.7416);
      expect(acme.category).toBe("Plumber");
    });

    it("captures BBB-specific fields from additionalProperty", () => {
      const items = parseBbbListingHTML(FIXTURE_LISTING_HTML);
      const acme = items.find((b) => b.name === "Acme Plumbing LLC")!;
      expect(acme.bbbRating).toBe("A+");
      expect(acme.accredited).toBe(true);
      expect(acme.rating).toBe(4.8);
      expect(acme.reviewCount).toBe(47);
    });

    it("computes years in business from foundingDate", () => {
      const items = parseBbbListingHTML(FIXTURE_LISTING_HTML);
      const acme = items.find((b) => b.name === "Acme Plumbing LLC")!;
      // Test runs against the current year, so just assert non-negative + reasonable.
      expect(acme.yearsInBusiness).toBeGreaterThanOrEqual(20);
      expect(acme.yearsInBusiness).toBeLessThan(50);
    });

    it("falls back to YearsInBusiness additionalProperty when foundingDate missing", () => {
      const items = parseBbbListingHTML(FIXTURE_LISTING_HTML);
      const hill = items.find((b) => b.name === "Hill Country Roofing")!;
      expect(hill.yearsInBusiness).toBe(8);
      expect(hill.accredited).toBe(false);
      expect(hill.bbbRating).toBe("B");
    });

    it("survives malformed JSON-LD blocks on the same page", () => {
      // Fixture includes a deliberately broken script; parser must skip it.
      expect(() => parseBbbListingHTML(FIXTURE_LISTING_HTML)).not.toThrow();
    });

    it("ignores non-business JSON-LD types (e.g. WebSite)", () => {
      const items = parseBbbListingHTML(FIXTURE_LISTING_HTML);
      expect(items.find((b) => b.name === "BBB")).toBeUndefined();
    });

    it("returns [] for HTML with no JSON-LD", () => {
      expect(parseBbbListingHTML("<html><body>no data</body></html>")).toEqual([]);
    });
  });

  describe("bbbDirectToLeadInput", () => {
    it("encodes BBB-specific tags into matchReason", () => {
      const b: BbbBusiness = {
        bbbId: "acme-plumbing",
        name: "Acme Plumbing",
        bbbProfileUrl: "https://www.bbb.org/.../acme-plumbing",
        accredited: true,
        bbbRating: "A+",
        yearsInBusiness: 22,
        phone: "5125550303",
        streetAddress: "500 W 6th St",
        city: "Austin",
        region: "TX",
        postalCode: "78701",
      };
      const lead = bbbDirectToLeadInput(b, "search-1", "plumber", "Austin, TX");
      expect(lead.matchReason).toContain("BBB");
      expect(lead.matchReason).toContain("Accredited");
      expect(lead.matchReason).toContain("A+ rating");
      expect(lead.matchReason).toContain("22y in business");
      expect(lead.placeId).toBe("bbb:acme-plumbing");
      expect(lead.industry).toBe("plumber");
      expect(lead.score).toBeGreaterThanOrEqual(85);
    });

    it("scores accredited A-rated businesses higher than unrated unaccredited ones", () => {
      const accredited: BbbBusiness = {
        bbbId: "a",
        name: "A",
        bbbProfileUrl: "https://x",
        accredited: true,
        bbbRating: "A+",
        phone: "1",
        streetAddress: "x",
      };
      const plain: BbbBusiness = {
        bbbId: "b",
        name: "B",
        bbbProfileUrl: "https://y",
        phone: "1",
        streetAddress: "y",
      };
      const a = bbbDirectToLeadInput(accredited, "s");
      const b = bbbDirectToLeadInput(plain, "s");
      expect(a.score!).toBeGreaterThan(b.score!);
    });

    it("penalises F-rated listings", () => {
      const f: BbbBusiness = {
        bbbId: "f",
        name: "F",
        bbbProfileUrl: "https://z",
        bbbRating: "F",
        phone: "1",
        streetAddress: "z",
      };
      const lead = bbbDirectToLeadInput(f, "s");
      expect(lead.score!).toBeLessThan(70);
    });
  });
});
