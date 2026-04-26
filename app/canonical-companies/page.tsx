"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Layers,
  Loader2,
  Phone,
  Globe,
  MapPin,
  Star,
  ShieldCheck,
  Sparkles,
  RefreshCw,
} from "lucide-react";
import { clsx } from "clsx";

type CanonicalCompany = {
  id: string;
  workspaceId: string;
  identityKey: string;
  companyName: string;
  websiteUrl?: string;
  domain?: string;
  phone?: string;
  streetAddress?: string;
  city?: string;
  region?: string;
  postalCode?: string;
  countryCode?: string;
  lat?: number;
  lng?: number;
  geohash?: string;
  industry?: string;
  categories: string[];
  hours?: string;
  googleRating?: number;
  googleReviewCount?: number;
  yelpRating?: number;
  yelpReviewCount?: number;
  bbbRating?: string;
  bbbAccredited?: boolean;
  yearsInBusiness?: number;
  naicsCode?: string;
  licenseNumber?: string;
  seenInSources: string[];
  sourceCount: number;
  firstSeenAt: number;
  lastSeenAt: number;
};

const SOURCE_LABELS: Record<string, string> = {
  google_places: "Google",
  google_maps: "Google (agent)",
  google_lsa: "Google LSA",
  foursquare: "Foursquare",
  bing_places: "Bing",
  tomtom: "TomTom",
  here_places: "HERE",
  osm_overpass: "OSM",
  bbb: "BBB",
  bbb_direct: "BBB",
  yelp: "Yelp",
  yelp_direct: "Yelp",
  apify: "Apify",
  yellowpages: "YP",
  manta: "Manta",
  houzz: "Houzz",
  nextdoor: "Nextdoor",
  opentable: "OpenTable",
  tripadvisor: "TripAdvisor",
  delivery_marketplace: "Delivery",
  state_license_board: "State License",
  state_sos: "State SoS",
  facebook_pages: "Facebook",
  angi: "Angi",
  custom: "Custom",
  firecrawl_search: "Firecrawl",
  yc: "YC",
  producthunt: "PH",
  github: "GitHub",
  tech_stack: "Tech Stack",
  icp: "ICP",
  lookalike: "Lookalike",
  signal_funding: "Funding",
  signal_hiring: "Hiring",
  signal_news: "News",
  signal_reviews: "Reviews",
  signal_new_business: "New biz",
  signal_license: "License",
};

function sourceLabel(slug: string): string {
  return SOURCE_LABELS[slug] ?? slug;
}

export default function CanonicalCompaniesPage() {
  const [companies, setCompanies] = useState<CanonicalCompany[] | null>(null);
  const [error, setError] = useState("");
  const [minSources, setMinSources] = useState(1);
  const [search, setSearch] = useState("");
  const [backfilling, setBackfilling] = useState(false);
  const [backfillResult, setBackfillResult] = useState<string>("");

  const load = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/canonical-companies?minSources=${minSources}&limit=500`
      );
      const data = await res.json();
      setCompanies(data.companies ?? []);
    } catch {
      setError("Failed to load canonical companies");
    }
  }, [minSources]);

  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  const runBackfill = useCallback(async () => {
    setBackfilling(true);
    setBackfillResult("");
    try {
      const res = await fetch("/api/canonical-companies/backfill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) {
        setBackfillResult(`Backfill failed: ${data.error ?? res.statusText}`);
      } else {
        setBackfillResult(
          `Backfill: processed ${data.processed}, linked ${data.linked}, skipped ${data.skipped}`
        );
        load();
      }
    } catch (err) {
      setBackfillResult(`Backfill failed: ${String(err)}`);
    } finally {
      setBackfilling(false);
    }
  }, [load]);

  const filtered = useMemo(() => {
    if (!companies) return null;
    const q = search.trim().toLowerCase();
    if (!q) return companies;
    return companies.filter((c) => {
      return (
        c.companyName.toLowerCase().includes(q) ||
        (c.domain ?? "").toLowerCase().includes(q) ||
        (c.phone ?? "").includes(q) ||
        (c.city ?? "").toLowerCase().includes(q) ||
        (c.region ?? "").toLowerCase().includes(q)
      );
    });
  }, [companies, search]);

  const stats = useMemo(() => {
    if (!companies) return null;
    return {
      total: companies.length,
      multi: companies.filter((c) => c.sourceCount >= 2).length,
      triple: companies.filter((c) => c.sourceCount >= 3).length,
    };
  }, [companies]);

  return (
    <div className="min-h-screen pb-16">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-4 sm:pt-6 space-y-4 sm:space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Layers
                className="w-5 h-5 text-brand-500 flex-shrink-0"
                strokeWidth={2}
              />
              <h1 className="text-2xl sm:text-3xl font-serif font-bold text-gray-900 tracking-tight">
                Canonical companies
              </h1>
            </div>
            <p className="text-sm text-cloudy mt-1">
              One row per real-world business — deduped across every discovery
              source. <em>Found by N sources</em> is a confidence signal: the
              same SMB seen on Google + Yelp + BBB + Foursquare is real.
            </p>
          </div>
          <button
            onClick={runBackfill}
            disabled={backfilling}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-cloudy/30 text-xs font-medium text-gray-700 hover:bg-pampas/60 transition-colors disabled:opacity-60 self-start sm:self-auto"
            title="Resolve canonical companies for any pre-existing leads that landed before Phase 3"
          >
            {backfilling ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <RefreshCw className="w-3.5 h-3.5" />
            )}
            Backfill old leads
          </button>
        </div>

        {error && (
          <div className="flex items-center gap-2 px-3 py-2 bg-red-50 border border-red-200 rounded-md text-xs text-red-700">
            <AlertCircle className="w-3.5 h-3.5" /> {error}
          </div>
        )}

        {backfillResult && (
          <div className="flex items-center gap-2 px-3 py-2 bg-pampas/60 border border-cloudy/30 rounded-md text-xs text-gray-700">
            <Sparkles className="w-3.5 h-3.5 text-brand-500" />
            {backfillResult}
          </div>
        )}

        {stats && (
          <div className="grid grid-cols-3 gap-3">
            <Stat label="Companies" value={stats.total.toLocaleString()} />
            <Stat
              label="Multi-source (≥2)"
              value={stats.multi.toLocaleString()}
              tone="brand"
            />
            <Stat
              label="Triple-confirmed (≥3)"
              value={stats.triple.toLocaleString()}
              tone="brand"
            />
          </div>
        )}

        <div className="flex flex-col sm:flex-row gap-3">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, domain, phone, city…"
            className="flex-1 border border-cloudy/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent transition"
          />
          <div className="inline-flex items-center gap-2 bg-white/60 border border-cloudy/30 rounded-lg px-3 py-2 text-xs text-gray-700">
            Min sources
            <select
              value={minSources}
              onChange={(e) => setMinSources(parseInt(e.target.value, 10))}
              className="bg-transparent border-none focus:outline-none focus:ring-0 text-xs font-medium"
            >
              <option value={1}>1+</option>
              <option value={2}>2+</option>
              <option value={3}>3+</option>
              <option value={4}>4+</option>
              <option value={5}>5+</option>
            </select>
          </div>
        </div>

        {filtered === null ? (
          <div className="text-sm text-cloudy flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading…
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState minSources={minSources} hasSearch={!!search.trim()} />
        ) : (
          <div className="bg-white border border-cloudy/30 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full text-xs">
                <thead>
                  <tr className="bg-pampas/60 text-left text-[10px] uppercase tracking-wider text-cloudy">
                    <th className="px-3 py-2 font-semibold">Company</th>
                    <th className="px-3 py-2 font-semibold">Sources</th>
                    <th className="px-3 py-2 font-semibold">Contact</th>
                    <th className="px-3 py-2 font-semibold">Location</th>
                    <th className="px-3 py-2 font-semibold">Signals</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((c) => (
                    <CompanyRow key={c.id} company={c} />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function CompanyRow({ company }: { company: CanonicalCompany }) {
  return (
    <tr className="border-t border-cloudy/10 align-top hover:bg-pampas/40">
      <td className="px-3 py-3">
        <div className="font-medium text-gray-900">{company.companyName}</div>
        {company.industry && (
          <div className="text-[11px] text-cloudy mt-0.5">{company.industry}</div>
        )}
        {company.domain && (
          <a
            href={company.websiteUrl ?? `https://${company.domain}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[11px] text-brand-600 hover:underline mt-0.5"
          >
            <Globe className="w-3 h-3" /> {company.domain}
          </a>
        )}
      </td>
      <td className="px-3 py-3 max-w-[220px]">
        <div className="text-[10px] uppercase tracking-wider text-cloudy font-semibold mb-1">
          {company.sourceCount}
        </div>
        <div className="flex flex-wrap gap-1">
          {company.seenInSources.map((s) => (
            <span
              key={s}
              className="inline-flex items-center px-1.5 py-0.5 rounded bg-pampas border border-cloudy/30 text-[10px] text-gray-700"
            >
              {sourceLabel(s)}
            </span>
          ))}
        </div>
      </td>
      <td className="px-3 py-3">
        {company.phone && (
          <div className="inline-flex items-center gap-1 text-[11px] text-gray-700 tabular">
            <Phone className="w-3 h-3" /> {formatPhone(company.phone)}
          </div>
        )}
      </td>
      <td className="px-3 py-3">
        {(company.streetAddress || company.city) && (
          <div className="inline-flex items-start gap-1 text-[11px] text-gray-700">
            <MapPin className="w-3 h-3 mt-0.5 flex-shrink-0" />
            <div className="leading-snug">
              {company.streetAddress && <div>{company.streetAddress}</div>}
              <div className="text-cloudy">
                {[company.city, company.region, company.postalCode]
                  .filter(Boolean)
                  .join(", ")}
              </div>
            </div>
          </div>
        )}
      </td>
      <td className="px-3 py-3">
        <div className="flex flex-col gap-1 text-[11px]">
          {company.googleRating !== undefined && (
            <SignalBadge
              icon={<Star className="w-3 h-3" />}
              label="Google"
              value={`${company.googleRating.toFixed(1)}★${
                company.googleReviewCount ? ` · ${company.googleReviewCount}` : ""
              }`}
            />
          )}
          {company.yelpRating !== undefined && (
            <SignalBadge
              icon={<Star className="w-3 h-3" />}
              label="Yelp"
              value={`${company.yelpRating.toFixed(1)}★${
                company.yelpReviewCount ? ` · ${company.yelpReviewCount}` : ""
              }`}
            />
          )}
          {company.bbbRating && (
            <SignalBadge
              icon={<ShieldCheck className="w-3 h-3" />}
              label="BBB"
              value={`${company.bbbRating}${
                company.bbbAccredited ? " · Accredited" : ""
              }`}
            />
          )}
          {company.yearsInBusiness !== undefined && (
            <span className="text-[11px] text-cloudy">
              {company.yearsInBusiness}y in business
            </span>
          )}
        </div>
      </td>
    </tr>
  );
}

function SignalBadge({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-gray-700">
      <span className="text-cloudy">{icon}</span>
      <span className="text-cloudy">{label}</span>
      <span className="font-medium tabular">{value}</span>
    </span>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "brand";
}) {
  return (
    <div className="bg-white border border-cloudy/30 rounded-xl p-3">
      <p className="text-[10px] uppercase tracking-wider text-cloudy font-semibold">
        {label}
      </p>
      <p
        className={clsx(
          "text-xl sm:text-2xl font-serif font-semibold mt-0.5 tabular",
          tone === "brand" ? "text-brand-600" : "text-gray-900"
        )}
      >
        {value}
      </p>
    </div>
  );
}

function EmptyState({
  minSources,
  hasSearch,
}: {
  minSources: number;
  hasSearch: boolean;
}) {
  return (
    <div className="bg-white border border-cloudy/30 rounded-xl px-6 py-10 text-center text-sm text-cloudy">
      {hasSearch
        ? "No canonical companies match that search."
        : minSources > 1
        ? `No companies seen by ${minSources}+ sources yet. Lower the filter to "1+" to see all canonicals, or run more discovery searches across sources.`
        : "No canonical companies yet. Run a discovery search on /discover or backfill from existing leads."}
    </div>
  );
}

function formatPhone(raw: string): string {
  // Normalised phones in storage are digits only; render the common
  // North American grouping when length matches.
  const d = raw.replace(/\D/g, "");
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  if (d.length === 11 && d.startsWith("1"))
    return `+1 (${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`;
  return raw;
}
