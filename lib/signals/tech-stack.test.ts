import { describe, expect, it } from "vitest";
import { detectTechFromResponse } from "./tech-stack";

describe("detectTechFromResponse", () => {
  it("identifies a Shopify storefront via cdn.shopify.com in HTML", () => {
    const html = `<script src="//cdn.shopify.com/s/files/1/0001/0001/t/1/assets/theme.js"></script>`;
    expect(detectTechFromResponse({ html })).toContain("Shopify");
  });

  it("identifies WordPress + WooCommerce together", () => {
    const html = `
      <link rel="stylesheet" href="/wp-content/themes/foo/style.css">
      <script>window.wc_cart_fragments_params = {};</script>
      <body class="woocommerce-cart">
    `;
    const detected = detectTechFromResponse({ html });
    expect(detected).toEqual(expect.arrayContaining(["WordPress", "WooCommerce"]));
  });

  it("matches Cloudflare via the cf-ray response header", () => {
    const detected = detectTechFromResponse({
      html: "<html></html>",
      headers: { "cf-ray": "abc123-DFW" },
    });
    expect(detected).toContain("Cloudflare");
  });

  it("matches Vercel via x-vercel-id header even with empty body", () => {
    expect(
      detectTechFromResponse({
        html: "",
        headers: { "x-vercel-id": "iad1::xyz" },
      })
    ).toContain("Vercel");
  });

  it("identifies Stripe + Calendly + Klaviyo on a typical SMB landing page", () => {
    const html = `
      <script src="https://js.stripe.com/v3/"></script>
      <script src="https://assets.calendly.com/assets/external/widget.js"></script>
      <script async src="https://static.klaviyo.com/onsite/js/klaviyo.js?company_id=ABC"></script>
    `;
    const detected = detectTechFromResponse({ html });
    expect(detected).toEqual(
      expect.arrayContaining(["Stripe", "Calendly", "Klaviyo"])
    );
  });

  it("dedupes — Shopify only appears once even when matched by HTML and header", () => {
    const detected = detectTechFromResponse({
      html: `<link href="https://cdn.shopify.com/s/files/foo.css">`,
      headers: { "x-shopify-stage": "production" },
    });
    expect(detected.filter((t) => t === "Shopify")).toHaveLength(1);
  });

  it("returns empty array for HTML with no known fingerprints", () => {
    expect(
      detectTechFromResponse({ html: "<html><body>just text</body></html>" })
    ).toEqual([]);
  });

  it("does not match Shopify on a generic mention of the word", () => {
    // The tightened regex requires the cdn host, not just the word.
    const html = "Our team competes with shopify and other platforms.";
    expect(detectTechFromResponse({ html })).not.toContain("Shopify");
  });

  it("returns sorted output for stable test assertions", () => {
    const html = `
      <script src="https://js.stripe.com/v3/"></script>
      <script src="//cdn.shopify.com/s/foo.js"></script>
      <link rel="stylesheet" href="/wp-content/foo.css">
    `;
    const detected = detectTechFromResponse({ html });
    const sorted = [...detected].sort();
    expect(detected).toEqual(sorted);
  });
});
