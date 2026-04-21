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
  {
    label: "Outreach",
    fields: [
      {
        key: "first_line",
        label: "Personalized First Line",
        description: "A one-sentence opener you can paste into an outreach email, DM, or LinkedIn message. References something concrete from the research (recent news, funding, hiring, a new location, tech stack, etc.) and is written in a casual first-person tone. Works best when paired with other enriched fields so the agent has material to reference.",
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
  {
    label: "Outreach",
    fields: [
      {
        key: "first_line",
        label: "Personalized First Line",
        description: "A one-sentence opener you can paste into an outreach email, DM, or LinkedIn message. References something concrete from the research (recent role change, tenure, company news, headline, etc.) and is written in a casual first-person tone. Works best when paired with other enriched fields so the agent has material to reference.",
      },
    ],
  },
];

export const DECISION_MAKER_FIELD_GROUPS: FieldGroup[] = [
  {
    label: "Business",
    fields: [
      {
        key: "business_resolved_name",
        label: "Resolved Business Name",
        description: "The canonical business name the agent identified from the input (disambiguated from any lookalikes).",
      },
      {
        key: "business_location",
        label: "Business Location",
        description: "City, state/region, country where the business physically operates. Infer from Google Business Profile, Facebook page, or website footer.",
      },
      {
        key: "business_category",
        label: "Business Category",
        description: "Short label for what the business does (e.g. Dentist, Pizzeria, Plumber, Boutique Hotel).",
      },
      {
        key: "website_url",
        label: "Website URL",
        description: "Official business website URL.",
      },
    ],
  },
  {
    label: "Decision Maker",
    fields: [
      {
        key: "decision_maker_name",
        label: "Decision Maker Name",
        description: "Full name of the owner, founder, or day-to-day manager (whoever actually makes buying decisions).",
      },
      {
        key: "decision_maker_title",
        label: "Decision Maker Title",
        description: "Role label: Owner / Founder / General Manager / Managing Director / Principal — whatever best fits.",
      },
      {
        key: "decision_maker_source",
        label: "ID Source",
        description: "Which surface revealed this person: LinkedIn, Google Business Profile, Facebook, Website About page, News article, or a combination (e.g. 'LinkedIn + Website').",
      },
      {
        key: "decision_maker_linkedin_url",
        label: "Decision Maker LinkedIn URL",
        description: "Direct URL to the decision maker's personal LinkedIn profile.",
      },
      {
        key: "decision_maker_confidence",
        label: "ID Confidence",
        description: "High / Medium / Low — how confident you are that this person is actually the decision maker (High = named as owner on ≥2 sources; Low = inferred from single weak signal).",
      },
      {
        key: "decision_maker_evidence",
        label: "ID Evidence",
        description: "One sentence explaining WHY you believe this is the decision maker — cite the strongest source (e.g. 'Listed as Owner on Google Business Profile and confirmed via LinkedIn headline').",
      },
    ],
  },
  {
    label: "Contact Channels",
    fields: [
      {
        key: "best_contact_channel",
        label: "Best Contact Channel",
        description: "The single most effective channel to reach this decision maker today. Pick ONE of: LinkedIn DM, Instagram DM, Facebook Messenger, Google Business Message, Business Phone, Business Email, Website Contact Form. Prefer channels with evidence of recent activity.",
      },
      {
        key: "best_contact_value",
        label: "Best Contact Value",
        description: "Actual URL / handle / phone / email for the best contact channel. Must be directly usable (e.g. a LinkedIn profile URL, '@handle', '+1 415-...', or an email address).",
      },
      {
        key: "backup_channels",
        label: "Backup Channels",
        description: "Comma-separated list of other usable channels with their values, e.g. 'Instagram: @joespizza; Phone: +1 415-555-0000; Email: info@joespizza.com'.",
      },
      {
        key: "business_phone",
        label: "Business Phone",
        description: "Main business phone in international format when possible (e.g. +14155551234).",
      },
      {
        key: "business_email",
        label: "Business Email",
        description: "Public contact email found on the website, Google Business Profile, or Facebook. Use 'NA' if only a contact form exists.",
      },
      {
        key: "instagram_handle",
        label: "Instagram Handle",
        description: "Instagram handle including the '@', preferring actively-posted accounts.",
      },
      {
        key: "facebook_page",
        label: "Facebook Page",
        description: "Full URL of the business Facebook page (prefer pages with recent posts).",
      },
      {
        key: "google_business_url",
        label: "Google Business Profile",
        description: "URL to the business's Google Business Profile / Google Maps place — this is where Google Business messaging lives.",
      },
    ],
  },
  {
    label: "Qualification",
    fields: [
      {
        key: "qualification_score",
        label: "Qualification Score",
        description: "Integer 0–100 that reflects how qualified this business is for cold outreach based on your research. This is NOT a fact — it is a judgement rolled up from the sub-scores below.",
      },
      {
        key: "qualification_tier",
        label: "Qualification Tier",
        description: "Letter tier derived from the score: A (80–100), B (60–79), C (40–59), D (0–39).",
      },
      {
        key: "qualification_breakdown",
        label: "Score Breakdown",
        description: "Semicolon-separated sub-scores using the rubric: 'DM Identified: X/25; Reachability: X/25; Digital Presence: X/25; Activity Signal: X/15; Fit: X/10'. Total must equal qualification_score.",
      },
      {
        key: "qualification_rationale",
        label: "Qualification Rationale",
        description: "One or two sentences explaining the score — specifically why it is not higher AND not lower. Ground this in the research, not in guesses.",
      },
    ],
  },
  {
    label: "Outreach",
    fields: [
      {
        key: "first_line",
        label: "Personalized First Line",
        description: "One-sentence cold opener for the best contact channel. References a concrete detail from the research (a recent post, a new location, a review theme, a menu item, a hiring sign) and is written in a casual first-person tone.",
      },
    ],
  },
];

export const COMPANY_FIELDS:         FieldDefinition[] = COMPANY_FIELD_GROUPS.flatMap((g)         => g.fields);
export const PEOPLE_FIELDS:          FieldDefinition[] = PEOPLE_FIELD_GROUPS.flatMap((g)          => g.fields);
export const DECISION_MAKER_FIELDS:  FieldDefinition[] = DECISION_MAKER_FIELD_GROUPS.flatMap((g)  => g.fields);

export type EnrichmentType = "company" | "people" | "decision_maker";

export function getFields(type: EnrichmentType): FieldDefinition[] {
  if (type === "company")        return COMPANY_FIELDS;
  if (type === "people")         return PEOPLE_FIELDS;
  return DECISION_MAKER_FIELDS;
}

export function getFieldGroups(type: EnrichmentType): FieldGroup[] {
  if (type === "company")        return COMPANY_FIELD_GROUPS;
  if (type === "people")         return PEOPLE_FIELD_GROUPS;
  return DECISION_MAKER_FIELD_GROUPS;
}
