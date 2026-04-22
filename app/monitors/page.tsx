"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  Hash,
  User,
  FileText,
  Zap,
  Plus,
  Play,
  Pause,
  Clock,
  CheckCircle2,
  XCircle,
  Loader2,
  ChevronRight,
  Radar,
} from "lucide-react";
import { clsx } from "clsx";
import { PEOPLE_FIELD_GROUPS } from "@/lib/enrichment-fields";

type MonitorMode = "keyword" | "profile" | "post" | "instant";
type MonitorSchedule = "manual" | "once" | "daily" | "weekly" | "monthly";

type MonitorSummary = {
  id: string;
  name: string;
  mode: MonitorMode;
  schedule: MonitorSchedule;
  active: boolean;
  config: {
    keywords?: string[];
    profileUrl?: string;
    postUrls?: string[];
  };
  leadCountTotal: number;
  costUsdTotal: number;
  lastRunAt?: number;
  nextRunAt?: number;
};

const MODE_META: Record<MonitorMode, { label: string; icon: typeof Hash; hint: string }> = {
  keyword: { label: "Keyword Tracking", icon: Hash, hint: "Find posts matching topics, then collect engagers" },
  profile: { label: "Profile Tracking", icon: User, hint: "Watch a profile's new posts, collect engagers" },
  post:    { label: "Post Monitoring",  icon: FileText, hint: "Re-check specific posts for new engagement" },
  instant: { label: "Instant Scraping", icon: Zap, hint: "One-off extraction from a post URL" },
};

const SCHEDULE_LABEL: Record<MonitorSchedule, string> = {
  manual: "Manual only",
  once: "Run once",
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
};

export default function MonitorsPage() {
  const [monitors, setMonitors] = useState<MonitorSummary[] | null>(null);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/monitors");
      const data = await res.json();
      setMonitors(data.monitors ?? []);
    } catch {
      setError("Failed to load monitors");
    }
  }, []);

  useEffect(() => {
    const first = setTimeout(load, 0);
    const id = setInterval(load, 5000);
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
              <Radar className="w-5 h-5 text-brand-500" strokeWidth={2} />
              <h1 className="text-3xl font-serif font-bold text-gray-900 tracking-tight">
                Social Engager
              </h1>
            </div>
            <p className="text-sm text-cloudy mt-1">
              Track LinkedIn keywords, profiles, and posts — collect everyone who engages, then enrich and deliver them.
            </p>
          </div>
          <button
            onClick={() => setCreating((v) => !v)}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-brand-500 text-white text-sm font-medium hover:bg-brand-600 transition-colors"
          >
            <Plus className="w-4 h-4" />
            {creating ? "Cancel" : "New monitor"}
          </button>
        </div>

        {error && (
          <div className="flex items-center gap-2.5 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            <AlertCircle className="w-4 h-4" />
            {error}
          </div>
        )}

        {creating && (
          <CreateMonitorForm
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
        ) : monitors.length === 0 ? (
          <div className="bg-white border border-cloudy/30 rounded-xl p-10 text-center">
            <Radar className="w-8 h-8 text-cloudy mx-auto mb-3" strokeWidth={1.5} />
            <h2 className="text-sm font-semibold text-gray-900">No monitors yet</h2>
            <p className="text-xs text-cloudy mt-1 max-w-sm mx-auto">
              Create a monitor to start tracking LinkedIn engagement. Pick a mode, point it at a keyword,
              profile, or post — and pick a schedule.
            </p>
            {!creating && (
              <button
                onClick={() => setCreating(true)}
                className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-brand-500 text-white text-sm font-medium hover:bg-brand-600 transition-colors"
              >
                <Plus className="w-4 h-4" />
                Create your first monitor
              </button>
            )}
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

function MonitorCard({
  monitor,
  onChanged,
}: {
  monitor: MonitorSummary;
  onChanged: () => void;
}) {
  const Icon = MODE_META[monitor.mode].icon;
  const [busy, setBusy] = useState<"toggle" | "trigger" | null>(null);

  const toggle = async () => {
    setBusy("toggle");
    try {
      await fetch(`/api/monitors/${monitor.id}`, {
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
      await fetch(`/api/monitors/${monitor.id}/trigger`, { method: "POST" });
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
            "w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0",
            monitor.active ? "bg-brand-50 text-brand-500" : "bg-gray-100 text-gray-400"
          )}
        >
          <Icon className="w-5 h-5" strokeWidth={2} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Link
              href={`/monitors/${monitor.id}`}
              className="text-sm font-semibold text-gray-900 hover:text-brand-500 transition-colors truncate"
            >
              {monitor.name}
            </Link>
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-600 uppercase tracking-wide">
              {MODE_META[monitor.mode].label}
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
          <div className="flex items-center gap-4 mt-2 text-[11px] text-cloudy tabular">
            <span className="inline-flex items-center gap-1">
              <Clock className="w-3 h-3" /> {SCHEDULE_LABEL[monitor.schedule]}
            </span>
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
          <Link
            href={`/monitors/${monitor.id}`}
            className="text-cloudy hover:text-brand-500 transition-colors"
          >
            <ChevronRight className="w-4 h-4" />
          </Link>
        </div>
      </div>
    </div>
  );
}

function renderConfigSummary(m: MonitorSummary): string {
  switch (m.mode) {
    case "keyword":
      return `Keywords: ${(m.config.keywords ?? []).join(", ") || "(none)"}`;
    case "profile":
      return `Profile: ${m.config.profileUrl ?? "(none)"}`;
    case "post":
    case "instant": {
      const urls = m.config.postUrls ?? [];
      if (urls.length === 0) return "Manual engager list only";
      if (urls.length === 1) return `Post: ${urls[0]}`;
      return `${urls.length} posts: ${urls[0]}, …`;
    }
    default:
      return "";
  }
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

// -----------------------------------------------------
// Create Monitor form
// -----------------------------------------------------

function CreateMonitorForm({
  onCancel,
  onCreated,
}: {
  onCancel: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [mode, setMode] = useState<MonitorMode>("post");
  const [schedule, setSchedule] = useState<MonitorSchedule>("manual");
  const [keywords, setKeywords] = useState("");
  const [profileUrl, setProfileUrl] = useState("");
  const [postUrls, setPostUrls] = useState("");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [manualEngagers, setManualEngagers] = useState("");
  const [outreachContext, setOutreachContext] = useState("");
  const [selectedFields, setSelectedFields] = useState<string[]>([
    "job_title",
    "current_company",
    "seniority_level",
    "linkedin_headline",
    "location",
    "first_line",
  ]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const isInstant = mode === "instant";

  const toggleField = (key: string) =>
    setSelectedFields((p) => (p.includes(key) ? p.filter((f) => f !== key) : [...p, key]));

  const parsedKeywords = useMemo(
    () => keywords.split(/[\n,]/).map((k) => k.trim()).filter(Boolean),
    [keywords]
  );
  const parsedPostUrls = useMemo(
    () => postUrls.split(/\s+/).map((u) => u.trim()).filter(Boolean),
    [postUrls]
  );
  const parsedManualEngagers = useMemo(
    () =>
      manualEngagers
        .split(/\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          // Accept: "<url>" or "<url>,<name>" or "<url>,<name>,<type>,<comment>"
          const [url, n, type, ...rest] = line.split(",").map((p) => p.trim());
          return {
            linkedinUrl: url,
            name: n || undefined,
            engagementType:
              type === "like" || type === "comment" || type === "reaction" ? type : undefined,
            engagementText: rest.join(",") || undefined,
          };
        })
        .filter((e) => /^https?:\/\/(www\.)?linkedin\.com\/in\//i.test(e.linkedinUrl)),
    [manualEngagers]
  );

  const submit = async () => {
    setError("");
    if (!name.trim()) return setError("Give the monitor a name.");
    if (selectedFields.length === 0)
      return setError("Pick at least one enrichment field.");

    const config: { keywords?: string[]; profileUrl?: string; postUrls?: string[] } = {};
    if (mode === "keyword") {
      if (parsedKeywords.length === 0)
        return setError("Add at least one keyword (one per line or comma-separated).");
      config.keywords = parsedKeywords;
    }
    if (mode === "profile") {
      if (!profileUrl.trim()) return setError("Paste a LinkedIn profile URL.");
      config.profileUrl = profileUrl.trim();
    }
    if (mode === "post" || mode === "instant") {
      if (parsedPostUrls.length === 0 && parsedManualEngagers.length === 0)
        return setError("Add at least one post URL or a manual engager list.");
      config.postUrls = parsedPostUrls;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/monitors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          mode,
          config,
          schedule: isInstant ? "once" : schedule,
          webhookUrl: webhookUrl.trim() || undefined,
          requestedFields: selectedFields,
          outreachContext: outreachContext.trim() || undefined,
          manualEngagers: parsedManualEngagers.length > 0 ? parsedManualEngagers : undefined,
          runNow: isInstant,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? data.issues?.join("; ") ?? "Failed to create monitor");
        return;
      }
      onCreated();
    } catch {
      setError("Network error creating monitor");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="bg-white border border-cloudy/30 rounded-xl overflow-hidden">
      <div className="px-5 py-4 border-b border-cloudy/20">
        <h2 className="text-sm font-semibold text-gray-700">New monitor</h2>
      </div>
      <div className="p-5 space-y-4">
        {/* Name */}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={120}
            placeholder="e.g. AI outbound post — Apr 2026"
            className="w-full border border-cloudy/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent transition"
          />
        </div>

        {/* Mode */}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-2">Mode</label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {(Object.keys(MODE_META) as MonitorMode[]).map((m) => {
              const meta = MODE_META[m];
              const Icon = meta.icon;
              const active = m === mode;
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
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

        {/* Config per mode */}
        {mode === "keyword" && (
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Keywords <span className="text-cloudy font-normal">(one per line, or comma-separated)</span>
            </label>
            <textarea
              value={keywords}
              onChange={(e) => setKeywords(e.target.value)}
              rows={3}
              placeholder={"outbound\ncold email\nAI SDR"}
              className="w-full border border-cloudy/40 rounded-lg px-3 py-2 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent transition"
            />
          </div>
        )}
        {mode === "profile" && (
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              LinkedIn profile URL
            </label>
            <input
              value={profileUrl}
              onChange={(e) => setProfileUrl(e.target.value)}
              placeholder="https://www.linkedin.com/in/their-slug"
              className="w-full border border-cloudy/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent transition"
            />
          </div>
        )}
        {(mode === "post" || mode === "instant") && (
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Post URL(s) <span className="text-cloudy font-normal">(space or newline-separated)</span>
            </label>
            <textarea
              value={postUrls}
              onChange={(e) => setPostUrls(e.target.value)}
              rows={2}
              placeholder="https://www.linkedin.com/posts/…"
              className="w-full border border-cloudy/40 rounded-lg px-3 py-2 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent transition"
            />
          </div>
        )}

        {/* Manual engagers — always available */}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            Manual engager list <span className="text-cloudy font-normal">(optional — one LinkedIn URL per line, optionally <code>,name,type,comment</code>)</span>
          </label>
          <p className="text-[11px] text-cloudy mb-1.5">
            LinkedIn blocks most unauthenticated scraping, so dropping in an engager list you already exported (from Phantombuster, Apify, or a manual copy) is the most reliable path.
          </p>
          <textarea
            value={manualEngagers}
            onChange={(e) => setManualEngagers(e.target.value)}
            rows={3}
            placeholder={"https://www.linkedin.com/in/jane-doe,Jane Doe,like\nhttps://www.linkedin.com/in/john-smith,John Smith,comment,Loved this"}
            className="w-full border border-cloudy/40 rounded-lg px-3 py-2 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent transition font-mono text-[12px]"
          />
          {parsedManualEngagers.length > 0 && (
            <p className="text-[11px] text-cloudy mt-1">
              {parsedManualEngagers.length} valid engager{parsedManualEngagers.length !== 1 ? "s" : ""} parsed
            </p>
          )}
        </div>

        {/* Schedule */}
        {!isInstant && (
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Schedule</label>
            <select
              value={schedule}
              onChange={(e) => setSchedule(e.target.value as MonitorSchedule)}
              className="w-full border border-cloudy/40 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent transition"
            >
              <option value="manual">Manual only — never runs on a timer</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
              <option value="once">Run once, then deactivate</option>
            </select>
          </div>
        )}

        {/* Webhook */}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            Webhook URL <span className="text-cloudy font-normal">(optional — POSTs each enriched lead)</span>
          </label>
          <input
            value={webhookUrl}
            onChange={(e) => setWebhookUrl(e.target.value)}
            placeholder="https://hooks.example.com/engager"
            className="w-full border border-cloudy/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent transition"
          />
        </div>

        {/* Enrichment fields */}
        <div>
          <p className="text-xs font-medium text-gray-600 mb-2">Enrich each engager with</p>
          <div className="space-y-3">
            {PEOPLE_FIELD_GROUPS.map((group) => (
              <div key={group.label}>
                <p className="text-[10px] font-semibold text-cloudy uppercase tracking-wider mb-1.5">
                  {group.label}
                </p>
                <div className="grid grid-cols-2 gap-1.5">
                  {group.fields.map((f) => {
                    const checked = selectedFields.includes(f.key);
                    return (
                      <label
                        key={f.key}
                        className={clsx(
                          "flex items-center gap-2 px-2.5 py-1.5 rounded-md border cursor-pointer text-xs select-none transition-colors",
                          checked
                            ? "bg-brand-50 border-brand-200 text-gray-800"
                            : "border-cloudy/30 hover:bg-pampas text-gray-600"
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleField(f.key)}
                          className="sr-only"
                        />
                        <div
                          className={clsx(
                            "w-3 h-3 rounded-sm border-2 flex items-center justify-center flex-shrink-0",
                            checked ? "bg-brand-500 border-brand-500" : "border-cloudy bg-white"
                          )}
                        >
                          {checked && (
                            <svg className="w-2 h-2 text-white" viewBox="0 0 10 10" fill="none">
                              <path
                                d="M1.5 5l2.5 2.5L8.5 2"
                                stroke="currentColor"
                                strokeWidth="1.75"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                          )}
                        </div>
                        {f.label}
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Outreach context (shown if first_line selected) */}
        {selectedFields.includes("first_line") && (
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Outreach context <span className="text-cloudy font-normal">(optional)</span>
            </label>
            <textarea
              value={outreachContext}
              onChange={(e) => setOutreachContext(e.target.value.slice(0, 1000))}
              rows={2}
              placeholder="What are you selling / what's your angle? Threaded into the first line."
              className="w-full border border-cloudy/40 rounded-lg px-3 py-2 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent transition"
            />
          </div>
        )}

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
            ) : isInstant ? (
              <Zap className="w-4 h-4" />
            ) : (
              <Plus className="w-4 h-4" />
            )}
            {isInstant ? "Create & run now" : "Create monitor"}
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

// Icons re-exported so other files can reuse the status mapping.
export const STATUS_ICONS: Record<string, typeof CheckCircle2> = {
  completed: CheckCircle2,
  running: Loader2,
  queued: Clock,
  awaiting_approval: AlertCircle,
  failed: XCircle,
  cancelled: XCircle,
};
