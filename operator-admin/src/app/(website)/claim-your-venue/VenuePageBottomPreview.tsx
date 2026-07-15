import { ClaimVenueCTA } from "@/app/(website)/[market]/venue/[slug]/ClaimVenueCTA";

/**
 * Step 2 visual — "the bottom of a venue page with the Claim This Venue
 * button visible/highlighted."
 *
 * No screenshot-capture tool was available to produce a literal PNG of a
 * running venue page, so this renders the actual bottom-of-page content
 * instead: the real "Last updated" line (same markup as
 * [market]/venue/[slug]/page.tsx) and the real, unmodified ClaimVenueCTA
 * component imported from the venue detail page. That makes this preview
 * pixel-identical to production and unable to go stale — a real screenshot
 * would need re-capturing after every future redesign of that CTA, this
 * doesn't. The wrapper is pointer-events-none so this marketing page can't
 * be used to actually start a claim for the placeholder venue name below;
 * the real flow still requires visiting an actual venue's page.
 *
 * If a literal captured screenshot is preferred instead, drop a PNG into
 * /public/images/claim-your-venue/ and swap this component out in
 * content.tsx — same swap pattern BrowserMockFrame uses elsewhere.
 */
export function VenuePageBottomPreview() {
  const today = new Date().toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  return (
    <div className="rounded-2xl border border-gray-200 bg-white shadow-[0_24px_64px_rgba(0,0,0,0.10),0_4px_16px_rgba(0,0,0,0.06)] overflow-hidden">
      {/* Browser chrome bar — same treatment as BrowserMockFrame */}
      <div className="flex items-center gap-1.5 px-4 py-3 border-b border-gray-100 bg-gray-50" aria-hidden="true">
        <span className="w-2.5 h-2.5 rounded-full bg-gray-300" />
        <span className="w-2.5 h-2.5 rounded-full bg-gray-300" />
        <span className="w-2.5 h-2.5 rounded-full bg-gray-300" />
      </div>

      <div className="relative px-5 pt-8 pb-7 md:px-8 md:pb-8">
        {/* Fade at the top implies scrolled-past content above */}
        <div
          className="absolute inset-x-0 top-0 h-10 bg-gradient-to-b from-white to-transparent"
          aria-hidden="true"
        />

        <p className="text-xs text-gray-400 mb-5">Last updated {today}</p>

        <div
          className="pointer-events-none select-none rounded-2xl ring-4 ring-amber-300/70 ring-offset-4 ring-offset-white"
          aria-hidden="true"
        >
          <ClaimVenueCTA venueRouteParam="preview" venueName="The Keg Steakhouse" />
        </div>

        <p className="mt-4 text-center text-xs font-semibold text-amber-700">
          This is the button you&rsquo;ll click
        </p>
      </div>
    </div>
  );
}
