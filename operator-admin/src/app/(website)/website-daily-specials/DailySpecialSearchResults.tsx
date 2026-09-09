"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import type { Market } from "@/lib/markets";
import type { WebsiteDailySpecialListItem } from "@/lib/data/dailySpecials";
import { OFFER_TYPES, OFFER_TYPE_LABELS, type OfferType } from "@/lib/dailySpecialTypes";
import {
  dailySpecialMatchesSearch,
  dailySpecialMatchesWhenFilter,
  type WhenFilter,
} from "@/lib/dailySpecialSchedule";
import { DailySpecialSearchCard } from "./DailySpecialSearchCard";
import { MarketModal } from "@/app/(consumer)/MarketModal";

// ── WHEN options ─────────────────────────────────────────────────────────────
// Weekday values are the URL-param spelling; WhenFilter's internal 0-6
// indexing (0=Sunday..6=Saturday) matches Date.getDay() / the Phase 1
// convention already established for Daily Specials scheduling.
const WHEN_OPTIONS: { param: string; label: string; value: WhenFilter }[] = [
  { param: "today", label: "Today", value: "today" },
  { param: "monday", label: "Monday", value: 1 },
  { param: "tuesday", label: "Tuesday", value: 2 },
  { param: "wednesday", label: "Wednesday", value: 3 },
  { param: "thursday", label: "Thursday", value: 4 },
  { param: "friday", label: "Friday", value: 5 },
  { param: "saturday", label: "Saturday", value: 6 },
  { param: "sunday", label: "Sunday", value: 0 },
];

const TYPE_OPTIONS: { param: string; label: string; value: OfferType | null }[] = [
  { param: "all", label: "All", value: null },
  ...OFFER_TYPES.map((t) => ({ param: t, label: OFFER_TYPE_LABELS[t], value: t })),
];

// Matches the debounce already established for the Happy Hours ?q= sync
// and the Events ?date=/?type= sync (EventSearchResults.tsx) — filtering
// itself stays instant/client-side, only the URL write is debounced.
const FILTER_URL_SYNC_DEBOUNCE_MS = 200;

/** "YYYY-MM-DD" for the viewer's browser-local today. See this file's header comment on the market-timezone limitation. */
function todayIsoLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

type Props = {
  dailySpecials: WebsiteDailySpecialListItem[];
  market: Market;
  /** When provided, enables the ?when=/?type=/?q= URL sync and mount-time restore. Off by default, mirroring EventSearchResults' enableFilterSync — only website-daily-specials/page.tsx opts in. */
  enableFilterSync?: boolean;
};

/**
 * "Today" is computed from the viewer's BROWSER-local clock (`new Date()`),
 * exactly matching the existing Events search page's todayLocal() —
 * neither `markets.ts` nor `activeMarket.ts` carries any timezone concept
 * today (confirmed during Phase 3 investigation), so there is no
 * market-local calendar to compute against. Since HHC currently serves a
 * single active market (Central Okanagan, Pacific time) and the existing
 * Events page already relies on this same browser-local convention with no
 * reported issues, this is the safest current-architecture choice rather
 * than introducing a new timezone system for one filter. Revisit if/when a
 * genuine multi-timezone market ships.
 */
export function DailySpecialSearchResults({ dailySpecials, market, enableFilterSync = false }: Props) {
  const pathname = usePathname();
  const todayIso = todayIsoLocal();

  const [whenFilter, setWhenFilter] = useState<{ param: string; value: WhenFilter } | null>(null);
  const [typeFilter, setTypeFilter] = useState<OfferType | null>(null);
  const [query, setQuery] = useState("");
  const [marketModalOpen, setMarketModalOpen] = useState(false);

  function toggleWhen(option: (typeof WHEN_OPTIONS)[number]) {
    setWhenFilter((cur) => (cur?.param === option.param ? null : { param: option.param, value: option.value }));
  }

  // ── URL sync (mirrors EventSearchResults.tsx's history.replaceState pattern) ──
  useEffect(() => {
    if (!enableFilterSync) return;
    const timer = setTimeout(() => {
      const parts: string[] = [];
      if (whenFilter) parts.push(`when=${whenFilter.param}`);
      if (typeFilter) parts.push(`type=${encodeURIComponent(typeFilter)}`);
      if (query.trim()) parts.push(`q=${encodeURIComponent(query.trim())}`);
      const url = parts.length > 0 ? `${pathname}?${parts.join("&")}` : pathname;
      window.history.replaceState(null, "", url);
    }, FILTER_URL_SYNC_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [enableFilterSync, whenFilter, typeFilter, query, pathname]);

  // Restore filter state from the live address bar once, on mount — same
  // rationale as EventSearchResults.tsx's matching effect (Next.js Router
  // Cache can remount this component from a pre-filter render).
  useEffect(() => {
    if (!enableFilterSync) return;
    const params = new URLSearchParams(window.location.search);
    const whenParam = params.get("when");
    const typeParam = params.get("type");
    const qParam = params.get("q");

    const matchedWhen = WHEN_OPTIONS.find((o) => o.param === whenParam);
    if (matchedWhen) setWhenFilter({ param: matchedWhen.param, value: matchedWhen.value });

    if (typeParam && (OFFER_TYPES as readonly string[]).includes(typeParam)) {
      setTypeFilter(typeParam as OfferType);
    }

    if (qParam) setQuery(qParam);
  }, [enableFilterSync]);

  // ── Filter pipeline ──────────────────────────────────────────────────────
  const filtered = useMemo(
    () =>
      dailySpecials
        .filter((s) => dailySpecialMatchesWhenFilter(s.schedule, whenFilter?.value ?? null, todayIso))
        .filter((s) => !typeFilter || s.offerType === typeFilter)
        .filter((s) =>
          dailySpecialMatchesSearch(
            { title: s.title, shortSummary: s.shortSummary, description: s.description },
            query
          )
        ),
    [dailySpecials, whenFilter, typeFilter, query, todayIso]
  );

  const hasFilters = !!whenFilter || !!typeFilter || !!query.trim();

  const emptyMessage = (() => {
    const typeLabel = typeFilter ? OFFER_TYPE_LABELS[typeFilter] : null;
    const whenLabel = whenFilter?.value === "today" ? "today" : whenFilter ? whenFilter.param[0].toUpperCase() + whenFilter.param.slice(1) : null;

    if (query.trim()) return "No Daily Specials match your search.";
    if (typeLabel && whenLabel) return `No ${typeLabel} Daily Specials found for ${whenLabel}.`;
    if (whenLabel) return `No Daily Specials found for ${whenLabel}.`;
    if (typeLabel) return `No ${typeLabel} Daily Specials found.`;
    return "No Daily Specials found.";
  })();

  return (
    <div className="max-w-7xl mx-auto px-6 lg:px-10 py-8">
      {/* ── Header ───────────────────────────────────────────────────────── */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 tracking-tight leading-tight">Daily Specials</h1>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setMarketModalOpen(true)}
            aria-label={`Currently browsing ${market.name}. Tap to change market.`}
            className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-full shadow-sm hover:shadow-md hover:border-gray-300 text-sm font-medium text-gray-700 transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-2"
          >
            <span>{market.name}</span>
          </button>
          <span className="text-xs text-gray-400">
            {filtered.length === 1 ? "1 Daily Special" : `${filtered.length} Daily Specials`}
          </span>
        </div>
      </div>

      {/* ── Search ───────────────────────────────────────────────────────── */}
      <div className="mb-4">
        <label htmlFor="daily-specials-search" className="sr-only">
          Search Daily Specials
        </label>
        <input
          id="daily-specials-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search wings, tacos, wine…"
          className="w-full sm:max-w-sm px-4 py-2.5 border border-gray-200 rounded-full text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent"
        />
      </div>

      {/* ── WHEN filter ──────────────────────────────────────────────────── */}
      <div className="mb-3" role="group" aria-label="Filter by day">
        <div className="flex flex-wrap gap-1.5">
          {WHEN_OPTIONS.map((option) => (
            <button
              key={option.param}
              type="button"
              onClick={() => toggleWhen(option)}
              aria-pressed={whenFilter?.param === option.param}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                whenFilter?.param === option.param
                  ? "bg-amber-500 text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── TYPE filter ──────────────────────────────────────────────────── */}
      <div className="mb-6" role="group" aria-label="Filter by type">
        <div className="flex flex-wrap gap-1.5">
          {TYPE_OPTIONS.map((option) => (
            <button
              key={option.param}
              type="button"
              onClick={() => setTypeFilter(option.value)}
              aria-pressed={typeFilter === option.value}
              className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                typeFilter === option.value
                  ? "bg-gray-900 text-white border-gray-900"
                  : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Results ──────────────────────────────────────────────────────── */}
      {filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 px-6 py-16 text-center">
          <p className="text-sm font-medium text-gray-600">{emptyMessage}</p>
          {hasFilters && (
            <button
              type="button"
              onClick={() => {
                setWhenFilter(null);
                setTypeFilter(null);
                setQuery("");
              }}
              className="mt-3 text-sm text-amber-600 hover:text-amber-700 font-medium"
            >
              Clear filters
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {filtered.map((special) => (
            <DailySpecialSearchCard key={special.id} special={special} />
          ))}
        </div>
      )}

      {marketModalOpen && (
        <MarketModal activeMarketId={market.id} onClose={() => setMarketModalOpen(false)} />
      )}
    </div>
  );
}
