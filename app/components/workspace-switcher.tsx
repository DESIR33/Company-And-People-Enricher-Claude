"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Building2, Check, ChevronDown, Plus, Loader2 } from "lucide-react";
import { clsx } from "clsx";

type Workspace = {
  id: string;
  slug: string;
  name: string;
  brandName: string | null;
};

// Compact dropdown that lives in the top nav. Shows the active workspace's
// name and lets the user flip to another one — on change, we PUT the cookie
// and hard-reload so every already-rendered list view rescopes. Kept as an
// unconditional, uncontrolled client component because the list is short
// (typically one per client agency) and loads fast.
export function WorkspaceSwitcher() {
  const [open, setOpen] = useState(false);
  const [workspaces, setWorkspaces] = useState<Workspace[] | null>(null);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [switching, setSwitching] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const [list, current] = await Promise.all([
        fetch("/api/workspaces").then((r) => r.json()),
        fetch("/api/workspaces/current").then((r) => r.json()),
      ]);
      setWorkspaces(list.workspaces ?? []);
      setCurrentId(current.workspace?.id ?? null);
    } catch {
      /* ignore — the menu stays empty */
    }
  }, []);

  useEffect(() => {
    // Defer the initial fetch by a tick so setState doesn't cascade within
    // the same render pass (matches the pattern used on other list pages).
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  // Close the menu when clicking/tapping outside. Using capture phase so we
  // don't fight with per-item onClick handlers.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const current = workspaces?.find((w) => w.id === currentId);

  const switchTo = async (id: string) => {
    if (id === currentId) {
      setOpen(false);
      return;
    }
    setSwitching(id);
    try {
      const res = await fetch("/api/workspaces/current", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId: id }),
      });
      if (res.ok) {
        // Hard-reload so every list view rescopes to the newly active
        // workspace. Soft navigation would leave stale rows on the screen.
        window.location.reload();
      } else {
        setSwitching(null);
      }
    } catch {
      setSwitching(null);
    }
  };

  const label = current?.name ?? "Workspace";

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={clsx(
          "inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-medium transition-all whitespace-nowrap",
          "bg-white/70 border border-cloudy/30 text-gray-700 hover:bg-white",
          open && "bg-white shadow-sm"
        )}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Building2 className="w-3.5 h-3.5 text-brand-500 flex-shrink-0" strokeWidth={2.5} />
        <span className="truncate max-w-[8rem] sm:max-w-[12rem]">{label}</span>
        <ChevronDown className={clsx("w-3 h-3 text-cloudy transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-1 w-64 max-w-[85vw] bg-white border border-cloudy/30 rounded-lg shadow-lg overflow-hidden z-30"
        >
          <div className="px-3 py-2 border-b border-cloudy/20 flex items-center justify-between">
            <span className="text-[10px] font-semibold text-cloudy uppercase tracking-wider">
              Workspaces
            </span>
            {workspaces === null && <Loader2 className="w-3 h-3 animate-spin text-cloudy" />}
          </div>
          <ul className="max-h-72 overflow-y-auto py-1">
            {(workspaces ?? []).map((w) => {
              const active = w.id === currentId;
              const isSwitching = switching === w.id;
              return (
                <li key={w.id}>
                  <button
                    role="menuitemradio"
                    aria-checked={active}
                    onClick={() => switchTo(w.id)}
                    className={clsx(
                      "w-full text-left px-3 py-2 flex items-center gap-2 text-xs transition-colors",
                      active ? "bg-brand-50" : "hover:bg-pampas"
                    )}
                  >
                    <span
                      className={clsx(
                        "w-4 h-4 flex items-center justify-center flex-shrink-0",
                        active ? "text-brand-500" : "text-transparent"
                      )}
                    >
                      {isSwitching ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={clsx("block truncate", active ? "text-gray-900 font-medium" : "text-gray-700")}>
                        {w.name}
                      </span>
                      <span className="block text-[10px] font-mono text-cloudy truncate">
                        /{w.slug}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
            {workspaces?.length === 0 && (
              <li className="px-3 py-2 text-[11px] text-cloudy">No workspaces yet.</li>
            )}
          </ul>
          <div className="border-t border-cloudy/20">
            <Link
              href="/workspaces"
              onClick={() => setOpen(false)}
              className="block px-3 py-2 text-xs text-brand-500 hover:bg-brand-50 transition-colors inline-flex items-center gap-1.5 w-full"
            >
              <Plus className="w-3 h-3" /> Manage workspaces
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
