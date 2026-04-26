import { describe, expect, it } from "vitest";
import {
  buildSearchUrl,
  parseYelpListingHTML,
  yelpDirectToLeadInput,
  type YelpBusiness,
} from "./yelp-direct";

// Synthetic HTML mimicking the JSON-LD shape Yelp embeds on a search
// listing page. Real pages are ~2MB; this fixture is the structurally
// representative subset our parser cares about.
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
        "@type": "Restaurant",
        "name": "Joe's Pizza",
        "url": "https://www.yelp.com/biz/joes-pizza-austin",
        "telephone": "(512) 555-0101",
        "priceRange": "$$",
        "servesCuisine": ["Italian", "Pizza"],
        "address": {
          "@type": "PostalAddress",
          "streetAddress": "123 Main St",
          "addressLocality": "Austin",
          "addressRegion": "TX",
          "postalCode": "78701",
          "addressCountry": "US"
        },
        "geo": { "latitude": 30.2700, "longitude": -97.7416 },
        "aggregateRating": { "ratingValue": "4.6", "reviewCount": "412" }
      }
    },
    {
      "@type": "ListItem",
      "position": 2,
      "item": {
        "@type": "LocalBusiness",
        "name": "Acme HVAC",
        "url": "https://www.yelp.com/biz/acme-hvac-austin",
        "telephone": "+1-512-555-0202",
        "address": {
          "streetAddress": "200 Congress Ave",
          "addressLocality": "Austin",
          "addressRegion": "TX",
          "postalCode": "78704"
        },
        "aggregateRating": { "ratingValue": 4.9, "reviewCount": 88 },
        "category": "HVAC Contractor"
      }
    }
  ]
}
</script>
<script type="application/ld+json">
{ "@type": "WebSite", "name": "Yelp" }
</script>
<script type="application/ld+json">
this is not valid json {[
</script>
</head><body></body></html>
`;

describe("yelp-direct parser", () => {
  describe("buildSearchUrl", () => {
    it("encodes term and geo into find_desc / find_loc", () => {
      const url = buildSearchUrl("HVAC contractor", "Austin, TX");
      expect(url).toContain("find_desc=HVAC+contractor");
      expect(url).toContain("find_loc=Austin%2C+TX");
    });

    it("only adds start when > 0", () => {
      expect(buildSearchUrl("plumber", "Atlanta")).not.toContain("start=");
      expect(buildSearchUrl("plumber", "Atlanta", 20)).toContain("start=20");
    });
  });

  describe("parseYelpListingHTML", () => {
    it("extracts businesses from JSON-LD ItemList", () => {
      const items = parseYelpListingHTML(FIXTURE_LISTING_HTML);
      expect(items).toHaveLength(2);
      const joe = items.find((b) => b.name === "Joe's Pizza")!;
      expect(joe.yelpId).toBe("joes-pizza-austin");
      expect(joe.phone).toBe("(512) 555-0101");
      expect(joe.streetAddress).toBe("123 Main St");
      expect(joe.city).toBe("Austin");
      expect(joe.region).toBe("TX");
      expect(joe.postalCode).toBe("78701");
      expect(joe.countryCode).toBe("US");
      expect(joe.rating).toBe(4.6);
      expect(joe.reviewCount).toBe(412);
      expect(joe.lat).toBe(30.27);
      expect(joe.lng).toBe(-97.7416);
      expect(joe.categories).toEqual(["Italian", "Pizza"]);
      expect(joe.category).toBe("Italian");
    });

    it("handles numeric and string aggregateRating values uniformly", () => {
      const items = parseYelpListingHTML(FIXTURE_LISTING_HTML);
      const acme = items.find((b) => b.name === "Acme HVAC")!;
      expect(acme.rating).toBe(4.9);
      expect(acme.reviewCount).toBe(88);
    });

    it("survives a malformed JSON-LD block in the same page", () => {
      // The fixture includes a deliberately broken <script> tag; the
      // parser must skip it without throwing.
      expect(() => parseYelpListingHTML(FIXTURE_LISTING_HTML)).not.toThrow();
    });

    it("ignores non-business JSON-LD types (e.g. WebSite)", () => {
      const items = parseYelpListingHTML(FIXTURE_LISTING_HTML);
      expect(items.find((b) => b.name === "Yelp")).toBeUndefined();
    });

    it("returns [] for HTML with no JSON-LD", () => {
      expect(parseYelpListingHTML("<html><body>no data</body></html>")).toEqual([]);
    });

    it("extracts the Yelp slug as the canonical id", () => {
      const items = parseYelpListingHTML(FIXTURE_LISTING_HTML);
      const ids = items.map((b) => b.yelpId).sort();
      expect(ids).toEqual(["acme-hvac-austin", "joes-pizza-austin"]);
    });
  });

  describe("yelpDirectToLeadInput", () => {
    it("maps a parsed business to the canonical lead-input shape", () => {
      const b: YelpBusiness = {
        yelpId: "joes-pizza-austin",
        name: "Joe's Pizza",
        yelpUrl: "https://www.yelp.com/biz/joes-pizza-austin",
        phone: "(512) 555-0101",
        formattedAddress: "123 Main St, Austin, TX, 78701",
        streetAddress: "123 Main St",
        city: "Austin",
        region: "TX",
        postalCode: "78701",
        countryCode: "US",
        category: "Pizza",
        rating: 4.6,
        reviewCount: 412,
        lat: 30.27,
        lng: -97.7416,
      };
      const lead = yelpDirectToLeadInput(b, "search-1", "restaurant", "Austin, TX");
      expect(lead.searchId).toBe("search-1");
      expect(lead.companyName).toBe("Joe's Pizza");
      expect(lead.placeId).toBe("yelp:joes-pizza-austin");
      expect(lead.sourceUrl).toBe("https://www.yelp.com/biz/joes-pizza-austin");
      expect(lead.industry).toBe("restaurant");
      expect(lead.matchReason).toContain("Yelp (Playwright)");
      expect(lead.matchReason).toContain("4.6★");
      expect(lead.matchReason).toContain("(412 reviews)");
      expect(lead.score).toBeGreaterThanOrEqual(80);
    });

    it("scores rows without rating data lower than rated rows", () => {
      const minimal: YelpBusiness = {
        yelpId: "minimal",
        name: "Minimal Biz",
        yelpUrl: "https://www.yelp.com/biz/minimal",
      };
      const lead = yelpDirectToLeadInput(minimal, "s", undefined, undefined);
      expect(lead.score).toBeLessThan(70);
    });
  });
});
