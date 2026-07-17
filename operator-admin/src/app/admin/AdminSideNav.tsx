"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Exported so AdminMobileNav's drawer can reuse the exact same route list
// and active-route logic rather than duplicating it.
export const NAV_ITEMS = [
  { label: "Home",         href: "/admin/home" },
  { label: "Venue",        href: "/admin/venue" },
  { label: "Happy Hours",  href: "/admin/happy-hours" },
  { label: "Events",       href: "/admin/events" },
  { label: "Analytics",    href: "/admin/analytics" },
  { label: "Subscription", href: "/admin/subscription" },
  { label: "Users",        href: "/admin/users" },
  { label: "Help",         href: "/admin/help" },
] as const;

export function isNavItemActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(href + "/");
}

// Permanent desktop sidebar — hidden below md: (AdminMobileNav's drawer
// takes over there). Width, styling, route structure, and active-state
// treatment are unchanged from before the mobile nav was added.
export default function AdminSideNav() {
  const pathname = usePathname();

  return (
    <nav className="hidden md:block w-52 shrink-0 bg-slate-100 border-r border-slate-200 overflow-y-auto py-4">
      <ul className="space-y-0.5 px-3">
        {NAV_ITEMS.map(({ label, href }) => {
          const isActive = isNavItemActive(pathname, href);
          return (
            <li key={href}>
              <Link
                href={href}
                className={`block px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-amber-50 text-amber-600"
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
