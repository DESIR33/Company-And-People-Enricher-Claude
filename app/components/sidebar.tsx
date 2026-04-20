"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Building2, Users, Sparkles } from "lucide-react";
import { clsx } from "clsx";

const NAV = [
  { href: "/enrich/company", label: "Companies", icon: Building2, description: "Enrich by URL" },
  { href: "/enrich/people",  label: "People",    icon: Users,     description: "Enrich by LinkedIn" },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-56 bg-white border-r border-gray-200 flex flex-col flex-shrink-0 h-full">
      {/* Brand */}
      <div className="px-5 h-14 flex items-center border-b border-gray-100 gap-2.5">
        <div className="w-7 h-7 bg-indigo-600 rounded-lg flex items-center justify-center flex-shrink-0">
          <Sparkles className="w-3.5 h-3.5 text-white" strokeWidth={2.5} />
        </div>
        <span className="font-semibold text-gray-900 text-sm tracking-tight">Enricher</span>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5">
        <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest px-2 mb-2">
          Enrich
        </p>
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={clsx(
                "flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm transition-all duration-150 group",
                active
                  ? "bg-indigo-50 text-indigo-700 font-medium"
                  : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
              )}
            >
              <Icon
                className={clsx(
                  "w-4 h-4 flex-shrink-0 transition-colors",
                  active ? "text-indigo-600" : "text-gray-400 group-hover:text-gray-600"
                )}
                strokeWidth={active ? 2.5 : 2}
              />
              {label}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="px-4 py-4 border-t border-gray-100">
        <p className="text-[11px] text-gray-400 leading-relaxed">
          Powered by Claude<br />
          Emails via Prospeo
        </p>
      </div>
    </aside>
  );
}
