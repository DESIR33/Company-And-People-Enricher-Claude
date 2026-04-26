// Tech-stack detector.
//
// Phase 4 — for an SMB lead, knowing the tools they're using is one of
// the highest-signal pieces of context for outreach: "you run on
// Shopify Plus and use Klaviyo for email" tells you who the buyer
// is, what their pain points likely are, and what the pitch should
// look like. Free APIs for this don't exist (BuiltWith/Wappalyzer are
// paid), so we run a small fingerprint library against the site's
// HTML + response headers ourselves.
//
// Approach:
//   - Fetch the site root with a realistic user-agent and follow
//     redirects (so apex → www works).
//   - Match HTML and headers against a curated fingerprint set.
//     Each fingerprint is a (tech, regex, scope) triple — scope is
//     either "html", "header:<name>", or "url".
//   - Return the deduped list of matched tech names.
//
// Pure parsing is exposed separately as `detectTechFromResponse` so
// tests don't need network. The integration entrypoint is
// `detectTechStack(websiteUrl)`.

const FETCH_TIMEOUT_MS = 8_000;
const REQUEST_UA =
  "Mozilla/5.0 (compatible; LeadDiscoveryBot/1.0; +https://hustlinglabs.com)";

export type TechFingerprint = {
  tech: string;
  // Source-of-truth regex applied against `target` text.
  pattern: RegExp;
  // What part of the response to match against.
  target: "html" | "url" | { header: string };
};

// Curated fingerprint library, biased toward tools that appear on SMB
// websites and matter for outreach context. Order is irrelevant — we
// dedupe by tech name. New fingerprints can be appended freely.
//
// Note on regex authoring: keep them tight — false positives clutter
// the lead profile. Prefer matching script src URLs, well-known
// header names, or unambiguous CSS classes over generic terms.
export const TECH_FINGERPRINTS: TechFingerprint[] = [
  // CMS / site builders
  { tech: "Shopify", pattern: /cdn\.shopify\.com/i, target: "html" },
  { tech: "Shopify", pattern: /shopify\.com/i, target: { header: "x-shopify-stage" } },
  { tech: "Shopify Plus", pattern: /shopify-plus/i, target: "html" },
  { tech: "WordPress", pattern: /\/wp-content\//i, target: "html" },
  { tech: "WordPress", pattern: /\/wp-json\//i, target: "html" },
  { tech: "WooCommerce", pattern: /woocommerce/i, target: "html" },
  { tech: "Wix", pattern: /\.wixsite\.com|wix\.com/i, target: "html" },
  { tech: "Wix", pattern: /.+/, target: { header: "x-wix-request-id" } },
  { tech: "Squarespace", pattern: /static1\.squarespace\.com|squarespace-cdn/i, target: "html" },
  { tech: "Squarespace", pattern: /Squarespace/i, target: { header: "server" } },
  { tech: "Webflow", pattern: /assets\.website-files\.com|webflow\.com\/js/i, target: "html" },
  { tech: "BigCommerce", pattern: /cdn\.bcapp\.dev|cdn11\.bigcommerce\.com/i, target: "html" },
  { tech: "Square Online", pattern: /square-web-payments-sdk|squarecdn\.com/i, target: "html" },
  { tech: "GoDaddy Website Builder", pattern: /img1\.wsimg\.com/i, target: "html" },
  { tech: "Duda", pattern: /dudamobile|dudaone|duda\.co/i, target: "html" },
  { tech: "Ghost", pattern: /ghost(?:\.io|-sdk)/i, target: "html" },

  // Frameworks / hosts
  { tech: "Next.js", pattern: /__next/i, target: "html" },
  { tech: "Next.js", pattern: /.+/, target: { header: "x-nextjs-cache" } },
  { tech: "React", pattern: /\bdata-reactroot\b/i, target: "html" },
  { tech: "Gatsby", pattern: /___gatsby/i, target: "html" },
  { tech: "Vercel", pattern: /.+/, target: { header: "x-vercel-id" } },
  { tech: "Netlify", pattern: /Netlify/i, target: { header: "server" } },
  { tech: "Cloudflare", pattern: /.+/, target: { header: "cf-ray" } },
  { tech: "AWS CloudFront", pattern: /.+/, target: { header: "x-amz-cf-id" } },

  // Payments
  { tech: "Stripe", pattern: /js\.stripe\.com/i, target: "html" },
  { tech: "Square", pattern: /squareup\.com|web\.squarecdn\.com/i, target: "html" },
  { tech: "PayPal", pattern: /paypal\.com\/sdk\/js/i, target: "html" },

  // Booking / scheduling
  { tech: "Calendly", pattern: /assets\.calendly\.com|calendly\.com\/widget/i, target: "html" },
  { tech: "Acuity Scheduling", pattern: /acuityscheduling\.com|squarespacescheduling\.com/i, target: "html" },
  { tech: "Mindbody", pattern: /mindbodyonline\.com|mindbody\.io/i, target: "html" },
  { tech: "OpenTable", pattern: /opentable\.com\/widget/i, target: "html" },
  { tech: "Resy", pattern: /widgets\.resy\.com|resy\.com\/widget/i, target: "html" },
  { tech: "Toast", pattern: /toasttab\.com/i, target: "html" },

  // CRM / email / chat
  { tech: "HubSpot", pattern: /js\.hs-scripts\.com|js\.hsforms\.net/i, target: "html" },
  { tech: "Mailchimp", pattern: /chimpstatic\.com|list-manage\.com/i, target: "html" },
  { tech: "Klaviyo", pattern: /static\.klaviyo\.com|klaviyo\.com\/onsite/i, target: "html" },
  { tech: "ActiveCampaign", pattern: /activehosted\.com\/f\/embed/i, target: "html" },
  { tech: "Constant Contact", pattern: /static\.ctctcdn\.com/i, target: "html" },
  { tech: "Intercom", pattern: /widget\.intercom\.io/i, target: "html" },
  { tech: "Drift", pattern: /js\.driftt\.com|js\.drift\.com/i, target: "html" },
  { tech: "Zendesk", pattern: /static\.zdassets\.com|zopim\.com/i, target: "html" },
  { tech: "Tawk.to", pattern: /embed\.tawk\.to/i, target: "html" },
  { tech: "Crisp", pattern: /client\.crisp\.chat/i, target: "html" },

  // Analytics / pixels
  { tech: "Google Analytics", pattern: /www\.googletagmanager\.com\/gtag\/js|google-analytics\.com\/(?:ga|analytics)\.js/i, target: "html" },
  { tech: "Google Tag Manager", pattern: /www\.googletagmanager\.com\/gtm\.js/i, target: "html" },
  { tech: "Meta Pixel", pattern: /connect\.facebook\.net/i, target: "html" },
  { tech: "TikTok Pixel", pattern: /analytics\.tiktok\.com/i, target: "html" },
  { tech: "Pinterest Tag", pattern: /pintrk\(|s\.pinimg\.com\/ct/i, target: "html" },
  { tech: "Hotjar", pattern: /static\.hotjar\.com/i, target: "html" },
  { tech: "Mixpanel", pattern: /cdn\.mxpnl\.com|api\.mixpanel\.com/i, target: "html" },
  { tech: "Segment", pattern: /cdn\.segment\.com|cdn\.segmentapis\.com/i, target: "html" },
];

export type DetectInput = {
  html: string;
  url?: string;
  headers?: Record<string, string>;
};

export function detectTechFromResponse(input: DetectInput): string[] {
  const found = new Set<string>();
  for (const fp of TECH_FINGERPRINTS) {
    if (found.has(fp.tech)) continue;
    if (fp.target === "html") {
      if (fp.pattern.test(input.html)) found.add(fp.tech);
    } else if (fp.target === "url") {
      if (input.url && fp.pattern.test(input.url)) found.add(fp.tech);
    } else {
      const headerName = fp.target.header.toLowerCase();
      const value = input.headers?.[headerName];
      if (value !== undefined && fp.pattern.test(value)) found.add(fp.tech);
    }
  }
  return Array.from(found).sort();
}

export async function detectTechStack(websiteUrl: string): Promise<string[]> {
  const url = normaliseUrl(websiteUrl);
  if (!url) return [];

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent": REQUEST_UA,
        Accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
      signal: controller.signal,
    });
    if (!res.ok) return [];
    const html = await res.text();
    const headers: Record<string, string> = {};
    res.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });
    return detectTechFromResponse({ html, url: res.url, headers });
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

function normaliseUrl(raw?: string): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}
