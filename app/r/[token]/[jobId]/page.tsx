"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Download,
  Loader2,
  Mail,
  Search,
  XCircle,
} from "lucide-react";
import { clsx } from "clsx";

// ----------------------------------------------------------------------
// Branded, unauthenticated results view. The URL path carries the workspace
// shareToken AND the jobId; the server cross-checks both before returning
// data, so a leaked jobId without a matching token is useless. Controls a
// client would never see (cancel, retry, cost stats, in-app nav) are
// deliberately omitted.
// ----------------------------------------------------------------------

type RowStatus = "pending" | "processing" | "done" | "error";

type SharedJob = {
  id: string;
  type: string;
  status: "pending" | "processing" | "completed" | "failed" | "cancelled";
  totalRows: number;
  processedRows: number;
  percentComplete: number;
  requestedFields: string[];
  identifierColumn: string;
  rows: Array<{
    rowIndex: number;
    status: RowStatus;
    originalData: Record<string, string>;
    enrichedData: Record<string, string>;
  }>;
};

type SharedWorkspace = {
  id: string;
  name: string;
  brandName: string | null;
  logoUrl: string | null;
  primaryColor: string | null;
  accentColor: string | null;
  supportEmail: string | null;
  footerText: string | null;
};

type Payload = { workspace: SharedWorkspace; job: SharedJob };

const DEFAULT_PRIMARY = "#c15f3c";

function toTitleCase(s: string): string {
  return s.replace(/[_-]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function BrandedResultsPage() {
  const { token, jobId } = useParams<{ token: string; jobId: string }>();
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/share/${token}/${jobId}`, { cache: "no-store" });
      if (res.status === 404) {
        setError("This link is no longer valid. Ask the sender to generate a new one.");
        return;
      }
      if (!res.ok) {
        setError("Couldn't load results. Please retry in a moment.");
        return;
      }
      const body = (await res.json()) as Payload;
      setError(null);
      setData(body);
    } catch {
      setError("Network error loading results.");
    }
  }, [token, jobId]);

  useEffect(() => {
    // Defer the first fetch by a tick so setState doesn't cascade inside
    // the same render pass, then keep polling while the job is still
    // enriching so the table fills in live for the client. Stop polling
    // once the job is terminal to save bandwidth.
    const first = setTimeout(load, 0);
    const id = setInterval(() => {
      setData((prev) => {
        if (!prev) return prev;
        if (
          prev.job.status === "completed" ||
          prev.job.status === "failed" ||
          prev.job.status === "cancelled"
        ) {
          return prev;
        }
        void load();
        return prev;
      });
    }, 3500);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [load]);

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = filter.trim().toLowerCase();
    if (!q) return data.job.rows;
    return data.job.rows.filter((r) => {
      const hay = [...Object.values(r.originalData), ...Object.values(r.enrichedData)]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [data, filter]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6">
        <div className="max-w-md text-center space-y-3">
          <AlertCircle className="w-8 h-8 text-gray-300 mx-auto" strokeWidth={1.5} />
          <p className="text-sm font-medium text-gray-900">Link unavailable</p>
          <p className="text-xs text-gray-500">{error}</p>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-5 h-5 text-gray-400 animate-spin" />
      </div>
    );
  }

  const { workspace, job } = data;
  const primary = workspace.primaryColor ?? DEFAULT_PRIMARY;
  const accent = workspace.accentColor ?? primary;
  const brandName = workspace.brandName ?? workspace.name;

  const originalHeaders =
    job.rows[0]?.originalData ? Object.keys(job.rows[0].originalData) : [];
  const enrichedHeaders = job.requestedFields;

  const isRunning = job.status === "pending" || job.status === "processing";
  const doneCount = job.rows.filter((r) => r.status === "done").length;
  const errorCount = job.rows.filter((r) => r.status === "error").length;

  return (
    <div
      className="min-h-screen flex flex-col bg-white"
      style={
        {
          // Expose brand colours as CSS variables so descendant elements can
          // tint themselves without inlining styles on every node.
          "--brand-primary": primary,
          "--brand-accent": accent,
        } as React.CSSProperties
      }
    >
      {/* Progress strip */}
      {isRunning && (
        <div className="h-0.5 bg-gray-100 flex-shrink-0">
          <div
            className="h-full transition-all duration-500 ease-out"
            style={{ width: `${job.percentComplete}%`, backgroundColor: primary }}
          />
        </div>
      )}

      {/* Branded header */}
      <header
        className="flex-shrink-0 border-b px-4 sm:px-8 py-4 sm:py-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
        style={{ borderColor: `${primary}26` }}
      >
        <div className="flex items-center gap-3 min-w-0">
          {workspace.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={workspace.logoUrl}
              alt={`${brandName} logo`}
              className="w-10 h-10 object-contain flex-shrink-0"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = "none";
              }}
            />
          ) : (
            <div
              className="w-10 h-10 rounded-lg flex items-center justify-center text-base font-semibold text-white flex-shrink-0"
              style={{ background: `linear-gradient(135deg, ${primary}, ${accent})` }}
            >
              {brandName.trim().charAt(0).toUpperCase() || "W"}
            </div>
          )}
          <div className="min-w-0">
            <h1
              className="text-base sm:text-lg font-semibold truncate"
              style={{ color: primary }}
            >
              {brandName}
            </h1>
            <p className="text-xs text-gray-500 mt-0.5">
              {isRunning ? (
                <span className="inline-flex items-center gap-1.5">
                  <Loader2 className="w-3 h-3 animate-spin" style={{ color: primary }} />
                  Enriching {job.processedRows} of {job.totalRows} rows…
                </span>
              ) : (
                <>
                  {doneCount > 0 && <>{doneCount} enriched</>}
                  {doneCount > 0 && errorCount > 0 && <span className="text-gray-300 mx-1">·</span>}
                  {errorCount > 0 && <span className="text-red-500">{errorCount} failed</span>}
                  {doneCount === 0 && errorCount === 0 && <>No results yet</>}
                </>
              )}
            </p>
          </div>
        </div>
        <a
          href={`/api/share/${token}/${jobId}/download`}
          className={clsx(
            "inline-flex items-center justify-center gap-2 px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-semibold text-white transition-opacity self-start sm:self-auto flex-shrink-0",
            doneCount > 0 ? "hover:opacity-90" : "opacity-40 pointer-events-none"
          )}
          style={{ backgroundColor: primary }}
        >
          <Download className="w-3.5 h-3.5" strokeWidth={2} />
          Download CSV
        </a>
      </header>

      {/* Toolbar */}
      <div className="flex-shrink-0 border-b border-gray-100 px-4 sm:px-8 py-3 flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 sm:flex-none min-w-0">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" strokeWidth={2} />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter rows…"
            className="bg-gray-50 border border-gray-200 rounded-lg pl-8 pr-3 py-1.5 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:border-transparent w-full sm:w-56 transition"
            style={{ boxShadow: filter ? `0 0 0 1px ${primary}40` : undefined }}
          />
        </div>
        <span className="text-xs text-gray-500 ml-auto">
          {filtered.length} of {job.totalRows} row{job.totalRows === 1 ? "" : "s"}
        </span>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {filtered.length === 0 ? (
          <div className="text-center py-16 text-sm text-gray-500">
            {job.rows.length === 0
              ? "Waiting for data…"
              : "No rows match your filter."}
          </div>
        ) : (
          <table className="w-full text-sm border-collapse min-w-max">
            <thead className="sticky top-0 z-10 bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap w-10">
                  {/* status icon */}
                </th>
                {originalHeaders.map((h) => (
                  <th
                    key={`o_${h}`}
                    className="text-left px-4 py-2.5 text-[11px] font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap"
                  >
                    {toTitleCase(h)}
                  </th>
                ))}
                {enrichedHeaders.map((f) => (
                  <th
                    key={`e_${f}`}
                    className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider whitespace-nowrap"
                    style={{ color: primary }}
                  >
                    {toTitleCase(f)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((row) => (
                <tr key={row.rowIndex} className="hover:bg-gray-50">
                  <td className="px-4 py-2.5">
                    <RowIcon status={row.status} primary={primary} />
                  </td>
                  {originalHeaders.map((h) => (
                    <td key={`o_${h}`} className="px-4 py-2.5 text-xs text-gray-500 max-w-48 truncate">
                      {row.originalData[h] ?? ""}
                    </td>
                  ))}
                  {enrichedHeaders.map((f) => {
                    const v = row.enrichedData?.[f] ?? "";
                    if (row.status === "pending" || row.status === "processing") {
                      return (
                        <td key={`e_${f}`} className="px-4 py-2.5 text-gray-300 text-xs">
                          —
                        </td>
                      );
                    }
                    return (
                      <td
                        key={`e_${f}`}
                        className="px-4 py-2.5 text-xs text-gray-900 font-medium max-w-48 truncate"
                        title={v}
                      >
                        {v || <span className="text-gray-300">—</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Footer */}
      <footer
        className="flex-shrink-0 border-t border-gray-100 px-4 sm:px-8 py-3 text-xs text-gray-500 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1"
      >
        <div>{workspace.footerText ?? `© ${brandName} · Enrichment results`}</div>
        {workspace.supportEmail && (
          <a
            href={`mailto:${workspace.supportEmail}`}
            className="inline-flex items-center gap-1 hover:underline"
            style={{ color: primary }}
          >
            <Mail className="w-3 h-3" /> {workspace.supportEmail}
          </a>
        )}
      </footer>
    </div>
  );
}

function RowIcon({ status, primary }: { status: RowStatus; primary: string }) {
  if (status === "done")
    return <CheckCircle2 className="w-3.5 h-3.5 text-green-500" strokeWidth={2} />;
  if (status === "error")
    return <XCircle className="w-3.5 h-3.5 text-red-400" strokeWidth={2} />;
  if (status === "processing")
    return <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: primary }} />;
  return <Clock className="w-3.5 h-3.5 text-gray-300" strokeWidth={2} />;
}
