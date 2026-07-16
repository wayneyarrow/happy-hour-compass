"use client";

import { useState, useEffect, useRef } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import WebsiteLocationSwitcher from "./WebsiteLocationSwitcher";
import { SavedDropdown } from "./SavedDropdown";
import AccountDropdown from "./AccountDropdown";
import { getSavedCounts } from "@/lib/consumer/savedItems";
import type { CityRecord } from "@/lib/geo/types";
import { AcquisitionModal } from "./acquisition/AcquisitionModal";
import { SuggestVenueModalContent } from "./acquisition/SuggestVenueModalContent";
import { AddVenueModalContent } from "./acquisition/AddVenueModalContent";

export type ConsumerUser = {
  email: string;
  displayName: string | null;
};

type Props = {
  marketId: string;
  marketName: string;
  currentCityName: string;
  cities: CityRecord[];
  consumerUser?: ConsumerUser | null;
};

const HEART_PATH =
  "M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z";

export default function WebsiteHeader({
  marketId,
  marketName,
  currentCityName,
  cities,
  consumerUser,
}: Props) {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [savedOpen, setSavedOpen] = useState(false);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [addVenueOpen, setAddVenueOpen] = useState(false);
  const [savedTotal, setSavedTotal] = useState(0);
  const pathname = usePathname();
  // Refs covering every element that belongs to the saved feature so the
  // single outside-click handler knows what counts as "inside".
  const savedRef = useRef<HTMLDivElement>(null);          // desktop button + dropdown
  const mobileSavedBtnRef = useRef<HTMLButtonElement>(null); // mobile heart button
  const mobileDropdownRef = useRef<HTMLDivElement>(null);    // mobile dropdown wrapper

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Close menus on navigation.
  useEffect(() => {
    setMenuOpen(false);
    setSavedOpen(false);
  }, [pathname]);

  // Single outside-click handler for the saved dropdown.
  // Checks all three areas so clicks on the trigger buttons don't double-fire.
  useEffect(() => {
    if (!savedOpen) return;
    function onDown(e: MouseEvent) {
      const t = e.target as Node;
      if (savedRef.current?.contains(t)) return;
      if (mobileSavedBtnRef.current?.contains(t)) return;
      if (mobileDropdownRef.current?.contains(t)) return;
      setSavedOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [savedOpen]);

  // Lock body scroll when mobile menu is open.
  useEffect(() => {
    document.body.style.overflow = menuOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [menuOpen]);

  // Sync saved count from localStorage, update on any save/unsave event.
  useEffect(() => {
    function refresh() {
      const counts = getSavedCounts();
      setSavedTotal(counts.venues + counts.events + counts.guides);
    }
    refresh();
    window.addEventListener("hhc:savedChanged", refresh);
    return () => window.removeEventListener("hhc:savedChanged", refresh);
  }, []);

  function toggleSaved() {
    setSavedOpen((v) => !v);
    if (menuOpen) setMenuOpen(false);
  }

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
            className="flex-shrink-0 flex items-center mr-3 md:mr-4"
          >
            <Image
              src="/hhc-logo-horizontal-header.png"
              alt="Happy Hour Compass"
              width={747}
              height={247}
              className="h-9 md:h-10 w-auto flex-shrink-0"
              priority
            />
          </Link>

          {/* Region & Location Switcher */}
          <WebsiteLocationSwitcher
            marketId={marketId}
            marketName={marketName}
            currentCityName={currentCityName}
            cities={cities}
          />

          <div className="flex-1" />

          {/* Desktop nav */}
          <nav aria-label="Main navigation" className="hidden md:flex items-center gap-1">
            <button
              type="button"
              onClick={() => setSuggestOpen(true)}
              className="text-sm font-semibold text-gray-600 hover:text-gray-900 px-3 py-[7px] rounded-full hover:bg-gray-50 transition-colors whitespace-nowrap"
            >
              Suggest a Venue
            </button>
            <button
              type="button"
              onClick={() => setAddVenueOpen(true)}
              className="text-sm font-semibold text-gray-600 hover:text-gray-900 px-3 py-[7px] rounded-full hover:bg-gray-50 transition-colors whitespace-nowrap"
            >
              Add Your Venue
            </button>

            {/* Saved button + dropdown */}
            <div className="relative" ref={savedRef}>
              <button
                type="button"
                onClick={toggleSaved}
                aria-expanded={savedOpen}
                aria-haspopup="dialog"
                aria-label={`Saved items${savedTotal > 0 ? `, ${savedTotal} saved` : ""}`}
                className={`flex items-center gap-1.5 px-3 py-[7px] rounded-full text-sm font-semibold transition-colors whitespace-nowrap ${
                  savedOpen
                    ? "bg-gray-100 text-gray-900"
                    : "text-gray-600 hover:text-gray-900 hover:bg-gray-50"
                }`}
              >
                <svg
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                  style={{
                    width: 16,
                    height: 16,
                    fill: savedTotal > 0 ? "#ef4444" : "none",
                    stroke: savedTotal > 0 ? "#ef4444" : "currentColor",
                    strokeWidth: 2,
                    strokeLinecap: "round",
                    strokeLinejoin: "round",
                    transition: "fill 0.15s, stroke 0.15s",
                  }}
                >
                  <path d={HEART_PATH} />
                </svg>
                Saved
                {savedTotal > 0 && (
                  <span className="ml-0.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[11px] font-bold bg-red-500 text-white leading-none">
                    {savedTotal > 99 ? "99+" : savedTotal}
                  </span>
                )}
              </button>

              <SavedDropdown
                open={savedOpen}
                onClose={() => setSavedOpen(false)}
              />
            </div>

            {consumerUser ? (
              <AccountDropdown
                displayName={consumerUser.displayName}
                email={consumerUser.email}
              />
            ) : (
              <Link
                href="/sign-in"
                className="ml-2 inline-flex items-center px-4 py-[7px] border border-gray-200 rounded-full text-sm font-semibold text-gray-900 hover:bg-gray-50 transition-colors whitespace-nowrap"
              >
                Sign In
              </Link>
            )}
          </nav>

          {/* Mobile — saved icon + hamburger */}
          <div className="md:hidden flex items-center gap-1">
            {/* Compact saved icon for mobile header */}
            <button
              ref={mobileSavedBtnRef}
              type="button"
              onClick={toggleSaved}
              aria-expanded={savedOpen}
              aria-haspopup="dialog"
              aria-label={`Saved items${savedTotal > 0 ? `, ${savedTotal} saved` : ""}`}
              className="relative p-2 text-gray-600 hover:text-gray-900 transition-colors"
            >
              <svg
                viewBox="0 0 24 24"
                aria-hidden="true"
                style={{
                  width: 20,
                  height: 20,
                  fill: savedTotal > 0 ? "#ef4444" : "none",
                  stroke: savedTotal > 0 ? "#ef4444" : "currentColor",
                  strokeWidth: 2,
                  strokeLinecap: "round",
                  strokeLinejoin: "round",
                }}
              >
                <path d={HEART_PATH} />
              </svg>
              {savedTotal > 0 && (
                <span
                  className="absolute top-0.5 right-0.5 inline-flex items-center justify-center w-4 h-4 rounded-full text-[9px] font-bold bg-red-500 text-white leading-none"
                  aria-hidden="true"
                >
                  {savedTotal > 9 ? "9+" : savedTotal}
                </span>
              )}
            </button>

            <button
              type="button"
              aria-label={menuOpen ? "Close navigation menu" : "Open navigation menu"}
              aria-expanded={menuOpen}
              aria-controls="website-mobile-menu"
              onClick={() => setMenuOpen(!menuOpen)}
              className="p-2 -mr-1 text-gray-600 hover:text-gray-900 transition-colors"
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
        </div>

        {/* Mobile saved dropdown — anchored to header bottom, full-width */}
        {savedOpen && (
          <div ref={mobileDropdownRef} className="md:hidden absolute left-0 right-0 top-full z-50 px-4 pb-2">
            <SavedDropdown
              open={savedOpen}
              onClose={() => setSavedOpen(false)}
            />
          </div>
        )}
      </header>

      {/* Acquisition modals — portaled to document.body via AcquisitionModal */}
      <AcquisitionModal
        open={suggestOpen}
        onClose={() => setSuggestOpen(false)}
        title="Suggest a Venue"
        description="Know a great happy hour? Tell us about it and we'll look into adding it to the directory."
      >
        <SuggestVenueModalContent onDone={() => setSuggestOpen(false)} />
      </AcquisitionModal>

      <AcquisitionModal
        open={addVenueOpen}
        onClose={() => setAddVenueOpen(false)}
        title="Add Your Venue"
        description="List your restaurant or bar on Happy Hour Compass and reach people looking for great happy hours."
      >
        <AddVenueModalContent onDone={() => setAddVenueOpen(false)} />
      </AcquisitionModal>

      {/* Mobile menu overlay */}
      {menuOpen && (
        <div
          id="website-mobile-menu"
          role="dialog"
          aria-label="Navigation menu"
          aria-modal="true"
          className="fixed inset-0 z-40 md:hidden"
        >
          <div
            className="absolute inset-0 bg-black/10 backdrop-blur-[2px]"
            onClick={() => setMenuOpen(false)}
            aria-hidden="true"
          />

          <nav
            aria-label="Mobile navigation"
            className="absolute top-16 inset-x-0 bg-white border-b border-gray-100 shadow-[0_4px_16px_rgba(0,0,0,0.08)]"
          >
            <div className="max-w-7xl mx-auto px-6">
              <ul role="list">
                <li className="border-b border-gray-100">
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      setSuggestOpen(true);
                    }}
                    className="w-full text-left flex items-center py-4 text-base font-medium text-gray-800 hover:text-amber-600 transition-colors"
                  >
                    Suggest a Venue
                  </button>
                </li>
                <li className="border-b border-gray-100">
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      setAddVenueOpen(true);
                    }}
                    className="w-full text-left flex items-center py-4 text-base font-medium text-gray-800 hover:text-amber-600 transition-colors"
                  >
                    Add Your Venue
                  </button>
                </li>
                <li className="border-b border-gray-100">
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      setSavedOpen(true);
                    }}
                    className="w-full flex items-center justify-between py-4 text-base font-medium text-gray-800 hover:text-amber-600 transition-colors"
                  >
                    <span className="flex items-center gap-2">
                      <svg
                        viewBox="0 0 24 24"
                        aria-hidden="true"
                        style={{
                          width: 18,
                          height: 18,
                          fill: savedTotal > 0 ? "#ef4444" : "none",
                          stroke: savedTotal > 0 ? "#ef4444" : "currentColor",
                          strokeWidth: 2,
                          strokeLinecap: "round",
                          strokeLinejoin: "round",
                        }}
                      >
                        <path d={HEART_PATH} />
                      </svg>
                      Saved
                    </span>
                    {savedTotal > 0 && (
                      <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-[11px] font-bold bg-red-500 text-white leading-none">
                        {savedTotal > 99 ? "99+" : savedTotal}
                      </span>
                    )}
                  </button>
                </li>
              </ul>
              {consumerUser ? (
                <div className="py-5 space-y-2">
                  <Link
                    href="/account"
                    className="block w-full text-center py-3 px-6 bg-gray-900 hover:bg-gray-800 text-white text-sm font-semibold rounded-full transition-colors"
                    onClick={() => setMenuOpen(false)}
                  >
                    My Account
                  </Link>
                  <button
                    type="button"
                    onClick={async () => {
                      setMenuOpen(false);
                      const { createClient } = await import("@/lib/supabase/browser");
                      await createClient().auth.signOut();
                      window.location.href = "/";
                    }}
                    className="block w-full text-center py-3 px-6 border border-gray-200 text-gray-700 text-sm font-semibold rounded-full transition-colors hover:bg-gray-50"
                  >
                    Sign Out
                  </button>
                </div>
              ) : (
                <div className="py-5">
                  <Link
                    href="/sign-in"
                    className="block w-full text-center py-3 px-6 bg-gray-900 hover:bg-gray-800 text-white text-sm font-semibold rounded-full transition-colors"
                  >
                    Sign In
                  </Link>
                </div>
              )}
            </div>
          </nav>
        </div>
      )}
    </>
  );
}
