"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  Banknote,
  Briefcase,
  Newspaper,
  Plus,
  Play,
  Pause,
  Clock,
  Loader2,
  ChevronRight,
  Trash2,
  Zap,
} from "lucide-react";
import { clsx } from "clsx";

type SignalType = "funding" | "hiring" | "news";
type Schedule = "manual" | "once" | "daily" | "weekly" | "monthly";

type SignalMonitor = {
  id: string;
  name: string;
  signalType: SignalType;
  config: Record<string, unknown>;
  schedule: Schedule;
  active: boolean;
  maxResults: number;
  timeframe: string;
  createdAt: number;
  lastRunAt?: number;
  nextRunAt?: number;
  runCount: number;
  leadCountTotal: number;
  costUsdTotal: number;
};

type DiscoverySearch = {
  id: string;
  name: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  createdAt: number;
  discoveredCount: number;
  costUsd: number;
};

const SIGNAL_META: Record<
  SignalType,
  { label: string; icon: typeof Banknote; hint: string; accent: string }
> = {
  funding: {
    label: "Funding",
    icon: Banknote,
    hint: "Companies that just raised — TechCrunch, Crunchbase, SEC Form D",
    accent: "text-emerald-600",
  },
  hiring: {
    label: "Hiring",
    icon: Briefcase,
    hint: "Companies posting open roles — LinkedIn Jobs, Indeed, careers pages",
    accent: "text-indigo-600",
  },
  news: {
    label: "News",
    icon: Newspaper,
    hint: "Expansions, launches, partnerships — Google News, local business journals",
    accent: "text-amber-600",
  },
};

const SCHEDULE_LABEL: Record<Schedule, string> = {
  manual: "Manual only",
  once: "Run once",
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
};

export default function SignalsPage() {
  const [monitors, setMonitors] = useState<SignalMonitor[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/signals");
      const data = await res.json();
      setMonitors(data.monitors ?? []);
    } catch {
      setError("Failed to load signal monitors");
    }
  }, []);

  useEffect(() => {
    const first = setTimeout(load, 0);
    const id = setInterval(load, 8000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [load]);

  return (
    <div className="min-h-screen pb-16">
      <div className="max-w-5xl mx-auto px-6 pt-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Zap className="w-5 h-5 text-brand-500" strokeWidth={2} />
              <h1 className="text-3xl font-serif font-bold text-gray-900 tracking-tight">
                Signal Monitors
              </h1>
            </div>
            <p className="text-sm text-cloudy mt-1">
              Scheduled lead sourcing from buying-intent signals. Each run drops fresh companies into the discovery pool, deduped against prior runs.
            </p>
          </div>
          <button
            onClick={() => setCreating((v) => !v)}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-brand-500 text-white text-sm font-medium hover:bg-brand-600 transition-colors"
          >
            <Plus className="w-4 h-4" />
            {creating ? "Cancel" : "New signal monitor"}
          </button>
        </div>

        {error && (
          <div className="flex items-center gap-2.5 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            <AlertCircle className="w-4 h-4" />
            {error}
          </div>
        )}

        {creating && (
          <CreateForm
            onCancel={() => setCreating(false)}
            onCreated={() => {
              setCreating(false);
              load();
            }}
          />
        )}

        {monitors === null ? (
          <div className="text-sm text-cloudy flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading monitors…
          </div>
        ) : monitors.length === 0 && !creating ? (
          <div className="bg-white border border-cloudy/30 rounded-xl p-10 text-center">
            <Zap className="w-8 h-8 text-cloudy mx-auto mb-3" strokeWidth={1.5} />
            <h2 className="text-sm font-semibold text-gray-900">No signal monitors yet</h2>
            <p className="text-xs text-cloudy mt-1 max-w-md mx-auto">
              Create one to auto-surface companies that just raised, are hiring, or made the news. Runs on a schedule and drops fresh leads into the discovery pool.
            </p>
            <button
              onClick={() => setCreating(true)}
              className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-brand-500 text-white text-sm font-medium hover:bg-brand-600 transition-colors"
            >
              <Plus className="w-4 h-4" />
              Create your first signal monitor
            </button>
          </div>
        ) : (
          <div className="grid gap-3">
            {monitors.map((m) => (
              <MonitorCard key={m.id} monitor={m} onChanged={load} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ----------------------------------------------------------------
// Monitor card
// ----------------------------------------------------------------

function MonitorCard({
  monitor,
  onChanged,
}: {
  monitor: SignalMonitor;
  onChanged: () => void;
}) {
  const meta = SIGNAL_META[monitor.signalType];
  const Icon = meta.icon;
  const [busy, setBusy] = useState<"toggle" | "trigger" | "delete" | null>(null);
  const [runs, setRuns] = useState<DiscoverySearch[] | null>(null);
  const [expanded, setExpanded] = useState(false);

  const loadRuns = useCallback(async () => {
    try {
      const res = await fetch(`/api/signals/${monitor.id}`);
      const data = await res.json();
      setRuns(data.runs ?? []);
    } catch {
      // transient; retry on next expand
    }
  }, [monitor.id]);

  useEffect(() => {
    if (!expanded) return;
    const t = setTimeout(loadRuns, 0);
    return () => clearTimeout(t);
  }, [expanded, loadRuns]);

  const toggle = async () => {
    setBusy("toggle");
    try {
      await fetch(`/api/signals/${monitor.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !monitor.active }),
      });
      onChanged();
    } finally {
      setBusy(null);
    }
  };

  const trigger = async () => {
    setBusy("trigger");
    try {
      const res = await fetch(`/api/signals/${monitor.id}/trigger`, {
        method: "POST",
      });
      if (res.ok) {
        setExpanded(true);
        loadRuns();
        onChanged();
      }
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!confirm(`Delete signal monitor "${monitor.name}"?`)) return;
    setBusy("delete");
    try {
      await fetch(`/api/signals/${monitor.id}`, { method: "DELETE" });
      onChanged();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="bg-white border border-cloudy/30 rounded-xl overflow-hidden hover:border-brand-200 transition-colors">
      <div className="p-5 flex items-start gap-4">
        <div
          className={clsx(
            "w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 bg-pampas/60",
            meta.accent
          )}
        >
          <Icon className="w-5 h-5" strokeWidth={2} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => setExpanded((v) => !v)}
              className="text-sm font-semibold text-gray-900 hover:text-brand-500 transition-colors truncate"
            >
              {monitor.name}
            </button>
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-600 uppercase tracking-wide">
              {meta.label}
            </span>
            <span
              className={clsx(
                "text-[10px] font-medium px-1.5 py-0.5 rounded-full uppercase tracking-wide",
                monitor.active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"
              )}
            >
              {monitor.active ? "Active" : "Paused"}
            </span>
          </div>
          <p className="text-xs text-cloudy mt-1 truncate">
            {renderConfigSummary(monitor)}
          </p>
          <div className="flex items-center gap-4 mt-2 text-[11px] text-cloudy tabular flex-wrap">
            <span className="inline-flex items-center gap-1">
              <Clock className="w-3 h-3" /> {SCHEDULE_LABEL[monitor.schedule]} · {monitor.timeframe}
            </span>
            <span>Runs: <span className="text-gray-700 font-medium">{monitor.runCount}</span></span>
            <span>Leads: <span className="text-gray-700 font-medium">{monitor.leadCountTotal}</span></span>
            <span>Cost: <span className="text-gray-700 font-medium">${monitor.costUsdTotal.toFixed(3)}</span></span>
            {monitor.lastRunAt && (
              <span>Last run: {formatAgo(monitor.lastRunAt)}</span>
            )}
            {monitor.nextRunAt && monitor.active && (
              <span>Next: {formatAgo(monitor.nextRunAt, true)}</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={toggle}
            disabled={busy !== null}
            className="text-xs px-2.5 py-1.5 rounded-md border border-cloudy/40 text-gray-600 hover:bg-pampas disabled:opacity-50 transition-colors inline-flex items-center gap-1"
            title={monitor.active ? "Pause monitor" : "Activate monitor"}
          >
            {monitor.active ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
            {monitor.active ? "Pause" : "Start"}
          </button>
          <button
            onClick={trigger}
            disabled={busy !== null}
            className="text-xs px-2.5 py-1.5 rounded-md bg-brand-500 text-white hover:bg-brand-600 disabled:opacity-50 transition-colors inline-flex items-center gap-1"
          >
            {busy === "trigger" ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Play className="w-3 h-3" />
            )}
            Run now
          </button>
          <button
            onClick={remove}
            disabled={busy !== null}
            className="text-xs px-2 py-1.5 rounded-md border border-cloudy/40 text-gray-400 hover:text-red-600 hover:border-red-300 disabled:opacity-50 transition-colors"
            title="Delete monitor"
          >
            {busy === "delete" ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Trash2 className="w-3 h-3" />
            )}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-cloudy/20 bg-pampas/30">
          {runs === null ? (
            <div className="px-5 py-3 text-xs text-cloudy flex items-center gap-2">
              <Loader2 className="w-3 h-3 animate-spin" /> Loading runs…
            </div>
          ) : runs.length === 0 ? (
            <div className="px-5 py-3 text-xs text-cloudy">
              No runs yet. Hit &ldquo;Run now&rdquo; to produce the first batch.
            </div>
          ) : (
            <div className="divide-y divide-cloudy/10">
              {runs.map((r) => (
                <Link
                  key={r.id}
                  href={`/discover?search=${r.id}`}
                  className="flex items-center gap-3 px-5 py-2 text-xs hover:bg-white/60 transition-colors"
                >
                  <RunStatusDot status={r.status} />
                  <span className="flex-1 truncate text-gray-700">{r.name}</span>
                  <span className="text-cloudy tabular">
                    {r.discoveredCount} lead(s)
                  </span>
                  <span className="text-cloudy tabular w-16 text-right">
                    ${r.costUsd.toFixed(3)}
                  </span>
                  <span className="text-cloudy tabular">{formatAgo(r.createdAt)}</span>
                  <ChevronRight className="w-3 h-3 text-cloudy" />
                </Link>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function RunStatusDot({ status }: { status: DiscoverySearch["status"] }) {
  const cls: Record<DiscoverySearch["status"], string> = {
    queued: "bg-gray-300",
    running: "bg-blue-400 animate-pulse",
    completed: "bg-green-500",
    failed: "bg-red-500",
    cancelled: "bg-gray-400",
  };
  return <span className={clsx("w-2 h-2 rounded-full", cls[status])} />;
}

function renderConfigSummary(m: SignalMonitor): string {
  const c = m.config as Record<string, unknown>;
  const bits: string[] = [];
  if (typeof c.industryFilter === "string") bits.push(`Industry: ${c.industryFilter}`);
  if (typeof c.geoFilter === "string") bits.push(`Geo: ${c.geoFilter}`);
  if (typeof c.sizeFilter === "string") bits.push(`Size: ${c.sizeFilter}`);
  if (m.signalType === "funding") {
    if (Array.isArray(c.stageFilter) && c.stageFilter.length)
      bits.push(`Stages: ${(c.stageFilter as string[]).join(", ")}`);
  }
  if (m.signalType === "hiring" && Array.isArray(c.roles) && c.roles.length) {
    bits.push(`Roles: ${(c.roles as string[]).join(", ")}`);
  }
  if (m.signalType === "news" && Array.isArray(c.keywords) && c.keywords.length) {
    bits.push(`Keywords: ${(c.keywords as string[]).join(", ")}`);
  }
  return bits.join(" · ") || "No filters";
}

function formatAgo(ms: number, future = false): string {
  const diff = future ? ms - Date.now() : Date.now() - ms;
  const abs = Math.abs(diff);
  const m = Math.floor(abs / 60_000);
  if (m < 1) return future ? "now" : "just now";
  if (m < 60) return future ? `in ${m}m` : `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return future ? `in ${h}h` : `${h}h ago`;
  const d = Math.floor(h / 24);
  return future ? `in ${d}d` : `${d}d ago`;
}

// ----------------------------------------------------------------
// Create form
// ----------------------------------------------------------------

function CreateForm({
  onCancel,
  onCreated,
}: {
  onCancel: () => void;
  onCreated: () => void;
}) {
  const [signalType, setSignalType] = useState<SignalType>("funding");
  const [name, setName] = useState("");
  const [schedule, setSchedule] = useState<Schedule>("weekly");
  const [timeframe, setTimeframe] = useState("last 14 days");
  const [maxResults, setMaxResults] = useState(25);
  const [runNow, setRunNow] = useState(true);

  const [industryFilter, setIndustryFilter] = useState("");
  const [geoFilter, setGeoFilter] = useState("");
  const [sizeFilter, setSizeFilter] = useState("");
  const [icpHint, setIcpHint] = useState("");

  const [stageFilterText, setStageFilterText] = useState("");
  const [minAmount, setMinAmount] = useState<string>("");
  const [maxAmount, setMaxAmount] = useState<string>("");

  const [rolesText, setRolesText] = useState("");
  const [keywordsText, setKeywordsText] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const stages = useMemo(
    () =>
      stageFilterText
        .split(/[\n,]/)
        .map((s) => s.trim())
        .filter(Boolean),
    [stageFilterText]
  );
  const roles = useMemo(
    () =>
      rolesText
        .split(/[\n,]/)
        .map((s) => s.trim())
        .filter(Boolean),
    [rolesText]
  );
  const keywords = useMemo(
    () =>
      keywordsText
        .split(/[\n,]/)
        .map((s) => s.trim())
        .filter(Boolean),
    [keywordsText]
  );

  const submit = async () => {
    setError("");
    if (!name.trim()) return setError("Give the monitor a name.");
    if (signalType === "hiring" && roles.length === 0)
      return setError("Add at least one role (comma- or line-separated).");
    if (signalType === "news" && keywords.length === 0)
      return setError("Add at least one news keyword.");

    const body: Record<string, unknown> = {
      signalType,
      name: name.trim(),
      schedule,
      timeframe: timeframe.trim() || "last 14 days",
      maxResults,
      runNow,
    };
    if (industryFilter.trim()) body.industryFilter = industryFilter.trim();
    if (geoFilter.trim()) body.geoFilter = geoFilter.trim();
    if (sizeFilter.trim()) body.sizeFilter = sizeFilter.trim();
    if (icpHint.trim()) body.icpHint = icpHint.trim();

    if (signalType === "funding") {
      if (stages.length > 0) body.stageFilter = stages;
      if (minAmount.trim()) body.minAmount = Number(minAmount);
      if (maxAmount.trim()) body.maxAmount = Number(maxAmount);
    } else if (signalType === "hiring") {
      body.roles = roles;
    } else if (signalType === "news") {
      body.keywords = keywords;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/signals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? data.issues?.join("; ") ?? "Failed to create");
        return;
      }
      onCreated();
    } catch {
      setError("Network error creating signal monitor");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="bg-white border border-cloudy/30 rounded-xl overflow-hidden">
      <div className="px-5 py-4 border-b border-cloudy/20">
        <h2 className="text-sm font-semibold text-gray-700">New signal monitor</h2>
      </div>
      <div className="p-5 space-y-4">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={120}
            placeholder="e.g. SaaS Series A funding — Apr 2026"
            className="w-full border border-cloudy/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent transition"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-2">Signal type</label>
          <div className="grid grid-cols-3 gap-2">
            {(Object.keys(SIGNAL_META) as SignalType[]).map((t) => {
              const m = SIGNAL_META[t];
              const Icon = m.icon;
              const active = t === signalType;
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => setSignalType(t)}
                  className={clsx(
                    "text-left rounded-lg border p-3 transition-all",
                    active
                      ? "border-brand-300 bg-brand-50"
                      : "border-cloudy/30 hover:border-cloudy/50 hover:bg-pampas"
                  )}
                >
                  <div className="flex items-center gap-1.5 mb-1">
                    <Icon
                      className={clsx("w-3.5 h-3.5", active ? "text-brand-500" : m.accent)}
                      strokeWidth={2}
                    />
                    <span className="text-xs font-semibold text-gray-800">{m.label}</span>
                  </div>
                  <p className="text-[11px] text-cloudy leading-snug">{m.hint}</p>
                </button>
              );
            })}
          </div>
        </div>

        {/* Shared ICP filters */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Industry <span className="text-cloudy font-normal">(optional)</span>
            </label>
            <input
              value={industryFilter}
              onChange={(e) => setIndustryFilter(e.target.value)}
              placeholder="SaaS, AI/ML, Fintech"
              className="w-full border border-cloudy/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent transition"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Geography <span className="text-cloudy font-normal">(optional)</span>
            </label>
            <input
              value={geoFilter}
              onChange={(e) => setGeoFilter(e.target.value)}
              placeholder="USA, Canada"
              className="w-full border border-cloudy/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent transition"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Size <span className="text-cloudy font-normal">(optional)</span>
            </label>
            <input
              value={sizeFilter}
              onChange={(e) => setSizeFilter(e.target.value)}
              placeholder="10–200 employees"
              className="w-full border border-cloudy/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent transition"
            />
          </div>
        </div>

        {/* Signal-specific */}
        {signalType === "funding" && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Stages <span className="text-cloudy font-normal">(comma-sep, optional)</span>
              </label>
              <input
                value={stageFilterText}
                onChange={(e) => setStageFilterText(e.target.value)}
                placeholder="Seed, Series A, Series B"
                className="w-full border border-cloudy/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent transition"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Min raise ($)
              </label>
              <input
                type="number"
                min={0}
                value={minAmount}
                onChange={(e) => setMinAmount(e.target.value)}
                placeholder="1000000"
                className="w-full border border-cloudy/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent transition tabular"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Max raise ($)
              </label>
              <input
                type="number"
                min={0}
                value={maxAmount}
                onChange={(e) => setMaxAmount(e.target.value)}
                placeholder="50000000"
                className="w-full border border-cloudy/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent transition tabular"
              />
            </div>
          </div>
        )}

        {signalType === "hiring" && (
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Roles <span className="text-cloudy font-normal">(one per line or comma-separated)</span>
            </label>
            <textarea
              value={rolesText}
              onChange={(e) => setRolesText(e.target.value)}
              rows={3}
              placeholder={"SDR\nAccount Executive\nHead of Growth"}
              className="w-full border border-cloudy/40 rounded-lg px-3 py-2 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent transition"
            />
            {roles.length > 0 && (
              <p className="text-[11px] text-cloudy mt-1">
                {roles.length} role{roles.length !== 1 ? "s" : ""} parsed
              </p>
            )}
          </div>
        )}

        {signalType === "news" && (
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Keywords <span className="text-cloudy font-normal">(one per line or comma-separated)</span>
            </label>
            <textarea
              value={keywordsText}
              onChange={(e) => setKeywordsText(e.target.value)}
              rows={3}
              placeholder={"expansion\nnew location\nproduct launch\npartnership"}
              className="w-full border border-cloudy/40 rounded-lg px-3 py-2 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent transition"
            />
            {keywords.length > 0 && (
              <p className="text-[11px] text-cloudy mt-1">
                {keywords.length} keyword{keywords.length !== 1 ? "s" : ""} parsed
              </p>
            )}
          </div>
        )}

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            ICP hint <span className="text-cloudy font-normal">(optional — free text)</span>
          </label>
          <textarea
            value={icpHint}
            onChange={(e) => setIcpHint(e.target.value.slice(0, 1000))}
            rows={2}
            placeholder="Skip consulting firms and agencies. Prefer product companies selling to mid-market."
            className="w-full border border-cloudy/40 rounded-lg px-3 py-2 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent transition"
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Schedule</label>
            <select
              value={schedule}
              onChange={(e) => setSchedule(e.target.value as Schedule)}
              className="w-full border border-cloudy/40 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent transition"
            >
              <option value="manual">Manual only</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
              <option value="once">Run once, then deactivate</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Timeframe
            </label>
            <input
              value={timeframe}
              onChange={(e) => setTimeframe(e.target.value)}
              placeholder="last 14 days"
              className="w-full border border-cloudy/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent transition"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Max results per run
            </label>
            <input
              type="number"
              min={1}
              max={50}
              value={maxResults}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (Number.isFinite(n))
                  setMaxResults(Math.max(1, Math.min(50, Math.round(n))));
              }}
              className="w-full border border-cloudy/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent transition tabular"
            />
          </div>
        </div>

        <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={runNow}
            onChange={(e) => setRunNow(e.target.checked)}
            className="accent-brand-500"
          />
          Run immediately after creating
        </label>

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
              <Plus className="w-4 h-4" />
            )}
            Create monitor
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
