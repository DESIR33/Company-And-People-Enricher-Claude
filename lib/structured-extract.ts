// Deterministic structured extraction path for "company" enrichment.
//
// When every requested field is present on a single known URL, we can skip
// the agent entirely and fetch the data via Firecrawl's /v1/extract endpoint.
// Extract runs a schema-constrained LLM pass inside Firecrawl against the
// scraped page and returns a typed JSON object — no web reasoning, no tool
// loops, no agent drift. Typical cost: 5 credits per URL (≈ $0.005 at the
// default rate) vs. ~$0.01–0.05 for a full agent run.
//
// We fall back to the agent whenever:
//   - Firecrawl is not configured.
//   - The identifier is not a fetchable HTTPS URL (e.g. a LinkedIn URL —
//     Firecrawl will fetch it but LinkedIn walls most of the useful data).
//   - Any requested field is outside the structured-extract allowlist
//     (news, first_line, custom fields, scoring fields, etc.).
//   - The /v1/extract call times out or returns no data.

import * as firecrawl from "./firecrawl";
import type { EnrichmentType } from "./enrichment-fields";

// Fields we trust a single-URL structured extract to populate. These all
// describe attributes typically surfaced on a company's own homepage, About
// page, or footer. Fields that require cross-site reasoning (funding, news,
// tech stack inferred from job posts, first_line, any scoring) are
// deliberately excluded — they need the agent.
const EXTRACTABLE_COMPANY_FIELDS: Record<
  string,
  { description: string }
> = {
  industry: {
    description:
      "Primary industry or sector (e.g. SaaS, Fintech, Healthcare, Home Services). 'NA' if unclear from the page.",
  },
  company_size: {
    description:
      "Headcount range as shown on the site (e.g. '10-50', '50-200'). 'NA' if not stated.",
  },
  hq_location: {
    description:
      "City and country of headquarters (or primary business location). 'NA' if not stated.",
  },
  description: {
    description:
      "One-sentence summary of what the company does, drawn from the hero or About section.",
  },
  linkedin_url: {
    description:
      "Company LinkedIn page URL found on the site (typically in the footer). 'NA' if not present.",
  },
  website_url: {
    description:
      "Official company website URL. Use the canonical domain of the page being extracted.",
  },
  business_phone: {
    description:
      "Main business phone number in E.164 format when possible. 'NA' if not published.",
  },
  instagram_handle: {
    description:
      "Instagram handle including the leading '@'. 'NA' if not present on the site.",
  },
  facebook_page: {
    description:
      "Full URL to the company Facebook page. 'NA' if not linked from the site.",
  },
  google_business_url: {
    description:
      "URL to the company's Google Business Profile / Google Maps place page. 'NA' if not linked.",
  },
  years_in_business: {
    description:
      "How long the business has been operating. Prefer an integer year count ('14') or an 'Est. YYYY' value copied from the site. 'NA' if not stated.",
  },
  google_rating: {
    description:
      "Star rating shown on the site or embedded Google widget (e.g. '4.7'). 'NA' if not displayed.",
  },
  review_count: {
    description:
      "Number of Google reviews cited on the site (e.g. '312'). 'NA' if not displayed.",
  },
  service_area: {
    description:
      "Cities, ZIPs, or mile radius the business serves as stated on the site. 'NA' if not stated.",
  },
  service_categories: {
    description:
      "Services offered, comma-separated, drawn from the /services page or homepage (e.g. 'AC repair, HVAC install, duct cleaning').",
  },
};

export function isStructuredExtractableField(fieldKey: string): boolean {
  return fieldKey in EXTRACTABLE_COMPANY_FIELDS;
}

// Only the company flow is routed through structured extract today. Other
// job types (people / decision_maker / lead_score / buying_trigger /
// multi_channel) all require cross-site reasoning or scoring rollups.
export function supportsStructuredExtract(type: EnrichmentType): boolean {
  return type === "company";
}

function isExtractableUrl(identifier: string): string | null {
  const trimmed = identifier.trim();
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  const host = url.hostname.toLowerCase();
  // LinkedIn walls every useful surface; skip it so we fall through to the
  // agent which has LinkedIn-specific playbooks.
  if (host.endsWith("linkedin.com")) return null;
  return url.toString();
}

export type StructuredExtractResult = {
  fields: Record<string, string>;
  costUsd: number;
  credits: number;
};

// Attempt a deterministic structured extract. Returns null when the caller
// should fall back to the agent path (not configured, wrong identifier,
// unsupported fields, timeout, or empty response).
export async function tryStructuredExtract(params: {
  type: EnrichmentType;
  identifier: string;
  requestedFields: string[];
  hasCustomFields: boolean;
  signal?: AbortSignal;
}): Promise<StructuredExtractResult | null> {
  if (!firecrawl.isConfigured()) return null;
  if (!supportsStructuredExtract(params.type)) return null;
  if (params.hasCustomFields) return null;
  if (params.requestedFields.length === 0) return null;
  if (!params.requestedFields.every(isStructuredExtractableField)) return null;

  const url = isExtractableUrl(params.identifier);
  if (!url) return null;

  const properties: Record<string, { type: string; description: string }> = {};
  for (const key of params.requestedFields) {
    properties[key] = {
      type: "string",
      description: EXTRACTABLE_COMPANY_FIELDS[key].description,
    };
  }

  const prompt =
    "Extract the requested fields from the company's website. Return 'NA' for any field you cannot find on the page — never invent values.";

  const outcome = await firecrawl.extract(url, {
    type: "object",
    properties,
    required: params.requestedFields,
  }, {
    prompt,
    signal: params.signal,
  });

  if (!outcome.data) {
    return null;
  }

  const fields: Record<string, string> = {};
  for (const key of params.requestedFields) {
    const raw = outcome.data[key];
    fields[key] = normaliseExtractedValue(raw);
  }
  return {
    fields,
    costUsd: outcome.cost.costUsd,
    credits: outcome.cost.credits,
  };
}

function normaliseExtractedValue(raw: unknown): string {
  if (raw === null || raw === undefined) return "";
  if (typeof raw === "string") return raw;
  if (typeof raw === "number" || typeof raw === "boolean") return String(raw);
  try {
    return JSON.stringify(raw);
  } catch {
    return "";
  }
}
