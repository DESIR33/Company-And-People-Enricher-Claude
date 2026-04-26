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
