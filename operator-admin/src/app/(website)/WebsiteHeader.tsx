"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import WebsiteLocationSwitcher from "./WebsiteLocationSwitcher";
import type { CityRecord } from "@/lib/geo/types";

type Props = {
  marketId: string;
  marketName: string;
  currentCityName: string;
  cities: CityRecord[];
};

export default function WebsiteHeader({
  marketId,
  marketName,
  currentCityName,
  cities,
}: Props) {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

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
        <div className="max-w-7xl mx-auto px-6 lg:px-10 h-16 md:h-[72px] flex items-center gap-3">
          {/* Logo */}
          <Link
            href="/"
            aria-label="Happy Hour Compass — Home"
            className="flex-shrink-0 flex items-center gap-2.5 mr-1"
          >
            <Image
              src="/hhc-icon.png"
              alt=""
              width={271}
              height={345}
              className="h-9 w-auto flex-shrink-0"
              priority
            />
            {/* Wordmark hidden on mobile to prevent header overflow when
                logo + location switcher + hamburger compete for narrow space. */}
            <span className="hidden sm:inline whitespace-nowrap text-[15px] font-bold tracking-tight text-gray-900">
              Happy Hour{" "}
              <span className="text-amber-500">Compass</span>
            </span>
          </Link>

          {/* Region & Location Switcher — always visible on all breakpoints */}
          <WebsiteLocationSwitcher
            marketId={marketId}
            marketName={marketName}
            currentCityName={currentCityName}
            cities={cities}
          />

          {/* Push right-side items to the end */}
          <div className="flex-1" />

          {/* Desktop — secondary CTAs + Sign In */}
          <nav aria-label="Main navigation" className="hidden md:flex items-center gap-1">
            <Link
              href="/suggest/customer"
              className="text-sm font-medium text-gray-600 hover:text-gray-900 px-3 py-[7px] rounded-full hover:bg-gray-50 transition-colors whitespace-nowrap"
            >
              Suggest a Venue
            </Link>
            <Link
              href="/suggest/owner"
              className="text-sm font-medium text-gray-600 hover:text-gray-900 px-3 py-[7px] rounded-full hover:bg-gray-50 transition-colors whitespace-nowrap"
            >
              Claim / Add Your Venue
            </Link>
            <Link
              href="/login"
              className="ml-2 inline-flex items-center px-4 py-[7px] border border-gray-200 rounded-full text-sm font-medium text-gray-900 hover:bg-gray-50 transition-colors whitespace-nowrap"
            >
              Sign In
            </Link>
          </nav>

          {/* Mobile — hamburger trigger */}
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
                <li className="border-b border-gray-100">
                  <Link
                    href="/suggest/customer"
                    className="flex items-center py-4 text-base font-medium text-gray-800 hover:text-amber-600 transition-colors"
                  >
                    Suggest a Venue
                  </Link>
                </li>
                <li className="border-b border-gray-100">
                  <Link
                    href="/suggest/owner"
                    className="flex items-center py-4 text-base font-medium text-gray-800 hover:text-amber-600 transition-colors"
                  >
                    Claim / Add Your Venue
                  </Link>
                </li>
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
