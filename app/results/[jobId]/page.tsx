"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import {
  Download,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Search,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  Building2,
  Users,
  UserSearch,
  Target,
  Flame,
  StopCircle,
} from "lucide-react";
import { clsx } from "clsx";
import { getFields } from "@/lib/enrichment-fields";

type RowStatus = "pending" | "processing" | "done" | "error";

type JobRow = {
  rowIndex: number;
  status: RowStatus;
  originalData: Record<string, string>;
  enrichedData: Record<string, string>;
  error?: string;
  costUsd?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
};

type JobData = {
  jobId: string;
  type: "company" | "people" | "decision_maker" | "lead_score" | "buying_trigger";
  status: "pending" | "processing" | "completed" | "failed" | "cancelled";
  totalRows: number;
  processedRows: number;
  percentComplete: number;
  requestedFields: string[];
  identifierColumn: string;
  rows: JobRow[];
  error?: string;
};

const TOP_N = 50;

function tierBadgeClasses(tier: string): string {
  switch (tier.toUpperCase()) {
    case "A": return "bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200";
    case "B": return "bg-blue-100 text-blue-700 ring-1 ring-blue-200";
    case "C": return "bg-amber-100 text-amber-700 ring-1 ring-amber-200";
    case "D": return "bg-gray-100 text-gray-600 ring-1 ring-gray-200";
    default:  return "bg-gray-100 text-gray-500 ring-1 ring-gray-200";
  }
}

const MODEL_OPTIONS = [
  { label: "Haiku 4.5 (default)", value: "claude-haiku-4-5-20251001" },
  { label: "Sonnet 4.6",          value: "claude-sonnet-4-6" },
  { label: "Opus 4.7",            value: "claude-opus-4-7" },
] as const;

function RowStatusIcon({ status }: { status: RowStatus }) {
  if (status === "done")       return <CheckCircle2 className="w-3.5 h-3.5 text-green-500" strokeWidth={2} />;
  if (status === "error")      return <XCircle className="w-3.5 h-3.5 text-red-400" strokeWidth={2} />;
  if (status === "processing") return <Loader2 className="w-3.5 h-3.5 text-brand-500 animate-spin" />;
  return <Clock className="w-3.5 h-3.5 text-cloudy" strokeWidth={2} />;
}

function toTitleCase(str: string): string {
  return str.replace(/[_-]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function ResultsPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const router    = useRouter();

  const [jobData,      setJobData]      = useState<JobData | null>(null);
  const [notFound,     setNotFound]     = useState(false);
  const [globalFilter, setGlobalFilter] = useState("");
  const [sorting,      setSorting]      = useState<SortingState>([]);
  const [cancelling,   setCancelling]   = useState(false);
  const [retryingRows, setRetryingRows] = useState<Set<number>>(new Set());
  const [retryModel,   setRetryModel]   = useState<Record<number, string>>({});
  const [showTopOnly,  setShowTopOnly]  = useState(true);

  useEffect(() => {
    if (!jobId) return;

    let cancelled = false;
    let es: EventSource | null = null;

    async function checkExists() {
      try {
        const res = await fetch(`/api/status/${jobId}`, { method: "GET" });
        if (res.status === 404) {
          if (!cancelled) setNotFound(true);
          return false;
        }
      } catch {
        // Network hiccup — let EventSource try anyway.
      }
      return true;
    }

    checkExists().then((ok) => {
      if (cancelled || !ok) return;

      es = new EventSource(`/api/stream/${jobId}`);

      es.addEventListener("snapshot", (e) => {
        if (cancelled) return;
        setJobData(JSON.parse((e as MessageEvent).data) as JobData);
      });

      es.addEventListener("row", (e) => {
        if (cancelled) return;
        const row = JSON.parse((e as MessageEvent).data) as JobRow;
        setJobData((prev) => {
          if (!prev) return prev;
          const rows = prev.rows.map((r) => (r.rowIndex === row.rowIndex ? row : r));
          const processedRows = rows.filter((r) => r.status === "done" || r.status === "error").length;
          return {
            ...prev,
            rows,
            processedRows,
            percentComplete: prev.totalRows > 0 ? Math.round((processedRows / prev.totalRows) * 100) : 0,
          };
        });
      });

      es.addEventListener("job", (e) => {
        if (cancelled) return;
        const partial = JSON.parse((e as MessageEvent).data) as Partial<JobData>;
        setJobData((prev) => (prev ? { ...prev, ...partial } : prev));
      });

      es.addEventListener("end", () => {
        es?.close();
      });

      es.onerror = () => {
        // EventSource auto-reconnects; if the job is already terminal the
        // server closed cleanly and we don't need to keep retrying.
        setJobData((prev) => {
          if (prev && (prev.status === "completed" || prev.status === "failed" || prev.status === "cancelled")) {
            es?.close();
          }
          return prev;
        });
      };
    });

    return () => {
      cancelled = true;
      es?.close();
    };
  }, [jobId]);

  const handleRetry = useCallback(async (rowIndex: number) => {
    const model = retryModel[rowIndex] ?? MODEL_OPTIONS[0].value;
    setRetryingRows((prev) => new Set(prev).add(rowIndex));
    try {
      await fetch(`/api/jobs/${jobId}/retry`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rowIndex, model }),
      });
    } finally {
      setRetryingRows((prev) => { const s = new Set(prev); s.delete(rowIndex); return s; });
    }
  }, [jobId, retryModel]);

  const handleCancel = useCallback(async () => {
    if (!jobData || cancelling) return;
    setCancelling(true);
    try {
      await fetch(`/api/jobs/${jobId}`, { method: "DELETE" });
    } finally {
      setCancelling(false);
    }
  }, [jobData, jobId, cancelling]);

  const isLeadScore     = jobData?.type === "lead_score";
  const isBuyingTrigger = jobData?.type === "buying_trigger";
  const isPrioritized   = isLeadScore || isBuyingTrigger;
  const sortScoreKey    = isBuyingTrigger ? "heat_score" : "total_score";

  const tableData = useMemo(() => {
    if (!jobData) return [];
    const rows: Record<string, string>[] = jobData.rows.map((row) => ({
      _rowIndex: String(row.rowIndex),
      _status:   row.status,
      _error:    row.error ?? "",
      _costUsd:  row.costUsd != null ? String(row.costUsd) : "",
      ...row.originalData,
      ...row.enrichedData,
    }));

    if (isPrioritized) {
      const scoreOf = (r: Record<string, string>) => {
        if (r._status !== "done") return -1;
        const n = Number(r[sortScoreKey]);
        return Number.isFinite(n) ? n : -1;
      };
      rows.sort((a, b) => scoreOf(b) - scoreOf(a));
      rows.forEach((r, i) => {
        r._rank = scoreOf(r) >= 0 ? String(i + 1) : "";
      });
      if (showTopOnly) return rows.slice(0, TOP_N);
    }
    return rows;
  }, [jobData, isPrioritized, sortScoreKey, showTopOnly]);


  const columns = useMemo<ColumnDef<Record<string, string>>[]>(() => {
    if (!jobData || !jobData.rows.length) return [];

    const originalHeaders = Object.keys(jobData.rows[0].originalData);
    const allFields       = getFields(jobData.type);
    const labelMap        = Object.fromEntries(allFields.map((f) => [f.key, f.label]));
    const enrichedSet     = new Set(jobData.requestedFields);

    const statusCol: ColumnDef<Record<string, string>> = {
      id: "_status", header: "", accessorKey: "_status", size: 44,
      enableSorting: false, enableGlobalFilter: false,
      cell: ({ getValue }) => (
        <span className="flex items-center justify-center">
          <RowStatusIcon status={getValue() as RowStatus} />
        </span>
      ),
    };

    const rankCol: ColumnDef<Record<string, string>> = {
      id: "_rank", header: "#", accessorKey: "_rank", size: 52,
      enableSorting: false, enableGlobalFilter: false,
      cell: ({ getValue }) => {
        const v = getValue() as string;
        return v
          ? <span className="text-cloudy text-xs tabular-nums font-medium">{v}</span>
          : <span className="text-cloudy/40 text-xs">—</span>;
      },
    };

    const originalCols: ColumnDef<Record<string, string>>[] = originalHeaders.map((h) => ({
      id: h, header: toTitleCase(h), accessorKey: h,
      cell: ({ getValue }) => {
        const v = getValue() as string;
        return <span className="text-cloudy text-xs tabular truncate block max-w-48" title={v}>{v || "—"}</span>;
      },
    }));

    const SCORE_FIELDS = new Set(["icp_fit_score", "pain_signal_score", "reachability_score", "total_score", "heat_score"]);
    const HEADLINE_SCORE_FIELDS = new Set(["total_score", "heat_score"]);
    const TIER_FIELDS = new Set(["priority_tier", "heat_tier"]);

    const enrichedCols: ColumnDef<Record<string, string>>[] = jobData.requestedFields.map((key) => ({
      id: `e_${key}`,
      header: labelMap[key] ?? toTitleCase(key),
      accessorFn: (row) => (enrichedSet.has(key) ? row[key] ?? "" : ""),
      cell: ({ getValue, row }) => {
        const v      = getValue() as string;
        const status = row.original._status as RowStatus;
        if (status === "pending" || status === "processing")
          return <span className="text-cloudy/40 text-xs">—</span>;

        // Numeric score — render as a colored pill.
        if (SCORE_FIELDS.has(key) && v) {
          const num = Number(v);
          if (Number.isFinite(num)) {
            const color =
              HEADLINE_SCORE_FIELDS.has(key)
                ? num >= 80 ? "bg-emerald-100 text-emerald-700"
                : num >= 65 ? "bg-blue-100 text-blue-700"
                : num >= 45 ? "bg-amber-100 text-amber-700"
                :             "bg-gray-100 text-gray-600"
                : "bg-brand-50 text-brand-700";
            return (
              <span className={clsx(
                "inline-flex items-center justify-center min-w-9 px-1.5 py-0.5 rounded-md text-xs font-semibold tabular-nums",
                color
              )}>
                {num}
              </span>
            );
          }
        }

        if (TIER_FIELDS.has(key) && v) {
          return (
            <span className={clsx(
              "inline-flex items-center justify-center w-6 h-6 rounded-md text-[11px] font-bold",
              tierBadgeClasses(v)
            )}>
              {v.toUpperCase()}
            </span>
          );
        }

        if (key === "score_explanation" && v) {
          return <span className="text-gray-900 text-xs tabular truncate block max-w-96" title={v}>{v}</span>;
        }

        return v
          ? <span className="text-gray-900 text-xs tabular truncate block max-w-48 font-medium" title={v}>{v}</span>
          : <span className="text-cloudy/40 text-xs">—</span>;
      },
    }));

    const costCol: ColumnDef<Record<string, string>> = {
      id: "_costUsd",
      header: "Cost",
      accessorKey: "_costUsd",
      size: 72,
      enableGlobalFilter: false,
      cell: ({ getValue, row }) => {
        const status = row.original._status as RowStatus;
        if (status === "pending" || status === "processing")
          return <span className="text-cloudy/40 text-xs">—</span>;
        const v = getValue() as string;
        if (!v) return <span className="text-cloudy/40 text-xs">—</span>;
        const cents = parseFloat(v) * 100;
        return (
          <span className="text-cloudy text-xs tabular-nums">
            {cents < 0.01 ? "<$0.01¢" : `$${(parseFloat(v)).toFixed(4)}`}
          </span>
        );
      },
    };

    const retryCol: ColumnDef<Record<string, string>> = {
      id: "_retry", header: "", accessorKey: "_status",
      size: 200, enableSorting: false, enableGlobalFilter: false,
      cell: ({ row }) => {
        const status     = row.original._status as RowStatus;
        const rIdx       = Number(row.original._rowIndex);
        const isRetrying = retryingRows.has(rIdx);
        const naCount    = jobData.requestedFields.filter((key) => {
          const val = (row.original[key] ?? "").trim().toUpperCase();
          return val === "NA" || val === "N/A";
        }).length;
        const showRetry  = status === "error" || (status === "done" && naCount >= 2);
        if (!showRetry) return null;
        return (
          <div className="flex items-center gap-1.5">
            <select
              disabled={isRetrying}
              value={retryModel[rIdx] ?? MODEL_OPTIONS[0].value}
              onChange={(e) => setRetryModel((prev) => ({ ...prev, [rIdx]: e.target.value }))}
              className="text-xs border border-cloudy/30 rounded-md px-1.5 py-1 bg-white text-gray-700 focus:outline-none focus:ring-1 focus:ring-brand-400 disabled:opacity-50"
            >
              {MODEL_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <button
              disabled={isRetrying}
              onClick={() => handleRetry(rIdx)}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-white bg-brand-500 hover:bg-brand-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isRetrying ? <Loader2 className="w-3 h-3 animate-spin" /> : "Retry"}
            </button>
          </div>
        );
      },
    };

    const leadCols = isPrioritized ? [rankCol] : [];
    return [statusCol, ...leadCols, ...originalCols, ...enrichedCols, costCol, retryCol];
  }, [jobData, retryingRows, retryModel, handleRetry, isPrioritized]);

  const table = useReactTable({
    data: tableData, columns,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel:     getCoreRowModel(),
    getSortedRowModel:   getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  if (notFound) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <p className="text-sm font-medium text-gray-900 mb-1">Job not found</p>
          <p className="text-xs text-cloudy mb-4">The server may have restarted.</p>
          <button onClick={() => router.push("/enrich/company")} className="text-sm text-brand-500 hover:text-brand-600 font-medium">
            Start a new enrichment →
          </button>
        </div>
      </div>
    );
  }

  if (!jobData) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="w-5 h-5 text-cloudy animate-spin" />
      </div>
    );
  }

  const isComplete = jobData.status === "completed" || jobData.status === "failed" || jobData.status === "cancelled";
  const isRunning  = jobData.status === "processing" || jobData.status === "pending";
  const doneCount  = jobData.rows.filter((r) => r.status === "done").length;
  const errorCount = jobData.rows.filter((r) => r.status === "error").length;
  const TypeIcon   =
    jobData.type === "company"          ? Building2
    : jobData.type === "people"         ? Users
    : jobData.type === "lead_score"     ? Target
    : jobData.type === "buying_trigger" ? Flame
    : UserSearch;
  const typeLabel  =
    jobData.type === "company"          ? "Company"
    : jobData.type === "people"         ? "People"
    : jobData.type === "lead_score"     ? "Lead Score"
    : jobData.type === "buying_trigger" ? "Buying Triggers"
    : "Decision Maker";

  const cacheReadTotal     = jobData.rows.reduce((s, r) => s + (r.cacheReadTokens ?? 0), 0);
  const cacheCreationTotal = jobData.rows.reduce((s, r) => s + (r.cacheCreationTokens ?? 0), 0);
  const cachedTokensTotal  = cacheReadTotal + cacheCreationTotal;
  const cacheHitRate       = cachedTokensTotal > 0
    ? Math.round((cacheReadTotal / cachedTokensTotal) * 100)
    : 0;

  return (
    <div className="flex flex-col min-h-screen">
      {/* Progress strip */}
      {!isComplete && (
        <div className="h-0.5 bg-cloudy/20 flex-shrink-0">
          <div className="h-full bg-brand-500 transition-all duration-500 ease-out" style={{ width: `${jobData.percentComplete}%` }} />
        </div>
      )}

      {/* Header */}
      <div className="bg-white border-b border-cloudy/20 px-8 py-5 flex-shrink-0 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-brand-50 flex items-center justify-center flex-shrink-0">
            <TypeIcon className="w-4 h-4 text-brand-500" strokeWidth={2} />
          </div>
          <div className="min-w-0">
            <h1 className="text-base font-semibold text-gray-900">
              {isLeadScore
                ? "Lead Score — Prioritized Results"
                : isBuyingTrigger
                ? "Buying Triggers — Heat-Ranked Results"
                : `${typeLabel} Enrichment — Results`}
            </h1>
            <div className="flex items-center gap-2 mt-0.5">
              {isComplete ? (
                <>
                  {jobData.status === "cancelled" && <span className="text-xs text-cloudy font-medium">Cancelled</span>}
                  {doneCount > 0 && <span className="text-xs text-green-600 font-medium">{doneCount} enriched</span>}
                  {doneCount > 0 && errorCount > 0 && <span className="text-cloudy/40">·</span>}
                  {errorCount > 0 && <span className="text-xs text-red-500 font-medium">{errorCount} failed</span>}
                  {cachedTokensTotal > 0 && (
                    <>
                      <span className="text-cloudy/40">·</span>
                      <span
                        className="text-xs text-cloudy font-medium"
                        title={`${cacheReadTotal.toLocaleString()} cache read / ${cacheCreationTotal.toLocaleString()} cache creation input tokens`}
                      >
                        {cacheHitRate}% cache hit
                      </span>
                    </>
                  )}
                </>
              ) : (
                <span className="text-xs text-cloudy flex items-center gap-1.5">
                  <Loader2 className="w-3 h-3 animate-spin text-brand-500" />
                  Enriching {jobData.processedRows} of {jobData.totalRows} rows…
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {isRunning && (
            <button
              onClick={handleCancel}
              disabled={cancelling}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium text-gray-600 bg-white border border-cloudy/30 hover:bg-pampas transition-all duration-150 disabled:opacity-50"
            >
              {cancelling ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <StopCircle className="w-3.5 h-3.5" strokeWidth={2} />}
              Cancel
            </button>
          )}
          {!isRunning && (
            <button
              onClick={() => router.push(`/enrich/${jobData.type}`)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium text-gray-600 bg-white border border-cloudy/30 hover:bg-pampas transition-all duration-150"
            >
              ← New enrichment
            </button>
          )}
          <a
            href={`/api/download/${jobId}`}
            download
            className={clsx(
              "inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-150",
              isComplete && doneCount > 0
                ? "bg-brand-500 text-white hover:bg-brand-600 shadow-sm"
                : "bg-cloudy/20 text-cloudy pointer-events-none"
            )}
          >
            <Download className="w-3.5 h-3.5" strokeWidth={2} />
            Download CSV
          </a>
        </div>
      </div>

      {/* Toolbar */}
      <div className="bg-white border-b border-cloudy/20 px-8 py-3 flex-shrink-0 flex items-center gap-3">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-cloudy" strokeWidth={2} />
          <input
            value={globalFilter}
            onChange={(e) => setGlobalFilter(e.target.value)}
            placeholder="Filter rows…"
            className="bg-pampas border border-cloudy/30 rounded-lg pl-8 pr-3 py-1.5 text-sm text-gray-900 placeholder:text-cloudy focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent w-56 transition"
          />
        </div>

        {isPrioritized && jobData.totalRows > TOP_N && (
          <div className="flex items-center gap-1 bg-pampas border border-cloudy/30 rounded-lg p-0.5">
            <button
              onClick={() => setShowTopOnly(true)}
              className={clsx(
                "px-3 py-1 rounded-md text-xs font-medium transition-all",
                showTopOnly ? "bg-white text-gray-900 shadow-sm" : "text-cloudy hover:text-gray-700"
              )}
            >
              Top {TOP_N}
            </button>
            <button
              onClick={() => setShowTopOnly(false)}
              className={clsx(
                "px-3 py-1 rounded-md text-xs font-medium transition-all",
                !showTopOnly ? "bg-white text-gray-900 shadow-sm" : "text-cloudy hover:text-gray-700"
              )}
            >
              All {jobData.totalRows}
            </button>
          </div>
        )}

        <span className="text-xs text-cloudy ml-auto">
          {isPrioritized && showTopOnly && jobData.totalRows > TOP_N
            ? `Top ${table.getFilteredRowModel().rows.length} of ${jobData.totalRows} rows`
            : `${table.getFilteredRowModel().rows.length} of ${jobData.totalRows} rows`}
        </span>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-sm border-collapse min-w-max">
          <thead className="sticky top-0 z-10 bg-pampas border-b border-cloudy/20">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((header) => {
                  const sorted  = header.column.getIsSorted();
                  const canSort = header.column.getCanSort();
                  return (
                    <th
                      key={header.id}
                      style={{ width: header.getSize() !== 150 ? header.getSize() : undefined }}
                      className={clsx(
                        "text-left px-4 py-2.5 text-[11px] font-semibold text-cloudy uppercase tracking-wider whitespace-nowrap",
                        canSort && "cursor-pointer hover:text-gray-700 select-none"
                      )}
                      onClick={header.column.getToggleSortingHandler()}
                    >
                      {header.isPlaceholder ? null : (
                        <span className="inline-flex items-center gap-1">
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {canSort && (
                            sorted === "asc"  ? <ArrowUp className="w-3 h-3" /> :
                            sorted === "desc" ? <ArrowDown className="w-3 h-3" /> :
                                                <ArrowUpDown className="w-3 h-3 opacity-30" />
                          )}
                        </span>
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody className="bg-white divide-y divide-cloudy/10">
            {table.getRowModel().rows.map((row) => {
              const isError = row.original._status === "error";
              return (
                <tr
                  key={row.id}
                  title={isError ? row.original._error : undefined}
                  className={clsx("transition-colors", isError ? "bg-red-50" : "hover:bg-pampas")}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="px-4 py-2.5">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              );
            })}
            {table.getRowModel().rows.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="px-6 py-16 text-center text-sm text-cloudy">
                  {globalFilter ? "No rows match your filter." : "Waiting for data…"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
