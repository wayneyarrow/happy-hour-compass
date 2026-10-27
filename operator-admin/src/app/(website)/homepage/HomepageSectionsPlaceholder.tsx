import Link from "next/link";

/**
 * Shown beneath the hero while the homepage's editorial Sections are still
 * resolving ((website)/page.tsx streams the header and hero first). Shaped
 * like the first Collection rail (same section padding, heading row and
 * 300px cards with a 200px image) so the real rail replaces it in place,
 * and tall enough (min-h, about two rails) that the footer never shows
 * through and then jumps down. Deliberately static — no shimmer/pulse — so
 * it reads as quiet space, not a loading screen.
 *
 * Without JavaScript the streamed Sections never move into place, so the
 * <noscript> part hides the empty card shapes (and their reserved height)
 * and links to the listing pages instead (each renders its full content
 * without JavaScript).
 */
export function HomepageSectionsPlaceholder() {
  return (
    <div data-homepage-sections-placeholder aria-busy="true" className="min-h-[1200px]">
      <span className="sr-only">Loading happy hours and events</span>
      <noscript>
        <style>{"[data-homepage-sections-skeleton]{display:none}[data-homepage-sections-placeholder]{min-height:0}"}</style>
        <section className="py-10 md:py-12 border-t border-gray-100">
          <p className="max-w-7xl mx-auto px-6 lg:px-10 text-lg text-gray-600">
            Browse{" "}
            <Link href="/website-happy-hours" className="font-semibold text-amber-600 hover:text-amber-700">happy hours</Link>,{" "}
            <Link href="/website-daily-specials" className="font-semibold text-amber-600 hover:text-amber-700">daily specials</Link> and{" "}
            <Link href="/website-events" className="font-semibold text-amber-600 hover:text-amber-700">events</Link>.
          </p>
        </section>
      </noscript>
      <section data-homepage-sections-skeleton aria-hidden="true" className="py-10 md:py-12 border-t border-gray-100">
        <div className="max-w-7xl mx-auto px-6 lg:px-10 mb-6">
          <div className="h-8 md:h-9 w-64 max-w-[70%] rounded-md bg-gray-100" />
        </div>
        <div className="max-w-7xl mx-auto px-6 lg:px-10 overflow-hidden">
          <div className="flex gap-5 pb-2">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="w-[300px] shrink-0">
                <div className="h-[200px] rounded-xl bg-gray-100" />
                <div className="mt-4 h-5 w-3/4 rounded bg-gray-100" />
                <div className="mt-2 h-4 w-1/2 rounded bg-gray-100" />
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
