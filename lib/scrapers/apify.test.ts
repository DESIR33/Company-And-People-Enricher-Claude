import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getDatasetItems,
  getRun,
  normalizeActorId,
  runActor,
  runActorAndGetItems,
  waitForRun,
} from "./apify";

const ORIGINAL_FETCH = globalThis.fetch;

function mockFetch(handlers: ((url: string, init?: RequestInit) => Response | Promise<Response>)[]) {
  let i = 0;
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const handler = handlers[i++];
    if (!handler) throw new Error(`fetch called more times than mocked: ${url}`);
    return handler(url, init);
  }) as typeof fetch;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("apify client", () => {
  beforeEach(() => {
    process.env.APIFY_API_TOKEN = "test_token";
  });

  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
    delete process.env.APIFY_API_TOKEN;
  });

  describe("normalizeActorId", () => {
    it("converts URL-form (slash) to canonical (tilde)", () => {
      expect(normalizeActorId("apify/google-search-scraper")).toBe(
        "apify~google-search-scraper"
      );
    });

    it("leaves canonical form unchanged", () => {
      expect(normalizeActorId("apify~google-search-scraper")).toBe(
        "apify~google-search-scraper"
      );
    });

    it("trims whitespace", () => {
      expect(normalizeActorId("  apify/foo  ")).toBe("apify~foo");
    });
  });

  describe("token requirement", () => {
    it("throws a useful error when APIFY_API_TOKEN is missing", async () => {
      delete process.env.APIFY_API_TOKEN;
      await expect(runActor("apify/foo", {})).rejects.toThrow(/APIFY_API_TOKEN/);
    });
  });

  describe("runActor", () => {
    it("POSTs to /acts/{id}/runs with the token query param and body", async () => {
      mockFetch([
        (url, init) => {
          expect(url).toContain("/acts/apify~yelp-scraper/runs");
          expect(url).toContain("token=test_token");
          expect(init?.method).toBe("POST");
          expect(JSON.parse(init?.body as string)).toEqual({ query: "plumber" });
          return jsonResponse({
            data: {
              id: "run-1",
              actId: "act-1",
              status: "RUNNING",
              startedAt: "2026-04-26T00:00:00Z",
              defaultDatasetId: "ds-1",
              defaultKeyValueStoreId: "kv-1",
            },
          });
        },
      ]);
      const run = await runActor("apify/yelp-scraper", { query: "plumber" });
      expect(run.id).toBe("run-1");
      expect(run.status).toBe("RUNNING");
    });

    it("surfaces actor IDs unchanged in error messages on failure", async () => {
      mockFetch([() => jsonResponse({ error: "no creds" }, 403)]);
      await expect(runActor("apify/foo", {})).rejects.toThrow(/apify~foo/);
    });
  });

  describe("getRun", () => {
    it("GETs /actor-runs/{runId}", async () => {
      mockFetch([
        (url) => {
          expect(url).toContain("/actor-runs/run-1");
          return jsonResponse({
            data: {
              id: "run-1",
              actId: "act-1",
              status: "SUCCEEDED",
              startedAt: "2026-04-26T00:00:00Z",
              defaultDatasetId: "ds-1",
              defaultKeyValueStoreId: "kv-1",
            },
          });
        },
      ]);
      const run = await getRun("run-1");
      expect(run.status).toBe("SUCCEEDED");
    });
  });

  describe("waitForRun", () => {
    it("polls until terminal status", async () => {
      mockFetch([
        () =>
          jsonResponse({
            data: {
              id: "run-1",
              actId: "act-1",
              status: "RUNNING",
              startedAt: "2026-04-26T00:00:00Z",
              defaultDatasetId: "ds-1",
              defaultKeyValueStoreId: "kv-1",
            },
          }),
        () =>
          jsonResponse({
            data: {
              id: "run-1",
              actId: "act-1",
              status: "SUCCEEDED",
              startedAt: "2026-04-26T00:00:00Z",
              finishedAt: "2026-04-26T00:00:01Z",
              defaultDatasetId: "ds-1",
              defaultKeyValueStoreId: "kv-1",
            },
          }),
      ]);
      const progress: string[] = [];
      const run = await waitForRun("run-1", {
        pollIntervalMs: 1,
        onProgress: (r) => progress.push(r.status),
      });
      expect(run.status).toBe("SUCCEEDED");
      expect(progress).toEqual(["RUNNING", "SUCCEEDED"]);
    });

    it("throws if maxWait elapses before completion", async () => {
      // First poll returns RUNNING; subsequent polls would too, but we cap
      // wait so the deadline trips before the second call.
      mockFetch([
        () =>
          jsonResponse({
            data: {
              id: "run-1",
              actId: "act-1",
              status: "RUNNING",
              startedAt: "2026-04-26T00:00:00Z",
              defaultDatasetId: "ds-1",
              defaultKeyValueStoreId: "kv-1",
            },
          }),
      ]);
      await expect(
        waitForRun("run-1", { pollIntervalMs: 1, maxWaitMs: 0 })
      ).rejects.toThrow(/did not finish/);
    });

    it("aborts when signal fires", async () => {
      const ctrl = new AbortController();
      mockFetch([
        () => {
          ctrl.abort();
          return jsonResponse({
            data: {
              id: "run-1",
              actId: "act-1",
              status: "RUNNING",
              startedAt: "2026-04-26T00:00:00Z",
              defaultDatasetId: "ds-1",
              defaultKeyValueStoreId: "kv-1",
            },
          });
        },
      ]);
      await expect(
        waitForRun("run-1", { pollIntervalMs: 50, signal: ctrl.signal })
      ).rejects.toThrow(/aborted/i);
    });
  });

  describe("getDatasetItems", () => {
    it("returns items array when API returns bare array", async () => {
      mockFetch([() => jsonResponse([{ a: 1 }, { a: 2 }])]);
      const items = await getDatasetItems("ds-1");
      expect(items).toHaveLength(2);
    });

    it("unwraps {items: [...]} envelope when API returns one", async () => {
      mockFetch([() => jsonResponse({ items: [{ a: 1 }] })]);
      const items = await getDatasetItems("ds-1");
      expect(items).toEqual([{ a: 1 }]);
    });

    it("respects limit query param", async () => {
      mockFetch([
        (url) => {
          expect(url).toContain("limit=42");
          return jsonResponse([]);
        },
      ]);
      await getDatasetItems("ds-1", { limit: 42 });
    });
  });

  describe("runActorAndGetItems", () => {
    it("wires run + wait + fetch end-to-end", async () => {
      mockFetch([
        // POST /acts/.../runs → started
        () =>
          jsonResponse({
            data: {
              id: "run-1",
              actId: "act-1",
              status: "READY",
              startedAt: "2026-04-26T00:00:00Z",
              defaultDatasetId: "ds-1",
              defaultKeyValueStoreId: "kv-1",
            },
          }),
        // GET /actor-runs/run-1 → SUCCEEDED on first poll
        () =>
          jsonResponse({
            data: {
              id: "run-1",
              actId: "act-1",
              status: "SUCCEEDED",
              startedAt: "2026-04-26T00:00:00Z",
              finishedAt: "2026-04-26T00:00:01Z",
              defaultDatasetId: "ds-1",
              defaultKeyValueStoreId: "kv-1",
              usageTotalUsd: 0.05,
            },
          }),
        // GET /datasets/ds-1/items
        () => jsonResponse([{ name: "Joe's Plumbing" }]),
      ]);
      const result = await runActorAndGetItems(
        "apify/yelp-scraper",
        { query: "plumber" },
        { pollIntervalMs: 1 }
      );
      expect(result.run.status).toBe("SUCCEEDED");
      expect(result.run.usageTotalUsd).toBe(0.05);
      expect(result.items).toEqual([{ name: "Joe's Plumbing" }]);
    });

    it("throws when the run ends in non-SUCCEEDED state", async () => {
      mockFetch([
        () =>
          jsonResponse({
            data: {
              id: "run-1",
              actId: "act-1",
              status: "READY",
              startedAt: "2026-04-26T00:00:00Z",
              defaultDatasetId: "ds-1",
              defaultKeyValueStoreId: "kv-1",
            },
          }),
        () =>
          jsonResponse({
            data: {
              id: "run-1",
              actId: "act-1",
              status: "FAILED",
              startedAt: "2026-04-26T00:00:00Z",
              finishedAt: "2026-04-26T00:00:01Z",
              defaultDatasetId: "ds-1",
              defaultKeyValueStoreId: "kv-1",
            },
          }),
      ]);
      await expect(
        runActorAndGetItems("apify/yelp-scraper", {}, { pollIntervalMs: 1 })
      ).rejects.toThrow(/FAILED/);
    });
  });
});
