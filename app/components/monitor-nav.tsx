"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { clsx } from "clsx";
import { LayoutGrid, Gauge, Building2, Users, UserSearch, Radar, Target, Flame, Search, Zap } from "lucide-react";

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
  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 pt-4 sm:pt-6">
      {/* The nav has 9 items and always overflows on narrow screens. Scroll it
          horizontally on mobile rather than trying to wrap — wrapping would
          eat vertical real estate above every page. Keep the active item
          visible by snapping to it. */}
      <div className="overflow-x-auto -mx-4 sm:mx-0 px-4 sm:px-0 scrollbar-thin">
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
          <span className="hidden sm:inline-flex items-center gap-1 px-2 py-1.5 text-[10px] text-cloudy">
            <LayoutGrid className="w-3 h-3" />
          </span>
        </div>
      </div>
    </div>
  );
}
