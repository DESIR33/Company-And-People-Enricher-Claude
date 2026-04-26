// Apify API client.
//
// Apify is a scraping-as-a-service platform with battle-tested actors
// (= scrapers) for the directories that block direct fetches: LinkedIn,
// Glassdoor, Crunchbase, Yelp, Google Maps, Indeed, Trustpilot, etc.
// They handle proxies, browser pools, anti-bot evasion, retries, and
// CAPTCHA solving. We just call the API and pay per dataset item.
//
// Three primitives are wrapped here:
//   - runActor(actorId, input)       → start a sync-or-async run
//   - waitForRun(runId)              → poll until the run finishes
//   - getDatasetItems(datasetId)     → fetch the items the run produced
//
// Plus a high-level convenience:
//   - runActorAndGetItems(actorId, input) → run + wait + fetch + cost
//
// Auth is `?token=...` query param. Actor IDs use either `username~actor`
// (Apify's canonical form) or `username/actor` (the URL form on apify.com)
// — we normalise to the canonical tilde form before calling the API.

const APIFY_BASE = process.env.APIFY_BASE_URL ?? "https://api.apify.com/v2";
const DEFAULT_POLL_INTERVAL_MS = 3000;
const DEFAULT_MAX_WAIT_MS = 5 * 60 * 1000; // 5 min — long enough for SMB actors

export type ApifyRunStatus =
  | "READY"
  | "RUNNING"
  | "SUCCEEDED"
  | "FAILED"
  | "TIMING-OUT"
  | "TIMED-OUT"
  | "ABORTING"
  | "ABORTED";

export type ApifyRun = {
  id: string;
  actId: string;
  status: ApifyRunStatus;
  startedAt: string;
  finishedAt?: string;
  defaultDatasetId: string;
  defaultKeyValueStoreId: string;
  // Apify reports compute units, dataset operations, etc. We surface the
  // total USD spent on this run when present so the runner can roll it
  // into the search's costUsd.
  usageTotalUsd?: number;
};

type RawRunResponse = { data?: ApifyRun };

export type ApifyItem = Record<string, unknown>;

function token(): string {
  const t = process.env.APIFY_API_TOKEN;
  if (!t) {
    throw new Error(
      "APIFY_API_TOKEN is not set. Get one at https://console.apify.com → Account → Integrations → Personal API tokens."
    );
  }
  return t;
}

// Apify accepts both `username~actor` (API canonical) and `username/actor`
// (URL form). Their API docs use the tilde form everywhere. Normalising
// at the boundary lets users paste the URL form they see on apify.com.
export function normalizeActorId(actorId: string): string {
  return actorId.trim().replace(/\//g, "~");
}

async function apifyFetch(
  path: string,
  init: RequestInit & { signal?: AbortSignal } = {}
): Promise<Response> {
  const sep = path.includes("?") ? "&" : "?";
  const url = `${APIFY_BASE}${path}${sep}token=${encodeURIComponent(token())}`;
  return fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

export async function runActor(
  actorId: string,
  input: Record<string, unknown>,
  signal?: AbortSignal
): Promise<ApifyRun> {
  const id = normalizeActorId(actorId);
  const res = await apifyFetch(`/acts/${id}/runs`, {
    method: "POST",
    body: JSON.stringify(input),
    signal,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Apify runActor(${id}) ${res.status}: ${text.slice(0, 400)}`);
  }
  const json = (await res.json()) as RawRunResponse;
  if (!json.data) throw new Error(`Apify runActor(${id}): empty response`);
  return json.data;
}

export async function getRun(
  runId: string,
  signal?: AbortSignal
): Promise<ApifyRun> {
  const res = await apifyFetch(`/actor-runs/${encodeURIComponent(runId)}`, {
    method: "GET",
    signal,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Apify getRun(${runId}) ${res.status}: ${text.slice(0, 400)}`);
  }
  const json = (await res.json()) as RawRunResponse;
  if (!json.data) throw new Error(`Apify getRun(${runId}): empty response`);
  return json.data;
}

const TERMINAL_STATUSES: readonly ApifyRunStatus[] = [
  "SUCCEEDED",
  "FAILED",
  "TIMED-OUT",
  "ABORTED",
];

export async function waitForRun(
  runId: string,
  opts: {
    signal?: AbortSignal;
    pollIntervalMs?: number;
    maxWaitMs?: number;
    onProgress?: (run: ApifyRun) => void;
  } = {}
): Promise<ApifyRun> {
  const interval = opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const deadline = Date.now() + (opts.maxWaitMs ?? DEFAULT_MAX_WAIT_MS);

  // First check is immediate so trivially-fast actors return without a sleep.
  let run = await getRun(runId, opts.signal);
  opts.onProgress?.(run);
  while (!TERMINAL_STATUSES.includes(run.status)) {
    if (opts.signal?.aborted) {
      throw new Error("Apify wait aborted");
    }
    if (Date.now() > deadline) {
      throw new Error(`Apify run ${runId} did not finish within ${opts.maxWaitMs ?? DEFAULT_MAX_WAIT_MS}ms`);
    }
    await sleep(interval, opts.signal);
    run = await getRun(runId, opts.signal);
    opts.onProgress?.(run);
  }
  return run;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("aborted"));
      return;
    }
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new Error("aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export async function getDatasetItems(
  datasetId: string,
  opts: { limit?: number; signal?: AbortSignal } = {}
): Promise<ApifyItem[]> {
  const limit = opts.limit ?? 1000;
  const res = await apifyFetch(
    `/datasets/${encodeURIComponent(datasetId)}/items?limit=${limit}&clean=1&format=json`,
    { method: "GET", signal: opts.signal }
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Apify getDatasetItems(${datasetId}) ${res.status}: ${text.slice(0, 400)}`
    );
  }
  const json = (await res.json()) as ApifyItem[] | { items?: ApifyItem[] };
  // Apify returns a bare array when ?format=json. Older endpoints wrap in
  // {items: [...]}; we accept both for robustness.
  return Array.isArray(json) ? json : json.items ?? [];
}

export type ApifyRunResult = {
  run: ApifyRun;
  items: ApifyItem[];
};

export async function runActorAndGetItems(
  actorId: string,
  input: Record<string, unknown>,
  opts: {
    signal?: AbortSignal;
    pollIntervalMs?: number;
    maxWaitMs?: number;
    itemLimit?: number;
    onProgress?: (run: ApifyRun) => void;
  } = {}
): Promise<ApifyRunResult> {
  const started = await runActor(actorId, input, opts.signal);
  const finished = await waitForRun(started.id, {
    signal: opts.signal,
    pollIntervalMs: opts.pollIntervalMs,
    maxWaitMs: opts.maxWaitMs,
    onProgress: opts.onProgress,
  });
  if (finished.status !== "SUCCEEDED") {
    throw new Error(
      `Apify run ${finished.id} ended with status ${finished.status}`
    );
  }
  const items = await getDatasetItems(finished.defaultDatasetId, {
    limit: opts.itemLimit,
    signal: opts.signal,
  });
  return { run: finished, items };
}
