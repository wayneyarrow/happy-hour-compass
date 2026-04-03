"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { label: "Dashboard",    href: "/control-panel/dashboard" },
  { label: "Claims",       href: "/control-panel/claims" },
  { label: "Submissions",  href: "/control-panel/operator-submissions" },
  { label: "Venues",       href: "/control-panel/venues" },
  { label: "Operators",    href: "/control-panel/operators" },
  { label: "Settings",     href: "/control-panel/settings" },
] as const;

export default function ControlPanelSideNav() {
  const pathname = usePathname();

  return (
    <nav className="w-52 shrink-0 bg-slate-100 border-r border-slate-200 overflow-y-auto py-4">
      <ul className="space-y-0.5 px-3">
        {NAV_ITEMS.map(({ label, href }) => {
          const isActive = pathname === href || pathname.startsWith(href + "/");
          return (
            <li key={href}>
              <Link
                href={href}
                className={`block px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-amber-50 text-amber-700"
                    : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                }`}
              >
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
