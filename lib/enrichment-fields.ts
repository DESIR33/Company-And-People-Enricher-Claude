export type FieldDefinition = {
  key: string;
  label: string;
  description: string;
  requiresProspeo?: boolean;
  isParameterized?: boolean;
};

export type FieldGroup = {
  label: string;
  fields: FieldDefinition[];
};

export const COMPANY_FIELD_GROUPS: FieldGroup[] = [
  {
    label: "Company Profile",
    fields: [
      { key: "industry",     label: "Industry",     description: "Primary industry or sector (e.g. SaaS, Fintech, Healthcare)" },
      { key: "company_size", label: "Company Size",  description: "Headcount range (e.g. 10–50, 50–200)" },
      { key: "hq_location",  label: "HQ Location",  description: "City and country of headquarters" },
      { key: "description",  label: "Description",  description: "One-sentence summary of what the company does" },
    ],
  },
  {
    label: "Financials & Stage",
    fields: [
      { key: "revenue_estimate", label: "Revenue Estimate", description: "Estimated annual revenue range (e.g. $1M–$10M)" },
      { key: "funding_stage",    label: "Funding Stage",    description: "Latest funding round (e.g. Seed, Series A, Public)" },
      { key: "funding_amount",        label: "Total Funding Amount",  description: "Total cumulative funding raised to date (e.g. $5M, $50M, $1.2B)" },
      { key: "recent_funding_amount", label: "Recent Funding Amount", description: "Amount raised in the most recent funding round (e.g. $10M Series A)" },
    ],
  },
  {
    label: "Tech & Web",
    fields: [
      { key: "key_technologies", label: "Key Technologies", description: "Main tools or tech stack (e.g. Salesforce, AWS, React)" },
      { key: "linkedin_url",     label: "LinkedIn URL",     description: "Company LinkedIn page URL" },
      { key: "website_url",      label: "Website URL",      description: "Official company website URL" },
    ],
  },
  {
    label: "Contact Channels",
    fields: [
      {
        key: "business_phone",
        label: "Business Phone",
        description: "Main business phone number in international format when possible (e.g. +14155551234 or (415) 555-1234). Prefer the number published on the company's website or Google Business Profile.",
      },
      {
        key: "instagram_handle",
        label: "Instagram Handle",
        description: "Instagram handle the business actively uses, including the leading @ (e.g. @stripe). Prefer accounts with recent posts; skip abandoned profiles.",
      },
      {
        key: "facebook_page",
        label: "Facebook Page",
        description: "Full URL to the company's Facebook business page (e.g. https://facebook.com/Stripe). Prefer pages with recent posts over inactive duplicates.",
      },
      {
        key: "google_business_url",
        label: "Google Business Profile",
        description: "URL to the company's Google Business Profile (Google Maps place URL, e.g. https://maps.google.com/?cid=... or a goo.gl/maps share link). This is the surface where Google Business messaging lives.",
      },
    ],
  },
  {
    label: "News & Activity",
    fields: [
      {
        key: "recent_news",
        label: "Recent Company News",
        description: "Latest news articles about the company — configure count and time frame",
        isParameterized: true,
      },
    ],
  },
];

export const PEOPLE_FIELD_GROUPS: FieldGroup[] = [
  {
    label: "Identity",
    fields: [
      { key: "job_title",       label: "Job Title",       description: "Current role at their company" },
      { key: "current_company", label: "Current Company", description: "Company they currently work at" },
      { key: "seniority_level", label: "Seniority Level", description: "Inferred from title: Junior / Senior / Manager / Director / VP / C-Suite" },
    ],
  },
  {
    label: "Contact",
    fields: [
      {
        key: "work_email",
        label: "Work Email",
        description: "Professional email address — found via Prospeo.io (requires PROSPEO_API_KEY in .env.local)",
        requiresProspeo: true,
      },
      { key: "linkedin_url",      label: "LinkedIn URL",      description: "LinkedIn profile URL" },
      { key: "linkedin_headline", label: "LinkedIn Headline", description: "Headline text from their LinkedIn profile" },
      { key: "location",          label: "Location",          description: "City and country where they are based" },
    ],
  },
];

export const COMPANY_FIELDS: FieldDefinition[] = COMPANY_FIELD_GROUPS.flatMap((g) => g.fields);
export const PEOPLE_FIELDS:  FieldDefinition[] = PEOPLE_FIELD_GROUPS.flatMap((g)  => g.fields);

export function getFields(type: "company" | "people"): FieldDefinition[] {
  return type === "company" ? COMPANY_FIELDS : PEOPLE_FIELDS;
}

export function getFieldGroups(type: "company" | "people"): FieldGroup[] {
  return type === "company" ? COMPANY_FIELD_GROUPS : PEOPLE_FIELD_GROUPS;
}
