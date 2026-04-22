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

export const LEAD_SCORE_FIELD_GROUPS: FieldGroup[] = [
  {
    label: "Company Snapshot",
    fields: [
      { key: "industry",         label: "Industry",          description: "Primary industry or sector (e.g. SaaS, Fintech, Healthcare)" },
      { key: "company_size",     label: "Company Size",      description: "Headcount range (e.g. 10–50, 50–200)" },
      { key: "hq_location",      label: "HQ Location",       description: "City and country of headquarters" },
      { key: "description",      label: "Description",       description: "One-sentence summary of what the company does" },
      { key: "funding_stage",    label: "Funding Stage",     description: "Latest funding round (e.g. Seed, Series A, Public)" },
      { key: "recent_funding_amount", label: "Recent Funding Amount", description: "Amount raised in the most recent funding round" },
      { key: "key_technologies", label: "Key Technologies",  description: "Main tools or tech stack" },
      { key: "linkedin_url",     label: "LinkedIn URL",      description: "Company LinkedIn page URL" },
      { key: "website_url",      label: "Website URL",       description: "Official company website URL" },
    ],
  },
  {
    label: "Lead Score",
    fields: [
      {
        key: "icp_fit_score",
        label: "ICP Fit Score",
        description: "Integer 0–100 scoring how well this company matches the ICP criteria you defined. Not a fact — a judgement grounded in the research.",
      },
      {
        key: "icp_fit_reasoning",
        label: "ICP Fit Reasoning",
        description: "One sentence citing the specific evidence that drove the ICP Fit score (industry, size, geography, stage, segment).",
      },
      {
        key: "pain_signal_score",
        label: "Pain Signal Score",
        description: "Integer 0–100 scoring how strongly the company exhibits pain signals from your rubric — hiring, funding, tech migrations, growth, public complaints, etc.",
      },
      {
        key: "pain_signal_reasoning",
        label: "Pain Signal Reasoning",
        description: "One sentence citing the concrete signal(s) that drove the Pain Signal score, with dates/sources where possible.",
      },
      {
        key: "reachability_score",
        label: "Reachability Score",
        description: "Integer 0–100 scoring how reachable the decision-making layer is — LinkedIn activity, named leaders, public email/phone, accessible social channels.",
      },
      {
        key: "reachability_reasoning",
        label: "Reachability Reasoning",
        description: "One sentence citing the specific channels and signals (named person, active profile, published email, etc.) that drove the Reachability score.",
      },
      {
        key: "total_score",
        label: "Total Score",
        description: "Weighted total 0–100 computed as (ICP × w_icp + Pain × w_pain + Reach × w_reach) / 100, using the weights from the rubric. This is the field you sort by to build the top-N list.",
      },
      {
        key: "priority_tier",
        label: "Priority Tier",
        description: "A (80–100) / B (65–79) / C (45–64) / D (0–44) bucket derived from total_score.",
      },
      {
        key: "score_explanation",
        label: "Explanation",
        description: "Two-sentence plain-English explanation a human SDR can read in five seconds: why this lead scored where it did, and what to do with it (prioritise / keep warm / skip).",
      },
    ],
  },
  {
    label: "Outreach",
    fields: [
      {
        key: "first_line",
        label: "Personalized First Line",
        description: "A one-sentence opener you can paste into an outreach email, DM, or LinkedIn message. References something concrete from the research (recent news, funding, hiring, tech stack, etc.) in a casual first-person tone.",
      },
    ],
  },
];

export const BUYING_TRIGGER_FIELD_GROUPS: FieldGroup[] = [
  {
    label: "Company Snapshot",
    fields: [
      { key: "industry",     label: "Industry",     description: "Primary industry or sector (e.g. Home Services, SaaS, Boutique Retail, Healthcare)" },
      { key: "company_size", label: "Company Size", description: "Headcount range (e.g. 1–10, 10–50, 50–200)" },
      { key: "hq_location",  label: "HQ Location",  description: "City and country of the primary location" },
      { key: "website_url",  label: "Website URL",  description: "Official company website URL" },
    ],
  },
  {
    label: "Buying Triggers",
    fields: [
      {
        key: "marketing_hire",
        label: "Marketing Role Opened",
        description: "Is the company actively hiring for a marketing role (Marketing Manager, Growth Marketer, Demand Gen, Head of Marketing, CMO, Social Media Manager, etc.) in the last 90 days? Check LinkedIn Jobs, Indeed, their /careers page. If yes, return: '[Role Title] — posted [date] — [source URL]'. Otherwise 'NA'.",
      },
      {
        key: "sales_hire",
        label: "Sales Role Opened",
        description: "Is the company actively hiring SDRs / AEs / VP Sales / Head of Sales in the last 90 days? Check LinkedIn Jobs, Indeed, their /careers page. Format: '[Role Title] — posted [date] — [source URL]'. Otherwise 'NA'.",
      },
      {
        key: "running_paid_ads",
        label: "Running Paid Ads (30d)",
        description: "Evidence the company is currently running Google Ads or Meta ads in the last 30 days. Check the Google Ads Transparency Center (adstransparency.google.com) and the Meta Ads Library (facebook.com/ads/library). If active, return: '[Platform] — [what they're advertising] — [source URL]'. Otherwise 'NA'. This is a strong buying signal because an active ad spend means they already have budget for growth.",
      },
      {
        key: "capacity_complaint",
        label: "\"Too Busy\" / Capacity Post",
        description: "Any recent (last 90 days) public social post on Facebook, LinkedIn, Instagram, or Twitter/X where the owner / founder / an employee complains about being slammed, overwhelmed, understaffed, or turning customers away. This is the strongest buying trigger — they are actively feeling pain. Format: '\"[quoted snippet]\" — [author name] — [date] — [source URL]'. Otherwise 'NA'.",
      },
      {
        key: "new_location",
        label: "New Location / Expansion",
        description: "Did the company open a new office, branch, storefront, or expand to a new city / region in the last 6 months? Check their website, press releases, local news, LinkedIn posts. Format: '[New city or location] — announced [date] — [source URL]'. Otherwise 'NA'.",
      },
      {
        key: "funding_round",
        label: "Recent Funding Round",
        description: "Did the company close a funding round, grant, or significant investment in the last 12 months? Check Crunchbase, TechCrunch, SEC filings, company blog. Format: '[Amount] [Stage] — closed [date] — [source URL]'. Otherwise 'NA'.",
      },
      {
        key: "leadership_change",
        label: "New Marketing / Sales Leader",
        description: "Was a new CMO, VP Marketing, Head of Growth, VP Sales, or RevOps leader hired in the last 6 months? Check LinkedIn announcements, press releases. New leaders reshape budgets in their first 90 days — strong trigger. Format: '[Name] — [Title] — started [date] — [source URL]'. Otherwise 'NA'.",
      },
      {
        key: "product_launch",
        label: "Product Launch / Rebrand",
        description: "Major product launch, new service line, or public rebrand in the last 6 months? Check company blog, press, LinkedIn, ProductHunt. Format: '[What was launched] — [date] — [source URL]'. Otherwise 'NA'.",
      },
    ],
  },
  {
    label: "Heat Score",
    fields: [
      {
        key: "trigger_count",
        label: "Triggers Detected",
        description: "Integer count of how many of the Buying Trigger fields above came back with real evidence (not 'NA'). This is a fact derived from the fields above, not a judgement.",
      },
      {
        key: "strongest_trigger",
        label: "Strongest Trigger",
        description: "The single trigger field key that represents the most actionable signal (e.g. 'capacity_complaint', 'running_paid_ads', 'marketing_hire'). Pick the one that most clearly implies budget + urgency. If no triggers fired, return 'none'.",
      },
      {
        key: "trigger_summary",
        label: "Trigger Summary",
        description: "One sentence (max ~30 words) a human SDR can read in three seconds that names the 1–3 most actionable triggers with dates. Example: 'Hired a CMO 4 weeks ago, posted a Facebook rant about being slammed 12 days ago, and has been running Google Ads for kitchen remodels since March.'",
      },
      {
        key: "heat_score",
        label: "Heat Score",
        description: "Integer 0–100 that reflects how hot this lead is RIGHT NOW based on the triggers detected. Rubric — 90–100: multiple strong, recent triggers including budget + pain (e.g. funding + marketing hire + active ads). 70–89: one strong very recent trigger OR two moderate ones. 50–69: one moderate trigger. 30–49: weak or stale signals only. 0–29: no visible triggers.",
      },
      {
        key: "heat_tier",
        label: "Heat Tier",
        description: "Letter tier derived from heat_score: A (80–100) / B (65–79) / C (45–64) / D (0–44). Used to sort and prioritise the list.",
      },
      {
        key: "recommended_action",
        label: "Recommended Action",
        description: "ONE of: 'Reach out today' / 'Reach out this week' / 'Nurture' / 'Skip'. Based on heat_tier: A → today, B → this week, C → nurture, D → skip. Bias towards 'Reach out today' when the trigger involves active ads or a capacity complaint within the last 30 days.",
      },
    ],
  },
  {
    label: "Outreach",
    fields: [
      {
        key: "outreach_angle",
        label: "Outreach Angle",
        description: "One sentence explaining HOW to position your pitch given the strongest trigger. Not the opener — the angle. Example: 'They just hired a Marketing Manager who will need reporting tooling in their first 30 days — lead with time-to-insight and show the Marketing Manager dashboard.' Ground this in the specific trigger you found.",
      },
      {
        key: "first_line",
        label: "Personalized First Line",
        description: "One-sentence opener (max ~25 words) to paste as the first line after the greeting. MUST reference the strongest trigger concretely — the role they posted, the ad they're running, the Facebook post they made, the location they opened. Casual first person, no pitch, no 'I noticed…' clichés. If no trigger fired, return 'NA' rather than a generic line.",
      },
    ],
  },
];

export const MULTI_CHANNEL_FIELD_GROUPS: FieldGroup[] = [
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
        description: "City, state/region, country where the business physically operates.",
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
      {
        key: "google_business_profile_url",
        label: "Google Business Profile",
        description: "URL to the business's Google Business Profile / Google Maps place. Identifier and trust signal only — Google removed Business Profile chat on 2024-07-31, so this is NOT a reachable messaging channel.",
      },
      {
        key: "website_contact_form_url",
        label: "Website Contact Form URL",
        description: "Direct URL to the website contact form if present (e.g. /contact, /get-a-quote). 'NA' if only mailto or phone are offered.",
      },
    ],
  },
  {
    label: "Owner",
    fields: [
      {
        key: "owner_name",
        label: "Owner / Decision Maker Name",
        description: "Full name of the owner, founder, or day-to-day manager (whoever actually makes buying decisions). 'NA' if cannot identify with reasonable confidence.",
      },
      {
        key: "owner_title",
        label: "Owner Title",
        description: "Role label: Owner / Founder / General Manager / Principal — whatever best fits.",
      },
      {
        key: "owner_confidence",
        label: "Owner ID Confidence",
        description: "High / Medium / Low — how confident you are that this person is actually the decision maker (High = confirmed by ≥2 sources; Low = inferred from single weak signal).",
      },
      {
        key: "owner_evidence",
        label: "Owner ID Evidence",
        description: "One sentence explaining WHY you believe this is the decision maker — cite the strongest source.",
      },
    ],
  },
  {
    label: "Contact Channels",
    fields: [
      {
        key: "channels",
        label: "Ranked Contact Channels",
        description: "A ranked array of reachable contact channels with deliverability, recency, compliance labels, and per-channel first-line openers. This is the primary output — see the Contact Channel Playbook in the system prompt for the structure and rules.",
      },
    ],
  },
];

export const COMPANY_FIELDS:         FieldDefinition[] = COMPANY_FIELD_GROUPS.flatMap((g)         => g.fields);
export const PEOPLE_FIELDS:          FieldDefinition[] = PEOPLE_FIELD_GROUPS.flatMap((g)          => g.fields);
export const DECISION_MAKER_FIELDS:  FieldDefinition[] = DECISION_MAKER_FIELD_GROUPS.flatMap((g)  => g.fields);
export const LEAD_SCORE_FIELDS:      FieldDefinition[] = LEAD_SCORE_FIELD_GROUPS.flatMap((g)      => g.fields);
export const BUYING_TRIGGER_FIELDS:  FieldDefinition[] = BUYING_TRIGGER_FIELD_GROUPS.flatMap((g)  => g.fields);
export const MULTI_CHANNEL_FIELDS:   FieldDefinition[] = MULTI_CHANNEL_FIELD_GROUPS.flatMap((g)   => g.fields);

export const LEAD_SCORE_REQUIRED_FIELDS: string[] = [
  "icp_fit_score",
  "icp_fit_reasoning",
  "pain_signal_score",
  "pain_signal_reasoning",
  "reachability_score",
  "reachability_reasoning",
  "total_score",
  "priority_tier",
  "score_explanation",
];

// Heat-score + outreach are the whole point of the buying-trigger job — always
// produce them so the results table can sort and the SDR has an opener.
export const BUYING_TRIGGER_REQUIRED_FIELDS: string[] = [
  "trigger_count",
  "strongest_trigger",
  "trigger_summary",
  "heat_score",
  "heat_tier",
  "recommended_action",
  "outreach_angle",
  "first_line",
];

// The trigger-signal field keys in canonical order. Used by the scoring
// reconciler to count how many triggers actually fired.
export const BUYING_TRIGGER_SIGNAL_FIELDS: string[] = [
  "marketing_hire",
  "sales_hire",
  "running_paid_ads",
  "capacity_complaint",
  "new_location",
  "funding_round",
  "leadership_change",
  "product_launch",
];

// Multi-channel jobs must always produce the structured channels output and
// the owner identification block — that IS the product. If the caller forgets
// to include them, the API adds them.
export const MULTI_CHANNEL_REQUIRED_FIELDS: string[] = [
  "business_resolved_name",
  "owner_name",
  "owner_confidence",
  "channels",
];

export type EnrichmentType =
  | "company"
  | "people"
  | "decision_maker"
  | "lead_score"
  | "buying_trigger"
  | "multi_channel";

export function getFields(type: EnrichmentType): FieldDefinition[] {
  if (type === "company")         return COMPANY_FIELDS;
  if (type === "people")          return PEOPLE_FIELDS;
  if (type === "decision_maker")  return DECISION_MAKER_FIELDS;
  if (type === "lead_score")      return LEAD_SCORE_FIELDS;
  if (type === "buying_trigger")  return BUYING_TRIGGER_FIELDS;
  return MULTI_CHANNEL_FIELDS;
}

export function getFieldGroups(type: EnrichmentType): FieldGroup[] {
  if (type === "company")         return COMPANY_FIELD_GROUPS;
  if (type === "people")          return PEOPLE_FIELD_GROUPS;
  if (type === "decision_maker")  return DECISION_MAKER_FIELD_GROUPS;
  if (type === "lead_score")      return LEAD_SCORE_FIELD_GROUPS;
  if (type === "buying_trigger")  return BUYING_TRIGGER_FIELD_GROUPS;
  return MULTI_CHANNEL_FIELD_GROUPS;
}
