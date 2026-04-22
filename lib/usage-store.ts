import { getDb } from "./db";

export type MonthlyUsage = {
  month: string; // YYYY-MM
  leadCount: number;
  costUsd: number;
  updatedAt: number;
};

type UsageRow = {
  month: string;
  lead_count: number;
  cost_usd: number;
  updated_at: number;
};

// Monthly caps — surfaced as warnings in the UI. Kept server-side so the
// runner can block or flag runs that would blow past the cap.
export const DEFAULT_MONTHLY_LEAD_CAP = Number(process.env.MONITOR_MONTHLY_LEAD_CAP ?? 5000);
export const DEFAULT_MONTHLY_COST_CAP = Number(process.env.MONITOR_MONTHLY_COST_CAP ?? 50);

function monthKey(ms: number = Date.now()): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function fromRow(r: UsageRow): MonthlyUsage {
  return {
    month: r.month,
    leadCount: r.lead_count,
    costUsd: r.cost_usd,
    updatedAt: r.updated_at,
  };
}

export function recordUsage(leadDelta: number, costDelta: number): MonthlyUsage {
  const db = getDb();
  const month = monthKey();
  const now = Date.now();
  db.prepare(
    `INSERT INTO monthly_usage (month, lead_count, cost_usd, updated_at)
     VALUES (@month, @leads, @cost, @now)
     ON CONFLICT(month) DO UPDATE SET
       lead_count = lead_count + @leads,
       cost_usd   = cost_usd   + @cost,
       updated_at = @now`
  ).run({ month, leads: leadDelta, cost: costDelta, now });
  return getCurrentUsage();
}

export function getCurrentUsage(): MonthlyUsage {
  const db = getDb();
  const month = monthKey();
  const row = db.prepare(`SELECT * FROM monthly_usage WHERE month = ?`).get(month) as
    | UsageRow
    | undefined;
  if (!row) {
    return { month, leadCount: 0, costUsd: 0, updatedAt: Date.now() };
  }
  return fromRow(row);
}

export function listUsage(limit = 12): MonthlyUsage[] {
  const db = getDb();
  const rows = db
    .prepare(`SELECT * FROM monthly_usage ORDER BY month DESC LIMIT ?`)
    .all(limit) as UsageRow[];
  return rows.map(fromRow);
}

export function capStatus(usage: MonthlyUsage): {
  leadPercent: number;
  costPercent: number;
  leadCap: number;
  costCap: number;
  warning: boolean;
  exceeded: boolean;
} {
  const leadPercent = DEFAULT_MONTHLY_LEAD_CAP > 0 ? usage.leadCount / DEFAULT_MONTHLY_LEAD_CAP : 0;
  const costPercent = DEFAULT_MONTHLY_COST_CAP > 0 ? usage.costUsd / DEFAULT_MONTHLY_COST_CAP : 0;
  const p = Math.max(leadPercent, costPercent);
  return {
    leadPercent,
    costPercent,
    leadCap: DEFAULT_MONTHLY_LEAD_CAP,
    costCap: DEFAULT_MONTHLY_COST_CAP,
    warning: p >= 0.8,
    exceeded: p >= 1,
  };
}
