// Signal-enrichment orchestrator for canonical companies.
//
// Given a CanonicalCompany with a domain, run the three free signal
// fetchers (tech stack, RDAP, CT logs) in parallel and write the
// resulting fields back to the canonical row. Failures in any one
// fetcher are isolated — the others still complete and write their
// columns.
//
// Public surface:
//   - enrichCanonicalSignals(id)      — load company, fetch, persist
//   - fetchAllSignals(websiteUrl, domain) — pure fetch, no persist
//   - applySignalsToCanonical(id, …) — write-only, used by tests + UI
//   - SignalEnrichResult — what changed (used by API responses)

import { getDb } from "../db";
import {
  getCanonicalCompany,
  registerCanonicalAfterUpsertHook,
  type CanonicalCompany,
} from "../canonical-companies";
import { detectTechStack } from "./tech-stack";
import { isoToEpochMs, lookupDomainInfo } from "./domain-info";
import { lookupFirstCertDate } from "./ct-logs";

export type FetchedSignals = {
  techStack?: string[];
  domainCreatedAt?: number;
  domainRegistrar?: string;
  firstCertAt?: number;
};

export type SignalEnrichResult = {
  ok: boolean;
  // What we wrote — caller can render this as "enriched: tech stack +
  // domain age + first cert" without re-fetching the company.
  changed: FetchedSignals;
  // Fetcher-level error messages keyed by signal name. Per-fetcher
  // failures don't fail the whole call — partial enrichment is the
  // norm (e.g. some private TLDs return RDAP 403; the tech stack and
  // CT logs still come through).
  errors: Record<string, string>;
};

// Pure fetch — runs the three sources in parallel, returns whatever
// each one yields. Tests mock the underlying fetchers.
export async function fetchAllSignals(
  websiteUrl: string | undefined,
  domain: string | undefined
): Promise<{ signals: FetchedSignals; errors: Record<string, string> }> {
  const errors: Record<string, string> = {};
  const target = websiteUrl ?? (domain ? `https://${domain}` : undefined);

  const techPromise = target
    ? detectTechStack(target).catch((err) => {
        errors.techStack = String(err);
        return [] as string[];
      })
    : Promise.resolve([] as string[]);

  const rdapPromise = domain
    ? lookupDomainInfo(domain).catch((err) => {
        errors.domainInfo = String(err);
        return undefined;
      })
    : Promise.resolve(undefined);

  const certPromise = domain
    ? lookupFirstCertDate(domain).catch((err) => {
        errors.firstCert = String(err);
        return undefined;
      })
    : Promise.resolve(undefined);

  const [techStack, rdap, firstCertIso] = await Promise.all([
    techPromise,
    rdapPromise,
    certPromise,
  ]);

  const signals: FetchedSignals = {};
  if (techStack && techStack.length > 0) signals.techStack = techStack;
  if (rdap?.createdAt) signals.domainCreatedAt = isoToEpochMs(rdap.createdAt);
  if (rdap?.registrar) signals.domainRegistrar = rdap.registrar;
  if (firstCertIso) signals.firstCertAt = isoToEpochMs(firstCertIso);
  return { signals, errors };
}

// Persist-only — used both by the orchestrator and by tests that want
// to inject signals without hitting the network.
export function applySignalsToCanonical(
  id: string,
  signals: FetchedSignals
): CanonicalCompany | undefined {
  const existing = getCanonicalCompany(id);
  if (!existing) return undefined;

  const db = getDb();
  const now = Date.now();
  // Only update slots the caller actually populated. Leaving values
  // alone (rather than NULL-overwriting) means partial enrichment from
  // a TLD with stricter RDAP doesn't wipe an earlier successful run.
  const updates: string[] = [];
  const params: Record<string, unknown> = { id, signalsUpdatedAt: now };

  if (signals.techStack !== undefined) {
    updates.push("tech_stack = @techStack");
    params.techStack = JSON.stringify(signals.techStack);
  }
  if (signals.domainCreatedAt !== undefined) {
    updates.push("domain_created_at = @domainCreatedAt");
    params.domainCreatedAt = signals.domainCreatedAt;
  }
  if (signals.domainRegistrar !== undefined) {
    updates.push("domain_registrar = @domainRegistrar");
    params.domainRegistrar = signals.domainRegistrar;
  }
  if (signals.firstCertAt !== undefined) {
    updates.push("first_cert_at = @firstCertAt");
    params.firstCertAt = signals.firstCertAt;
  }
  // Always stamp signals_updated_at so the UI can show "last enriched
  // 2 hours ago" even when every fetcher returned empty (no domain,
  // private RDAP, etc.).
  updates.push("signals_updated_at = @signalsUpdatedAt");

  db.prepare(
    `UPDATE canonical_companies SET ${updates.join(", ")} WHERE id = @id`
  ).run(params);
  return getCanonicalCompany(id);
}

export async function enrichCanonicalSignals(
  id: string
): Promise<SignalEnrichResult> {
  const company = getCanonicalCompany(id);
  if (!company) {
    return {
      ok: false,
      changed: {},
      errors: { lookup: `canonical company ${id} not found` },
    };
  }
  const { signals, errors } = await fetchAllSignals(
    company.websiteUrl,
    company.domain
  );
  applySignalsToCanonical(id, signals);
  return { ok: true, changed: signals, errors };
}

// --- Auto-enrich queue ----------------------------------------------------
// Phase 4.2 — every canonical upsert can trigger background enrichment so
// users don't have to click "Enrich" on each row. Bounded so a discovery
// run that lands 100 SMBs at once doesn't slam crt.sh / rdap.org / 100
// company websites simultaneously.
//
// Design points:
//   - In-process queue + dedup. Survives only as long as the Node
//     process; that's fine — discovery work is also in-process.
//   - TTL guard so re-merging an already-enriched company doesn't
//     re-fetch (default 7 days).
//   - Concurrency cap (default 3) keeps load on free upstream APIs
//     polite.
//   - No domain → skip enqueue entirely (nothing to enrich).
//   - Fully optional — flip AUTO_ENRICH_SIGNALS=0 to disable.

const AUTO_ENRICH_ENABLED =
  (process.env.AUTO_ENRICH_SIGNALS ?? "1") !== "0";
const AUTO_ENRICH_TTL_MS =
  Math.max(0, Number(process.env.AUTO_ENRICH_TTL_DAYS ?? "7")) *
  24 *
  60 *
  60 *
  1000;
const AUTO_ENRICH_MAX_CONCURRENCY = Math.max(
  1,
  Number(process.env.AUTO_ENRICH_MAX_CONCURRENCY ?? "3")
);

const queue: string[] = [];
const inFlight = new Set<string>();
let activeWorkers = 0;
// Test seam — vitest replaces this so suites can assert that enqueue
// actually fired without spinning up real fetches.
let runner: (id: string) => Promise<unknown> = enrichCanonicalSignals;

export function _setAutoEnrichRunnerForTests(
  fn: (id: string) => Promise<unknown>
): () => void {
  const prev = runner;
  runner = fn;
  return () => {
    runner = prev;
  };
}

export function _resetAutoEnrichQueueForTests(): void {
  queue.length = 0;
  inFlight.clear();
  activeWorkers = 0;
}

export function enqueueAutoEnrich(
  company: Pick<CanonicalCompany, "id" | "domain" | "websiteUrl" | "signalsUpdatedAt">
): boolean {
  if (!AUTO_ENRICH_ENABLED) return false;
  if (!company.domain && !company.websiteUrl) return false;
  if (
    company.signalsUpdatedAt !== undefined &&
    Date.now() - company.signalsUpdatedAt < AUTO_ENRICH_TTL_MS
  ) {
    return false;
  }
  if (inFlight.has(company.id)) return false;
  if (queue.includes(company.id)) return false;
  queue.push(company.id);
  pumpQueue();
  return true;
}

function pumpQueue(): void {
  while (activeWorkers < AUTO_ENRICH_MAX_CONCURRENCY && queue.length > 0) {
    const id = queue.shift();
    if (!id || inFlight.has(id)) continue;
    inFlight.add(id);
    activeWorkers += 1;
    runner(id)
      .catch(() => {
        // best-effort — failure of one row shouldn't stall the queue
      })
      .finally(() => {
        inFlight.delete(id);
        activeWorkers -= 1;
        pumpQueue();
      });
  }
}

// Register the upsert hook at module load so any consumer that imports
// this file (typically discovery-runner via side-effect import) wires
// auto-enrichment for free.
registerCanonicalAfterUpsertHook((company) => {
  enqueueAutoEnrich(company);
});
