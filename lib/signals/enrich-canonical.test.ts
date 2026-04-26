import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const tmpDir = fs.mkdtempSync(
  path.join(os.tmpdir(), `enricher-signals-${Date.now()}-`)
);
process.env.DATABASE_PATH = path.join(tmpDir, "jobs.db");

type Canonical = typeof import("../canonical-companies");
type Enrich = typeof import("./enrich-canonical");
let canonical: Canonical;
let enrich: Enrich;

beforeAll(async () => {
  canonical = await import("../canonical-companies");
  enrich = await import("./enrich-canonical");
});

describe("applySignalsToCanonical", () => {
  it("persists tech stack + domain dates + registrar + signals_updated_at", () => {
    const c = canonical.upsertCanonicalCompany({
      workspaceId: "ws-signals-1",
      source: "google_places",
      companyName: "Acme Plumbing",
      phone: "5550000001",
      websiteUrl: "https://acmeplumbing.example",
    });
    const updated = enrich.applySignalsToCanonical(c.id, {
      techStack: ["Shopify", "Stripe"],
      domainCreatedAt: Date.parse("2018-01-01T00:00:00Z"),
      domainRegistrar: "GoDaddy.com, LLC",
      firstCertAt: Date.parse("2018-02-15T00:00:00Z"),
    });
    expect(updated?.techStack).toEqual(["Shopify", "Stripe"]);
    expect(updated?.domainCreatedAt).toBe(Date.parse("2018-01-01T00:00:00Z"));
    expect(updated?.domainRegistrar).toBe("GoDaddy.com, LLC");
    expect(updated?.firstCertAt).toBe(Date.parse("2018-02-15T00:00:00Z"));
    expect(updated?.signalsUpdatedAt).toBeGreaterThan(0);
  });

  it("partial application: only the supplied fields update; existing ones stay put", () => {
    const c = canonical.upsertCanonicalCompany({
      workspaceId: "ws-signals-2",
      source: "google_places",
      companyName: "Old Town Cafe",
      phone: "5550000002",
      websiteUrl: "https://oldtowncafe.example",
    });
    enrich.applySignalsToCanonical(c.id, {
      techStack: ["WordPress"],
      domainCreatedAt: Date.parse("2010-06-01T00:00:00Z"),
      domainRegistrar: "Tucows",
      firstCertAt: Date.parse("2010-07-01T00:00:00Z"),
    });
    // Second pass — supply only first_cert_at; the rest must persist.
    enrich.applySignalsToCanonical(c.id, {
      firstCertAt: Date.parse("2010-08-01T00:00:00Z"),
    });
    const after = canonical.getCanonicalCompany(c.id);
    expect(after?.techStack).toEqual(["WordPress"]);
    expect(after?.domainCreatedAt).toBe(Date.parse("2010-06-01T00:00:00Z"));
    expect(after?.domainRegistrar).toBe("Tucows");
    expect(after?.firstCertAt).toBe(Date.parse("2010-08-01T00:00:00Z"));
  });

  it("returns undefined for unknown canonical id", () => {
    expect(
      enrich.applySignalsToCanonical("nope-not-a-real-id", { techStack: ["X"] })
    ).toBeUndefined();
  });

  it("stamps signals_updated_at even when every signal is empty", () => {
    const c = canonical.upsertCanonicalCompany({
      workspaceId: "ws-signals-3",
      source: "google_places",
      companyName: "No-domain Diner",
      phone: "5550000003",
    });
    const updated = enrich.applySignalsToCanonical(c.id, {});
    expect(updated?.signalsUpdatedAt).toBeGreaterThan(0);
    expect(updated?.techStack).toBeUndefined();
  });
});

describe("fetchAllSignals", () => {
  it("returns empty signals + no errors when no domain or website are provided", async () => {
    const result = await enrich.fetchAllSignals(undefined, undefined);
    expect(result.signals).toEqual({});
    expect(result.errors).toEqual({});
  });
});

describe("auto-enrich queue", () => {
  // Sleep until the queue drains. The runner is mocked to resolve
  // synchronously, so a microtask flush is enough.
  const flush = () => new Promise<void>((r) => setTimeout(r, 0));

  it("enqueues a company that has a domain and no recent signals", async () => {
    enrich._resetAutoEnrichQueueForTests();
    const calls: string[] = [];
    const restore = enrich._setAutoEnrichRunnerForTests(async (id) => {
      calls.push(id);
    });
    try {
      const enqueued = enrich.enqueueAutoEnrich({
        id: "c1",
        domain: "example.com",
        websiteUrl: "https://example.com",
        signalsUpdatedAt: undefined,
      });
      expect(enqueued).toBe(true);
      await flush();
      expect(calls).toEqual(["c1"]);
    } finally {
      restore();
    }
  });

  it("skips when the company has no domain or website", async () => {
    enrich._resetAutoEnrichQueueForTests();
    const enqueued = enrich.enqueueAutoEnrich({
      id: "c-no-domain",
      domain: undefined,
      websiteUrl: undefined,
      signalsUpdatedAt: undefined,
    });
    expect(enqueued).toBe(false);
  });

  it("skips when signals were refreshed inside the TTL window", async () => {
    enrich._resetAutoEnrichQueueForTests();
    const enqueued = enrich.enqueueAutoEnrich({
      id: "c-fresh",
      domain: "fresh.example",
      signalsUpdatedAt: Date.now() - 60_000, // 1 minute ago
    });
    expect(enqueued).toBe(false);
  });

  it("dedupes — the same id queued twice runs once", async () => {
    enrich._resetAutoEnrichQueueForTests();
    const calls: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const restore = enrich._setAutoEnrichRunnerForTests(async (id) => {
      calls.push(id);
      await gate; // hold so the second enqueue lands while the first is in flight
    });
    try {
      const a = enrich.enqueueAutoEnrich({
        id: "dedup",
        domain: "dedup.example",
      });
      const b = enrich.enqueueAutoEnrich({
        id: "dedup",
        domain: "dedup.example",
      });
      expect(a).toBe(true);
      expect(b).toBe(false);
      release();
      await flush();
      expect(calls).toEqual(["dedup"]);
    } finally {
      restore();
    }
  });

  it("respects the concurrency cap", async () => {
    enrich._resetAutoEnrichQueueForTests();
    const peakObs: number[] = [];
    let active = 0;
    const releases: (() => void)[] = [];
    const restore = enrich._setAutoEnrichRunnerForTests(async () => {
      active += 1;
      peakObs.push(active);
      await new Promise<void>((r) => releases.push(r));
      active -= 1;
    });
    try {
      // Default cap is 3 unless AUTO_ENRICH_MAX_CONCURRENCY is set;
      // we only assert the observed peak doesn't exceed it.
      const cap = Math.max(
        1,
        Number(process.env.AUTO_ENRICH_MAX_CONCURRENCY ?? "3")
      );
      for (let i = 0; i < cap + 3; i++) {
        enrich.enqueueAutoEnrich({
          id: `cap-${i}`,
          domain: `c${i}.example`,
        });
      }
      await flush();
      const peak = Math.max(...peakObs, 0);
      expect(peak).toBeLessThanOrEqual(cap);
      // Drain the runners so vitest doesn't see a hanging promise.
      while (releases.length > 0) {
        const r = releases.shift();
        r?.();
        await flush();
      }
    } finally {
      restore();
    }
  });

  it("fires automatically on canonical upsert via the registered hook", async () => {
    enrich._resetAutoEnrichQueueForTests();
    const calls: string[] = [];
    const restore = enrich._setAutoEnrichRunnerForTests(async (id) => {
      calls.push(id);
    });
    try {
      const c = canonical.upsertCanonicalCompany({
        workspaceId: "ws-auto",
        source: "google_places",
        companyName: "Hooked Plumbing",
        websiteUrl: "https://hookedplumbing.example",
        phone: "5550000099",
      });
      // Hook fires synchronously; the runner is mocked + synchronous.
      await flush();
      expect(calls).toContain(c.id);
    } finally {
      restore();
    }
  });
});
