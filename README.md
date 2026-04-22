# Company & People Enricher Agent

> **This project shows you the power of what AI tools and workflows can do for a business.**
>
> You can fork this project and link all the internal tools you use for your GTM (Sales & Marketing) needs. After helping Fortune 100 clients alongside top SaaS companies like Rocketlane, SARAL, and top agencies like Teknicks & The Kiln with AI workflows and systems, I've seen firsthand how these systems transform GTM and other business operations by cutting time from hours to seconds, eliminating manual data entry, and freeing teams to focus on what actually moves the needle: building relationships and closing deals. What used to take a full-time SDR a week can now run overnight, automatically, at a fraction of the cost.
>
> Fork this. Adapt it. Connect it to your CRM, other enrichment tools, outreach tools, and data sources. The compounding effect of even one well-built AI system is hard to overstate.

---

An open-source AI-powered enrichment tool that takes a CSV of companies or people and automatically fills in missing data — industry, funding, tech stack, LinkedIn URLs, job titles, recent news, and more — using Claude AI.

Built with [Next.js](https://nextjs.org) and the [Anthropic Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk).

---

## What It Does

Upload a CSV, pick what fields you want enriched, and the agent does the research for you — in parallel, across up to 15 rows at once.

**Company enrichment** finds:
- Industry & company description
- Company size (headcount range)
- HQ location
- Revenue estimate & funding stage
- Total funding amount & most recent funding round amount
- Key technologies used
- LinkedIn URL & website URL
- **Contact channels**: business phone, Instagram handle, Facebook page, Google Business Profile URL — useful for local-business outreach where DMs and Google Business messaging outperform cold email
- Recent company news (configurable count + time frame)
- **Personalized first line** — a one-sentence opener grounded in the other research, ready to paste into a cold email or DM. Optional **outreach context** field lets you tell the agent what you're selling so the opener leans the right way without becoming a pitch.
- Any custom fields you define

**People enrichment** finds:
- Job title & current company
- Seniority level (inferred from title)
- LinkedIn headline & LinkedIn URL
- Location
- Work email *(via Prospeo.io — optional)*
- **Personalized first line** — a one-sentence opener grounded in their role, tenure, and recent activity. Same optional outreach-context field as on the company side.
- Any custom fields you define

**Buying Triggers** (`/enrich/buying_trigger`) detects fresh signals that a company
is in-market *right now* and hands you the outreach copy to act on them:

- **Trigger signals** (configurable which ones to hunt for) — marketing-role hire,
  sales-role hire, active Google/Meta ads in the last 30 days, "too busy" /
  capacity complaint posts on Facebook / LinkedIn, new location or expansion,
  recent funding round, new CMO / VP Marketing / Head of Growth, product launch
  or rebrand. Each signal comes back with a dated quote and a source URL — or
  `NA` if nothing was found.
- **Heat rollup** — Trigger Count, Strongest Trigger, one-line Trigger Summary,
  Heat Score (0–100), Heat Tier (A/B/C/D), and a Recommended Action (*Reach out
  today* / *Reach out this week* / *Nurture* / *Skip*). The results table
  auto-sorts by Heat Score so your top 50 bubbles to the top.
- **Outreach payload** — an **Outreach Angle** (one sentence on how to
  position your pitch given the strongest trigger) and a **Personalized First
  Line** that references the specific signal (the role they posted, the ad
  they're running, the Facebook rant, the new location). Both are *always*
  included — triggers without outreach copy are just data, and this view is
  built for SDRs who need to send the message today.

The optional **Outreach context** field tells the agent what you're selling so
the angle and first line lean toward your offer without turning into a pitch.

---

## Multi-Channel — reach local businesses where they actually answer

**Multi-Channel** (`/enrich/multi_channel`) is built for **cold outreach to
local business owners** (plumbers, dentists, salons, barbers, contractors,
restaurants, boutiques) — the segment where email is the *worst* channel.
Owners live on their phone; they reply to Instagram DMs in hours and let
`info@` inboxes rot for weeks.

Given a business name (and optionally a city for disambiguation), the agent:

1. **Resolves the business** (Google Maps + website + socials).
2. **Identifies the owner / decision maker** from LinkedIn, Google Business
   Profile review replies, Facebook page transparency, website About pages,
   or local news. Returns owner name, title, ID confidence (High/Medium/Low),
   and the evidence behind the call.
3. **Enumerates every reachable contact channel** from a configurable set of 10:
   `business_phone_call`, `sms_mobile`, `whatsapp`, `instagram_dm`,
   `facebook_messenger`, `tiktok_dm`, `youtube`, `nextdoor`,
   `yelp_angi_thumbtack`, `email`.
4. **Also discovers owner-personal channels** (optional, on by default) — the
   owner's personal IG / TikTok / mobile, which typically out-respond the
   business account 5×. Only surfaces personal channels the agent can tie to
   the business with concrete evidence (named in bio, tagged in posts, etc.).
5. **Scores, labels, and ranks each channel** with a deterministic
   post-processor so rankings are trustworthy regardless of agent drift:
   - `reachability_score` (0–100) from channel-type baseline + recency
     bonus + responsiveness signals + owner-personal bonus − compliance penalty
     − stale penalty.
   - `compliance_label`: `ok` / `ok_manual_only` / `requires_consent` /
     `restricted_by_region` / `do_not_use`. These are **advisory labels the
     agent reasons about, not enforced scrubs** — you are responsible for TCPA
     (SMS), Meta ToS (IG/FB/WhatsApp DMs), GDPR/CASL, and any DNC lists
     before sending.
   - `status`: `likely_active` / `stale` / `unknown`.
   - Per-channel, channel-appropriate `first_line` — IG casual ≤180 chars,
     SMS ≤160 no-links, voicemail script ≤20 seconds spoken, email opener
     without subject.
6. **Returns a ranked `channels[]` array** (JSON) in `enriched_data`. The CSV
   download flattens the top 5 channels into columns (`channel_1_type`,
   `channel_1_value`, `channel_1_score`, `channel_1_compliance`,
   `channel_1_first_line`, …) and preserves the full array in
   `channels_json` for advanced consumers.

> **Google Business Profile messaging is dead.** Google permanently removed
> chat and call history from GBP on **2024-07-31**. The GBP URL is still useful
> as an identifier and trust signal — it is captured as
> `google_business_profile_url` — but it is *not* included in the ranked
> messaging-channel list.

**Workflow helpers built into the multi-channel flow:**

- **Separate city column.** Keep your CSV tidy — if you have business name in
  one column and city in another, point the enricher at both and it will
  disambiguate common names automatically (no more `"Joe's Pizza, Atlanta GA"`
  mashed into a single field). Also available on the Decision Maker flow.
- **Suppression list.** Paste handles / phones / emails / profile URLs you've
  already contacted, one per line. Any matching channel gets force-demoted to
  `do_not_use` and drops to the bottom of the rank — turns the tool into a
  repeatable weekly workflow instead of a one-shot. US phone numbers match
  regardless of `+1 / (404) 555-1234 / 4045551234` formatting.
- **Current local time per row.** Every row captures a `business_timezone`
  (IANA) and `business_hours_local` — the results table renders a live clock
  in the business's timezone plus a "Likely open / Likely closed" badge so you
  don't cold-call a plumber at midnight. The clock auto-ticks every minute.
- **One-click outreach actions.** Each channel card has Copy value, Copy first
  line, and Open-in-platform buttons (direct `tel:` / `sms:` / `wa.me` /
  `mailto:` / Instagram / TikTok links). Click "Show all + actions" on any
  row to expand every ranked channel with its opener rendered inline.

---

## Social Engager — LinkedIn engagement monitors

In addition to CSV enrichment, the app ships a **Social Engager** module
(`/monitors`) that tracks LinkedIn engagement and turns engagers into enriched
outreach leads. Four modes:

- **Keyword tracking** — find recent posts matching topics, then collect engagers.
- **Profile tracking** — watch a profile's new posts.
- **Post monitoring** — re-check specific post URLs on a schedule.
- **Instant scraping** — one-off extraction from a post URL.

Each monitor stores a schedule (manual / daily / weekly / monthly / once),
an optional webhook, the enrichment fields to apply to every engager, and an
optional outreach context for the personalized first line. Runs dedupe against
the monitor's lifetime lead set so you only pay to enrich each person once.

> **Reality check on discovery.** LinkedIn blocks most unauthenticated page
> fetches, so the discovery agent will often come back with `0` engagers on its
> own. That's expected. The feature is designed for a pragmatic workflow: export
> an engager list from Phantombuster / Apify / a manual copy, paste it into the
> "Manual engager list" field on monitor creation, and let the runner do the
> enrichment + webhook + dedup heavy lifting.

**Scheduling.** Scheduled monitors advance their `next_run_at` after each run.
A single endpoint (`/api/cron/run-monitors`) picks up every monitor whose
`next_run_at` has passed and kicks off runs — point Vercel Cron, a cron job, or
any external scheduler at it on whatever cadence you like (e.g. hourly). Protect
it by setting `CRON_SECRET` and passing `Authorization: Bearer $CRON_SECRET`.

**Approval gate.** Runs estimated to create ≥1000 leads enter
`awaiting_approval` status and require a click in the UI before executing —
avoids surprise bills from an overeager keyword monitor.

**Monthly caps.** `/usage` shows this-month lead count and Claude spend against
`MONITOR_MONTHLY_LEAD_CAP` and `MONITOR_MONTHLY_COST_CAP`. Runs are blocked
once either cap is reached.

---

## Prerequisites

Before you begin, make sure you have the following installed:

- **Node.js** v18 or later — [download here](https://nodejs.org)
- **npm** (comes with Node.js) or **yarn** / **pnpm**
- An **Anthropic API key** — [get one here](https://console.anthropic.com)
- *(Optional)* A **Prospeo API key** if you want work email lookup — [get one here](https://prospeo.io)

---

## Getting Started

### 1. Clone the repository

```bash
git clone https://github.com/your-username/company-people-enricher.git
cd company-people-enricher
```

### 2. Install dependencies

```bash
npm install
```

### 3. Set up your environment variables

Copy the example environment file:

```bash
cp .env.local.example .env.local
```

Open `.env.local` in any text editor and replace the placeholder values with your real API keys:

```env
ANTHROPIC_API_KEY=your_anthropic_api_key_here
PROSPEO_API_KEY=your_prospeo_api_key_here
```

> **Important:** Never commit `.env.local` to git. It is already listed in `.gitignore` to prevent accidental exposure of your API keys.

See the [Environment Variables](#environment-variables) section below for detailed instructions on obtaining each key.

### 4. Run the development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser. You should see the enrichment tool ready to use.

---

## How to Use

### Step 1 — Prepare your CSV

Your CSV must have:
- **A header row** as the first row (column names)
- **One identifier column** per row:
  - For **companies**: the company's website URL (e.g. `https://stripe.com`) or LinkedIn URL
  - For **people**: the person's LinkedIn profile URL (e.g. `https://linkedin.com/in/username`)

Example company CSV:
```
Company Name,Website
Stripe,https://stripe.com
Notion,https://notion.so
Linear,https://linear.app
```

Example people CSV:
```
Name,LinkedIn URL
Jane Smith,https://linkedin.com/in/jane-smith
John Doe,https://linkedin.com/in/john-doe
```

> The CSV can have as many other columns as you like — they are preserved in the output unchanged.

Maximum: **200 rows** per job.

---

### Step 2 — Upload your CSV

1. Go to [http://localhost:3000](http://localhost:3000)
2. Select the enrichment type: **Company** or **People** using the tabs at the top
3. Drag and drop your CSV file onto the upload area, or click to browse
4. Once uploaded, select which column contains the identifier (website URL or LinkedIn URL)

---

### Step 3 — Choose your fields

Check the fields you want the agent to fill in. You can:

- **Select individual fields** by clicking their checkboxes
- **Select all / Deselect all** using the button in the card header
- **Add custom fields** by clicking the **+ Add field** button at the bottom

#### Custom Fields

Click **+ Add field** to open a modal where you can define any field not in the default list:

- **Field Name** — what you want the column header to be (e.g. `Target Market`)
- **Extraction instructions** — tell the agent what to look for (e.g. `The primary customer segment this company targets, e.g. SMB, Mid-Market, Enterprise`)

You can add as many custom fields as you need. Each appears as a chip with an amber "Custom" badge and can be removed with the × button.

#### Recent Company News *(Company only)*

Enable **Recent Company News** and configure:

- **How many?** — number of articles to find (1–10)
- **Time frame** — Last 30 days / Last 3 months / Last 6 months / Last year

Each article becomes its own column in the output: **Recent News 1**, **Recent News 2**, etc. Each cell contains the article date, headline, and a one-sentence summary.

---

### Step 4 — Start enrichment

Click **Start enrichment**. You'll be taken to the results page where you can watch progress in real time.

The agent processes up to **15 rows in parallel**, so even large CSVs complete quickly.

---

### Step 5 — View and download results

The results table shows:
- A **status icon** per row (clock = pending, spinner = processing, checkmark = done, X = error)
- All your **original CSV columns**
- One column for each **enriched field**

Use the **search bar** at the top to filter rows.

When enrichment is complete, click **Download CSV** to export the full enriched dataset. The downloaded file merges your original data with all enriched columns.

> Fields that the agent could not find are returned as `NA`.

---

## Choosing a Model

By default, the agent uses **Claude Haiku 4.5** (`claude-haiku-4-5-20251001`) — the fastest and most cost-efficient option, well-suited for most enrichment tasks.

To switch models, open `lib/agent.ts` and update the default in `enrichWithAgent`:

```ts
model: params.model ?? "claude-haiku-4-5-20251001",  // change this
```

Available Claude models (as of this writing):

| Model | ID | Best for |
|---|---|---|
| Haiku 4.5 *(default)* | `claude-haiku-4-5-20251001` | High-volume, cost-sensitive enrichment |
| Sonnet 4.6 | `claude-sonnet-4-6` | Better reasoning, moderate cost |
| Opus 4.7 | `claude-opus-4-7` | Maximum accuracy, highest cost |

You can also switch models per-row directly from the results page — any failed row shows a **Retry** button with a model dropdown.

---

## Best Practices

**Keep costs low:**
- Only select the fields you actually need — every field adds tokens and web fetches
- Use Haiku for high-volume runs; switch to Sonnet or Opus only for rows that failed or returned too many NAs
- Start with a small test batch (10–20 rows) before running your full list
- Avoid enabling Recent News unless you specifically need it — it adds multiple web searches per row

**Get better results:**
- Use clean, complete LinkedIn URLs for people enrichment — partial or redirect URLs degrade accuracy
- For companies, a direct website URL tends to outperform a LinkedIn URL as the identifier
- If a field consistently returns NA across rows, try rephrasing it as a custom field with clearer extraction instructions
- Use the Retry button (with Sonnet or Opus) on rows that returned too many NAs before giving up

**Data hygiene:**
- Remove duplicates from your CSV before uploading — each row costs API credits
- Validate your identifier column before running — blank or malformed identifiers will error immediately
- The tool caps at 200 rows per job; for larger lists, split into batches

---

## Environment Variables

### `ANTHROPIC_API_KEY` *(required)*

Powers the AI enrichment agent.

1. Go to [https://console.anthropic.com](https://console.anthropic.com)
2. Sign in or create an account
3. Click **API Keys** in the left sidebar
4. Click **Create Key**, give it a name, and copy the value
5. Paste it into `.env.local` as `ANTHROPIC_API_KEY=sk-ant-...`

**Cost:** You are billed per token consumed by the agent. Each enrichment row typically costs a few cents depending on how many fields are requested and how much web research is needed. See [Anthropic pricing](https://www.anthropic.com/pricing) for current rates.

---

### `PROSPEO_API_KEY` *(optional)*

Only required if you want the **Work Email** field in people enrichment. All other fields work without it.

1. Go to [https://prospeo.io](https://prospeo.io)
2. Create an account and choose a plan (free tier available)
3. Go to your dashboard → **API** section
4. Copy your API key
5. Paste it into `.env.local` as `PROSPEO_API_KEY=...`

If this key is missing or left as the placeholder, the Work Email field will return empty values but the rest of enrichment works normally.

---

## Building for Production

To run this in production:

```bash
npm run build
npm start
```

Or deploy to [Vercel](https://vercel.com) with one click — just make sure to add your environment variables in the Vercel project settings under **Settings → Environment Variables**.

> **Note:** Job data is stored in memory and does not persist across server restarts. For production use with persistence, you would need to swap `lib/job-store.ts` with a database-backed implementation (e.g. Redis, Postgres).

---

## Project Structure

```
├── app/
│   ├── api/
│   │   ├── enrich/route.ts        # POST /api/enrich — starts a job
│   │   ├── status/[jobId]/        # GET — polls job progress
│   │   ├── download/[jobId]/      # GET — downloads enriched CSV
│   │   └── jobs/[jobId]/          # DELETE — cancels a running job
│   ├── enrich/[type]/page.tsx     # Upload + field selection UI
│   └── results/[jobId]/page.tsx   # Live results table
├── lib/
│   ├── agent.ts                   # Claude agent logic & prompt building
│   ├── enrichment-fields.ts       # Field definitions for company & people
│   ├── job-store.ts               # In-memory job state
│   ├── csv.ts                     # CSV parsing & serialization
│   └── prospeo.ts                 # Prospeo email lookup integration
├── .env.local.example             # Template for environment variables
└── LICENSE                        # MIT License
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router) |
| AI Agent | Anthropic Claude Agent SDK |
| UI | React 19, Tailwind CSS 4, Framer Motion |
| Table | TanStack React Table |
| CSV | PapaParse |
| Email lookup | Prospeo.io |

---

## A Word of Caution

This project demonstrates the real power of AI automations and systems — but it is still a tool, not a replacement for judgment. AI agents can hallucinate, miss data, or return results that look correct but aren't. **Do not fully depend on this in production until you've validated that it works reliably for your specific use case and that the costs make sense at your volume.** Spot-check outputs. Start small. Build trust in the system before scaling it.

The goal is augmentation, not blind automation.

---

## License

This project is licensed under the **MIT License** — see the [LICENSE](./LICENSE) file for details.

You are free to fork, modify, and distribute this project for personal or commercial use.

---

## Contributing

Pull requests are welcome. For major changes, please open an issue first to discuss what you'd like to change.

---

## Want This Built for Your Business?

If this sparked ideas about what's possible — connecting your CRM, outreach tools, data sources, and internal workflows into a unified AI system — I'd love to help you build it.

I work with growth-focused teams to design and implement AI workflows and systems tailored to how they actually operate: from automated enrichment pipelines like this one, to lead scoring, to fully connected GTM stacks. If you want to stop doing the repetitive work and start letting systems handle it, [reach out](https://agentyug.com).

---

*Built by [Akansh](https://agentyug.com) · [AgentYug](https://agentyug.com)*
