"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  AlertCircle,
  CheckCircle2,
  Clock,
  Download,
  Hash,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  Trash2,
  XCircle,
  Zap,
  User,
  FileText,
  Webhook,
} from "lucide-react";
import { clsx } from "clsx";

type MonitorMode = "keyword" | "profile" | "post" | "instant";
type MonitorSchedule = "manual" | "once" | "daily" | "weekly" | "monthly";
type RunStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "awaiting_approval";

type Monitor = {
  id: string;
  name: string;
  mode: MonitorMode;
  schedule: MonitorSchedule;
  active: boolean;
  webhookUrl?: string;
  config: { keywords?: string[]; profileUrl?: string; postUrls?: string[] };
  requestedFields: string[];
  outreachContext?: string;
  leadCountTotal: number;
  costUsdTotal: number;
  lastRunAt?: number;
  nextRunAt?: number;
};

type Run = {
  id: string;
  status: RunStatus;
  trigger: string;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  discoveredCount: number;
  newCount: number;
  dedupCount: number;
  enrichedCount: number;
  costUsd: number;
  estimatedLeads?: number;
  discoveryLog: string[];
  error?: string;
};

type Lead = {
  id: string;
  linkedinUrl: string;
  profileName?: string;
  engagementType?: string;
  engagementText?: string;
  postUrl?: string;
  enrichedData: Record<string, string>;
  enrichmentStatus: "pending" | "processing" | "done" | "error";
  enrichmentError?: string;
  webhookStatus?: string;
  createdAt: number;
};

const MODE_ICONS: Record<MonitorMode, typeof Hash> = {
  keyword: Hash,
  profile: User,
  post: FileText,
  instant: Zap,
};

const STATUS_BADGE: Record<
  RunStatus,
  { label: string; icon: typeof CheckCircle2; classes: string }
> = {
  queued: { label: "Queued", icon: Clock, classes: "bg-gray-100 text-gray-600" },
  running: { label: "Running", icon: Loader2, classes: "bg-blue-100 text-blue-700" },
  completed: { label: "Completed", icon: CheckCircle2, classes: "bg-green-100 text-green-700" },
  failed: { label: "Failed", icon: XCircle, classes: "bg-red-100 text-red-700" },
  cancelled: { label: "Cancelled", icon: XCircle, classes: "bg-gray-100 text-gray-500" },
  awaiting_approval: {
    label: "Awaiting approval",
    icon: AlertCircle,
    classes: "bg-amber-100 text-amber-700",
  },
};

export default function MonitorDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [monitor, setMonitor] = useState<Monitor | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [m, r, l] = await Promise.all([
        fetch(`/api/monitors/${id}`).then((res) => res.json()),
        fetch(`/api/monitors/${id}/runs`).then((res) => res.json()),
        fetch(`/api/monitors/${id}/leads`).then((res) => res.json()),
      ]);
      if (m.error) setError(m.error);
      else setMonitor(m.monitor);
      setRuns(r.runs ?? []);
      setLeads(l.leads ?? []);
    } catch {
      setError("Failed to load monitor");
    }
  }, [id]);

  useEffect(() => {
    const first = setTimeout(load, 0);
    const t = setInterval(load, 3500);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [load]);

  const trigger = async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/monitors/${id}/trigger`, { method: "POST" });
      if (!res.ok) {
        const d = await res.json();
        setError(d.error ?? "Failed to start run");
      }
      load();
    } finally {
      setBusy(false);
    }
  };

  const toggle = async () => {
    if (!monitor) return;
    setBusy(true);
    try {
      await fetch(`/api/monitors/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !monitor.active }),
      });
      load();
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!confirm("Delete this monitor and all its runs/leads?")) return;
    setBusy(true);
    try {
      await fetch(`/api/monitors/${id}`, { method: "DELETE" });
      window.location.href = "/monitors";
    } finally {
      setBusy(false);
    }
  };

  const approve = async (runId: string) => {
    await fetch(`/api/runs/${runId}/approve`, { method: "POST" });
    load();
  };

  const cancel = async (runId: string) => {
    await fetch(`/api/runs/${runId}/cancel`, { method: "POST" });
    load();
  };

  const enrichedKeys = useMemo(() => {
    const set = new Set<string>();
    for (const l of leads) for (const k of Object.keys(l.enrichedData)) set.add(k);
    return Array.from(set);
  }, [leads]);

  if (!monitor) {
    return (
      <div className="min-h-screen">
        <div className="max-w-5xl mx-auto px-6 pt-10 text-sm text-cloudy">
          {error ? (
            <div className="flex items-center gap-2 text-red-700">
              <AlertCircle className="w-4 h-4" /> {error}
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading…
            </div>
          )}
        </div>
      </div>
    );
  }

  const ModeIcon = MODE_ICONS[monitor.mode];

  return (
    <div className="min-h-screen pb-16">
      <div className="max-w-5xl mx-auto px-6 pt-6 space-y-6">
        <div className="flex items-center gap-3">
          <Link
            href="/monitors"
            className="inline-flex items-center gap-1 text-xs text-cloudy hover:text-gray-700 transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            All monitors
          </Link>
        </div>

        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3 min-w-0">
            <div
              className={clsx(
                "w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0",
                monitor.active ? "bg-brand-50 text-brand-500" : "bg-gray-100 text-gray-400"
              )}
            >
              <ModeIcon className="w-5 h-5" strokeWidth={2} />
            </div>
            <div className="min-w-0">
              <h1 className="text-2xl font-serif font-bold text-gray-900 truncate">
                {monitor.name}
              </h1>
              <p className="text-xs text-cloudy mt-0.5">{describeMonitor(monitor)}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={toggle}
              disabled={busy}
              className="text-xs px-3 py-2 rounded-md border border-cloudy/40 text-gray-600 hover:bg-pampas inline-flex items-center gap-1.5 disabled:opacity-50 transition-colors"
            >
              {monitor.active ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
              {monitor.active ? "Pause" : "Start"}
            </button>
            <button
              onClick={trigger}
              disabled={busy}
              className="text-xs px-3 py-2 rounded-md bg-brand-500 text-white hover:bg-brand-600 inline-flex items-center gap-1.5 disabled:opacity-50 transition-colors"
            >
              <Play className="w-3.5 h-3.5" />
              Run now
            </button>
            <a
              href={`/api/monitors/${id}/leads?format=csv`}
              className="text-xs px-3 py-2 rounded-md border border-cloudy/40 text-gray-600 hover:bg-pampas inline-flex items-center gap-1.5 transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              Export CSV
            </a>
            <button
              onClick={remove}
              disabled={busy}
              className="text-xs px-3 py-2 rounded-md border border-red-200 text-red-600 hover:bg-red-50 inline-flex items-center gap-1.5 disabled:opacity-50 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Delete
            </button>
          </div>
        </div>

        {/* Meta stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard label="Total leads" value={monitor.leadCountTotal.toLocaleString()} />
          <StatCard label="Total cost" value={`$${monitor.costUsdTotal.toFixed(3)}`} />
          <StatCard
            label="Schedule"
            value={
              monitor.schedule === "manual"
                ? "Manual"
                : monitor.schedule.charAt(0).toUpperCase() + monitor.schedule.slice(1)
            }
          />
          <StatCard
            label={monitor.nextRunAt && monitor.active ? "Next run" : "Last run"}
            value={
              monitor.nextRunAt && monitor.active
                ? formatRelative(monitor.nextRunAt)
                : monitor.lastRunAt
                  ? formatRelative(monitor.lastRunAt)
                  : "—"
            }
          />
        </div>

        {monitor.webhookUrl && (
          <div className="bg-white border border-cloudy/30 rounded-lg px-4 py-2.5 flex items-center gap-2 text-xs">
            <Webhook className="w-3.5 h-3.5 text-brand-500" />
            <span className="text-cloudy">Webhook:</span>
            <code className="text-gray-700 truncate">{monitor.webhookUrl}</code>
          </div>
        )}

        {/* Runs */}
        <section>
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold text-gray-700">Runs</h2>
            <button
              onClick={load}
              className="text-[11px] text-cloudy hover:text-brand-500 inline-flex items-center gap-1 transition-colors"
            >
              <RefreshCw className="w-3 h-3" />
              Refresh
            </button>
          </div>
          <div className="bg-white border border-cloudy/30 rounded-xl divide-y divide-cloudy/15">
            {runs.length === 0 ? (
              <div className="px-4 py-8 text-center text-xs text-cloudy">
                No runs yet. Click <span className="text-gray-700 font-medium">Run now</span> to start the first.
              </div>
            ) : (
              runs.map((run) => (
                <RunRow key={run.id} run={run} onApprove={approve} onCancel={cancel} />
              ))
            )}
          </div>
        </section>

        {/* Leads */}
        <section>
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold text-gray-700">
              Leads <span className="text-cloudy font-normal">({leads.length})</span>
            </h2>
          </div>
          <div className="bg-white border border-cloudy/30 rounded-xl overflow-hidden">
            {leads.length === 0 ? (
              <div className="px-4 py-8 text-center text-xs text-cloudy">
                No leads yet.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-xs">
                  <thead>
                    <tr className="bg-pampas/60 text-left text-[10px] uppercase tracking-wider text-cloudy">
                      <th className="px-3 py-2 font-semibold">Status</th>
                      <th className="px-3 py-2 font-semibold">Profile</th>
                      <th className="px-3 py-2 font-semibold">Engagement</th>
                      {enrichedKeys.map((k) => (
                        <th key={k} className="px-3 py-2 font-semibold whitespace-nowrap">
                          {k}
                        </th>
                      ))}
                      <th className="px-3 py-2 font-semibold">Webhook</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leads.map((lead) => (
                      <LeadRow key={lead.id} lead={lead} enrichedKeys={enrichedKeys} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>

        {error && (
          <div className="flex items-center gap-2 px-3 py-2 bg-red-50 border border-red-200 rounded-md text-xs text-red-700">
            <AlertCircle className="w-3.5 h-3.5" /> {error}
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white border border-cloudy/30 rounded-lg px-4 py-3">
      <p className="text-[10px] uppercase tracking-wider text-cloudy font-semibold">{label}</p>
      <p className="text-lg font-serif font-semibold text-gray-900 mt-0.5 tabular">{value}</p>
    </div>
  );
}

function RunRow({
  run,
  onApprove,
  onCancel,
}: {
  run: Run;
  onApprove: (id: string) => void;
  onCancel: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const badge = STATUS_BADGE[run.status];
  const Icon = badge.icon;

  return (
    <div className="px-4 py-3 text-xs">
      <div className="flex items-center gap-3 flex-wrap">
        <span
          className={clsx(
            "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium uppercase tracking-wide",
            badge.classes
          )}
        >
          <Icon className={clsx("w-3 h-3", run.status === "running" && "animate-spin")} />
          {badge.label}
        </span>
        <span className="text-gray-700">{new Date(run.createdAt).toLocaleString()}</span>
        <span className="text-cloudy">trigger: {run.trigger}</span>
        <span className="ml-auto tabular text-cloudy">
          <span className="text-gray-700 font-medium">{run.newCount}</span> new ·{" "}
          <span className="text-gray-700 font-medium">{run.enrichedCount}</span> enriched ·{" "}
          <span className="text-gray-700 font-medium">{run.dedupCount}</span> dedup · ${run.costUsd.toFixed(4)}
        </span>
      </div>

      {run.status === "awaiting_approval" && (
        <div className="mt-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-md flex items-center gap-2">
          <AlertCircle className="w-3.5 h-3.5 text-amber-700 flex-shrink-0" />
          <span className="text-amber-800">
            Estimated {run.estimatedLeads ?? "?"} leads — approval required before running.
          </span>
          <button
            onClick={() => onApprove(run.id)}
            className="ml-auto text-[11px] px-2.5 py-1 rounded-md bg-amber-600 text-white hover:bg-amber-700 transition-colors"
          >
            Approve & run
          </button>
          <button
            onClick={() => onCancel(run.id)}
            className="text-[11px] px-2.5 py-1 rounded-md border border-amber-300 text-amber-700 hover:bg-amber-100 transition-colors"
          >
            Cancel
          </button>
        </div>
      )}

      {run.error && (
        <div className="mt-2 px-3 py-1.5 bg-red-50 border border-red-200 rounded-md text-red-700">
          {run.error}
        </div>
      )}

      <button
        onClick={() => setExpanded((v) => !v)}
        className="mt-2 text-[11px] text-cloudy hover:text-brand-500 transition-colors"
      >
        {expanded ? "Hide" : "Show"} discovery log ({run.discoveryLog.length})
      </button>
      {expanded && run.discoveryLog.length > 0 && (
        <pre className="mt-1 bg-pampas rounded-md p-2 text-[11px] text-gray-700 font-mono overflow-x-auto max-h-40">
          {run.discoveryLog.slice(-100).join("\n")}
        </pre>
      )}

      {(run.status === "running" || run.status === "queued") && (
        <button
          onClick={() => onCancel(run.id)}
          className="mt-2 ml-2 text-[11px] text-red-600 hover:text-red-700 transition-colors"
        >
          Cancel run
        </button>
      )}
    </div>
  );
}

function LeadRow({ lead, enrichedKeys }: { lead: Lead; enrichedKeys: string[] }) {
  const StatusIcon =
    lead.enrichmentStatus === "done"
      ? CheckCircle2
      : lead.enrichmentStatus === "error"
        ? XCircle
        : lead.enrichmentStatus === "processing"
          ? Loader2
          : Clock;
  const statusClasses =
    lead.enrichmentStatus === "done"
      ? "text-green-600"
      : lead.enrichmentStatus === "error"
        ? "text-red-500"
        : lead.enrichmentStatus === "processing"
          ? "text-blue-500"
          : "text-cloudy";

  return (
    <tr className="border-t border-cloudy/10 hover:bg-pampas/40">
      <td className="px-3 py-2">
        <StatusIcon
          className={clsx(
            "w-3.5 h-3.5",
            statusClasses,
            lead.enrichmentStatus === "processing" && "animate-spin"
          )}
        />
      </td>
      <td className="px-3 py-2">
        <a
          href={lead.linkedinUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-brand-500 hover:underline font-medium"
        >
          {lead.profileName || lead.linkedinUrl.replace(/^https?:\/\/(www\.)?/, "")}
        </a>
      </td>
      <td className="px-3 py-2 text-gray-600">
        {lead.engagementType ?? "—"}
        {lead.engagementText && (
          <span className="block text-[10px] text-cloudy truncate max-w-[12rem]" title={lead.engagementText}>
            “{lead.engagementText}”
          </span>
        )}
      </td>
      {enrichedKeys.map((k) => (
        <td key={k} className="px-3 py-2 text-gray-700 max-w-[16rem]">
          <span className="line-clamp-2 whitespace-pre-wrap break-words" title={lead.enrichedData[k] ?? ""}>
            {lead.enrichedData[k] || (lead.enrichmentStatus === "done" ? "NA" : "…")}
          </span>
        </td>
      ))}
      <td className="px-3 py-2 text-[10px] text-cloudy">{lead.webhookStatus ?? "—"}</td>
    </tr>
  );
}

function describeMonitor(m: Monitor): string {
  switch (m.mode) {
    case "keyword":
      return `Keyword tracking — ${(m.config.keywords ?? []).join(", ")}`;
    case "profile":
      return `Profile tracking — ${m.config.profileUrl ?? ""}`;
    case "post":
      return `Post monitoring — ${(m.config.postUrls ?? []).length} post(s)`;
    case "instant":
      return `Instant scrape — ${(m.config.postUrls ?? [])[0] ?? ""}`;
    default:
      return "";
  }
}

function formatRelative(ms: number): string {
  const diff = ms - Date.now();
  const abs = Math.abs(diff);
  const m = Math.round(abs / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return diff >= 0 ? `in ${m}m` : `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return diff >= 0 ? `in ${h}h` : `${h}h ago`;
  const d = Math.round(h / 24);
  return diff >= 0 ? `in ${d}d` : `${d}d ago`;
}

