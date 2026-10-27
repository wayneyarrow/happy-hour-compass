import { HomepageBrowseLinks } from "./HomepageBrowseLinks";

/**
 * How long after the placeholder first renders it gives way to the
 * browse links. Normal loads replace the placeholder long before this
 * (Production homepage renders: p95 ≈ 5 s of server time), so visitors only
 * see the links when Sections are genuinely stuck.
 */
const FALLBACK_DELAY = "10s";

/**
 * Pure CSS, so it works whether or not any script runs:
 * - after FALLBACK_DELAY the empty card shapes hide, their reserved height
 *   collapses and the browse links appear in their place (a zero-duration
 *   step, not motion — unaffected by reduced-motion settings);
 * - without JavaScript (<noscript>) that happens immediately, since the
 *   streamed Sections can never move into place.
 * React removes the whole placeholder when the Sections arrive, which ends
 * both.
 */
const FALLBACK_CSS =
  "@keyframes hhc-sections-fallback-hide{to{visibility:hidden;height:0;overflow:hidden}}" +
  "@keyframes hhc-sections-fallback-show{to{visibility:visible;position:static}}" +
  "@keyframes hhc-sections-fallback-collapse{to{min-height:0}}" +
  // Plain concatenation, not template literals: the production minifier
  // folded `...${delay}s forwards}` + `...` incorrectly (dropped "s forwards}").
  "[data-homepage-sections-placeholder]{animation:hhc-sections-fallback-collapse 0s " + FALLBACK_DELAY + " forwards}" +
  "[data-homepage-sections-skeleton]{animation:hhc-sections-fallback-hide 0s " + FALLBACK_DELAY + " forwards}" +
  "[data-homepage-sections-fallback]{visibility:hidden;animation:hhc-sections-fallback-show 0s " + FALLBACK_DELAY + " forwards}";

const NOSCRIPT_CSS =
  "[data-homepage-sections-placeholder]{min-height:0;animation:none}" +
  "[data-homepage-sections-skeleton]{display:none}" +
  "[data-homepage-sections-fallback]{visibility:visible;position:static;animation:none}";

/**
 * Shown beneath the hero while the homepage's editorial Sections are still
 * resolving ((website)/page.tsx streams the header and hero first). Shaped
 * like the first Collection rail (same section padding, heading row and
 * 300px cards with a 200px image) so the real rail replaces it in place,
 * and tall enough (min-h, about two rails) that the footer never shows
 * through and then jumps down. Deliberately static — no shimmer/pulse — so
 * it reads as quiet space, not a loading screen.
 *
 * If the Sections never arrive (no JavaScript, or scripts that don't run,
 * or a stalled stream) it gives way to the browse links — see FALLBACK_CSS.
 */
export function HomepageSectionsPlaceholder() {
  return (
    <div data-homepage-sections-placeholder className="relative min-h-[1200px]">
      <style>{FALLBACK_CSS}</style>
      <noscript>
        <style>{NOSCRIPT_CSS}</style>
      </noscript>
      {/* visibility:hidden until the fallback applies: not seen, not focusable, not announced. */}
      <section data-homepage-sections-fallback className="absolute inset-x-0 top-0 py-10 md:py-12 border-t border-gray-100">
        <HomepageBrowseLinks />
      </section>
      <div data-homepage-sections-skeleton aria-busy="true">
        <span className="sr-only">Loading happy hours and events</span>
        <section aria-hidden="true" className="py-10 md:py-12 border-t border-gray-100">
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
    </div>
  );
}
