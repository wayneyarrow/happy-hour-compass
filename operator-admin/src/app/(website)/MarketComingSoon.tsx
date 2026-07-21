import Link from "next/link";
import { getDefaultMarket } from "@/lib/markets";

type Props = {
  marketName: string;
};

/**
 * Shared branded "Coming Soon" experience for every public website route
 * that resolves a URL to a market whose status isn't "active" (see
 * src/lib/markets.ts) — venue, event, collection, and guide pages all
 * render this in place of the underlying content rather than each building
 * their own version. The page itself still returns a normal 200 response
 * (never notFound()) so this branded UI is what visitors and crawlers
 * alike actually see; each caller's generateMetadata() pairs this with
 * buildComingSoonMetadata() (src/lib/seo/metadata.ts) for an explicit
 * noindex, so the page is never indexed despite the 200.
 */
export function MarketComingSoon({ marketName }: Props) {
  const activeMarket = getDefaultMarket();

  return (
    <div className="max-w-2xl mx-auto px-6 py-24 text-center">
      <p className="text-amber-500 text-sm font-semibold uppercase tracking-widest mb-4">
        Coming Soon
      </p>
      <h1 className="text-3xl md:text-4xl font-bold text-gray-900 tracking-tight mb-6">
        {marketName} is Coming Soon
      </h1>
      <p className="text-base text-gray-600 leading-relaxed mb-3">
        Happy Hour Compass is launching first in the {activeMarket.name}.
      </p>
      <p className="text-base text-gray-600 leading-relaxed mb-3">
        {marketName} is on our roadmap and will be available in the future.
      </p>
      <p className="text-base text-gray-600 leading-relaxed mb-8">
        In the meantime, explore venues in the {activeMarket.name}.
      </p>
      <Link
        href="/website-happy-hours"
        className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-gray-900 text-white text-sm font-semibold hover:bg-gray-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-2"
      >
        Explore {activeMarket.name}
      </Link>
    </div>
  );
}
