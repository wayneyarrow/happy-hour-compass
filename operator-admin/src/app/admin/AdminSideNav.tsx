"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { label: "Home",       href: "/admin/home" },
  { label: "Venue",      href: "/admin/venue" },
  { label: "Happy Hours",href: "/admin/happy-hours" },
  { label: "Events",     href: "/admin/events" },
  { label: "Images",     href: "/admin/images" },
  { label: "Analytics",  href: "/admin/analytics" },
  { label: "Marketing",  href: "/admin/marketing" },
  { label: "Billing",    href: "/admin/billing" },
  { label: "Users",      href: "/admin/users" },
  { label: "Account",    href: "/admin/account" },
] as const;

export default function AdminSideNav() {
  const pathname = usePathname();

  return (
    <nav className="w-52 shrink-0 bg-white border-r border-gray-200 overflow-y-auto py-4">
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
