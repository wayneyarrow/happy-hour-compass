"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_ITEMS, isNavItemActive } from "./AdminSideNav";

/**
 * Mobile-only navigation trigger + slide-out drawer for the Operator Admin
 * shell. Renders a hamburger button (visible below md:; AdminSideNav's
 * permanent sidebar takes over at md: and above) that opens a left-side
 * drawer containing the same NAV_ITEMS / active-route logic AdminSideNav
 * uses, so the two navigation surfaces can never drift out of sync.
 *
 * Self-contained: owns its own open/close state, so admin/layout.tsx (a
 * Server Component doing the auth check) only needs to render <AdminMobileNav />
 * in the header — no state needs to be lifted up to the server layout.
 */
export default function AdminMobileNav() {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  function closeDrawer() {
    setIsOpen(false);
  }

  // Close whenever the route changes — covers "close after a nav item is
  // selected" without wiring an onClick to every Link, and also covers
  // browser back/forward navigation while the drawer happens to be open.
  useEffect(() => {
    setIsOpen(false);
  }, [pathname]);

  // Defensive: if the viewport crosses the md: breakpoint while the drawer
  // is open (e.g. a tablet rotating, or a desktop window resize), force it
  // closed rather than leaving an invisible (md:hidden) drawer holding the
  // body-scroll lock with no visible way to dismiss it.
  useEffect(() => {
    if (!isOpen) return;
    const mql = window.matchMedia("(min-width: 768px)");
    function handleChange(e: MediaQueryListEvent) {
      if (e.matches) closeDrawer();
    }
    mql.addEventListener("change", handleChange);
    return () => mql.removeEventListener("change", handleChange);
  }, [isOpen]);

  // Lock body scroll while the drawer is open so the page behind it can't
  // scroll.
  useEffect(() => {
    if (!isOpen) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = original;
    };
  }, [isOpen]);

  // Focus management: move focus into the drawer (its close button) on
  // open, return it to the hamburger trigger on close.
  useEffect(() => {
    if (isOpen) {
      closeButtonRef.current?.focus();
    } else {
      triggerRef.current?.focus();
    }
  }, [isOpen]);

  // Escape closes the drawer; Tab is trapped within it while open.
  useEffect(() => {
    if (!isOpen) return;

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        closeDrawer();
        return;
      }
      if (e.key === "Tab" && panelRef.current) {
        const focusable = panelRef.current.querySelectorAll<HTMLElement>(
          "a[href], button:not([disabled])"
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen]);

  return (
    <>
      {/* Hamburger trigger */}
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setIsOpen(true)}
        aria-label="Open navigation menu"
        aria-expanded={isOpen}
        aria-controls="admin-mobile-nav-drawer"
        className="md:hidden shrink-0 p-2.5 -ml-2.5 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-900 active:bg-gray-200 transition-colors"
      >
        <svg
          className="w-6 h-6"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M3.75 6.75h16.5M3.75 12h16.5M3.75 17.25h16.5"
          />
        </svg>
      </button>

      {/* Backdrop — always mounted so the opacity transition can animate;
          pointer-events-none when closed so it never blocks clicks. */}
      <div
        className={`md:hidden fixed inset-0 z-40 bg-black/50 transition-opacity duration-300 ${
          isOpen ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
        aria-hidden="true"
        onClick={closeDrawer}
      />

      {/* Drawer panel */}
      <div
        id="admin-mobile-nav-drawer"
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Admin navigation"
        className={`md:hidden fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] bg-white shadow-2xl flex flex-col transition-transform duration-300 ease-out ${
          isOpen ? "translate-x-0" : "-translate-x-full"
        }`}
        style={{
          paddingTop: "env(safe-area-inset-top)",
          paddingBottom: "env(safe-area-inset-bottom)",
        }}
      >
        {/* Drawer header */}
        <div className="flex items-center justify-between gap-3 px-4 py-4 border-b border-gray-100 shrink-0">
          <span className="text-sm font-semibold text-gray-900">Menu</span>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={closeDrawer}
            aria-label="Close navigation menu"
            className="shrink-0 p-2 -mr-2 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 active:bg-gray-200 transition-colors"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Nav items — same NAV_ITEMS / active-route logic as AdminSideNav */}
        <nav aria-label="Admin navigation" className="flex-1 overflow-y-auto py-3">
          <ul className="space-y-0.5 px-3">
            {NAV_ITEMS.map(({ label, href }) => {
              const isActive = isNavItemActive(pathname, href);
              return (
                <li key={href}>
                  <Link
                    href={href}
                    className={`block px-3 py-3 rounded-lg text-base font-medium truncate transition-colors ${
                      isActive
                        ? "bg-amber-50 text-amber-600"
                        : "text-gray-600 hover:bg-gray-100 hover:text-gray-900 active:bg-gray-100"
                    }`}
                  >
                    {label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>
    </>
  );
}
