import { EventEmitter } from "node:events";
import type { EnrichmentRow, Job } from "./job-store";

type JobEvents = {
  job: (partial: Partial<Job>) => void;
  row: (row: EnrichmentRow) => void;
  end: () => void;
};

type JobEmitter = EventEmitter & {
  on<K extends keyof JobEvents>(event: K, listener: JobEvents[K]): JobEmitter;
  off<K extends keyof JobEvents>(event: K, listener: JobEvents[K]): JobEmitter;
  emit<K extends keyof JobEvents>(event: K, ...args: Parameters<JobEvents[K]>): boolean;
};

type Globals = typeof globalThis & { __enricherJobBuses?: Map<string, JobEmitter> };
const g = globalThis as Globals;
if (!g.__enricherJobBuses) g.__enricherJobBuses = new Map();
const buses = g.__enricherJobBuses;

export function getJobBus(jobId: string): JobEmitter {
  let bus = buses.get(jobId);
  if (!bus) {
    bus = new EventEmitter() as JobEmitter;
    bus.setMaxListeners(50);
    buses.set(jobId, bus);
  }
  return bus;
}

export function disposeJobBus(jobId: string): void {
  const bus = buses.get(jobId);
  if (!bus) return;
  bus.emit("end");
  bus.removeAllListeners();
  buses.delete(jobId);
}
