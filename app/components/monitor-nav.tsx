"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { clsx } from "clsx";
import { Gauge, Building2, Users, UserSearch, Radar, Target, Flame, Search, Zap } from "lucide-react";
import { WorkspaceSwitcher } from "./workspace-switcher";

const LINKS = [
  { href: "/discover",              label: "Discover",       icon: Search },
  { href: "/signals",               label: "Signals",        icon: Zap },
  { href: "/enrich/company",        label: "Company",        icon: Building2 },
  { href: "/enrich/people",         label: "People",         icon: Users },
  { href: "/enrich/decision_maker", label: "Decision Maker", icon: UserSearch },
  { href: "/enrich/lead_score",     label: "Lead Score",     icon: Target },
  { href: "/enrich/buying_trigger", label: "Buying Triggers", icon: Flame },
  { href: "/monitors",              label: "Social Engager", icon: Radar },
  { href: "/usage",                 label: "Usage",          icon: Gauge },
];

export function MonitorNav() {
  const pathname = usePathname();
  // The branded public results view (/r/<token>/<jobId>) has its own header
  // and deliberately hides every app-side affordance — workspace switcher,
  // in-app nav, etc. Early-return so those chromes don't leak into the
  // client-facing surface.
  if (pathname.startsWith("/r/")) return null;
  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 pt-4 sm:pt-6 flex items-start gap-2 sm:gap-3">
      {/* The nav has 9 items and always overflows on narrow screens. Scroll it
          horizontally on mobile rather than trying to wrap — wrapping would
          eat vertical real estate above every page. */}
      <div className="flex-1 min-w-0 overflow-x-auto -mx-4 sm:mx-0 px-4 sm:px-0 scrollbar-thin">
        <div className="inline-flex items-center gap-1 sm:gap-2 bg-white/60 backdrop-blur-sm border border-cloudy/30 rounded-xl p-1 w-max">
          {LINKS.map(({ href, label, icon: Icon }) => {
            const active =
              href === "/monitors"
                ? pathname.startsWith("/monitors")
                : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={clsx(
                  "inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-medium transition-all whitespace-nowrap",
                  active
                    ? "bg-white text-gray-900 shadow-sm"
                    : "text-gray-500 hover:text-gray-800"
                )}
              >
                <Icon
                  className={clsx("w-3.5 h-3.5 flex-shrink-0", active ? "text-brand-500" : "text-cloudy")}
                  strokeWidth={active ? 2.5 : 2}
                />
                {label}
              </Link>
            );
          })}
        </div>
      </div>
      {/* Workspace switcher sits to the right of the nav. Pinned on a fixed
          column so horizontal scroll of the nav rail doesn't hide it. */}
      <div className="flex-shrink-0">
        <WorkspaceSwitcher />
      </div>
    </div>
  );
}
