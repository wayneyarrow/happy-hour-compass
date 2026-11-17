"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { getDiscoveryDestination } from "@/lib/homepageDiscoveryModes";
import { getPageMarketIdForPath } from "@/lib/marketHomepage";

/**
 * Fallback route into the site's content when the homepage's editorial
 * Sections can't be shown (no JavaScript, a stalled or interrupted stream,
 * or a shared Section failure). Each linked listing page renders its full
 * content without JavaScript.
 *
 * Links go to the homepage's own market listings ("/" → /central-okanagan/…,
 * "/greater-san-diego" → /greater-san-diego/…), worked out from the URL so
 * the placeholder and error boundary need no market prop. Rendered on the
 * server too, so the no-JavaScript fallback gets the same links.
 */
export function HomepageBrowseLinks() {
  const marketId = getPageMarketIdForPath(usePathname());
  return (
    <p className="max-w-7xl mx-auto px-6 lg:px-10 text-lg text-gray-600">
      Browse{" "}
      <Link href={getDiscoveryDestination("happy_hours", marketId)} className="font-semibold text-amber-600 hover:text-amber-700">happy hours</Link>,{" "}
      <Link href={getDiscoveryDestination("daily_specials", marketId)} className="font-semibold text-amber-600 hover:text-amber-700">daily specials</Link> and{" "}
      <Link href={getDiscoveryDestination("events", marketId)} className="font-semibold text-amber-600 hover:text-amber-700">events</Link>.
    </p>
  );
}
