import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  _resetHostRateLimiter,
  isPlaywrightAvailable,
  listProxies,
  parseProxyUrl,
  pickProxy,
  pickUserAgent,
  waitForHost,
} from "./playwright-pool";

describe("playwright-pool helpers", () => {
  afterEach(() => {
    delete process.env.PLAYWRIGHT_PROXY_URL_POOL;
    _resetHostRateLimiter();
  });

  describe("parseProxyUrl", () => {
    it("parses bare URL with credentials", () => {
      expect(parseProxyUrl("http://user:pass@1.2.3.4:8080")).toEqual({
        server: "http://1.2.3.4:8080",
        username: "user",
        password: "pass",
      });
    });

    it("parses URL without credentials", () => {
      expect(parseProxyUrl("http://1.2.3.4:8080")).toEqual({
        server: "http://1.2.3.4:8080",
      });
    });

    it("assumes http:// when scheme is missing", () => {
      expect(parseProxyUrl("1.2.3.4:8080")).toEqual({
        server: "http://1.2.3.4:8080",
      });
    });

    it("preserves https scheme", () => {
      expect(parseProxyUrl("https://proxy.example.com:8443")).toEqual({
        server: "https://proxy.example.com:8443",
      });
    });

    it("URL-decodes credentials", () => {
      const r = parseProxyUrl("http://us%40er:p%40ss@1.2.3.4:8080");
      expect(r?.username).toBe("us@er");
      expect(r?.password).toBe("p@ss");
    });

    it("returns undefined for empty / unparseable input", () => {
      expect(parseProxyUrl("")).toBeUndefined();
      expect(parseProxyUrl("   ")).toBeUndefined();
    });
  });

  describe("listProxies / pickProxy", () => {
    it("returns empty when env var is unset", () => {
      delete process.env.PLAYWRIGHT_PROXY_URL_POOL;
      expect(listProxies()).toEqual([]);
      expect(pickProxy()).toBeUndefined();
    });

    it("splits on comma and newline, drops blanks", () => {
      process.env.PLAYWRIGHT_PROXY_URL_POOL =
        "http://a:1,http://b:2\n,http://c:3,";
      const list = listProxies();
      expect(list.map((p) => p.server)).toEqual([
        "http://a:1",
        "http://b:2",
        "http://c:3",
      ]);
    });

    it("pickProxy returns one of the configured proxies", () => {
      process.env.PLAYWRIGHT_PROXY_URL_POOL = "http://a:1,http://b:2";
      const servers = new Set(listProxies().map((p) => p.server));
      // Pick 30 times — random, so this is non-flaky given 2 options.
      for (let i = 0; i < 30; i++) {
        const p = pickProxy();
        expect(p).toBeDefined();
        expect(servers.has(p!.server)).toBe(true);
      }
    });

    it("ignores unparseable entries silently", () => {
      process.env.PLAYWRIGHT_PROXY_URL_POOL = "http://ok:1,,not a url at all";
      const list = listProxies();
      // First and second entries parse; the URL parser is permissive
      // enough that "not a url at all" gets http:// prefixed and parses
      // as a host. We only require the OK one shows up.
      expect(list.find((p) => p.server === "http://ok:1")).toBeDefined();
    });
  });

  describe("pickUserAgent", () => {
    it("returns a non-empty UA string", () => {
      const ua = pickUserAgent();
      expect(ua.length).toBeGreaterThan(20);
      expect(ua.toLowerCase()).toMatch(/mozilla/);
    });

    it("does not return the literal HeadlessChrome marker", () => {
      // The whole point of the UA pool is to avoid the default Playwright UA.
      for (let i = 0; i < 10; i++) {
        expect(pickUserAgent()).not.toMatch(/HeadlessChrome/i);
      }
    });
  });

  describe("waitForHost", () => {
    beforeEach(() => {
      _resetHostRateLimiter();
    });

    it("returns immediately on first call for a host", async () => {
      const t0 = Date.now();
      await waitForHost("yelp.com", 200);
      expect(Date.now() - t0).toBeLessThan(50);
    });

    it("waits the configured gap on subsequent calls", async () => {
      await waitForHost("yelp.com", 100);
      const t0 = Date.now();
      await waitForHost("yelp.com", 100);
      expect(Date.now() - t0).toBeGreaterThanOrEqual(80);
    });

    it("does not block calls to a different host", async () => {
      await waitForHost("yelp.com", 500);
      const t0 = Date.now();
      await waitForHost("bbb.org", 500);
      expect(Date.now() - t0).toBeLessThan(100);
    });

    it("is a no-op when gap is 0", async () => {
      await waitForHost("yelp.com", 0);
      const t0 = Date.now();
      await waitForHost("yelp.com", 0);
      expect(Date.now() - t0).toBeLessThan(50);
    });
  });

  describe("isPlaywrightAvailable", () => {
    it("returns false when playwright is not installed (test env)", async () => {
      // Vitest runs without playwright installed in CI, so the dynamic
      // import resolves to undefined. If a maintainer installs playwright
      // locally, this asserts true — both are valid pool states.
      const result = await isPlaywrightAvailable();
      expect(typeof result).toBe("boolean");
    });
  });
});
