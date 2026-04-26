import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// Isolated DB path for this test file — match the pattern used by other
// store-level tests. Setting DATABASE_PATH BEFORE the store imports matters.
const tmpDir = fs.mkdtempSync(
  path.join(os.tmpdir(), `enricher-discovery-${Date.now()}-`)
);
process.env.DATABASE_PATH = path.join(tmpDir, "jobs.db");

type Store = typeof import("./discovery-store");

describe("canonicalLeadKey", () => {
  let store: Store;
  beforeAll(async () => {
    store = await import("./discovery-store");
  });

  it("produces the same key for identical phone numbers regardless of formatting", () => {
    const a = store.canonicalLeadKey({
      companyName: "Joe's Plumbing",
      phone: "+1 (404) 555-1234",
    });
    const b = store.canonicalLeadKey({
      companyName: "Joes Plumbing LLC",
      phone: "404-555-1234",
    });
    const c = store.canonicalLeadKey({
      companyName: "Joe's Plumbing",
      phone: "4045551234",
    });
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it("falls back to address+name when phone is missing", () => {
    const a = store.canonicalLeadKey({
      companyName: "Joe's Plumbing LLC",
      streetAddress: "123 Main Street, Suite 4",
      postalCode: "30339",
    });
    const b = store.canonicalLeadKey({
      companyName: "Joes Plumbing Inc",
      streetAddress: "123 main st apt 9",
      postalCode: "30339",
    });
    expect(a).toBe(b);
  });

  it("falls back to domain when phone+address missing", () => {
    const a = store.canonicalLeadKey({
      companyName: "Stripe",
      websiteUrl: "https://stripe.com",
    });
    const b = store.canonicalLeadKey({
      companyName: "STRIPE INC",
      websiteUrl: "https://www.stripe.com",
    });
    expect(a).toBe(b);
  });

  it("differs for different businesses", () => {
    const a = store.canonicalLeadKey({
      companyName: "Joe's Plumbing",
      phone: "404-555-1234",
    });
    const b = store.canonicalLeadKey({
      companyName: "Joe's Plumbing",
      phone: "404-555-9999",
    });
    expect(a).not.toBe(b);
  });
});

describe("normalize helpers", () => {
  let store: Store;
  beforeAll(async () => {
    store = await import("./discovery-store");
  });

  it("normalizes US phone numbers regardless of format", () => {
    expect(store.normalizePhone("+1 (404) 555-1234")).toBe("4045551234");
    expect(store.normalizePhone("404.555.1234")).toBe("4045551234");
    expect(store.normalizePhone("4045551234")).toBe("4045551234");
  });

  it("preserves international numbers", () => {
    // 11-digit non-US (e.g. UK 44...) should not have its leading digit stripped.
    expect(store.normalizePhone("+44 20 7946 0958")).toBe("442079460958");
  });

  it("strips suite/apt/unit from addresses", () => {
    expect(store.normalizeAddress("123 Main St, Suite 4")).toBe("123 main st");
    expect(store.normalizeAddress("123 Main St Apt 9B")).toBe("123 main st");
    expect(store.normalizeAddress("123 Main, Floor 2")).toBe("123 main");
  });

  it("strips entity suffixes from names", () => {
    expect(store.normalizeName("Joe's Plumbing LLC")).toBe("joes plumbing");
    expect(store.normalizeName("Acme Corporation")).toBe("acme");
    expect(store.normalizeName("Stripe, Inc.")).toBe("stripe");
  });
});

describe("insertLead identity dedup", () => {
  let store: Store;
  let searchId: string;
  beforeAll(async () => {
    store = await import("./discovery-store");
    const search = store.createSearch({
      workspaceId: "test-ws",
      mode: "directory",
      name: "test",
      queryText: "",
      maxResults: 10,
      directoryConfig: { source: "yelp", category: "plumber", geo: "Atlanta" },
    });
    searchId = search.id;
  });

  it("collapses two listings with the same phone into one row", () => {
    const a = store.insertLead({
      searchId,
      companyName: "Joe's Plumbing",
      websiteUrl: "https://joesplumbing.com",
      phone: "+1 (404) 555-1234",
    });
    expect(a.isNew).toBe(true);

    const b = store.insertLead({
      searchId,
      companyName: "Joes Plumbing LLC",
      websiteUrl: "https://www.joesplumbing.com",
      phone: "404-555-1234",
    });
    expect(b.isNew).toBe(false);
    expect(b.lead.id).toBe(a.lead.id);
  });

  it("treats different phones as distinct", () => {
    const a = store.insertLead({
      searchId,
      companyName: "Acme Roofing",
      phone: "404-555-2000",
    });
    const b = store.insertLead({
      searchId,
      companyName: "Acme Roofing",
      phone: "404-555-2001",
    });
    expect(a.isNew).toBe(true);
    expect(b.isNew).toBe(true);
    expect(a.lead.id).not.toBe(b.lead.id);
  });

  it("merges fields from both inserts (existing nulls get filled)", () => {
    const a = store.insertLead({
      searchId,
      companyName: "Prime HVAC",
      phone: "404-555-3000",
    });
    expect(a.lead.streetAddress).toBeUndefined();

    const b = store.insertLead({
      searchId,
      companyName: "Prime HVAC",
      phone: "(404) 555-3000",
      streetAddress: "456 Oak Ave",
      city: "Atlanta",
    });
    expect(b.isNew).toBe(false);
    expect(b.lead.streetAddress).toBe("456 Oak Ave");
    expect(b.lead.city).toBe("Atlanta");
  });
});
