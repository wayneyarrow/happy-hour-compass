"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { label: "Restaurants & Bars", href: "/restaurants" },
  { label: "Guides", href: "/guides" },
  { label: "For Businesses", href: "/for-businesses" },
];

export default function WebsiteHeader() {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Close mobile menu on route change
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  // Prevent body scroll while mobile menu is open
  useEffect(() => {
    document.body.style.overflow = menuOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [menuOpen]);

  return (
    <>
      <header
        className={`sticky top-0 z-50 bg-white transition-shadow duration-200 ${
          scrolled
            ? "shadow-[0_1px_8px_rgba(0,0,0,0.08),0_1px_2px_rgba(0,0,0,0.04)] border-b border-gray-100/80"
            : "border-b border-gray-100"
        }`}
      >
        <div className="max-w-7xl mx-auto px-6 lg:px-10 h-16 md:h-[72px] flex items-center">
          {/* Logo — icon mark + HTML wordmark.
              The stacked logo.png (1024×1024) renders its text at ~5 px at
              standard header heights; a horizontal lockup is needed here. */}
          <Link
            href="/"
            aria-label="Happy Hour Compass — Home"
            className="flex-shrink-0 mr-auto flex items-center gap-2.5"
          >
            <Image
              src="/hhc-icon.png"
              alt=""
              width={271}
              height={345}
              className="h-9 w-auto flex-shrink-0"
              priority
            />
            <span className="whitespace-nowrap text-[15px] font-bold tracking-tight text-gray-900">
              Happy Hour{" "}
              <span className="text-amber-500">Compass</span>
            </span>
          </Link>

          {/* Desktop nav — centered between logo and Sign In */}
          <nav
            aria-label="Main navigation"
            className="hidden md:flex items-center gap-8 mx-auto"
          >
            {NAV.map((item) => {
              const active = pathname === item.href || pathname.startsWith(item.href + "/");
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`text-sm font-medium transition-colors whitespace-nowrap ${
                    active
                      ? "text-gray-900"
                      : "text-gray-500 hover:text-gray-900"
                  }`}
                  aria-current={active ? "page" : undefined}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          {/* Desktop Sign In — pinned right */}
          <Link
            href="/login"
            className="hidden md:inline-flex items-center ml-auto px-4 py-[7px] border border-gray-200 rounded-full text-sm font-medium text-gray-900 hover:bg-gray-50 transition-colors"
          >
            Sign In
          </Link>

          {/* Mobile menu trigger */}
          <button
            type="button"
            aria-label={menuOpen ? "Close navigation menu" : "Open navigation menu"}
            aria-expanded={menuOpen}
            aria-controls="website-mobile-menu"
            onClick={() => setMenuOpen(!menuOpen)}
            className="md:hidden p-2 -mr-1 text-gray-600 hover:text-gray-900 transition-colors"
          >
            {menuOpen ? (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            ) : (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            )}
          </button>
        </div>
      </header>

      {/* Mobile menu overlay */}
      {menuOpen && (
        <div
          id="website-mobile-menu"
          role="dialog"
          aria-label="Navigation menu"
          aria-modal="true"
          className="fixed inset-0 z-40 md:hidden"
        >
          {/* Tap-outside backdrop */}
          <div
            className="absolute inset-0 bg-black/10 backdrop-blur-[2px]"
            onClick={() => setMenuOpen(false)}
            aria-hidden="true"
          />

          {/* Dropdown panel — anchored below the 64px header */}
          <nav
            aria-label="Mobile navigation"
            className="absolute top-16 inset-x-0 bg-white border-b border-gray-100 shadow-[0_4px_16px_rgba(0,0,0,0.08)]"
          >
            <div className="max-w-7xl mx-auto px-6">
              <ul role="list">
                {NAV.map((item) => {
                  const active = pathname === item.href || pathname.startsWith(item.href + "/");
                  return (
                    <li key={item.href} className="border-b border-gray-100 last:border-0">
                      <Link
                        href={item.href}
                        aria-current={active ? "page" : undefined}
                        className={`flex items-center py-4 text-base font-medium transition-colors ${
                          active ? "text-amber-600" : "text-gray-800 hover:text-amber-600"
                        }`}
                      >
                        {item.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
              <div className="py-5">
                <Link
                  href="/login"
                  className="block w-full text-center py-3 px-6 bg-gray-900 hover:bg-gray-800 text-white text-sm font-semibold rounded-full transition-colors"
                >
                  Sign In
                </Link>
              </div>
            </div>
          </nav>
        </div>
      )}
    </>
  );
}
