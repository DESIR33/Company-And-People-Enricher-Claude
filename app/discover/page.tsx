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
} from "lucide-react";
import { clsx } from "clsx";
import { COMPANY_FIELD_GROUPS } from "@/lib/enrichment-fields";

type DiscoveryMode =
  | "icp"
  | "lookalike"
  | "signal_funding"
  | "signal_hiring"
  | "signal_news"
  | "directory";

type DirectorySource =
  | "yc"
  | "producthunt"
  | "github"
  | "google_maps"
  | "tech_stack"
  | "custom";

type DirectoryConfig = {
  source: DirectorySource;
  category?: string;
  query?: string;
  geo?: string;
  url?: string;
  techStack?: string;
  batch?: string;
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
  const searchParams = useSearchParams();
  const deepLinkId = searchParams.get("search");

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
      <div className="max-w-6xl mx-auto px-6 pt-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Target className="w-5 h-5 text-brand-500" strokeWidth={2} />
              <h1 className="text-3xl font-serif font-bold text-gray-900 tracking-tight">
                Discover
              </h1>
            </div>
            <p className="text-sm text-cloudy mt-1">
              Generate lead lists from scratch. Describe your ICP or paste seed companies — the agent searches the web and returns candidates you can feed into enrichment.
            </p>
          </div>
          <button
            onClick={() => setCreating((v) => !v)}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-brand-500 text-white text-sm font-medium hover:bg-brand-600 transition-colors"
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
  { label: string; icon: typeof BookOpen; hint: string }
> = {
  yc: {
    label: "Y Combinator",
    icon: BookOpen,
    hint: "Pull from the YC directory — filter by batch, category, or free text.",
  },
  producthunt: {
    label: "Product Hunt",
    icon: Rocket,
    hint: "Recent launches by topic. Good for finding new, product-led companies.",
  },
  github: {
    label: "GitHub Topics",
    icon: Code,
    hint: "Commercial orgs behind active repos on a given topic. Good for dev-tool ICPs.",
  },
  google_maps: {
    label: "Google Maps",
    icon: MapPin,
    hint: "Local businesses by category + geography. Best for field-services ICPs.",
  },
  tech_stack: {
    label: "Tech Stack",
    icon: Cpu,
    hint: "Companies publicly using a given product (BuiltWith, G2, case studies).",
  },
  custom: {
    label: "Custom URL",
    icon: LinkIcon,
    hint: "Paste any directory page URL. The agent extracts companies from it.",
  },
};

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

  const [dirSource, setDirSource] = useState<DirectorySource>("yc");
  const [dirCategory, setDirCategory] = useState("");
  const [dirQuery, setDirQuery] = useState("");
  const [dirGeo, setDirGeo] = useState("");
  const [dirUrl, setDirUrl] = useState("");
  const [dirTechStack, setDirTechStack] = useState("");
  const [dirBatch, setDirBatch] = useState("");
  const [dirExtra, setDirExtra] = useState("");

  const seedCompanies = useMemo(
    () =>
      seedText
        .split(/\n/)
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 10),
    [seedText]
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

      body = {
        mode: "directory",
        name: trimmedName,
        directoryConfig,
        queryText: dirExtra.trim(),
        maxResults,
      };
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
          <div className="grid grid-cols-3 gap-2">
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
                </p>
              )}
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
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {(Object.keys(DIRECTORY_META) as DirectorySource[]).map((s) => {
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

            {dirSource === "google_maps" && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Business category
                  </label>
                  <input
                    value={dirCategory}
                    onChange={(e) => setDirCategory(e.target.value)}
                    placeholder="HVAC contractor, dentist, gym"
                    className="w-full border border-cloudy/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent transition"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Geography
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
      <div className="px-5 py-4 border-b border-cloudy/20 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <StatusBadge status={search.status} />
          <h2 className="text-sm font-semibold text-gray-800 truncate">{search.name}</h2>
          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-600 uppercase tracking-wide">
            {modeLabel(search.mode, search.directoryConfig?.source)}
          </span>
        </div>
        <div className="flex items-center gap-4 text-[11px] text-cloudy tabular whitespace-nowrap">
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
        <div className="px-5 py-3 border-t border-cloudy/20 bg-pampas/30 flex items-center justify-between gap-3 flex-wrap">
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
                            onChange={() =>
                              setEnrichFields((prev) =>
                                prev.includes(f.key)
                                  ? prev.filter((k) => k !== f.key)
                                  : [...prev, f.key]
                              )
                            }
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
            className="bg-white border border-cloudy/30 rounded-lg px-4 py-2.5 text-left hover:border-brand-200 transition-colors flex items-center justify-between gap-3"
          >
            <div className="min-w-0 flex items-center gap-2">
              <StatusBadge status={s.status} compact />
              <span className="text-sm font-medium text-gray-800 truncate">{s.name}</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-600 uppercase tracking-wide">
                {modeLabel(s.mode, s.directoryConfig?.source)}
              </span>
            </div>
            <div className="flex items-center gap-3 text-[11px] text-cloudy tabular whitespace-nowrap">
              <span>{s.discoveredCount} lead(s)</span>
              <span>${s.costUsd.toFixed(3)}</span>
              <ChevronRight className="w-3.5 h-3.5" />
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
