import type { Metadata } from "next";
import Link from "next/link";
import { getAllMarkets } from "@/lib/geo/geography";
import { getMerchandisableGuides } from "@/lib/data/contentGuideDistribution";
import {
  DISTRIBUTION_CHANNELS,
  getChannelDisplayLabel,
  isDistributionChannelKey,
  type DistributionChannelKey,
} from "@/lib/data/contentGuideDistributionShared";
import { GuidePlacementRow } from "./GuidePlacementRow";

export const metadata: Metadata = { title: "Guides — Discover Management" };
export const dynamic = "force-dynamic";

/**
 * Discover Management → Guides merchandising (Card 6B, Part 2 + Part 3).
 *
 * Deliberately a separate page/route from ../page.tsx (the existing
 * venue/event rail management) rather than a new RailTabs tab — guides are
 * eligibility-gated (Content Engine decides the candidate pool) and
 * market-scoped by a real FK, not a geo-radius algorithm, so the
 * interaction model here (market selector, channel selector, add/remove
 * eligible guides) is genuinely different from the existing rail UI. This
 * keeps that existing implementation completely untouched, per the card's
 * "do not refactor" guardrail — the only change to it is a one-line link
 * added in ../page.tsx pointing here.
 *
 * No guide content editing happens on this page — only merchandising
 * (active/inactive, ordering, channel membership). Editing a guide's own
 * content/eligibility always happens in Content Engine.
 */

type Props = {
  searchParams: Promise<{ market?: string; channel?: string }>;
};

export default async function DiscoverGuidesPage({ searchParams }: Props) {
  const { market: marketSlugParam, channel: channelParam } = await searchParams;

  const markets = await getAllMarkets();
  const selectedMarket =
    markets.find((m) => m.slug === marketSlugParam) ?? markets[0] ?? null;
  const channel: DistributionChannelKey = isDistributionChannelKey(channelParam ?? "")
    ? (channelParam as DistributionChannelKey)
    : "guides_library";

  const guides = selectedMarket
    ? await getMerchandisableGuides(channel, selectedMarket.id)
    : [];

  const merchandisedGuideIds = guides.filter((g) => g.isMerchandised).map((g) => g.guideId);

  return (
    <div className="max-w-4xl">
      {/* Header */}
      <div className="mb-6">
        <Link
          href="/control-panel/discover"
          className="text-xs text-gray-400 hover:text-gray-600 transition-colors mb-3 inline-block"
        >
          ← Discover Management
        </Link>
        <h1 className="text-2xl font-bold text-slate-900">Guides Merchandising</h1>
        <p className="mt-1 text-sm text-gray-500">
          Content Engine decides which guides are eligible for each channel. This page only
          controls what&apos;s actually shown, its order, and whether it&apos;s active.
        </p>
      </div>

      {!selectedMarket ? (
        <p className="text-sm text-gray-400">No markets are configured yet.</p>
      ) : (
        <>
          {/* Market selector — Card 6B Part 3: explicit market awareness for
              guide merchandising only. The existing venue/event rails below
              this page are untouched and remain single-market. */}
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">
            Market
          </div>
          <div className="flex flex-wrap gap-1.5 mb-5">
            {markets.map((m) => {
              const isActive = m.id === selectedMarket.id;
              return (
                <Link
                  key={m.id}
                  href={`/control-panel/discover/guides?market=${m.slug}&channel=${channel}`}
                  className={`px-3.5 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    isActive
                      ? "bg-amber-100 text-amber-800 border border-amber-300"
                      : "bg-white text-gray-600 border border-gray-200 hover:border-amber-200 hover:text-amber-700"
                  }`}
                >
                  {m.name}
                  {m.status === "coming_soon" && (
                    <span className="ml-1.5 text-xs font-normal text-gray-400">Soon</span>
                  )}
                </Link>
              );
            })}
          </div>

          {/* Channel selector */}
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">
            Channel
          </div>
          <div className="flex flex-wrap gap-1.5 mb-6">
            {DISTRIBUTION_CHANNELS.map((key) => {
              const isActive = key === channel;
              return (
                <Link
                  key={key}
                  href={`/control-panel/discover/guides?market=${selectedMarket.slug}&channel=${key}`}
                  className={`px-3.5 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    isActive
                      ? "bg-amber-100 text-amber-800 border border-amber-300"
                      : "bg-white text-gray-600 border border-gray-200 hover:border-amber-200 hover:text-amber-700"
                  }`}
                >
                  {getChannelDisplayLabel(key, selectedMarket.name)}
                </Link>
              );
            })}
          </div>

          {/* Rail header */}
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="text-base font-semibold text-slate-800">
                {getChannelDisplayLabel(channel, selectedMarket.name)}
              </h2>
              <p className="text-xs text-gray-400 mt-0.5">
                {merchandisedGuideIds.length} guide{merchandisedGuideIds.length !== 1 ? "s" : ""}{" "}
                currently merchandised in {selectedMarket.name}
              </p>
            </div>
          </div>

          {/* Guide list */}
          <div className="bg-white rounded-xl border border-gray-200">
            {guides.length === 0 ? (
              <p className="px-4 py-6 text-sm text-gray-400 text-center">
                No guides in {selectedMarket.name} are eligible for this channel yet. Mark a
                guide eligible from its Distribution section in Content Engine first.
              </p>
            ) : (
              guides.map((g) => {
                const merchandisedIndex = merchandisedGuideIds.indexOf(g.guideId);
                return (
                  <GuidePlacementRow
                    key={g.guideId}
                    guide={g}
                    channelKey={channel}
                    marketId={selectedMarket.id}
                    canMoveUp={merchandisedIndex > 0}
                    canMoveDown={
                      merchandisedIndex !== -1 &&
                      merchandisedIndex < merchandisedGuideIds.length - 1
                    }
                  />
                );
              })
            )}
          </div>
        </>
      )}
    </div>
  );
}
