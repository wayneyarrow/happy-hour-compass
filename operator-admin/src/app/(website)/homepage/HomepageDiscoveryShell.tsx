import type { ReactNode } from "react";
import WebsiteHeader from "@/app/(website)/WebsiteHeader";
import HeroSection from "@/app/(website)/HeroSection";
import type { Market } from "@/lib/markets";
import type { CityRecord } from "@/lib/geo/types";

/**
 * The Homepage's static Discovery Shell — public Website header + existing
 * Hero (headline, Happy Hours/Events toggle, primary CTA, search pill).
 * Never configurable (per docs/website/HOMEPAGE_COLLECTIONS_PRODUCT_SPEC.md
 * and the Build Homepage Preview task) — this simply composes the two
 * existing, unmodified website components so the Control Panel preview
 * route and any future public Homepage route render an identical shell
 * without duplicating the composition.
 *
 * isPersisted is always passed as `true` to HeroSection so its geolocation
 * auto-detect effect never fires — the Discovery Shell must reflect the
 * Homepage's OWN saved geography, never the viewer's browser location.
 *
 * `banner` is an optional slot rendered directly above WebsiteHeader, inside
 * the SAME sticky wrapper — this is how the Control Panel preview route
 * stacks its preview-only banner above the sticky Website header without
 * overlap, without modifying WebsiteHeader's own `sticky top-0` (it stays
 * unmodified and reusable everywhere else). Once the wrapper is stuck at the
 * top of the scrolling ancestor, WebsiteHeader's own sticky rule never needs
 * to fire — its position relative to the wrapper is already fixed. Omitted
 * (renders nothing extra) for any future public Homepage route, which has no
 * banner to show.
 *
 * `stickyTopClassName` overrides the wrapper's `top` value — defaults to
 * `top-0`, correct for any ordinary scroll container. The Control Panel
 * preview route overrides this to a NEGATIVE offset (see that route's own
 * comment) because its scroll container (control-panel/layout.tsx's <main>)
 * has its own `p-6 md:p-8` padding, which the preview page cancels visually
 * with a matching negative margin — but position:sticky's `top` is always
 * measured from that ancestor's PADDING edge, not its border edge, so a
 * plain `top-0` would leave a gap exactly equal to that padding once
 * scrolled (empirically confirmed: a nested sticky rule, like
 * WebsiteHeader's own `sticky top-0`, does NOT contribute to this gap — it
 * stays flush against whatever is above it — so this prop is the ONLY thing
 * that needs adjusting).
 */

type Props = {
  market: Market;
  cityName: string;
  cities: CityRecord[];
  banner?: ReactNode;
  stickyTopClassName?: string;
};

export function HomepageDiscoveryShell({ market, cityName, cities, banner, stickyTopClassName = "top-0" }: Props) {
  return (
    <>
      <div className={`sticky ${stickyTopClassName} z-[60]`}>
        {banner}
        <WebsiteHeader marketId={market.id} marketName={market.name} currentCityName={cityName} cities={cities} />
      </div>
      <HeroSection market={market} cityName={cityName} isPersisted />
    </>
  );
}
