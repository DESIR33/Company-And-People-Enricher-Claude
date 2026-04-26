import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const tmpDir = fs.mkdtempSync(
  path.join(os.tmpdir(), `enricher-canonical-${Date.now()}-`)
);
process.env.DATABASE_PATH = path.join(tmpDir, "jobs.db");

type Module = typeof import("./canonical-companies");
let mod: Module;

beforeAll(async () => {
  mod = await import("./canonical-companies");
});

describe("geohashEncode", () => {
  it("returns precision-7 strings for valid coords", () => {
    const gh = mod.geohashEncode(33.749, -84.388, 7);
    expect(gh).toHaveLength(7);
    expect(gh).toMatch(/^[0-9b-hjkmnp-z]+$/);
  });

  it("two points within ~150m share the same precision-7 geohash", () => {
    // Two points 100m apart in central Atlanta.
    const a = mod.geohashEncode(33.74900, -84.38800, 7);
    const b = mod.geohashEncode(33.74909, -84.38790, 7);
    expect(a).toBe(b);
  });

  it("two points many km apart have different geohashes", () => {
    expect(mod.geohashEncode(33.749, -84.388, 7)).not.toBe(
      mod.geohashEncode(40.7506, -73.9971, 7)
    );
  });

  it("returns empty string for invalid coords", () => {
    expect(mod.geohashEncode(NaN, 0, 7)).toBe("");
    expect(mod.geohashEncode(0, 999, 7)).toBe("");
    expect(mod.geohashEncode(99, 0, 7)).toBe("");
  });
});

describe("sourceAuthority", () => {
  it("ranks google_places above yelp", () => {
    expect(mod.sourceAuthority("google_places")).toBeGreaterThan(
      mod.sourceAuthority("yelp")
    );
  });

  it("returns 0 for unknown sources", () => {
    expect(mod.sourceAuthority("totally_made_up")).toBe(0);
    expect(mod.sourceAuthority(undefined)).toBe(0);
  });
});

describe("upsertCanonicalCompany", () => {
  // Each test runs in its own workspace so they don't see each other's writes.
  function ws(): string {
    return `ws-${Math.random().toString(36).slice(2, 10)}`;
  }

  it("creates a new canonical record on first insert", () => {
    const workspaceId = ws();
    const c = mod.upsertCanonicalCompany({
      workspaceId,
      source: "google_places",
      companyName: "Joe's Plumbing",
      phone: "(404) 555-1234",
      websiteUrl: "https://joesplumbing.com",
      streetAddress: "100 Main St",
      city: "Atlanta",
      region: "GA",
      postalCode: "30309",
      lat: 33.749,
      lng: -84.388,
      industry: "Plumbing",
      rating: 4.7,
      reviewCount: 132,
    });
    expect(c.companyName).toBe("Joe's Plumbing");
    expect(c.phone).toBe("4045551234"); // normalized
    expect(c.domain).toBe("joesplumbing.com");
    expect(c.googleRating).toBe(4.7);
    expect(c.googleReviewCount).toBe(132);
    expect(c.seenInSources).toEqual(["google_places"]);
    expect(c.sourceCount).toBe(1);
    expect(c.geohash).toHaveLength(7);
  });

  it("merges across sources by phone (STRONG match)", () => {
    const workspaceId = ws();
    const a = mod.upsertCanonicalCompany({
      workspaceId,
      source: "google_places",
      companyName: "Joe's Plumbing",
      phone: "(404) 555-1234",
      websiteUrl: "https://joesplumbing.com",
      streetAddress: "100 Main St",
      city: "Atlanta",
      region: "GA",
      postalCode: "30309",
      lat: 33.749,
      lng: -84.388,
      industry: "Plumbing",
      rating: 4.7,
      reviewCount: 132,
    });
    const b = mod.upsertCanonicalCompany({
      workspaceId,
      source: "yelp_direct",
      companyName: "Joes Plumbing LLC", // different formatting
      phone: "+1-404-555-1234",          // same phone, different formatting
      industry: "Plumber",
      rating: 4.5,                       // → yelpRating
      reviewCount: 88,                   // → yelpReviewCount
    });
    expect(b.id).toBe(a.id); // merged
    expect(b.seenInSources.sort()).toEqual(["google_places", "yelp_direct"]);
    expect(b.sourceCount).toBe(2);
    // High-authority Google data wins for the name slot.
    expect(b.companyName).toBe("Joe's Plumbing");
    // Per-source signal slots populate independently.
    expect(b.googleRating).toBe(4.7);
    expect(b.yelpRating).toBe(4.5);
    expect(b.googleReviewCount).toBe(132);
    expect(b.yelpReviewCount).toBe(88);
    // Categories union picks up the new industry value.
    expect(b.categories.map((s) => s.toLowerCase()).sort()).toEqual([
      "plumber",
      "plumbing",
    ]);
  });

  it("merges by domain (STRONG match) when phone is absent on incoming", () => {
    const workspaceId = ws();
    const a = mod.upsertCanonicalCompany({
      workspaceId,
      source: "google_places",
      companyName: "Acme HVAC",
      phone: "(404) 111-1111",
      websiteUrl: "https://www.acmehvac.com",
    });
    const b = mod.upsertCanonicalCompany({
      workspaceId,
      source: "bbb_direct",
      companyName: "ACME HVAC LLC",
      websiteUrl: "https://acmehvac.com/contact", // same registered domain
      bbbRating: "A+",
      bbbAccredited: true,
      yearsInBusiness: 18,
    });
    expect(b.id).toBe(a.id);
    expect(b.bbbRating).toBe("A+");
    expect(b.bbbAccredited).toBe(true);
    expect(b.yearsInBusiness).toBe(18);
  });

  it("merges by name + close geohash (MEDIUM match)", () => {
    const workspaceId = ws();
    // Picked from the verified-same-bucket pair in the geohash test
    // above so this isn't sensitive to where Niemeyer cell boundaries fall.
    const a = mod.upsertCanonicalCompany({
      workspaceId,
      source: "google_places",
      companyName: "Hill Country Roofing",
      lat: 33.749,
      lng: -84.388,
    });
    const b = mod.upsertCanonicalCompany({
      workspaceId,
      source: "foursquare",
      companyName: "Hill Country Roofing",
      lat: 33.74909,
      lng: -84.3879,
    });
    expect(b.id).toBe(a.id);
    expect(b.sourceCount).toBe(2);
  });

  it("does NOT merge across geographically distant matches with the same name", () => {
    const workspaceId = ws();
    const a = mod.upsertCanonicalCompany({
      workspaceId,
      source: "google_places",
      companyName: "Acme Plumbing",
      lat: 33.749,
      lng: -84.388,
    });
    const b = mod.upsertCanonicalCompany({
      workspaceId,
      source: "foursquare",
      companyName: "Acme Plumbing", // chain in another city
      lat: 40.7506,
      lng: -73.9971,
    });
    expect(b.id).not.toBe(a.id);
  });

  it("isolates canonical records per workspace", () => {
    const a = mod.upsertCanonicalCompany({
      workspaceId: "ws-1",
      source: "google_places",
      companyName: "Foo",
      phone: "5551110000",
    });
    const b = mod.upsertCanonicalCompany({
      workspaceId: "ws-2",
      source: "google_places",
      companyName: "Foo",
      phone: "5551110000",
    });
    expect(a.id).not.toBe(b.id);
  });

  it("BBB signals only populate from BBB sources", () => {
    const workspaceId = ws();
    const a = mod.upsertCanonicalCompany({
      workspaceId,
      source: "google_places",
      companyName: "Sunshine Bakery",
      phone: "5552220000",
      bbbRating: "A+", // wrong-source attempt — should be ignored
      bbbAccredited: true,
    });
    expect(a.bbbRating).toBeUndefined();
    expect(a.bbbAccredited).toBeUndefined();
  });

  it("yearsInBusiness keeps the larger reported value across merges", () => {
    const workspaceId = ws();
    mod.upsertCanonicalCompany({
      workspaceId,
      source: "bbb_direct",
      companyName: "Old Town Cafe",
      phone: "5553330000",
      yearsInBusiness: 5,
    });
    const merged = mod.upsertCanonicalCompany({
      workspaceId,
      source: "google_places",
      companyName: "Old Town Cafe",
      phone: "5553330000",
      yearsInBusiness: 12,
    });
    expect(merged.yearsInBusiness).toBe(12);
  });

  it("registers a hook that links discovered leads on insertLead", async () => {
    const store = await import("./discovery-store");
    const search = store.createSearch({
      workspaceId: "ws-hook",
      mode: "directory",
      name: "google search",
      queryText: "",
      directoryConfig: { source: "google_places", category: "plumber" },
      maxResults: 10,
    });
    const result = store.insertLead({
      searchId: search.id,
      companyName: "Hook Plumbing",
      phone: "(404) 555-7777",
      websiteUrl: "https://hookplumbing.com",
      streetAddress: "1 Hook St",
      city: "Atlanta",
      region: "GA",
      postalCode: "30309",
      lat: 33.749,
      lng: -84.388,
      industry: "Plumbing",
    });
    // Hook fires synchronously inside insertLead, so the returned lead
    // should already have canonicalCompanyId populated.
    expect(result.lead.canonicalCompanyId).toBeDefined();
    const company = mod.getCanonicalCompany(result.lead.canonicalCompanyId!);
    expect(company?.companyName).toBe("Hook Plumbing");
    expect(company?.seenInSources).toEqual(["google_places"]);
  });

  it("backfillCanonicalLinks resolves leads inserted before the hook ran", async () => {
    const store = await import("./discovery-store");
    const workspaceId = "ws-backfill";
    const search = store.createSearch({
      workspaceId,
      mode: "directory",
      name: "yelp search",
      queryText: "",
      directoryConfig: { source: "yelp_direct", category: "plumber" },
      maxResults: 10,
    });

    // Simulate a lead that landed BEFORE Phase 3 by inserting + then
    // clearing canonical_company_id directly. The hook will fire on
    // insert, populate the FK, and we manually NULL it to set up the
    // backfill scenario.
    const inserted = store.insertLead({
      searchId: search.id,
      companyName: "Backfill Plumbing",
      phone: "5556660001",
      lat: 33.749,
      lng: -84.388,
    });
    expect(inserted.lead.canonicalCompanyId).toBeDefined();

    const { getDb } = await import("./db");
    const db = getDb();
    db.prepare(
      `UPDATE discovered_leads SET canonical_company_id = NULL WHERE id = ?`
    ).run(inserted.lead.id);

    const result = mod.backfillCanonicalLinks({ workspaceId });
    expect(result.processed).toBe(1);
    expect(result.linked).toBe(1);
    expect(result.skipped).toBe(0);

    const after = db
      .prepare(
        `SELECT canonical_company_id FROM discovered_leads WHERE id = ?`
      )
      .get(inserted.lead.id) as { canonical_company_id: string | null };
    expect(after.canonical_company_id).toBeTruthy();
  });

  it("listCanonicalCompaniesByWorkspace honors workspace + minSources filter", () => {
    const workspaceId = ws();
    // 1 source.
    mod.upsertCanonicalCompany({
      workspaceId,
      source: "google_places",
      companyName: "Solo Source",
      phone: "5559990001",
    });
    // 2 sources.
    mod.upsertCanonicalCompany({
      workspaceId,
      source: "google_places",
      companyName: "Multi Source",
      phone: "5559990002",
    });
    mod.upsertCanonicalCompany({
      workspaceId,
      source: "yelp_direct",
      companyName: "Multi Source",
      phone: "5559990002",
    });
    const all = mod.listCanonicalCompaniesByWorkspace(workspaceId);
    expect(all.length).toBeGreaterThanOrEqual(2);
    const multi = mod.listCanonicalCompaniesByWorkspace(workspaceId, {
      minSources: 2,
    });
    expect(multi.every((c) => c.sourceCount >= 2)).toBe(true);
    expect(multi.find((c) => c.companyName === "Multi Source")).toBeDefined();
    expect(multi.find((c) => c.companyName === "Solo Source")).toBeUndefined();
  });
});
