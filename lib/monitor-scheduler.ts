import type { MonitorSchedule } from "./monitor-store";

const DAY_MS = 24 * 60 * 60 * 1000;

export function computeNextRunAt(
  schedule: MonitorSchedule,
  from: number = Date.now()
): number | undefined {
  switch (schedule) {
    case "daily":
      return from + DAY_MS;
    case "weekly":
      return from + 7 * DAY_MS;
    case "monthly": {
      const d = new Date(from);
      d.setUTCMonth(d.getUTCMonth() + 1);
      return d.getTime();
    }
    case "once":
    case "manual":
    default:
      return undefined;
  }
}

export function isSchedulable(schedule: MonitorSchedule): boolean {
  return schedule === "daily" || schedule === "weekly" || schedule === "monthly";
}
