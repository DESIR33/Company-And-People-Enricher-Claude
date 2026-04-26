// Certificate Transparency (CT) log lookup via crt.sh.
//
// Phase 4 — every public TLS certificate issued for a domain is
// published to public CT logs by the issuing CA. crt.sh is a free
// public mirror of those logs. The earliest cert for a domain is a
// proxy for "when did this site go live with HTTPS" — almost always
// within days of when the site itself launched.
//
// This complements RDAP nicely:
//   - Domain-created (RDAP)         → when the registrant bought the name.
//   - First-cert (CT logs)          → when the site actually went live.
//
// A 2018 domain registration with a first cert in March 2026 reads
// very differently from one with a first cert in 2018 — the gap
// signals a recent re-launch or rebrand.
//
// API: https://crt.sh/?q=<domain>&output=json
// Returns an array of cert objects with a `not_before` field. We pick
// the earliest. The crt.sh endpoint is permissive about the query
// (case-insensitive, accepts %-wildcards) so we send the bare domain
// without scheme.

const CT_LOGS_BASE = process.env.CT_LOGS_BASE_URL ?? "https://crt.sh";
const FETCH_TIMEOUT_MS = 10_000;

export type CtCert = {
  notBefore?: string;
  notAfter?: string;
  commonName?: string;
  issuerName?: string;
};

type RawCtRow = {
  not_before?: string;
  not_after?: string;
  common_name?: string;
  issuer_name?: string;
};

export async function lookupFirstCertDate(
  rawDomain: string
): Promise<string | undefined> {
  const certs = await listCertsForDomain(rawDomain);
  return earliestNotBefore(certs);
}

export async function listCertsForDomain(rawDomain: string): Promise<CtCert[]> {
  const domain = normaliseDomain(rawDomain);
  if (!domain) return [];

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const url = `${CT_LOGS_BASE}/?q=${encodeURIComponent(domain)}&output=json`;
    const res = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) return [];
    const json = (await res.json()) as RawCtRow[] | unknown;
    if (!Array.isArray(json)) return [];
    return json.map(rowToCert);
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

function rowToCert(r: RawCtRow): CtCert {
  return {
    notBefore: r.not_before,
    notAfter: r.not_after,
    commonName: r.common_name,
    issuerName: r.issuer_name,
  };
}

export function earliestNotBefore(certs: CtCert[]): string | undefined {
  let best: string | undefined;
  let bestMs = Infinity;
  for (const c of certs) {
    if (!c.notBefore) continue;
    const ms = Date.parse(c.notBefore);
    if (!Number.isFinite(ms)) continue;
    if (ms < bestMs) {
      bestMs = ms;
      best = c.notBefore;
    }
  }
  return best;
}

function normaliseDomain(raw: string): string | undefined {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return undefined;
  let host = trimmed;
  try {
    if (/^[a-z]+:\/\//.test(trimmed)) host = new URL(trimmed).hostname;
  } catch {
    // pass through
  }
  return host.replace(/^www\./, "") || undefined;
}
