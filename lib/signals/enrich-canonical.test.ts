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
