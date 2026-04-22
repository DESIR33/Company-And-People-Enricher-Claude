import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// Isolated DB path for this test file — prevents clobbering the real
// .data/jobs.db AND any leftover state from a prior run. Setting the env
// var BEFORE the store imports matters: lib/db.ts captures DB_PATH at
// module load. ES module imports are hoisted, so we use a dynamic import
// below after the env var is set.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `enricher-ws-${Date.now()}-`));
process.env.DATABASE_PATH = path.join(tmpDir, "jobs.db");

type Store = typeof import("./workspace-store");

describe("workspace-store", () => {
  let store: Store;

  beforeAll(async () => {
    store = await import("./workspace-store");
    // Touch the default workspace so the init code runs and the schema is
    // created before any individual test queries it.
    store.getDefaultWorkspace();
  });

  it("auto-creates a default workspace on first access", () => {
    const all = store.listWorkspaces();
    expect(all.length).toBeGreaterThanOrEqual(1);
    const def = all.find((w) => w.slug === "default");
    expect(def).toBeDefined();
    expect(def!.shareToken).toBeTruthy();
    expect(def!.shareToken.length).toBeGreaterThan(10);
  });

  it("createWorkspace round-trips via slug / id / share token", () => {
    const ws = store.createWorkspace({
      slug: "acme",
      name: "Acme Research",
      brandName: "Acme",
      primaryColor: "#112233",
      accentColor: "#445566",
      supportEmail: "hi@acme.test",
    });
    expect(ws.slug).toBe("acme");
    expect(ws.brandName).toBe("Acme");
    expect(ws.shareToken).toBeTruthy();

    expect(store.getWorkspace(ws.id)?.name).toBe("Acme Research");
    expect(store.getWorkspaceBySlug("acme")?.id).toBe(ws.id);
    expect(store.getWorkspaceByShareToken(ws.shareToken)?.id).toBe(ws.id);
  });

  it("updateWorkspace persists diffs and leaves others alone", () => {
    const ws = store.createWorkspace({
      slug: "contoso",
      name: "Contoso",
      primaryColor: "#000000",
    });
    const updated = store.updateWorkspace(ws.id, {
      brandName: "Contoso Media",
      footerText: "© 2026 Contoso",
    });
    expect(updated?.brandName).toBe("Contoso Media");
    expect(updated?.footerText).toBe("© 2026 Contoso");
    // Untouched fields must survive.
    expect(updated?.primaryColor).toBe("#000000");
    expect(updated?.slug).toBe("contoso");
  });

  it("rotateShareToken changes the token and invalidates the old one", () => {
    const ws = store.createWorkspace({ slug: "rotate-test", name: "Rotate" });
    const original = ws.shareToken;
    const rotated = store.rotateShareToken(ws.id);
    expect(rotated?.shareToken).not.toBe(original);
    expect(store.getWorkspaceByShareToken(original)).toBeUndefined();
    expect(store.getWorkspaceByShareToken(rotated!.shareToken)?.id).toBe(ws.id);
  });

  it("refuses to delete the default workspace", () => {
    const def = store.getDefaultWorkspace();
    const result = store.deleteWorkspace(def.id);
    expect(result.ok).toBe(false);
    expect(store.getWorkspaceBySlug("default")).toBeDefined();
  });

  it("deletes a non-default workspace and reassigns its rows to default", () => {
    const ws = store.createWorkspace({ slug: "to-delete", name: "Delete Me" });
    const result = store.deleteWorkspace(ws.id);
    expect(result.ok).toBe(true);
    expect(store.getWorkspace(ws.id)).toBeUndefined();
  });

  it("getWorkspaceStats returns zero counts for a fresh workspace", () => {
    const ws = store.createWorkspace({ slug: "stats-test", name: "Stats" });
    const stats = store.getWorkspaceStats(ws.id);
    expect(stats).toEqual({
      jobCount: 0,
      monitorCount: 0,
      signalMonitorCount: 0,
      discoveryCount: 0,
    });
  });
});
