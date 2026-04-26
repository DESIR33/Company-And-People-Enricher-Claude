// Self-hosted Playwright browser pool.
//
// Phase 2.2 of the scraper layer. Apify covers tricky / well-protected
// sites (LinkedIn, Glassdoor, Crunchbase) but we pay per actor run.
// For high-volume sweeps over simpler directories (Yelp, BBB, Yellow
// Pages, chamber sites) self-hosted Playwright costs nothing per run
// once the infra is up.
//
// Constraints this module handles:
//   - playwright is an OPTIONAL dependency (~3MB package + 300MB
//     Chromium download). We lazy-load it and degrade cleanly on
//     environments where it isn't installed (notably Vercel — no
//     Chromium support in serverless functions).
//   - Browsers are expensive to launch, so we keep a singleton across
//     requests on long-running self-hosted Node servers.
//   - Anti-bot evasion: per-request residential / mobile proxy from a
//     comma-separated env pool, randomised user-agent, sane viewport.
//   - Polite scraping: per-domain rate limiter so a 200-page sweep
//     can't hammer one host.
//   - Concurrency cap so a discovery run doesn't open 50 browsers.
//
// Public surface:
//   - isPlaywrightAvailable() — quick "is this env able to run a
//     scrape?" probe used by the UI / runner.
//   - withPage(host, fn, opts) — allocate a context+page, await fn,
//     clean up. Returns whatever fn returns.
//   - shutdown() — close the singleton browser (called on test exit).

// We keep the dependency optional, so we don't import its types directly.
// Local minimal shapes are enough for what we use.
type PWPage = {
  goto: (url: string, opts?: { waitUntil?: string; timeout?: number }) => Promise<unknown>;
  content: () => Promise<string>;
  url: () => string;
  setExtraHTTPHeaders: (h: Record<string, string>) => Promise<void>;
  close: () => Promise<void>;
  waitForSelector: (sel: string, opts?: { timeout?: number }) => Promise<unknown>;
  evaluate: <T>(fn: () => T) => Promise<T>;
};

type PWContext = {
  newPage: () => Promise<PWPage>;
  close: () => Promise<void>;
};

type PWBrowser = {
  newContext: (opts: {
    userAgent?: string;
    viewport?: { width: number; height: number };
    locale?: string;
    proxy?: { server: string; username?: string; password?: string };
  }) => Promise<PWContext>;
  close: () => Promise<void>;
  isConnected: () => boolean;
};

type PWChromium = {
  launch: (opts?: { headless?: boolean }) => Promise<PWBrowser>;
};

type PWModule = { chromium: PWChromium };

const HEADLESS = (process.env.PLAYWRIGHT_BROWSER_HEADLESS ?? "1") !== "0";
const MAX_CONCURRENCY = Math.max(
  1,
  Number(process.env.PLAYWRIGHT_MAX_CONCURRENCY ?? "3")
);
// Minimum gap between requests to the same host (ms). 1000ms keeps us
// well below most directories' rate-limit thresholds.
const PER_HOST_GAP_MS = Math.max(
  0,
  Number(process.env.PLAYWRIGHT_PER_HOST_GAP_MS ?? "1000")
);

// Well-known recent desktop browser strings. Real Playwright traffic
// otherwise emits "HeadlessChrome" which directories block on sight.
const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0",
];

// --- Module-level state ---------------------------------------------------

let cachedModule: PWModule | undefined;
let cachedModuleAttempted = false;
let browserPromise: Promise<PWBrowser> | undefined;
const lastHostHit = new Map<string, number>();
let inFlight = 0;
const waiters: (() => void)[] = [];

// --- Lazy load + availability probe --------------------------------------

// Function-constructed import dodges static analysis: TypeScript can't
// statically resolve `import(p)` where `p` is a runtime string, and Next's
// bundler (Turbopack/webpack) follows suit. The result is that this file
// type-checks and builds even when `playwright` isn't in node_modules.
const dynamicImport: (specifier: string) => Promise<unknown> = new Function(
  "specifier",
  "return import(specifier)"
) as (s: string) => Promise<unknown>;

async function loadPlaywright(): Promise<PWModule | undefined> {
  if (cachedModuleAttempted) return cachedModule;
  cachedModuleAttempted = true;
  try {
    const mod = (await dynamicImport("playwright")) as PWModule;
    cachedModule = mod;
    return mod;
  } catch {
    return undefined;
  }
}

export async function isPlaywrightAvailable(): Promise<boolean> {
  return (await loadPlaywright()) !== undefined;
}

// --- Proxy & UA pickers --------------------------------------------------

export type ParsedProxy = {
  server: string;
  username?: string;
  password?: string;
};

// Accepts: bare URL ("http://1.2.3.4:8080"), URL with creds
// ("http://user:pass@1.2.3.4:8080"), or "host:port" (assumed http).
export function parseProxyUrl(raw: string): ParsedProxy | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  try {
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
      ? trimmed
      : `http://${trimmed}`;
    const u = new URL(withScheme);
    const username = u.username ? decodeURIComponent(u.username) : undefined;
    const password = u.password ? decodeURIComponent(u.password) : undefined;
    const server = `${u.protocol}//${u.host}`;
    return { server, username, password };
  } catch {
    return undefined;
  }
}

export function listProxies(): ParsedProxy[] {
  const raw = process.env.PLAYWRIGHT_PROXY_URL_POOL ?? "";
  return raw
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map(parseProxyUrl)
    .filter((p): p is ParsedProxy => p !== undefined);
}

export function pickProxy(): ParsedProxy | undefined {
  const pool = listProxies();
  if (pool.length === 0) return undefined;
  return pool[Math.floor(Math.random() * pool.length)];
}

export function pickUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

// --- Per-host rate limiter ----------------------------------------------

export async function waitForHost(host: string, gapMs = PER_HOST_GAP_MS): Promise<void> {
  if (gapMs <= 0) return;
  const now = Date.now();
  const last = lastHostHit.get(host);
  if (last !== undefined) {
    const elapsed = now - last;
    if (elapsed < gapMs) {
      await new Promise<void>((resolve) => setTimeout(resolve, gapMs - elapsed));
    }
  }
  lastHostHit.set(host, Date.now());
}

// Test helper — clears the rate-limiter map so unit tests aren't order-dependent.
export function _resetHostRateLimiter(): void {
  lastHostHit.clear();
}

// --- Concurrency semaphore ----------------------------------------------

async function acquire(): Promise<void> {
  if (inFlight < MAX_CONCURRENCY) {
    inFlight += 1;
    return;
  }
  await new Promise<void>((resolve) => waiters.push(resolve));
  inFlight += 1;
}

function release(): void {
  inFlight -= 1;
  const next = waiters.shift();
  if (next) next();
}

// --- Browser singleton ---------------------------------------------------

async function getBrowser(): Promise<PWBrowser> {
  if (browserPromise) {
    const b = await browserPromise;
    if (b.isConnected()) return b;
    browserPromise = undefined;
  }
  const mod = await loadPlaywright();
  if (!mod) {
    throw new Error(
      "Playwright is not installed. Run `npm install playwright && npx playwright install chromium` on a self-hosted server. Vercel functions cannot run Chromium."
    );
  }
  browserPromise = mod.chromium.launch({ headless: HEADLESS });
  return browserPromise;
}

export async function shutdown(): Promise<void> {
  if (!browserPromise) return;
  try {
    const b = await browserPromise;
    await b.close();
  } catch {
    // ignore — best-effort
  }
  browserPromise = undefined;
}

// --- Main entry: withPage ------------------------------------------------

export type WithPageOpts = {
  /** Override the random UA pick (e.g. tests). */
  userAgent?: string;
  /** Override the random proxy pick. Pass null to disable proxy entirely. */
  proxy?: ParsedProxy | null;
  /** Per-host minimum gap (ms). Default uses PLAYWRIGHT_PER_HOST_GAP_MS env. */
  hostGapMs?: number;
  /** Retries on thrown errors. Default 2 (so 3 total attempts). */
  retries?: number;
  /** Page nav timeout. Default 30s. */
  navTimeoutMs?: number;
  signal?: AbortSignal;
};

// Run `fn(page)` with a fresh context (= new IP/UA per call). The host
// arg is used for rate-limiting; pass the listing site's hostname.
export async function withPage<T>(
  host: string,
  fn: (page: PWPage) => Promise<T>,
  opts: WithPageOpts = {}
): Promise<T> {
  const retries = opts.retries ?? 2;
  let lastErr: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (opts.signal?.aborted) throw new Error("withPage aborted");

    await waitForHost(host, opts.hostGapMs);
    await acquire();

    let context: PWContext | undefined;
    let page: PWPage | undefined;
    try {
      const browser = await getBrowser();
      const proxy =
        opts.proxy === null
          ? undefined
          : opts.proxy ?? pickProxy();
      context = await browser.newContext({
        userAgent: opts.userAgent ?? pickUserAgent(),
        viewport: { width: 1366, height: 800 },
        locale: "en-US",
        proxy,
      });
      page = await context.newPage();
      const result = await fn(page);
      return result;
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        // Exponential backoff: 500ms, 1500ms, 4500ms.
        const delay = 500 * Math.pow(3, attempt);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    } finally {
      try {
        await page?.close();
      } catch {
        // ignore
      }
      try {
        await context?.close();
      } catch {
        // ignore
      }
      release();
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error(`withPage(${host}) failed after ${retries + 1} attempt(s)`);
}
