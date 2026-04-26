// RDAP (Registration Data Access Protocol) client.
//
// Phase 4 — domain age + registrar are strong SMB signals:
//   - <1 year old → newly launched, fresh website, often pre-revenue
//   - 1-5 years   → growing
//   - 5-15 years  → established
//   - 15+ years   → legacy / brand presence
//
// Plus a "looks like a real business?" check: a domain registered 2
// weeks ago to a privacy-shielded contact at a $1.99 registrar reads
// very differently from one at the same business for 12 years.
//
// RDAP replaces classic WHOIS with a structured JSON API that's now
// ICANN-mandated for gTLDs. We hit https://rdap.org/domain/<domain>
// which acts as a routing layer to the authoritative server for the
// TLD. Override RDAP_BASE_URL to point at a self-hosted aggregator.

const RDAP_BASE = process.env.RDAP_BASE_URL ?? "https://rdap.org";
const FETCH_TIMEOUT_MS = 8_000;

export type DomainInfo = {
  /** ISO date string when the domain was first registered. */
  createdAt?: string;
  /** Registrar name (e.g. "GoDaddy.com, LLC"). */
  registrar?: string;
  /** ISO date string of the last update on file. */
  updatedAt?: string;
  /** ISO date string of the current expiration. */
  expiresAt?: string;
};

type RdapEvent = {
  eventAction?: string;
  eventDate?: string;
};

type RdapVcardField = [string, Record<string, unknown>, string, string?];

type RdapEntity = {
  roles?: string[];
  vcardArray?: ["vcard", RdapVcardField[]];
};

type RdapResponse = {
  events?: RdapEvent[];
  entities?: RdapEntity[];
  ldhName?: string;
};

export async function lookupDomainInfo(
  rawDomain: string
): Promise<DomainInfo | undefined> {
  const domain = normaliseDomain(rawDomain);
  if (!domain) return undefined;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(
      `${RDAP_BASE}/domain/${encodeURIComponent(domain)}`,
      {
        method: "GET",
        headers: { Accept: "application/rdap+json" },
        redirect: "follow",
        signal: controller.signal,
      }
    );
    if (!res.ok) return undefined;
    const json = (await res.json()) as RdapResponse;
    return parseRdapResponse(json);
  } catch {
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
}

export function parseRdapResponse(json: RdapResponse): DomainInfo {
  const events = json.events ?? [];
  const out: DomainInfo = {};
  for (const e of events) {
    if (!e.eventDate) continue;
    switch (e.eventAction) {
      case "registration":
        out.createdAt = e.eventDate;
        break;
      case "last changed":
      case "last update of RDAP database":
        // Prefer the more specific "last changed" if both appear.
        if (!out.updatedAt || e.eventAction === "last changed") {
          out.updatedAt = e.eventDate;
        }
        break;
      case "expiration":
        out.expiresAt = e.eventDate;
        break;
    }
  }
  out.registrar = pickRegistrar(json.entities ?? []);
  return out;
}

function pickRegistrar(entities: RdapEntity[]): string | undefined {
  for (const e of entities) {
    if (!e.roles?.includes("registrar")) continue;
    const vcard = e.vcardArray?.[1];
    if (!vcard) continue;
    for (const field of vcard) {
      const [key, , , value] = field;
      if (key === "fn" && typeof value === "string" && value.trim()) {
        return value.trim();
      }
    }
  }
  return undefined;
}

function normaliseDomain(raw: string): string | undefined {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return undefined;
  // Strip protocol + path; keep just the host.
  let host = trimmed;
  try {
    if (/^[a-z]+:\/\//.test(trimmed)) host = new URL(trimmed).hostname;
  } catch {
    // fall through with the raw string
  }
  // RDAP wants the registered (apex) name. Strip a leading "www." when
  // present; fancier multi-label TLDs (".co.uk" etc.) we leave alone —
  // RDAP redirects route by TLD anyway.
  return host.replace(/^www\./, "") || undefined;
}

/**
 * Convert an ISO date string from RDAP into epoch ms; returns undefined
 * if the string is missing or unparseable.
 */
export function isoToEpochMs(iso?: string): number | undefined {
  if (!iso) return undefined;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : undefined;
}
