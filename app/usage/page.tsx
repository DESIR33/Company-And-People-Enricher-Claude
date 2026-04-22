"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertCircle, Gauge, Loader2 } from "lucide-react";
import { clsx } from "clsx";

type UsageMonth = { month: string; leadCount: number; costUsd: number };
type Caps = {
  leadPercent: number;
  costPercent: number;
  leadCap: number;
  costCap: number;
  warning: boolean;
  exceeded: boolean;
};

export default function UsagePage() {
  const [current, setCurrent] = useState<UsageMonth | null>(null);
  const [history, setHistory] = useState<UsageMonth[]>([]);
  const [caps, setCaps] = useState<Caps | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/usage");
      const data = await res.json();
      setCurrent(data.current);
      setHistory(data.history ?? []);
      setCaps(data.caps);
    } catch {
      setError("Failed to load usage");
    }
  }, []);

  useEffect(() => {
    const first = setTimeout(load, 0);
    const t = setInterval(load, 10_000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [load]);

  return (
    <div className="min-h-screen pb-16">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 pt-4 sm:pt-6 space-y-4 sm:space-y-6">
        <div>
          <div className="flex items-center gap-2">
            <Gauge className="w-5 h-5 text-brand-500 flex-shrink-0" strokeWidth={2} />
            <h1 className="text-2xl sm:text-3xl font-serif font-bold text-gray-900 tracking-tight">Usage</h1>
          </div>
          <p className="text-sm text-cloudy mt-1">
            Monthly lead count and cost — across every Social Engager monitor. Caps are set via{" "}
            <code className="text-[11px] bg-pampas px-1 py-0.5 rounded break-all">MONITOR_MONTHLY_LEAD_CAP</code> and{" "}
            <code className="text-[11px] bg-pampas px-1 py-0.5 rounded break-all">MONITOR_MONTHLY_COST_CAP</code>.
          </p>
        </div>

        {error && (
          <div className="flex items-center gap-2 px-3 py-2 bg-red-50 border border-red-200 rounded-md text-xs text-red-700">
            <AlertCircle className="w-3.5 h-3.5" /> {error}
          </div>
        )}

        {!current || !caps ? (
          <div className="text-sm text-cloudy flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading usage…
          </div>
        ) : (
          <>
            {caps.warning && (
              <div
                className={clsx(
                  "px-4 py-3 rounded-lg border text-xs flex items-center gap-2",
                  caps.exceeded
                    ? "bg-red-50 border-red-200 text-red-700"
                    : "bg-amber-50 border-amber-200 text-amber-800"
                )}
              >
                <AlertCircle className="w-4 h-4" />
                {caps.exceeded
                  ? "Monthly cap reached — new scheduled and manual runs are blocked until next month."
                  : `You have used ${Math.round(Math.max(caps.leadPercent, caps.costPercent) * 100)}% of this month's cap.`}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <UsageMeter
                label="Leads this month"
                value={current.leadCount.toLocaleString()}
                cap={caps.leadCap.toLocaleString()}
                percent={caps.leadPercent}
              />
              <UsageMeter
                label="Cost this month"
                value={`$${current.costUsd.toFixed(3)}`}
                cap={`$${caps.costCap.toFixed(2)}`}
                percent={caps.costPercent}
              />
            </div>

            <section>
              <h2 className="text-sm font-semibold text-gray-700 mb-2">History</h2>
              <div className="bg-white border border-cloudy/30 rounded-xl overflow-hidden">
                {history.length === 0 ? (
                  <div className="px-4 py-8 text-center text-xs text-cloudy">
                    No recorded usage yet.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                  <table className="min-w-full text-xs">
                    <thead>
                      <tr className="bg-pampas/60 text-left text-[10px] uppercase tracking-wider text-cloudy">
                        <th className="px-3 py-2 font-semibold">Month</th>
                        <th className="px-3 py-2 font-semibold">Leads</th>
                        <th className="px-3 py-2 font-semibold">Cost</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.map((m) => (
                        <tr key={m.month} className="border-t border-cloudy/10">
                          <td className="px-3 py-2 tabular">{m.month}</td>
                          <td className="px-3 py-2 tabular">{m.leadCount.toLocaleString()}</td>
                          <td className="px-3 py-2 tabular">${m.costUsd.toFixed(3)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  </div>
                )}
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}

function UsageMeter({
  label,
  value,
  cap,
  percent,
}: {
  label: string;
  value: string;
  cap: string;
  percent: number;
}) {
  const pct = Math.min(100, Math.max(0, percent * 100));
  const tone =
    pct >= 100 ? "bg-red-500" : pct >= 80 ? "bg-amber-500" : "bg-brand-500";
  return (
    <div className="bg-white border border-cloudy/30 rounded-xl p-4">
      <div className="flex items-baseline justify-between">
        <p className="text-[10px] uppercase tracking-wider text-cloudy font-semibold">{label}</p>
        <span className="text-[11px] text-cloudy tabular">{cap} cap</span>
      </div>
      <p className="text-2xl font-serif font-semibold text-gray-900 mt-1 tabular">{value}</p>
      <div className="mt-2 h-1.5 bg-pampas rounded-full overflow-hidden">
        <div
          className={clsx("h-full rounded-full transition-all duration-300", tone)}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-[10px] text-cloudy tabular mt-1">{pct.toFixed(1)}% used</p>
    </div>
  );
}
