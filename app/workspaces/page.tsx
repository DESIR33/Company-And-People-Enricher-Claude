"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  Building2,
  Check,
  Copy,
  Edit3,
  Loader2,
  Palette,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import { clsx } from "clsx";

type WorkspaceStats = {
  jobCount: number;
  monitorCount: number;
  signalMonitorCount: number;
  discoveryCount: number;
};

type Workspace = {
  id: string;
  slug: string;
  name: string;
  brandName: string | null;
  logoUrl: string | null;
  primaryColor: string | null;
  accentColor: string | null;
  supportEmail: string | null;
  footerText: string | null;
  shareToken: string;
  createdAt: number;
  stats: WorkspaceStats;
};

export default function WorkspacesPage() {
  const [workspaces, setWorkspaces] = useState<Workspace[] | null>(null);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Workspace | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const [list, current] = await Promise.all([
        fetch("/api/workspaces").then((r) => r.json()),
        fetch("/api/workspaces/current").then((r) => r.json()),
      ]);
      setWorkspaces(list.workspaces ?? []);
      setCurrentId(current.workspace?.id ?? null);
    } catch {
      setError("Failed to load workspaces");
    }
  }, []);

  useEffect(() => {
    // Defer the first load by a tick so the setState it triggers doesn't
    // cascade inside the same render pass — matches the pattern used on
    // the other list pages in this app.
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  const activate = async (id: string) => {
    await fetch("/api/workspaces/current", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId: id }),
    });
    setCurrentId(id);
    // Reload so that any list views rendered elsewhere re-scope.
    window.location.reload();
  };

  return (
    <div className="min-h-screen pb-16">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 pt-4 sm:pt-6 space-y-4 sm:space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Building2 className="w-5 h-5 text-brand-500 flex-shrink-0" strokeWidth={2} />
              <h1 className="text-2xl sm:text-3xl font-serif font-bold text-gray-900 tracking-tight">
                Workspaces
              </h1>
            </div>
            <p className="text-sm text-cloudy mt-1">
              One deployment, many clients. Each workspace has an isolated job history and can be white-labeled with a logo, brand colors, and a shareable public results URL.
            </p>
          </div>
          <button
            onClick={() => setCreating((v) => !v)}
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-brand-500 text-white text-sm font-medium hover:bg-brand-600 transition-colors self-start sm:self-auto flex-shrink-0"
          >
            <Plus className="w-4 h-4" />
            {creating ? "Cancel" : "New workspace"}
          </button>
        </div>

        {error && (
          <div className="flex items-center gap-2.5 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            <AlertCircle className="w-4 h-4" />
            {error}
          </div>
        )}

        {creating && (
          <CreateForm
            onCancel={() => setCreating(false)}
            onCreated={() => {
              setCreating(false);
              load();
            }}
          />
        )}

        {editing && (
          <EditDialog
            workspace={editing}
            onClose={() => setEditing(null)}
            onSaved={() => {
              setEditing(null);
              load();
            }}
          />
        )}

        {workspaces === null ? (
          <div className="text-sm text-cloudy flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading workspaces…
          </div>
        ) : (
          <div className="grid gap-3">
            {workspaces.map((w) => (
              <WorkspaceCard
                key={w.id}
                workspace={w}
                active={w.id === currentId}
                onActivate={() => activate(w.id)}
                onEdit={() => setEditing(w)}
                onDeleted={load}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function WorkspaceCard({
  workspace,
  active,
  onActivate,
  onEdit,
  onDeleted,
}: {
  workspace: Workspace;
  active: boolean;
  onActivate: () => void;
  onEdit: () => void;
  onDeleted: () => void;
}) {
  const [busy, setBusy] = useState<"delete" | null>(null);

  const remove = async () => {
    if (
      !confirm(
        `Delete workspace "${workspace.name}"? Its ${workspace.stats.jobCount} job(s), ${workspace.stats.monitorCount} monitor(s), and ${workspace.stats.discoveryCount} search(es) will be reassigned to the default workspace.`
      )
    )
      return;
    setBusy("delete");
    try {
      const res = await fetch(`/api/workspaces/${workspace.id}`, { method: "DELETE" });
      const body = await res.json();
      if (!res.ok) {
        alert(body.error ?? "Failed to delete");
        return;
      }
      onDeleted();
    } finally {
      setBusy(null);
    }
  };

  const primary = workspace.primaryColor ?? "#c15f3c";
  const accent = workspace.accentColor ?? primary;

  return (
    <div className="bg-white border border-cloudy/30 rounded-xl overflow-hidden">
      <div className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-start gap-3 sm:gap-4">
        <div className="flex items-start gap-3 sm:gap-4 min-w-0 flex-1">
          <BrandTile
            logoUrl={workspace.logoUrl}
            brandName={workspace.brandName ?? workspace.name}
            primaryColor={primary}
            accentColor={accent}
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-sm font-semibold text-gray-900 truncate">{workspace.name}</h2>
              <code className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-pampas text-cloudy">
                /{workspace.slug}
              </code>
              {active && (
                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-brand-100 text-brand-700 uppercase tracking-wide">
                  Active
                </span>
              )}
              {workspace.slug === "default" && (
                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-600 uppercase tracking-wide">
                  Default
                </span>
              )}
            </div>
            {workspace.brandName && workspace.brandName !== workspace.name && (
              <p className="text-xs text-cloudy mt-0.5">
                Public brand: <span className="text-gray-700 font-medium">{workspace.brandName}</span>
              </p>
            )}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-[11px] text-cloudy tabular">
              <span>Jobs: <span className="text-gray-700 font-medium">{workspace.stats.jobCount}</span></span>
              <span>Monitors: <span className="text-gray-700 font-medium">{workspace.stats.monitorCount}</span></span>
              <span>Signals: <span className="text-gray-700 font-medium">{workspace.stats.signalMonitorCount}</span></span>
              <span>Searches: <span className="text-gray-700 font-medium">{workspace.stats.discoveryCount}</span></span>
            </div>
            <div className="mt-2">
              <ShareLinkRow shareToken={workspace.shareToken} />
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap flex-shrink-0 sm:self-start">
          {!active && (
            <button
              onClick={onActivate}
              className="text-xs px-2.5 py-1.5 rounded-md border border-cloudy/40 text-gray-700 hover:bg-pampas transition-colors"
            >
              Switch to
            </button>
          )}
          <button
            onClick={onEdit}
            className="text-xs px-2.5 py-1.5 rounded-md border border-cloudy/40 text-gray-600 hover:bg-pampas transition-colors inline-flex items-center gap-1"
          >
            <Edit3 className="w-3 h-3" /> Edit
          </button>
          {workspace.slug !== "default" && (
            <button
              onClick={remove}
              disabled={busy === "delete"}
              className="text-xs px-2 py-1.5 rounded-md border border-cloudy/40 text-gray-400 hover:text-red-600 hover:border-red-300 disabled:opacity-50 transition-colors"
              title="Delete workspace (data moves to default)"
            >
              {busy === "delete" ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// Visual preview of the workspace's branding. Kept as a tiny square so the
// list stays compact — the Edit dialog shows a larger preview of the public
// header.
function BrandTile({
  logoUrl,
  brandName,
  primaryColor,
  accentColor,
}: {
  logoUrl: string | null;
  brandName: string;
  primaryColor: string;
  accentColor: string;
}) {
  if (logoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={logoUrl}
        alt={`${brandName} logo`}
        className="w-11 h-11 rounded-lg object-contain bg-white border border-cloudy/30 p-1 flex-shrink-0"
        onError={(e) => {
          (e.target as HTMLImageElement).style.display = "none";
        }}
      />
    );
  }
  const initial = brandName.trim().charAt(0).toUpperCase() || "W";
  return (
    <div
      className="w-11 h-11 rounded-lg flex items-center justify-center text-base font-semibold text-white flex-shrink-0"
      style={{
        background: `linear-gradient(135deg, ${primaryColor}, ${accentColor})`,
      }}
    >
      {initial}
    </div>
  );
}

function ShareLinkRow({ shareToken }: { shareToken: string }) {
  const [copied, setCopied] = useState(false);
  const base =
    typeof window === "undefined" ? "" : `${window.location.origin}/r/${shareToken}/`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${base}<jobId>`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* ignore */
    }
  };
  return (
    <div className="flex items-center gap-1.5 text-[11px] text-cloudy">
      <span>Branded link:</span>
      <code className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-pampas text-gray-700 truncate max-w-[12rem] sm:max-w-xs">
        {base}&lt;jobId&gt;
      </code>
      <button
        onClick={copy}
        className={clsx(
          "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors",
          copied
            ? "bg-emerald-100 text-emerald-700"
            : "text-cloudy hover:text-brand-500"
        )}
      >
        {copied ? <Check className="w-2.5 h-2.5" /> : <Copy className="w-2.5 h-2.5" />}
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

// ----------------------------------------------------------------
// Create form
// ----------------------------------------------------------------

function CreateForm({ onCancel, onCreated }: { onCancel: () => void; onCreated: () => void }) {
  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");
  const [brandName, setBrandName] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [primaryColor, setPrimaryColor] = useState("#c15f3c");
  const [accentColor, setAccentColor] = useState("#d07550");
  const [supportEmail, setSupportEmail] = useState("");
  const [footerText, setFooterText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const slugify = (s: string) =>
    s
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 50);

  const submit = async () => {
    setError("");
    if (!name.trim()) return setError("Give the workspace a name.");
    const finalSlug = slug.trim() || slugify(name);
    if (!finalSlug) return setError("Couldn't derive a slug — type one manually.");
    setSubmitting(true);
    try {
      const res = await fetch("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: finalSlug,
          name: name.trim(),
          brandName: brandName.trim() || undefined,
          logoUrl: logoUrl.trim() || undefined,
          primaryColor: primaryColor.trim() || undefined,
          accentColor: accentColor.trim() || undefined,
          supportEmail: supportEmail.trim() || undefined,
          footerText: footerText.trim() || undefined,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? body.issues?.join("; ") ?? "Failed to create");
        return;
      }
      onCreated();
    } catch {
      setError("Network error creating workspace");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="bg-white border border-cloudy/30 rounded-xl overflow-hidden">
      <div className="px-4 sm:px-5 py-4 border-b border-cloudy/20">
        <h2 className="text-sm font-semibold text-gray-700">New workspace</h2>
      </div>
      <div className="p-4 sm:p-5 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Name">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Acme Research"
              className="w-full border border-cloudy/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent transition"
            />
          </Field>
          <Field
            label="Slug"
            hint="Lowercase letters, numbers, hyphens. Auto-derived from name if blank."
          >
            <input
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder={name ? slugify(name) : "acme-research"}
              className="w-full border border-cloudy/40 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent transition"
            />
          </Field>
        </div>

        <BrandingFields
          brandName={brandName}
          onBrandName={setBrandName}
          logoUrl={logoUrl}
          onLogoUrl={setLogoUrl}
          primaryColor={primaryColor}
          onPrimaryColor={setPrimaryColor}
          accentColor={accentColor}
          onAccentColor={setAccentColor}
          supportEmail={supportEmail}
          onSupportEmail={setSupportEmail}
          footerText={footerText}
          onFooterText={setFooterText}
        />

        {error && (
          <div className="flex items-center gap-2.5 px-3 py-2 bg-red-50 border border-red-200 rounded-md text-xs text-red-700">
            <AlertCircle className="w-3.5 h-3.5" /> {error}
          </div>
        )}

        <div className="flex items-center gap-2 pt-1">
          <button
            onClick={submit}
            disabled={submitting}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-brand-500 text-white text-sm font-medium hover:bg-brand-600 disabled:opacity-50 transition-colors"
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Create workspace
          </button>
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-lg border border-cloudy/40 text-sm text-gray-600 hover:bg-pampas transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------
// Edit dialog — modal for updating branding of an existing workspace
// ----------------------------------------------------------------

function EditDialog({
  workspace,
  onClose,
  onSaved,
}: {
  workspace: Workspace;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(workspace.name);
  const [brandName, setBrandName] = useState(workspace.brandName ?? "");
  const [logoUrl, setLogoUrl] = useState(workspace.logoUrl ?? "");
  const [primaryColor, setPrimaryColor] = useState(workspace.primaryColor ?? "#c15f3c");
  const [accentColor, setAccentColor] = useState(workspace.accentColor ?? "#d07550");
  const [supportEmail, setSupportEmail] = useState(workspace.supportEmail ?? "");
  const [footerText, setFooterText] = useState(workspace.footerText ?? "");
  const [rotating, setRotating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const save = async (opts: { rotate?: boolean } = {}) => {
    setError("");
    if (opts.rotate) setRotating(true);
    else setSaving(true);
    try {
      const res = await fetch(`/api/workspaces/${workspace.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          brandName: brandName.trim() || null,
          logoUrl: logoUrl.trim() || null,
          primaryColor: primaryColor.trim() || null,
          accentColor: accentColor.trim() || null,
          supportEmail: supportEmail.trim() || null,
          footerText: footerText.trim() || null,
          rotateShareToken: opts.rotate ?? false,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? body.issues?.join("; ") ?? "Failed to save");
        return;
      }
      onSaved();
    } catch {
      setError("Network error saving workspace");
    } finally {
      setSaving(false);
      setRotating(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-start sm:items-center justify-center p-3 sm:p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-xl max-w-lg w-full my-8 sm:my-0"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 sm:px-5 py-4 border-b border-cloudy/20 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-gray-900 truncate">
              Edit {workspace.name}
            </h3>
            <p className="text-[11px] text-cloudy mt-0.5">
              Branding applies to the public <code className="font-mono">/r/&lt;token&gt;</code> results view.
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-cloudy hover:text-gray-700 transition-colors flex-shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 sm:p-5 space-y-4">
          <Field label="Name">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full border border-cloudy/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent transition"
            />
          </Field>

          <BrandingFields
            brandName={brandName}
            onBrandName={setBrandName}
            logoUrl={logoUrl}
            onLogoUrl={setLogoUrl}
            primaryColor={primaryColor}
            onPrimaryColor={setPrimaryColor}
            accentColor={accentColor}
            onAccentColor={setAccentColor}
            supportEmail={supportEmail}
            onSupportEmail={setSupportEmail}
            footerText={footerText}
            onFooterText={setFooterText}
          />

          <BrandedPreview
            brandName={brandName || name || workspace.name}
            logoUrl={logoUrl}
            primaryColor={primaryColor}
            accentColor={accentColor}
            footerText={footerText}
          />

          <div className="rounded-lg border border-cloudy/30 bg-pampas/40 p-3 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-xs font-medium text-gray-700">Share token</p>
                <code className="text-[10px] font-mono text-cloudy break-all">
                  {workspace.shareToken}
                </code>
              </div>
              <button
                onClick={() => save({ rotate: true })}
                disabled={rotating}
                className="text-[11px] px-2.5 py-1.5 rounded-md border border-cloudy/40 text-gray-700 hover:bg-white inline-flex items-center gap-1 flex-shrink-0 transition-colors disabled:opacity-50"
                title="Rotate token — any existing /r/ links will stop working"
              >
                {rotating ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                Rotate
              </button>
            </div>
            <p className="text-[10px] text-cloudy">
              Rotating invalidates every <code className="font-mono">/r/&lt;token&gt;/…</code> link you&apos;ve shared.
            </p>
          </div>

          {error && (
            <div className="flex items-center gap-2.5 px-3 py-2 bg-red-50 border border-red-200 rounded-md text-xs text-red-700">
              <AlertCircle className="w-3.5 h-3.5" /> {error}
            </div>
          )}

          <div className="flex items-center gap-2">
            <button
              onClick={() => save()}
              disabled={saving}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-brand-500 text-white text-sm font-medium hover:bg-brand-600 disabled:opacity-50 transition-colors"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              Save changes
            </button>
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg border border-cloudy/40 text-sm text-gray-600 hover:bg-pampas transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------
// Shared building blocks
// ----------------------------------------------------------------

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      {children}
      {hint && <p className="text-[11px] text-cloudy mt-1">{hint}</p>}
    </div>
  );
}

function BrandingFields({
  brandName,
  onBrandName,
  logoUrl,
  onLogoUrl,
  primaryColor,
  onPrimaryColor,
  accentColor,
  onAccentColor,
  supportEmail,
  onSupportEmail,
  footerText,
  onFooterText,
}: {
  brandName: string;
  onBrandName: (s: string) => void;
  logoUrl: string;
  onLogoUrl: (s: string) => void;
  primaryColor: string;
  onPrimaryColor: (s: string) => void;
  accentColor: string;
  onAccentColor: (s: string) => void;
  supportEmail: string;
  onSupportEmail: (s: string) => void;
  footerText: string;
  onFooterText: (s: string) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-[11px] font-semibold text-cloudy uppercase tracking-wider">
        <Palette className="w-3 h-3" /> Branding
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Brand name (shown in public header)">
          <input
            value={brandName}
            onChange={(e) => onBrandName(e.target.value)}
            placeholder="Acme Research"
            className="w-full border border-cloudy/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent transition"
          />
        </Field>
        <Field label="Logo URL (https://…)">
          <input
            value={logoUrl}
            onChange={(e) => onLogoUrl(e.target.value)}
            placeholder="https://example.com/logo.png"
            className="w-full border border-cloudy/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent transition"
          />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Primary colour">
          <ColorInput value={primaryColor} onChange={onPrimaryColor} />
        </Field>
        <Field label="Accent colour">
          <ColorInput value={accentColor} onChange={onAccentColor} />
        </Field>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Support email">
          <input
            value={supportEmail}
            onChange={(e) => onSupportEmail(e.target.value)}
            placeholder="hi@acme.research"
            className="w-full border border-cloudy/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent transition"
          />
        </Field>
        <Field label="Footer text">
          <input
            value={footerText}
            onChange={(e) => onFooterText(e.target.value)}
            placeholder="© Acme Research 2026"
            className="w-full border border-cloudy/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent transition"
          />
        </Field>
      </div>
    </div>
  );
}

function ColorInput({ value, onChange }: { value: string; onChange: (s: string) => void }) {
  const normalised = /^#[0-9a-fA-F]{6}$/.test(value.trim()) ? value.trim() : "#c15f3c";
  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        value={normalised}
        onChange={(e) => onChange(e.target.value)}
        className="w-10 h-9 rounded-md border border-cloudy/40 cursor-pointer flex-shrink-0"
        aria-label="Colour picker"
      />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="#RRGGBB"
        className="flex-1 min-w-0 border border-cloudy/40 rounded-lg px-3 py-2 text-sm font-mono tabular focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent transition"
      />
    </div>
  );
}

function BrandedPreview({
  brandName,
  logoUrl,
  primaryColor,
  accentColor,
  footerText,
}: {
  brandName: string;
  logoUrl: string;
  primaryColor: string;
  accentColor: string;
  footerText: string;
}) {
  const primary = /^#[0-9a-fA-F]{6}$/.test(primaryColor) ? primaryColor : "#c15f3c";
  const accent = /^#[0-9a-fA-F]{6}$/.test(accentColor) ? accentColor : primary;
  return (
    <div className="rounded-lg border border-cloudy/30 bg-white overflow-hidden">
      <p className="text-[10px] uppercase tracking-wider font-semibold text-cloudy px-3 pt-2">
        Public header preview
      </p>
      <div
        className="px-4 py-3 flex items-center gap-3 border-b"
        style={{ borderColor: `${primary}33` }}
      >
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={logoUrl}
            alt="Logo preview"
            className="w-8 h-8 object-contain"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        ) : (
          <div
            className="w-8 h-8 rounded-md flex items-center justify-center text-xs font-semibold text-white"
            style={{ background: `linear-gradient(135deg, ${primary}, ${accent})` }}
          >
            {(brandName || "W").trim().charAt(0).toUpperCase()}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate" style={{ color: primary }}>
            {brandName || "Your brand"}
          </p>
          <p className="text-[11px] text-gray-500">Enrichment results</p>
        </div>
        <button
          className="text-[11px] px-2.5 py-1.5 rounded-md font-medium text-white pointer-events-none"
          style={{ backgroundColor: primary }}
        >
          Download CSV
        </button>
      </div>
      <div className="px-4 py-2 text-[10px] text-cloudy">
        {footerText || "Footer text appears here"}
      </div>
    </div>
  );
}
