"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { clsx } from "clsx";
import { LayoutGrid, Gauge, Building2, Users, UserSearch, Radar, Target, Flame } from "lucide-react";

const LINKS = [
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
    <div className="max-w-5xl mx-auto px-6 pt-6">
      <div className="flex items-center gap-2 bg-white/60 backdrop-blur-sm border border-cloudy/30 rounded-xl p-1 w-fit">
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
                "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all",
                active
                  ? "bg-white text-gray-900 shadow-sm"
                  : "text-gray-500 hover:text-gray-800"
              )}
            >
              <Icon
                className={clsx("w-3.5 h-3.5", active ? "text-brand-500" : "text-cloudy")}
                strokeWidth={active ? 2.5 : 2}
              />
              {label}
            </Link>
          );
        })}
        <span className="inline-flex items-center gap-1 px-2 py-1.5 text-[10px] text-cloudy">
          <LayoutGrid className="w-3 h-3" />
        </span>
      </div>
    </div>
  );
}
