"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Search,
  Target,
  Copy,
  Plus,
  AlertCircle,
  Loader2,
  CheckCircle2,
  XCircle,
  Sparkles,
  ExternalLink,
  Download,
  ChevronRight,
  ChevronDown,
  BookOpen,
  Rocket,
  Code,
  MapPin,
  Cpu,
  Link as LinkIcon,
  Star,
  ShieldCheck,
  Hammer,
  ThumbsUp,
  Flame,
  Map,
  Building2,
  Home,
  Users,
  Utensils,
  Truck,
  Compass,
  FileText,
  BadgeCheck,
  Webhook,
  Upload,
} from "lucide-react";
import { clsx } from "clsx";
import { COMPANY_FIELD_GROUPS } from "@/lib/enrichment-fields";

type DiscoveryMode =
  | "icp"
  | "lookalike"
  | "signal_funding"
  | "signal_hiring"
  | "signal_news"
  | "signal_reviews"
  | "signal_new_business"
  | "signal_license"
  | "directory";

type DirectorySource =
  | "yc"
  | "producthunt"
  | "github"
  | "google_maps"
  | "tech_stack"
  | "custom"
  | "yelp"
  | "bbb"
  | "angi"
  | "facebook_pages"
  | "firecrawl_search"
  | "osm_overpass"
  | "google_lsa"
  | "yellowpages"
  | "manta"
  | "houzz"
  | "nextdoor"
  | "opentable"
  | "tripadvisor"
  | "delivery_marketplace"
  | "state_license_board"
  | "state_sos"
  | "google_places"
  | "foursquare"
  | "bing_places"
  | "tomtom"
  | "here_places"
  | "apify"
  | "yelp_direct"
  | "bbb_direct";

type DirectoryConfig = {
  source: DirectorySource;
  category?: string;
  query?: string;
  geo?: string;
  url?: string;
  techStack?: string;
  batch?: string;
  lat?: number;
  lng?: number;
  radiusMiles?: number;
  zips?: string[];
  msaCode?: string;
  state?: string;
  actorId?: string;
};
type DiscoveryStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

type DiscoverySearch = {
  id: string;
  mode: DiscoveryMode;
  name: string;
  queryText: string;
  seedCompanies?: string[];
  directoryConfig?: DirectoryConfig;
  maxResults: number;
  status: DiscoveryStatus;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  discoveredCount: number;
  costUsd: number;
  discoveryLog: string[];
  agentNote?: string;
  error?: string;
  webhookUrl?: string;
};

type DiscoveredLead = {
  id: string;
  searchId: string;
  companyName: string;
  websiteUrl?: string;
  linkedinUrl?: string;
  description?: string;
  location?: string;
  industry?: string;
  employeeRange?: string;
  matchReason?: string;
  sourceUrl?: string;
  score?: number;
  createdAt: number;
  phone?: string;
  streetAddress?: string;
  city?: string;
  region?: string;
  postalCode?: string;
  countryCode?: string;
  lat?: number;
  lng?: number;
  hours?: string;
  licenseNumber?: string;
};

const DEFAULT_ENRICH_FIELDS = [
  "industry",
  "company_size",
  "hq_location",
  "description",
  "linkedin_url",
  "website_url",
  "first_line",
];

// When the search looks like it's for local SMBs, default to contact-channel
// and review-signal fields instead of SaaS-flavored firmographics.
const LOCAL_BUSINESS_ENRICH_FIELDS = [
  "hq_location",
  "description",
  "business_phone",
  "instagram_handle",
  "facebook_page",
  "google_business_url",
  "website_url",
  "google_rating",
  "review_count",
  "service_categories",
  "service_area",
  "first_line",
];

const LOCAL_DIRECTORY_SOURCES: DirectorySource[] = [
  "yelp",
  "bbb",
  "angi",
  "facebook_pages",
  "google_maps",
  "google_places",
  "foursquare",
  "bing_places",
  "tomtom",
  "here_places",
  "apify",
  "yelp_direct",
  "bbb_direct",
];

function defaultEnrichFieldsForSearch(search: DiscoverySearch | null): string[] {
  if (!search) return DEFAULT_ENRICH_FIELDS;
  if (search.mode === "signal_reviews") return LOCAL_BUSINESS_ENRICH_FIELDS;
  if (
    search.mode === "directory" &&
    search.directoryConfig &&
    LOCAL_DIRECTORY_SOURCES.includes(search.directoryConfig.source)
  ) {
    return LOCAL_BUSINESS_ENRICH_FIELDS;
  }
  return DEFAULT_ENRICH_FIELDS;
}

export default function DiscoverPage() {
  return (
    <Suspense fallback={null}>
      <DiscoverPageInner />
    </Suspense>
  );
}

function DiscoverPageInner() {
  const [searches, setSearches] = useState<DiscoverySearch[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [firecrawlOn, setFirecrawlOn] = useState<boolean | null>(null);
  const searchParams = useSearchParams();
  const deepLinkId = searchParams.get("search");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/integrations/status")
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setFirecrawlOn(!!d.firecrawl);
      })
      .catch(() => {
        if (!cancelled) setFirecrawlOn(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!deepLinkId) return;
    const t = setTimeout(() => setActiveId(deepLinkId), 0);
    return () => clearTimeout(t);
  }, [deepLinkId]);

  const loadSearches = useCallback(async () => {
    try {
      const res = await fetch("/api/discover");
      const data = await res.json();
      setSearches(data.searches ?? []);
      if (!activeId && data.searches?.[0]) {
        setActiveId(data.searches[0].id);
      }
    } catch {
      setError("Failed to load searches");
    }
  }, [activeId]);

  useEffect(() => {
    const first = setTimeout(loadSearches, 0);
    const id = setInterval(loadSearches, 5000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [loadSearches]);

  const activeSearch = useMemo(
    () => searches?.find((s) => s.id === activeId) ?? null,
    [searches, activeId]
  );

  return (
    <div className="min-h-screen pb-16">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-4 sm:pt-6 space-y-4 sm:space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Target className="w-5 h-5 text-brand-500 flex-shrink-0" strokeWidth={2} />
              <h1 className="text-2xl sm:text-3xl font-serif font-bold text-gray-900 tracking-tight">
                Discover
              </h1>
            </div>
            <p className="text-sm text-cloudy mt-1">
              Generate lead lists from scratch. Describe your ICP or paste seed companies — the agent searches the web and returns candidates you can feed into enrichment.
            </p>
            {firecrawlOn !== null && (
              <div className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px]">
                <span className="inline-flex items-center gap-1.5">
                  <Flame
                    className={clsx(
                      "w-3 h-3",
                      firecrawlOn ? "text-orange-500" : "text-cloudy"
                    )}
                    strokeWidth={2.5}
                  />
                  <span className={clsx(firecrawlOn ? "text-orange-700" : "text-cloudy")}>
                    Firecrawl {firecrawlOn ? "enabled" : "not configured"}
                  </span>
                </span>
                <span className="text-cloudy">
                  {firecrawlOn
                    ? "— pre-fetching clean markdown before the agent runs"
                    : "— set FIRECRAWL_API_KEY to unlock JS-heavy directories"}
                </span>
              </div>
            )}
          </div>
          <button
            onClick={() => setCreating((v) => !v)}
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-brand-500 text-white text-sm font-medium hover:bg-brand-600 transition-colors self-start sm:self-auto flex-shrink-0"
          >
            <Plus className="w-4 h-4" />
            {creating ? "Cancel" : "New search"}
          </button>
        </div>

        {error && (
          <div className="flex items-center gap-2.5 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            <AlertCircle className="w-4 h-4" />
            {error}
          </div>
        )}

        {creating && (
          <CreateSearchForm
            onCancel={() => setCreating(false)}
            onCreated={(id) => {
              setCreating(false);
              setActiveId(id);
              loadSearches();
            }}
          />
        )}

        {searches === null ? (
          <div className="text-sm text-cloudy flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading searches…
          </div>
        ) : searches.length === 0 && !creating ? (
          <EmptyState onCreate={() => setCreating(true)} />
        ) : (
          <>
            {activeSearch && <SearchDetail key={activeSearch.id} searchId={activeSearch.id} />}
            {searches.length > 1 && (
              <PastSearches
                searches={searches.filter((s) => s.id !== activeId)}
                onPick={(id) => setActiveId(id)}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="bg-white border border-cloudy/30 rounded-xl p-10 text-center">
      <Sparkles className="w-8 h-8 text-cloudy mx-auto mb-3" strokeWidth={1.5} />
      <h2 className="text-sm font-semibold text-gray-900">No searches yet</h2>
      <p className="text-xs text-cloudy mt-1 max-w-md mx-auto">
        Start with an ICP description (e.g. &ldquo;HVAC contractors in Texas, 10&ndash;50 employees&rdquo;) or paste a few seed companies to find similar ones.
      </p>
      <button
        onClick={onCreate}
        className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-brand-500 text-white text-sm font-medium hover:bg-brand-600 transition-colors"
      >
        <Plus className="w-4 h-4" />
        Run your first search
      </button>
    </div>
  );
}

// ----------------------------------------------------------------
// Create form
// ----------------------------------------------------------------

type CreateMode = "icp" | "lookalike" | "directory";

const DIRECTORY_META: Record<
  DirectorySource,
  { label: string; icon: typeof BookOpen; hint: string; smbFriendly: boolean }
> = {
  google_maps: {
    label: "Google Maps (agent)",
    icon: MapPin,
    hint: "Agent-driven Google Maps search. Use Google Places (API) below for the deterministic, lower-cost native version.",
    smbFriendly: true,
  },
  google_places: {
    label: "Google Places (API)",
    icon: MapPin,
    hint: "Native Google Places API (New) — deterministic JSON, no LLM tokens. Tile fan-out covers dense metros despite the 20-result Nearby cap. Requires GOOGLE_PLACES_API_KEY.",
    smbFriendly: true,
  },
  foursquare: {
    label: "Foursquare (API)",
    icon: Compass,
    hint: "Native Foursquare Places API. Strongest international coverage; complements Google in ex-US metros. Requires FOURSQUARE_API_KEY.",
    smbFriendly: true,
  },
  bing_places: {
    label: "Bing Local Search (API)",
    icon: Search,
    hint: "Native Bing Maps Local Search API. Useful as a Google fallback in regions where Google quotas/coverage thin out. Requires BING_MAPS_API_KEY.",
    smbFriendly: true,
  },
  tomtom: {
    label: "TomTom (API)",
    icon: Map,
    hint: "Native TomTom Search API. Strongest international POI dataset of the major commercial mappers, generous free tier. Best for ex-US sweeps. Requires TOMTOM_API_KEY.",
    smbFriendly: true,
  },
  here_places: {
    label: "HERE (API)",
    icon: Map,
    hint: "Native HERE Discover/Browse API. Best-in-class European POI coverage and vehicle-routing-grade addresses. Requires HERE_API_KEY.",
    smbFriendly: true,
  },
  apify: {
    label: "Apify (LinkedIn / Glassdoor / Crunchbase / etc.)",
    icon: Sparkles,
    hint: "Run battle-tested Apify actors for sites that block direct fetches: LinkedIn, Glassdoor, Crunchbase, Yelp, Google Maps, Instagram. Apify handles proxies, browsers, and CAPTCHAs. Requires APIFY_API_TOKEN; pay per actor run.",
    smbFriendly: true,
  },
  yelp_direct: {
    label: "Yelp (self-hosted Playwright)",
    icon: Star,
    hint: "Self-hosted Yelp scraper. Lowest cost-per-lead at scale once the infra is up. Requires `npm install playwright && npx playwright install chromium` on the host (will not run on Vercel). Configure proxies via PLAYWRIGHT_PROXY_URL_POOL.",
    smbFriendly: true,
  },
  bbb_direct: {
    label: "BBB (self-hosted Playwright)",
    icon: ShieldCheck,
    hint: "Self-hosted BBB scraper. Captures BBB letter rating (A+ … F), accreditation status, and years in business — high-signal vetting on top of NAP. Same Playwright requirements as yelp_direct.",
    smbFriendly: true,
  },
  yelp: {
    label: "Yelp",
    icon: Star,
    hint: "Yelp category search — good for restaurants, contractors, local services.",
    smbFriendly: true,
  },
  bbb: {
    label: "Better Business Bureau",
    icon: ShieldCheck,
    hint: "BBB-accredited businesses. Filters in established SMBs with real operations.",
    smbFriendly: true,
  },
  angi: {
    label: "Angi / HomeAdvisor",
    icon: Hammer,
    hint: "Home-services contractors — Angi, HomeAdvisor, Thumbtack.",
    smbFriendly: true,
  },
  facebook_pages: {
    label: "Facebook Pages",
    icon: ThumbsUp,
    hint: "Local businesses active on Facebook — many SMBs use FB as their web presence.",
    smbFriendly: true,
  },
  firecrawl_search: {
    label: "Firecrawl Search",
    icon: Flame,
    hint: "Web search via Firecrawl — each result is pre-scraped into clean markdown before the agent extracts companies. Requires FIRECRAWL_API_KEY.",
    smbFriendly: false,
  },
  tech_stack: {
    label: "Tech Stack",
    icon: Cpu,
    hint: "Companies publicly using a given product (BuiltWith, G2, case studies).",
    smbFriendly: false,
  },
  custom: {
    label: "Custom URL",
    icon: LinkIcon,
    hint: "Paste any directory page URL. The agent extracts companies from it.",
    smbFriendly: false,
  },
  yc: {
    label: "Y Combinator",
    icon: BookOpen,
    hint: "YC directory — filter by batch or category. For tech/VC-backed ICPs.",
    smbFriendly: false,
  },
  producthunt: {
    label: "Product Hunt",
    icon: Rocket,
    hint: "Recent launches by topic. For product-led / tech companies.",
    smbFriendly: false,
  },
  github: {
    label: "GitHub Topics",
    icon: Code,
    hint: "Commercial orgs behind active repos. For dev-tool ICPs.",
    smbFriendly: false,
  },
  osm_overpass: {
    label: "OpenStreetMap (radius)",
    icon: Compass,
    hint: "Free Overpass API — true lat/lng + radius queries. No API key, no agent cost. Best when you need NAP data fast.",
    smbFriendly: true,
  },
  google_lsa: {
    label: "Google Local Services",
    icon: BadgeCheck,
    hint: "Google-vetted, license-verified pros. Highest-intent home-services lead source — every pro is reviewed by Google.",
    smbFriendly: true,
  },
  yellowpages: {
    label: "Yellow Pages",
    icon: BookOpen,
    hint: "Broadest US SMB directory long-tail. Phone + address on every listing.",
    smbFriendly: true,
  },
  manta: {
    label: "Manta",
    icon: Building2,
    hint: "US SMB directory with NAICS codes, employee bands, and revenue ranges.",
    smbFriendly: true,
  },
  houzz: {
    label: "Houzz",
    icon: Home,
    hint: "Home pros — designers, contractors, landscapers, remodelers. Best for premium home-services ICPs.",
    smbFriendly: true,
  },
  nextdoor: {
    label: "Nextdoor (best-effort)",
    icon: Users,
    hint: "Nextdoor business pages — best-effort discovery via Google indexed pages. Owners actively reply on this platform.",
    smbFriendly: true,
  },
  opentable: {
    label: "OpenTable",
    icon: Utensils,
    hint: "Restaurants — every OT-listed venue is reachable for vendor / SaaS / marketing pitches.",
    smbFriendly: true,
  },
  tripadvisor: {
    label: "TripAdvisor",
    icon: Map,
    hint: "Restaurants, hotels, tours. Cross-source dedup with OpenTable / Yelp.",
    smbFriendly: true,
  },
  delivery_marketplace: {
    label: "Delivery Marketplaces",
    icon: Truck,
    hint: "DoorDash + Uber Eats + Grubhub. Every listed restaurant is signed up = reachable.",
    smbFriendly: true,
  },
  state_license_board: {
    label: "State License Boards",
    icon: BadgeCheck,
    hint: "State contractor / professional licenses (CSLB CA, TDLR TX, DBPR FL, NY DOS, GA SOS). License # + status + issue date.",
    smbFriendly: true,
  },
  state_sos: {
    label: "State SoS Filings",
    icon: FileText,
    hint: "State Secretary-of-State business filings. Newly registered LLCs/Inc — \"just opened\" signal.",
    smbFriendly: true,
  },
};

const DIRECTORY_SOURCE_ORDER: DirectorySource[] = [
  "google_places",
  "foursquare",
  "tomtom",
  "here_places",
  "bing_places",
  "apify",
  "yelp_direct",
  "bbb_direct",
  "google_maps",
  "osm_overpass",
  "yelp",
  "google_lsa",
  "yellowpages",
  "bbb",
  "angi",
  "houzz",
  "manta",
  "opentable",
  "tripadvisor",
  "delivery_marketplace",
  "facebook_pages",
  "nextdoor",
  "state_license_board",
  "state_sos",
  "firecrawl_search",
  "tech_stack",
  "custom",
  "yc",
  "producthunt",
  "github",
];

function CreateSearchForm({
  onCancel,
  onCreated,
}: {
  onCancel: () => void;
  onCreated: (searchId: string) => void;
}) {
  const [mode, setMode] = useState<CreateMode>("icp");
  const [name, setName] = useState("");
  const [icpText, setIcpText] = useState("");
  const [seedText, setSeedText] = useState("");
  const [lookalikeExtra, setLookalikeExtra] = useState("");
  const [maxResults, setMaxResults] = useState(25);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const [dirSource, setDirSource] = useState<DirectorySource>("google_maps");
  const [dirCategory, setDirCategory] = useState("");
  const [dirQuery, setDirQuery] = useState("");
  const [dirGeo, setDirGeo] = useState("");
  const [dirUrl, setDirUrl] = useState("");
  const [dirTechStack, setDirTechStack] = useState("");
  const [dirBatch, setDirBatch] = useState("");
  const [dirExtra, setDirExtra] = useState("");
  // Phase 1.3 — geo precision inputs.
  const [dirLat, setDirLat] = useState("");
  const [dirLng, setDirLng] = useState("");
  const [dirRadius, setDirRadius] = useState("");
  const [dirZips, setDirZips] = useState("");
  const [dirState, setDirState] = useState("");
  // Phase 2.1 — Apify actor ID (preset key or custom user/actor).
  const [dirActorId, setDirActorId] = useState("");
  // Phase 1.4 — discovery webhook URL.
  const [webhookUrl, setWebhookUrl] = useState("");

  // Phase 4.17 — raised cap, plus CSV upload support for lookalike seeds.
  const seedCompanies = useMemo(
    () =>
      seedText
        .split(/[\n,]/)
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 200),
    [seedText]
  );

  const handleSeedCsv = useCallback(
    async (file: File) => {
      const text = await file.text();
      // Light CSV handling — first non-empty cell of each row. Accepts plain
      // newline-delimited lists too (which is how the textarea ingests).
      const lines = text
        .split(/\r?\n/)
        .map((l) => l.split(",")[0]?.trim())
        .filter((s): s is string => !!s && s.length > 0);
      // Drop a likely header row (e.g. "Company,Website").
      if (lines[0] && /^(company|domain|name|website|url)/i.test(lines[0])) {
        lines.shift();
      }
      setSeedText(lines.join("\n"));
    },
    [setSeedText]
  );

  const submit = async () => {
    setError("");
    const trimmedName = name.trim();
    if (!trimmedName) return setError("Give the search a name so you can find it later.");

    let body: Record<string, unknown>;
    if (mode === "icp") {
      if (icpText.trim().length < 10)
        return setError("Describe the ICP in at least a sentence (≥10 characters).");
      body = {
        mode: "icp",
        name: trimmedName,
        queryText: icpText.trim(),
        maxResults,
      };
    } else if (mode === "lookalike") {
      if (seedCompanies.length === 0)
        return setError("Paste at least one seed company (one per line).");
      body = {
        mode: "lookalike",
        name: trimmedName,
        seedCompanies,
        queryText: lookalikeExtra.trim(),
        maxResults,
      };
    } else {
      const directoryConfig: DirectoryConfig = { source: dirSource };
      if (dirCategory.trim()) directoryConfig.category = dirCategory.trim();
      if (dirQuery.trim()) directoryConfig.query = dirQuery.trim();
      if (dirGeo.trim()) directoryConfig.geo = dirGeo.trim();
      if (dirUrl.trim()) directoryConfig.url = dirUrl.trim();
      if (dirTechStack.trim()) directoryConfig.techStack = dirTechStack.trim();
      if (dirBatch.trim()) directoryConfig.batch = dirBatch.trim();
      if (dirState.trim())
        directoryConfig.state = dirState.trim().toUpperCase().slice(0, 2);
      if (dirActorId.trim()) directoryConfig.actorId = dirActorId.trim();
      const latNum = parseFloat(dirLat);
      const lngNum = parseFloat(dirLng);
      const radNum = parseFloat(dirRadius);
      if (Number.isFinite(latNum) && latNum >= -90 && latNum <= 90)
        directoryConfig.lat = latNum;
      if (Number.isFinite(lngNum) && lngNum >= -180 && lngNum <= 180)
        directoryConfig.lng = lngNum;
      if (Number.isFinite(radNum) && radNum > 0 && radNum <= 500)
        directoryConfig.radiusMiles = radNum;
      const zipList = dirZips
        .split(/[,\s]+/)
        .map((z) => z.trim())
        .filter((z) => /^\d{5}$/.test(z))
        .slice(0, 50);
      if (zipList.length > 0) directoryConfig.zips = zipList;

      if (dirSource === "custom" && !directoryConfig.url)
        return setError("Paste the directory URL to fetch from.");
      if (dirSource === "google_maps" && !directoryConfig.category && !directoryConfig.query)
        return setError("Give a business category (e.g. 'HVAC contractor').");
      if (dirSource === "google_maps" && !directoryConfig.geo)
        return setError("Give a geography for the Google Maps search (e.g. 'Austin, TX').");
      if (dirSource === "tech_stack" && !directoryConfig.techStack && !directoryConfig.query)
        return setError("Name the tech stack / product (e.g. 'Shopify Plus').");
      if (
        (dirSource === "yc" || dirSource === "producthunt" || dirSource === "github") &&
        !directoryConfig.category &&
        !directoryConfig.query &&
        !directoryConfig.batch
      )
        return setError(
          "Give at least one filter (category, free-text, or batch) so the agent has something to search for."
        );
      if (dirSource === "osm_overpass") {
        if (!directoryConfig.category && !directoryConfig.query)
          return setError(
            "Give a category for OSM (e.g. 'restaurant', 'plumber', 'roofer')."
          );
        if (
          directoryConfig.lat === undefined &&
          !directoryConfig.geo &&
          !directoryConfig.zips?.length
        ) {
          return setError(
            "OSM Overpass needs a geo: lat/lng + radius, a zip code, or a city name."
          );
        }
      }
      if (
        (dirSource === "state_license_board" || dirSource === "state_sos") &&
        !directoryConfig.state
      ) {
        return setError(
          "Pick a state (CA, TX, FL, NY, GA) for state-registry search."
        );
      }
      if (
        (dirSource === "yellowpages" ||
          dirSource === "manta" ||
          dirSource === "houzz" ||
          dirSource === "google_lsa" ||
          dirSource === "nextdoor" ||
          dirSource === "opentable" ||
          dirSource === "tripadvisor" ||
          dirSource === "delivery_marketplace") &&
        !directoryConfig.category &&
        !directoryConfig.query
      ) {
        return setError("Give a business category for this directory.");
      }
      if (dirSource === "google_places") {
        const hasQuery = !!(directoryConfig.category || directoryConfig.query);
        const hasNearby =
          directoryConfig.lat !== undefined &&
          directoryConfig.lng !== undefined &&
          !!directoryConfig.category;
        if (!hasQuery && !hasNearby) {
          return setError(
            "Google Places needs a category or free-text query (and a geo bias for Nearby Search)."
          );
        }
      }
      if (
        dirSource === "foursquare" ||
        dirSource === "bing_places" ||
        dirSource === "tomtom" ||
        dirSource === "here_places"
      ) {
        const hasFilter = !!(directoryConfig.category || directoryConfig.query);
        const hasGeo =
          (directoryConfig.lat !== undefined && directoryConfig.lng !== undefined) ||
          !!directoryConfig.geo ||
          !!directoryConfig.zips?.length;
        if (!hasFilter) {
          return setError("Give a business category or query for this directory.");
        }
        if (!hasGeo) {
          return setError(
            "Give a geo (lat/lng + radius, zip, or city) so the search has something to scope to."
          );
        }
      }
      if (dirSource === "apify") {
        if (!directoryConfig.actorId) {
          return setError(
            "Pick an Apify actor preset, or paste a custom \"username/actor\" ID."
          );
        }
        if (!directoryConfig.category && !directoryConfig.query) {
          return setError(
            "Give a search query (or category) so the actor knows what to look for."
          );
        }
      }

      body = {
        mode: "directory",
        name: trimmedName,
        directoryConfig,
        queryText: dirExtra.trim(),
        maxResults,
      };
    }

    if (webhookUrl.trim()) {
      try {
        new URL(webhookUrl.trim());
        body.webhookUrl = webhookUrl.trim();
      } catch {
        return setError(
          "Webhook URL is not a valid URL (e.g. https://example.com/hook)"
        );
      }
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? data.issues?.join("; ") ?? "Failed to start search");
        return;
      }
      onCreated(data.searchId);
    } catch {
      setError("Network error starting search");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="bg-white border border-cloudy/30 rounded-xl overflow-hidden">
      <div className="px-5 py-4 border-b border-cloudy/20">
        <h2 className="text-sm font-semibold text-gray-700">New discovery search</h2>
      </div>
      <div className="p-5 space-y-4">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={120}
            placeholder="e.g. Austin HVAC contractors — Apr 2026"
            className="w-full border border-cloudy/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent transition"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-2">Mode</label>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <ModeCard
              active={mode === "icp"}
              onClick={() => setMode("icp")}
              icon={Search}
              label="ICP Search"
              hint="Describe your ideal customer in plain English. The agent builds a candidate list from web search + directories."
            />
            <ModeCard
              active={mode === "lookalike"}
              onClick={() => setMode("lookalike")}
              icon={Copy}
              label="Look-alike"
              hint="Paste 2–10 existing customers or targets. The agent finds companies with the same shape."
            />
            <ModeCard
              active={mode === "directory"}
              onClick={() => setMode("directory")}
              icon={BookOpen}
              label="Directory"
              hint="Pull from a specific source: YC, Product Hunt, GitHub, Google Maps, BuiltWith, or a custom URL."
            />
          </div>
        </div>

        {mode === "icp" && (
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              ICP description
            </label>
            <textarea
              value={icpText}
              onChange={(e) => setIcpText(e.target.value.slice(0, 2000))}
              rows={4}
              placeholder="Residential HVAC contractors in Texas with 10–50 employees, serving the Austin or Dallas metro, active Google Business Profile."
              className="w-full border border-cloudy/40 rounded-lg px-3 py-2 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent transition"
            />
            <p className="text-[11px] text-cloudy mt-1">
              Be specific: industry, geography, size, tech stack, a recent event (funding, hiring, expansion). The more concrete, the better the matches.
            </p>
          </div>
        )}

        {mode === "lookalike" && (
          <>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Seed companies <span className="text-cloudy font-normal">(one per line, 1–10)</span>
              </label>
              <textarea
                value={seedText}
                onChange={(e) => setSeedText(e.target.value)}
                rows={4}
                placeholder={"acme-roofing.com\nexampleplumbing.com\nhttps://www.linkedin.com/company/third-example"}
                className="w-full border border-cloudy/40 rounded-lg px-3 py-2 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent transition font-mono text-[12px]"
              />
              {seedCompanies.length > 0 && (
                <p className="text-[11px] text-cloudy mt-1">
                  {seedCompanies.length} seed{seedCompanies.length !== 1 ? "s" : ""} parsed
                  {seedCompanies.length >= 200 && " (capped at 200)"}
                </p>
              )}
              <label className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-cloudy/40 text-[11px] text-gray-600 hover:bg-pampas cursor-pointer transition-colors">
                <Upload className="w-3 h-3" strokeWidth={2} />
                Upload CSV of seeds
                <input
                  type="file"
                  accept=".csv,text/csv,text/plain"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void handleSeedCsv(f);
                  }}
                />
              </label>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Extra constraints <span className="text-cloudy font-normal">(optional)</span>
              </label>
              <input
                value={lookalikeExtra}
                onChange={(e) => setLookalikeExtra(e.target.value.slice(0, 2000))}
                placeholder="Limit to US only, avoid enterprises >500 employees, etc."
                className="w-full border border-cloudy/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent transition"
              />
            </div>
          </>
        )}

        {mode === "directory" && (
          <>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-2">Source</label>
              <p className="text-[11px] text-cloudy mb-2">
                Local-business sources are listed first. VC-style sources (YC, Product Hunt, GitHub) are at the end.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                {DIRECTORY_SOURCE_ORDER.map((s) => {
                  const meta = DIRECTORY_META[s];
                  const Icon = meta.icon;
                  const active = s === dirSource;
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setDirSource(s)}
                      className={clsx(
                        "text-left rounded-lg border p-3 transition-all",
                        active
                          ? "border-brand-300 bg-brand-50"
                          : "border-cloudy/30 hover:border-cloudy/50 hover:bg-pampas"
                      )}
                    >
                      <div className="flex items-center gap-1.5 mb-1">
                        <Icon
                          className={clsx("w-3.5 h-3.5", active ? "text-brand-500" : "text-cloudy")}
                          strokeWidth={2}
                        />
                        <span className="text-xs font-semibold text-gray-800">{meta.label}</span>
                        {meta.smbFriendly && (
                          <span className="text-[9px] font-medium px-1 py-0.5 rounded bg-emerald-100 text-emerald-700 uppercase tracking-wider">
                            SMB
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-cloudy leading-snug">{meta.hint}</p>
                    </button>
                  );
                })}
              </div>
            </div>

            {dirSource === "yc" && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Batch <span className="text-cloudy font-normal">(optional)</span>
                  </label>
                  <input
                    value={dirBatch}
                    onChange={(e) => setDirBatch(e.target.value)}
                    placeholder="W24, S23"
                    className="w-full border border-cloudy/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent transition"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Category <span className="text-cloudy font-normal">(optional)</span>
                  </label>
                  <input
                    value={dirCategory}
                    onChange={(e) => setDirCategory(e.target.value)}
                    placeholder="B2B, Fintech, Consumer"
                    className="w-full border border-cloudy/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent transition"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Free-text <span className="text-cloudy font-normal">(optional)</span>
                  </label>
                  <input
                    value={dirQuery}
                    onChange={(e) => setDirQuery(e.target.value)}
                    placeholder="devtools, AI agents"
                    className="w-full border border-cloudy/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent transition"
                  />
                </div>
              </div>
            )}

            {dirSource === "producthunt" && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Topic / category
                  </label>
                  <input
                    value={dirCategory}
                    onChange={(e) => setDirCategory(e.target.value)}
                    placeholder="productivity, developer-tools, marketing"
                    className="w-full border border-cloudy/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent transition"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Free-text <span className="text-cloudy font-normal">(optional)</span>
                  </label>
                  <input
                    value={dirQuery}
                    onChange={(e) => setDirQuery(e.target.value)}
                    placeholder="AI, automation, design"
                    className="w-full border border-cloudy/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent transition"
                  />
                </div>
              </div>
            )}

            {dirSource === "github" && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Topic
                  </label>
                  <input
                    value={dirCategory}
                    onChange={(e) => setDirCategory(e.target.value)}
                    placeholder="kubernetes, typescript, nextjs"
                    className="w-full border border-cloudy/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent transition"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Free-text query <span className="text-cloudy font-normal">(optional)</span>
                  </label>
                  <input
                    value={dirQuery}
                    onChange={(e) => setDirQuery(e.target.value)}
                    placeholder="language:Go stars:>500"
                    className="w-full border border-cloudy/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent transition font-mono text-[12px]"
                  />
                </div>
              </div>
            )}

            {(dirSource === "google_maps" ||
              dirSource === "yelp" ||
              dirSource === "bbb" ||
              dirSource === "angi" ||
              dirSource === "facebook_pages" ||
              dirSource === "osm_overpass" ||
              dirSource === "google_lsa" ||
              dirSource === "yellowpages" ||
              dirSource === "manta" ||
              dirSource === "houzz" ||
              dirSource === "nextdoor" ||
              dirSource === "opentable" ||
              dirSource === "tripadvisor" ||
              dirSource === "delivery_marketplace" ||
              dirSource === "google_places" ||
              dirSource === "foursquare" ||
              dirSource === "bing_places" ||
              dirSource === "tomtom" ||
              dirSource === "here_places" ||
              dirSource === "yelp_direct" ||
              dirSource === "bbb_direct") && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    {dirSource === "osm_overpass" ||
                    dirSource === "google_places" ||
                    dirSource === "foursquare" ||
                    dirSource === "tomtom" ||
                    dirSource === "here_places"
                      ? "Category (preset key or free text)"
                      : "Business category"}
                  </label>
                  <input
                    value={dirCategory}
                    onChange={(e) => setDirCategory(e.target.value)}
                    placeholder={
                      dirSource === "angi" || dirSource === "houzz"
                        ? "plumber, roofer, electrician"
                        : dirSource === "opentable" ||
                          dirSource === "tripadvisor" ||
                          dirSource === "delivery_marketplace"
                        ? "italian, sushi, pizza, brunch"
                        : dirSource === "osm_overpass" ||
                          dirSource === "google_places" ||
                          dirSource === "foursquare" ||
                          dirSource === "tomtom" ||
                          dirSource === "here_places"
                        ? "restaurant, plumber, roofer, hair, dentist"
                        : "HVAC contractor, dentist, gym"
                    }
                    className="w-full border border-cloudy/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent transition"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Geography{" "}
                    {dirSource !== "google_maps" && (
                      <span className="text-cloudy font-normal">(recommended)</span>
                    )}
                  </label>
                  <input
                    value={dirGeo}
                    onChange={(e) => setDirGeo(e.target.value)}
                    placeholder="Austin, TX"
                    className="w-full border border-cloudy/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent transition"
                  />
                </div>
              </div>
            )}

            {dirSource === "tech_stack" && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Tech / product
                  </label>
                  <input
                    value={dirTechStack}
                    onChange={(e) => setDirTechStack(e.target.value)}
                    placeholder="Shopify Plus, Salesforce, HubSpot"
                    className="w-full border border-cloudy/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent transition"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Industry <span className="text-cloudy font-normal">(optional)</span>
                  </label>
                  <input
                    value={dirCategory}
                    onChange={(e) => setDirCategory(e.target.value)}
                    placeholder="Ecommerce, SaaS"
                    className="w-full border border-cloudy/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent transition"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Geography <span className="text-cloudy font-normal">(optional)</span>
                  </label>
                  <input
                    value={dirGeo}
                    onChange={(e) => setDirGeo(e.target.value)}
                    placeholder="USA, Canada"
                    className="w-full border border-cloudy/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent transition"
                  />
                </div>
              </div>
            )}

            {dirSource === "custom" && (
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Directory URL
                  </label>
                  <input
                    value={dirUrl}
                    onChange={(e) => setDirUrl(e.target.value)}
                    placeholder="https://example.com/directory?category=foo"
                    className="w-full border border-cloudy/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent transition"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Extraction hint <span className="text-cloudy font-normal">(optional)</span>
                  </label>
                  <input
                    value={dirQuery}
                    onChange={(e) => setDirQuery(e.target.value)}
                    placeholder="Only the B2B companies, skip sponsored rows"
                    className="w-full border border-cloudy/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent transition"
                  />
                </div>
              </div>
            )}

            {dirSource === "firecrawl_search" && (
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Search query
                </label>
                <input
                  value={dirQuery}
                  onChange={(e) => setDirQuery(e.target.value)}
                  placeholder='"top 20 HVAC contractors in Austin TX" OR "best Shopify Plus agencies 2026"'
                  className="w-full border border-cloudy/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent transition"
                />
                <p className="text-[11px] text-cloudy mt-1">
                  Google-style query. Firecrawl runs the search and pre-scrapes the top 10 results into clean markdown. The agent extracts companies from those blocks.
                </p>
              </div>
            )}

            {dirSource === "apify" && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Actor
                  </label>
                  <select
                    value={dirActorId}
                    onChange={(e) => setDirActorId(e.target.value)}
                    className="w-full border border-cloudy/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent transition bg-white"
                  >
                    <option value="">Pick an actor…</option>
                    <option value="linkedin_companies">LinkedIn Companies</option>
                    <option value="glassdoor_companies">Glassdoor Companies</option>
                    <option value="crunchbase_companies">Crunchbase Companies</option>
                    <option value="yelp_businesses">Yelp Businesses</option>
                    <option value="google_maps_businesses">Google Maps (via Apify)</option>
                    <option value="instagram_business_search">Instagram Business Search</option>
                  </select>
                  <p className="text-[11px] text-cloudy mt-1">
                    Or type a custom <code>username/actor</code> ID below to use an unlisted actor.
                  </p>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Custom actor (overrides preset)
                  </label>
                  <input
                    value={dirActorId.includes("/") || dirActorId.includes("~") ? dirActorId : ""}
                    onChange={(e) => setDirActorId(e.target.value)}
                    placeholder="apify/web-scraper"
                    className="w-full border border-cloudy/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent transition font-mono text-[12px]"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Search query
                  </label>
                  <input
                    value={dirQuery}
                    onChange={(e) => setDirQuery(e.target.value)}
                    placeholder="HVAC contractor — passed to the actor as keywords/query/searchTerms"
                    className="w-full border border-cloudy/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent transition"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Location <span className="text-cloudy font-normal">(optional, location-aware actors only)</span>
                  </label>
                  <input
                    value={dirGeo}
                    onChange={(e) => setDirGeo(e.target.value)}
                    placeholder="Austin, TX"
                    className="w-full border border-cloudy/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent transition"
                  />
                </div>
              </div>
            )}

            {/* Phase 1.3 — radius/zip/MSA inputs. Power-user precision geo for any
                local-business directory; agents can still ignore them when not
                needed. */}
            {(dirSource === "google_maps" ||
              dirSource === "yelp" ||
              dirSource === "bbb" ||
              dirSource === "angi" ||
              dirSource === "facebook_pages" ||
              dirSource === "osm_overpass" ||
              dirSource === "google_lsa" ||
              dirSource === "yellowpages" ||
              dirSource === "manta" ||
              dirSource === "houzz" ||
              dirSource === "nextdoor" ||
              dirSource === "opentable" ||
              dirSource === "tripadvisor" ||
              dirSource === "delivery_marketplace" ||
              dirSource === "google_places" ||
              dirSource === "foursquare" ||
              dirSource === "bing_places" ||
              dirSource === "tomtom" ||
              dirSource === "here_places" ||
              dirSource === "yelp_direct" ||
              dirSource === "bbb_direct") && (
              <details className="rounded-lg border border-cloudy/30 bg-pampas/40">
                <summary className="cursor-pointer select-none px-3 py-2 text-xs font-medium text-gray-700 flex items-center gap-1.5">
                  <Compass className="w-3.5 h-3.5 text-cloudy" strokeWidth={2} />
                  Precision geo (lat/lng + radius, zip list){" "}
                  <span className="text-cloudy font-normal">— optional</span>
                </summary>
                <div className="p-3 grid grid-cols-1 md:grid-cols-3 gap-3 border-t border-cloudy/30">
                  <div>
                    <label className="block text-[11px] font-medium text-gray-600 mb-1">
                      Latitude
                    </label>
                    <input
                      value={dirLat}
                      onChange={(e) => setDirLat(e.target.value)}
                      placeholder="33.879"
                      className="w-full border border-cloudy/40 rounded-md px-2 py-1.5 text-xs tabular focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent transition"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-gray-600 mb-1">
                      Longitude
                    </label>
                    <input
                      value={dirLng}
                      onChange={(e) => setDirLng(e.target.value)}
                      placeholder="-84.459"
                      className="w-full border border-cloudy/40 rounded-md px-2 py-1.5 text-xs tabular focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent transition"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-gray-600 mb-1">
                      Radius (mi)
                    </label>
                    <input
                      value={dirRadius}
                      onChange={(e) => setDirRadius(e.target.value)}
                      placeholder="25"
                      className="w-full border border-cloudy/40 rounded-md px-2 py-1.5 text-xs tabular focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent transition"
                    />
                  </div>
                  <div className="md:col-span-3">
                    <label className="block text-[11px] font-medium text-gray-600 mb-1">
                      Zip codes <span className="text-cloudy font-normal">(comma- or space-separated, max 50)</span>
                    </label>
                    <input
                      value={dirZips}
                      onChange={(e) => setDirZips(e.target.value)}
                      placeholder="30339, 30303, 30309"
                      className="w-full border border-cloudy/40 rounded-md px-2 py-1.5 text-xs tabular focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent transition"
                    />
                    <p className="text-[10px] text-cloudy mt-1">
                      Used to fan a city-wide search out into specific zip slices. With lat/lng + radius the runner auto-expands to bundled zips inside the circle.
                    </p>
                  </div>
                </div>
              </details>
            )}

            {/* Phase 2.12 — state-scoped sources. */}
            {(dirSource === "state_license_board" || dirSource === "state_sos") && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    State <span className="text-cloudy font-normal">(2-letter postal code)</span>
                  </label>
                  <input
                    value={dirState}
                    onChange={(e) => setDirState(e.target.value)}
                    placeholder="CA, TX, FL, NY, GA"
                    maxLength={2}
                    className="w-32 border border-cloudy/40 rounded-lg px-3 py-2 text-sm uppercase focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent transition"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    {dirSource === "state_license_board"
                      ? "License type"
                      : "NAICS / industry filter"}{" "}
                    <span className="text-cloudy font-normal">(optional)</span>
                  </label>
                  <input
                    value={dirCategory}
                    onChange={(e) => setDirCategory(e.target.value)}
                    placeholder={
                      dirSource === "state_license_board"
                        ? "general contractor, plumbing, electrical, HVAC"
                        : "722511 (limited-service restaurants), 238220 (plumbing/HVAC)"
                    }
                    className="w-full border border-cloudy/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent transition"
                  />
                </div>
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Additional ICP constraints <span className="text-cloudy font-normal">(optional)</span>
              </label>
              <textarea
                value={dirExtra}
                onChange={(e) => setDirExtra(e.target.value.slice(0, 2000))}
                rows={2}
                placeholder="Only companies with a US HQ, avoid pure services firms."
                className="w-full border border-cloudy/40 rounded-lg px-3 py-2 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent transition"
              />
            </div>
          </>
        )}

        {/* Phase 1.4 — webhook URL applies to all modes. Each new lead is
            POSTed to this URL during the run so a CRM can subscribe to
            discovery deltas instead of polling. */}
        <div>
          <label className=" text-xs font-medium text-gray-600 mb-1 inline-flex items-center gap-1.5">
            <Webhook className="w-3.5 h-3.5 text-cloudy" strokeWidth={2} />
            Webhook URL <span className="text-cloudy font-normal">(optional)</span>
          </label>
          <input
            value={webhookUrl}
            onChange={(e) => setWebhookUrl(e.target.value)}
            placeholder="https://your-crm.example.com/hooks/leads"
            className="w-full border border-cloudy/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent transition"
          />
          <p className="text-[11px] text-cloudy mt-1">
            POSTed once per new lead with the full lead payload (name, phone, address, lat/lng, source, score). Failures are non-blocking.
          </p>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            Max results <span className="text-cloudy font-normal">(1–50)</span>
          </label>
          <input
            type="number"
            min={1}
            max={50}
            value={maxResults}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (Number.isFinite(n)) setMaxResults(Math.max(1, Math.min(50, Math.round(n))));
            }}
            className="w-32 border border-cloudy/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent transition tabular"
          />
          <p className="text-[11px] text-cloudy mt-1">
            Higher = more web-search cost. 25 is a good default.
          </p>
        </div>

        {error && (
          <div className="flex items-center gap-2.5 px-3 py-2 bg-red-50 border border-red-200 rounded-md text-xs text-red-700">
            <AlertCircle className="w-3.5 h-3.5" />
            {error}
          </div>
        )}

        <div className="flex items-center gap-2 pt-2">
          <button
            onClick={submit}
            disabled={submitting}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-brand-500 text-white text-sm font-medium hover:bg-brand-600 disabled:opacity-50 transition-colors"
          >
            {submitting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Search className="w-4 h-4" />
            )}
            Start search
          </button>
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-lg border border-cloudy/40 text-sm text-gray-600 hover:bg-pampas transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function ModeCard({
  active,
  onClick,
  icon: Icon,
  label,
  hint,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof Search;
  label: string;
  hint: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        "text-left rounded-lg border p-3 transition-all",
        active
          ? "border-brand-300 bg-brand-50"
          : "border-cloudy/30 hover:border-cloudy/50 hover:bg-pampas"
      )}
    >
      <div className="flex items-center gap-1.5 mb-1">
        <Icon
          className={clsx("w-3.5 h-3.5", active ? "text-brand-500" : "text-cloudy")}
          strokeWidth={2}
        />
        <span className="text-xs font-semibold text-gray-800">{label}</span>
      </div>
      <p className="text-[11px] text-cloudy leading-snug">{hint}</p>
    </button>
  );
}

// ----------------------------------------------------------------
// Active search detail
// ----------------------------------------------------------------

function SearchDetail({ searchId }: { searchId: string }) {
  const [data, setData] = useState<{
    search: DiscoverySearch;
    leads: DiscoveredLead[];
  } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [enriching, setEnriching] = useState(false);
  const [enrichFields, setEnrichFields] = useState<string[]>(DEFAULT_ENRICH_FIELDS);
  const [userEditedFields, setUserEditedFields] = useState(false);
  const [showFields, setShowFields] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [actionError, setActionError] = useState("");
  const router = useRouter();

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/discover/${searchId}`);
      if (!res.ok) return;
      const body = await res.json();
      setData(body);
    } catch {
      // transient network errors are fine; next poll will retry
    }
  }, [searchId]);

  useEffect(() => {
    const first = setTimeout(load, 0);
    const id = setInterval(() => {
      if (data?.search.status === "running" || data?.search.status === "queued") {
        load();
      } else if (!data) {
        load();
      }
    }, 3000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [load, data]);

  // Once the search loads, default the enrichment fields to something sensible
  // for its source (local-biz defaults for SMB-y sources). Stop syncing once
  // the user has toggled a checkbox themselves.
  useEffect(() => {
    if (!data || userEditedFields) return;
    const t = setTimeout(
      () => setEnrichFields(defaultEnrichFieldsForSearch(data.search)),
      0
    );
    return () => clearTimeout(t);
  }, [data, userEditedFields]);

  if (!data) {
    return (
      <div className="bg-white border border-cloudy/30 rounded-xl p-6 text-sm text-cloudy flex items-center gap-2">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading search…
      </div>
    );
  }

  const { search, leads } = data;
  const isRunning = search.status === "running" || search.status === "queued";
  const allChecked = leads.length > 0 && selected.size === leads.length;

  const toggleAll = () => {
    setSelected(allChecked ? new Set() : new Set(leads.map((l) => l.id)));
  };
  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const enrichSelected = async () => {
    setActionError("");
    if (enrichFields.length === 0) {
      setActionError("Pick at least one enrichment field.");
      return;
    }
    if (leads.length === 0) {
      setActionError("No leads to enrich yet.");
      return;
    }
    setEnriching(true);
    try {
      const leadIds = selected.size > 0 ? Array.from(selected) : undefined;
      const res = await fetch(`/api/discover/${search.id}/enrich`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadIds,
          requestedFields: enrichFields,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setActionError(body.error ?? body.issues?.join("; ") ?? "Failed to start enrichment");
        return;
      }
      router.push(`/results/${body.jobId}`);
    } catch {
      setActionError("Network error starting enrichment");
    } finally {
      setEnriching(false);
    }
  };

  const downloadCsv = () => {
    const subset =
      selected.size > 0
        ? leads.filter((l) => selected.has(l.id))
        : leads;
    const headers = [
      "company_name",
      "website_url",
      "linkedin_url",
      "description",
      "location",
      "industry",
      "employee_range",
      "match_reason",
      "source_url",
      "score",
    ];
    const rows = subset.map((l) => [
      l.companyName,
      l.websiteUrl ?? "",
      l.linkedinUrl ?? "",
      l.description ?? "",
      l.location ?? "",
      l.industry ?? "",
      l.employeeRange ?? "",
      l.matchReason ?? "",
      l.sourceUrl ?? "",
      l.score !== undefined ? String(l.score) : "",
    ]);
    const csv = [headers, ...rows]
      .map((row) =>
        row
          .map((cell) => {
            const s = String(cell);
            return s.includes(",") || s.includes('"') || s.includes("\n")
              ? `"${s.replace(/"/g, '""')}"`
              : s;
          })
          .join(",")
      )
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `discover-${search.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="bg-white border border-cloudy/30 rounded-xl overflow-hidden">
      {/* header */}
      <div className="px-4 sm:px-5 py-4 border-b border-cloudy/20 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-3">
        <div className="flex items-center gap-2 min-w-0 flex-wrap">
          <StatusBadge status={search.status} />
          <h2 className="text-sm font-semibold text-gray-800 truncate">{search.name}</h2>
          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-600 uppercase tracking-wide">
            {modeLabel(search.mode, search.directoryConfig?.source)}
          </span>
        </div>
        <div className="flex items-center gap-3 sm:gap-4 text-[11px] text-cloudy tabular whitespace-nowrap">
          <span>
            Leads: <span className="text-gray-700 font-medium">{leads.length}</span>/{search.maxResults}
          </span>
          <span>
            Cost: <span className="text-gray-700 font-medium">${search.costUsd.toFixed(3)}</span>
          </span>
        </div>
      </div>

      {/* query summary */}
      <div className="px-5 py-3 border-b border-cloudy/20 bg-pampas/40">
        <QuerySummary search={search} />
      </div>

      {/* agent note / error */}
      {search.agentNote && (
        <div className="px-5 py-2 border-b border-cloudy/20 text-[11px] text-cloudy">
          Agent note: {search.agentNote}
        </div>
      )}
      {search.error && (
        <div className="px-5 py-2 border-b border-cloudy/20 bg-red-50 text-xs text-red-700 flex items-center gap-2">
          <AlertCircle className="w-3.5 h-3.5" /> {search.error}
        </div>
      )}

      {/* results table */}
      {leads.length === 0 ? (
        <div className="p-10 text-center text-sm text-cloudy">
          {isRunning ? (
            <span className="inline-flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Agent is searching the web…
            </span>
          ) : (
            "No companies found. Try loosening the ICP, or add more seed companies."
          )}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-pampas/60 border-b border-cloudy/20">
              <tr>
                <th className="px-3 py-2 w-8">
                  <input
                    type="checkbox"
                    checked={allChecked}
                    onChange={toggleAll}
                    className="accent-brand-500"
                    aria-label="Select all"
                  />
                </th>
                <th className="px-3 py-2 text-left font-medium text-gray-600">Company</th>
                <th className="px-3 py-2 text-left font-medium text-gray-600">Location</th>
                <th className="px-3 py-2 text-left font-medium text-gray-600">Industry</th>
                <th className="px-3 py-2 text-left font-medium text-gray-600">Match reason</th>
                <th className="px-3 py-2 text-right font-medium text-gray-600 w-16">Score</th>
              </tr>
            </thead>
            <tbody>
              {leads.map((l) => (
                <tr key={l.id} className="border-b border-cloudy/10 hover:bg-pampas/40">
                  <td className="px-3 py-2 align-top">
                    <input
                      type="checkbox"
                      checked={selected.has(l.id)}
                      onChange={() => toggle(l.id)}
                      className="accent-brand-500"
                      aria-label={`Select ${l.companyName}`}
                    />
                  </td>
                  <td className="px-3 py-2 align-top">
                    <div className="font-medium text-gray-800">{l.companyName}</div>
                    <div className="flex gap-2 flex-wrap mt-0.5">
                      {l.websiteUrl && (
                        <a
                          href={l.websiteUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[11px] text-brand-500 hover:underline inline-flex items-center gap-0.5"
                        >
                          website <ExternalLink className="w-2.5 h-2.5" />
                        </a>
                      )}
                      {l.linkedinUrl && (
                        <a
                          href={l.linkedinUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[11px] text-brand-500 hover:underline inline-flex items-center gap-0.5"
                        >
                          linkedin <ExternalLink className="w-2.5 h-2.5" />
                        </a>
                      )}
                    </div>
                    {l.description && (
                      <p className="text-[11px] text-cloudy mt-0.5 line-clamp-2">{l.description}</p>
                    )}
                  </td>
                  <td className="px-3 py-2 align-top text-gray-700">{l.location ?? "—"}</td>
                  <td className="px-3 py-2 align-top text-gray-700">{l.industry ?? "—"}</td>
                  <td className="px-3 py-2 align-top text-gray-600 max-w-md">
                    <p className="line-clamp-2">{l.matchReason ?? "—"}</p>
                    {l.sourceUrl && (
                      <a
                        href={l.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[10px] text-cloudy hover:text-brand-500 hover:underline inline-flex items-center gap-0.5 mt-0.5"
                      >
                        source <ExternalLink className="w-2.5 h-2.5" />
                      </a>
                    )}
                  </td>
                  <td className="px-3 py-2 align-top text-right text-gray-700 tabular">
                    {l.score !== undefined ? l.score : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* log toggle */}
      {search.discoveryLog.length > 0 && (
        <div className="px-5 py-2 border-t border-cloudy/20">
          <button
            onClick={() => setLogOpen((v) => !v)}
            className="text-[11px] text-cloudy hover:text-brand-500 inline-flex items-center gap-1"
          >
            {logOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            Agent log ({search.discoveryLog.length} line{search.discoveryLog.length !== 1 ? "s" : ""})
          </button>
          {logOpen && (
            <pre className="mt-2 text-[10px] text-cloudy bg-pampas/60 p-2 rounded max-h-48 overflow-auto font-mono whitespace-pre-wrap">
              {search.discoveryLog.join("\n")}
            </pre>
          )}
        </div>
      )}

      {/* action bar */}
      {leads.length > 0 && (
        <div className="px-4 sm:px-5 py-3 border-t border-cloudy/20 bg-pampas/30 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-3">
          <div className="text-xs text-cloudy">
            {selected.size > 0 ? (
              <span>
                <span className="font-medium text-gray-700">{selected.size}</span> selected
              </span>
            ) : (
              <span>None selected (actions will apply to all)</span>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => setShowFields((v) => !v)}
              className="text-xs px-2.5 py-1.5 rounded-md border border-cloudy/40 text-gray-600 hover:bg-white transition-colors"
            >
              Enrichment fields ({enrichFields.length})
            </button>
            <button
              onClick={downloadCsv}
              className="text-xs px-2.5 py-1.5 rounded-md border border-cloudy/40 text-gray-600 hover:bg-white transition-colors inline-flex items-center gap-1"
            >
              <Download className="w-3 h-3" /> CSV
            </button>
            <button
              onClick={enrichSelected}
              disabled={enriching}
              className="text-xs px-3 py-1.5 rounded-md bg-brand-500 text-white hover:bg-brand-600 disabled:opacity-50 transition-colors inline-flex items-center gap-1.5"
            >
              {enriching ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Sparkles className="w-3 h-3" />
              )}
              Enrich as companies
            </button>
          </div>
        </div>
      )}

      {showFields && (
        <div className="px-5 py-3 border-t border-cloudy/20 bg-white">
          <p className="text-[11px] font-semibold text-cloudy uppercase tracking-wider mb-2">
            Company fields to enrich
          </p>
          <div className="space-y-2">
            {COMPANY_FIELD_GROUPS.map((group) => (
              <div key={group.label}>
                <p className="text-[10px] font-semibold text-cloudy uppercase tracking-wider mb-1">
                  {group.label}
                </p>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-1">
                  {group.fields
                    .filter((f) => !f.isParameterized)
                    .map((f) => {
                      const checked = enrichFields.includes(f.key);
                      return (
                        <label
                          key={f.key}
                          className={clsx(
                            "flex items-center gap-2 px-2 py-1 rounded-md border cursor-pointer text-[11px] select-none transition-colors",
                            checked
                              ? "bg-brand-50 border-brand-200 text-gray-800"
                              : "border-cloudy/30 hover:bg-pampas text-gray-600"
                          )}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => {
                              setUserEditedFields(true);
                              setEnrichFields((prev) =>
                                prev.includes(f.key)
                                  ? prev.filter((k) => k !== f.key)
                                  : [...prev, f.key]
                              );
                            }}
                            className="accent-brand-500"
                          />
                          {f.label}
                        </label>
                      );
                    })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {actionError && (
        <div className="px-5 py-2 border-t border-cloudy/20 bg-red-50 text-xs text-red-700 flex items-center gap-2">
          <AlertCircle className="w-3.5 h-3.5" /> {actionError}
        </div>
      )}
    </div>
  );
}

// ----------------------------------------------------------------
// Past searches list
// ----------------------------------------------------------------

function PastSearches({
  searches,
  onPick,
}: {
  searches: DiscoverySearch[];
  onPick: (id: string) => void;
}) {
  return (
    <div>
      <p className="text-[11px] font-semibold text-cloudy uppercase tracking-widest mb-2">
        Previous searches
      </p>
      <div className="grid gap-2">
        {searches.map((s) => (
          <button
            key={s.id}
            onClick={() => onPick(s.id)}
            className="bg-white border border-cloudy/30 rounded-lg px-3 sm:px-4 py-2.5 text-left hover:border-brand-200 transition-colors flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1.5 sm:gap-3"
          >
            <div className="min-w-0 flex items-center gap-2 flex-wrap">
              <StatusBadge status={s.status} compact />
              <span className="text-sm font-medium text-gray-800 truncate">{s.name}</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-600 uppercase tracking-wide">
                {modeLabel(s.mode, s.directoryConfig?.source)}
              </span>
            </div>
            <div className="flex items-center gap-3 text-[11px] text-cloudy tabular whitespace-nowrap">
              <span>{s.discoveredCount} lead(s)</span>
              <span>${s.costUsd.toFixed(3)}</span>
              <ChevronRight className="w-3.5 h-3.5 hidden sm:inline" />
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function modeLabel(mode: DiscoveryMode, source?: DirectorySource): string {
  switch (mode) {
    case "icp":
      return "ICP search";
    case "lookalike":
      return "Look-alike";
    case "signal_funding":
      return "Funding signal";
    case "signal_hiring":
      return "Hiring signal";
    case "signal_news":
      return "News signal";
    case "signal_reviews":
      return "Reviews signal";
    case "directory":
      return source ? `Directory · ${DIRECTORY_META[source].label}` : "Directory";
    default:
      return mode;
  }
}

function QuerySummary({ search }: { search: DiscoverySearch }) {
  if (search.mode === "lookalike") {
    return (
      <div className="text-xs text-gray-600">
        <span className="font-medium text-gray-700">Seeds: </span>
        {(search.seedCompanies ?? []).join(", ")}
        {search.queryText && (
          <p className="mt-0.5 italic">&ldquo;{search.queryText}&rdquo;</p>
        )}
      </div>
    );
  }
  if (search.mode === "directory" && search.directoryConfig) {
    const c = search.directoryConfig;
    const bits: string[] = [DIRECTORY_META[c.source].label];
    if (c.batch) bits.push(`batch ${c.batch}`);
    if (c.category) bits.push(`category: ${c.category}`);
    if (c.techStack) bits.push(`tech: ${c.techStack}`);
    if (c.geo) bits.push(`geo: ${c.geo}`);
    if (c.query) bits.push(`query: ${c.query}`);
    if (c.url) bits.push(c.url);
    return (
      <div className="text-xs text-gray-600">
        <span className="font-medium text-gray-700">Source: </span>
        {bits.join(" · ")}
        {search.queryText && (
          <p className="mt-0.5 italic">&ldquo;{search.queryText}&rdquo;</p>
        )}
      </div>
    );
  }
  // icp and signal modes both have a meaningful queryText
  return (
    <p className="text-xs text-gray-600 italic line-clamp-3">
      &ldquo;{search.queryText}&rdquo;
    </p>
  );
}

function StatusBadge({
  status,
  compact = false,
}: {
  status: DiscoveryStatus;
  compact?: boolean;
}) {
  const map: Record<
    DiscoveryStatus,
    { label: string; icon: typeof CheckCircle2; cls: string }
  > = {
    queued: { label: "Queued", icon: Loader2, cls: "bg-gray-100 text-gray-600" },
    running: { label: "Running", icon: Loader2, cls: "bg-blue-100 text-blue-700" },
    completed: { label: "Done", icon: CheckCircle2, cls: "bg-green-100 text-green-700" },
    failed: { label: "Failed", icon: XCircle, cls: "bg-red-100 text-red-700" },
    cancelled: { label: "Cancelled", icon: XCircle, cls: "bg-gray-100 text-gray-600" },
  };
  const m = map[status];
  const Icon = m.icon;
  const spinning = status === "running" || status === "queued";
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 rounded-full uppercase tracking-wide font-medium",
        compact ? "text-[9px] px-1.5 py-0.5" : "text-[10px] px-2 py-0.5",
        m.cls
      )}
    >
      <Icon className={clsx(compact ? "w-2.5 h-2.5" : "w-3 h-3", spinning && "animate-spin")} />
      {m.label}
    </span>
  );
}
