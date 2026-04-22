import crypto from "node:crypto";
import { getDb } from "./db";

// A "workspace" is a tenant. Every enrichment job, monitor, signal monitor,
// and discovery search is stamped with a workspace_id so one deployment can
// serve multiple client agencies with their own data silo and their own
// white-label branding. The workspace also owns a shareToken used to expose
// a read-only, branded view of its results at /r/<token>/<jobId> — no login,
// but the jobId itself is a uuid so the surface is effectively bearer-token
// protected.

export type Workspace = {
  id: string;
  slug: string;                 // URL-safe identifier, unique per deployment
  name: string;                 // Display name in the switcher
  brandName: string | null;     // Shown in the branded public header (e.g. "Acme Research")
  logoUrl: string | null;       // Absolute URL of the brand logo
  primaryColor: string | null;  // "#RRGGBB" — used for CTAs + links in branded view
  accentColor: string | null;   // "#RRGGBB" — secondary highlight
  supportEmail: string | null;  // Shown in branded footer
  footerText: string | null;    // Short line (e.g. "© Acme Research 2026")
  shareToken: string;           // Random token used in /r/<token>/<jobId>
  createdAt: number;
  updatedAt: number;
};

type Row = {
  id: string;
  slug: string;
  name: string;
  brand_name: string | null;
  logo_url: string | null;
  primary_color: string | null;
  accent_color: string | null;
  support_email: string | null;
  footer_text: string | null;
  share_token: string;
  created_at: number;
  updated_at: number;
};

function fromRow(r: Row): Workspace {
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    brandName: r.brand_name,
    logoUrl: r.logo_url,
    primaryColor: r.primary_color,
    accentColor: r.accent_color,
    supportEmail: r.support_email,
    footerText: r.footer_text,
    shareToken: r.share_token,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,48}[a-z0-9]$|^[a-z0-9]$/;
export const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

export function listWorkspaces(): Workspace[] {
  const db = getDb();
  const rows = db
    .prepare(`SELECT * FROM workspaces ORDER BY slug = 'default' DESC, name ASC`)
    .all() as Row[];
  return rows.map(fromRow);
}

export function getWorkspace(id: string): Workspace | undefined {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM workspaces WHERE id = ?`).get(id) as Row | undefined;
  return row ? fromRow(row) : undefined;
}

export function getWorkspaceBySlug(slug: string): Workspace | undefined {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM workspaces WHERE slug = ?`).get(slug) as Row | undefined;
  return row ? fromRow(row) : undefined;
}

export function getWorkspaceByShareToken(token: string): Workspace | undefined {
  const db = getDb();
  const row = db
    .prepare(`SELECT * FROM workspaces WHERE share_token = ?`)
    .get(token) as Row | undefined;
  return row ? fromRow(row) : undefined;
}

// The default workspace is always guaranteed to exist — lib/db.ts creates it
// during init. This getter exists so callers (cookie resolver, API routes,
// the UI) don't need to special-case "workspace missing".
export function getDefaultWorkspace(): Workspace {
  const ws = getWorkspaceBySlug("default");
  if (!ws) {
    // Shouldn't happen — lib/db.ts init guarantees this row. If the DB was
    // tampered with, recreate it so the app stays usable.
    const db = getDb();
    const id = crypto.randomUUID();
    const now = Date.now();
    db.transaction(() => {
      db.prepare(
        `INSERT INTO workspaces (id, slug, name, brand_name, share_token, created_at, updated_at)
         VALUES (?, 'default', 'Default Workspace', 'Enricher', ?, ?, ?)`
      ).run(id, crypto.randomBytes(18).toString("base64url"), now, now);
      db.prepare(
        `INSERT INTO workspace_business_profiles (
          workspace_id, business_name, offerings, service_geographies, target_industries,
          persona_titles, company_size_min, company_size_max, deal_size_min, deal_size_max,
          excluded_segments, messaging_tone, compliance_boundaries, created_at, updated_at
        ) VALUES (?, '', '[]', '[]', '[]', '[]', NULL, NULL, NULL, NULL, '[]', NULL, '{}', ?, ?)`
      ).run(id, now, now);
    })();
    return getWorkspace(id)!;
  }
  return ws;
}

export function createWorkspace(params: {
  slug: string;
  name: string;
  brandName?: string;
  logoUrl?: string;
  primaryColor?: string;
  accentColor?: string;
  supportEmail?: string;
  footerText?: string;
}): Workspace {
  const db = getDb();
  const id = crypto.randomUUID();
  const now = Date.now();
  db.transaction(() => {
    db.prepare(
      `INSERT INTO workspaces (
        id, slug, name, brand_name, logo_url, primary_color, accent_color,
        support_email, footer_text, share_token, created_at, updated_at
      ) VALUES (
        @id, @slug, @name, @brandName, @logoUrl, @primaryColor, @accentColor,
        @supportEmail, @footerText, @shareToken, @now, @now
      )`
    ).run({
      id,
      slug: params.slug,
      name: params.name,
      brandName: params.brandName ?? null,
      logoUrl: params.logoUrl ?? null,
      primaryColor: params.primaryColor ?? null,
      accentColor: params.accentColor ?? null,
      supportEmail: params.supportEmail ?? null,
      footerText: params.footerText ?? null,
      shareToken: crypto.randomBytes(18).toString("base64url"),
      now,
    });
    db.prepare(
      `INSERT INTO workspace_business_profiles (
        workspace_id, business_name, offerings, service_geographies, target_industries,
        persona_titles, company_size_min, company_size_max, deal_size_min, deal_size_max,
        excluded_segments, messaging_tone, compliance_boundaries, created_at, updated_at
      ) VALUES (?, '', '[]', '[]', '[]', '[]', NULL, NULL, NULL, NULL, '[]', NULL, '{}', ?, ?)`
    ).run(id, now, now);
  })();
  return getWorkspace(id)!;
}

const FIELD_TO_COLUMN: Record<string, string> = {
  name: "name",
  brandName: "brand_name",
  logoUrl: "logo_url",
  primaryColor: "primary_color",
  accentColor: "accent_color",
  supportEmail: "support_email",
  footerText: "footer_text",
};

export function updateWorkspace(id: string, partial: Partial<Workspace>): Workspace | undefined {
  const db = getDb();
  const sets: string[] = [];
  const values: Record<string, unknown> = { id, updatedAt: Date.now() };
  for (const [key, value] of Object.entries(partial)) {
    const col = FIELD_TO_COLUMN[key];
    if (!col) continue;
    sets.push(`${col} = @${key}`);
    values[key] = value === "" ? null : value ?? null;
  }
  if (sets.length === 0) {
    db.prepare(`UPDATE workspaces SET updated_at = @updatedAt WHERE id = @id`).run(values);
  } else {
    db.prepare(
      `UPDATE workspaces SET ${sets.join(", ")}, updated_at = @updatedAt WHERE id = @id`
    ).run(values);
  }
  return getWorkspace(id);
}

// Rotating the share token invalidates any previously distributed /r/<token>
// links for this workspace. Useful if a client leak requires revoking access.
export function rotateShareToken(id: string): Workspace | undefined {
  const db = getDb();
  db.prepare(
    `UPDATE workspaces SET share_token = ?, updated_at = ? WHERE id = ?`
  ).run(crypto.randomBytes(18).toString("base64url"), Date.now(), id);
  return getWorkspace(id);
}

// Delete a workspace, reassigning its data (jobs, monitors, etc.) to the
// default workspace so history isn't lost. Refuses to delete the default
// workspace itself.
export function deleteWorkspace(id: string): { ok: boolean; reason?: string } {
  const ws = getWorkspace(id);
  if (!ws) return { ok: false, reason: "Workspace not found" };
  if (ws.slug === "default") {
    return { ok: false, reason: "The default workspace cannot be deleted" };
  }
  const db = getDb();
  const defaultId = getDefaultWorkspace().id;
  db.transaction(() => {
    db.prepare(`UPDATE jobs              SET workspace_id = ? WHERE workspace_id = ?`).run(defaultId, id);
    db.prepare(`UPDATE monitors          SET workspace_id = ? WHERE workspace_id = ?`).run(defaultId, id);
    db.prepare(`UPDATE signal_monitors   SET workspace_id = ? WHERE workspace_id = ?`).run(defaultId, id);
    db.prepare(`UPDATE discovery_searches SET workspace_id = ? WHERE workspace_id = ?`).run(defaultId, id);
    db.prepare(`DELETE FROM workspaces WHERE id = ?`).run(id);
  })();
  return { ok: true };
}

// Lightweight stats used by the workspaces UI. Counts are per-workspace so
// the list view shows how much traffic each client is driving.
export type WorkspaceStats = {
  jobCount: number;
  monitorCount: number;
  signalMonitorCount: number;
  discoveryCount: number;
};

export function getWorkspaceStats(id: string): WorkspaceStats {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM jobs               WHERE workspace_id = ?) AS jobs,
         (SELECT COUNT(*) FROM monitors           WHERE workspace_id = ?) AS monitors,
         (SELECT COUNT(*) FROM signal_monitors    WHERE workspace_id = ?) AS signals,
         (SELECT COUNT(*) FROM discovery_searches WHERE workspace_id = ?) AS discoveries`
    )
    .get(id, id, id, id) as {
    jobs: number;
    monitors: number;
    signals: number;
    discoveries: number;
  };
  return {
    jobCount: row.jobs,
    monitorCount: row.monitors,
    signalMonitorCount: row.signals,
    discoveryCount: row.discoveries,
  };
}
