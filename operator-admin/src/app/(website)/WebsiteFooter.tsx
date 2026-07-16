"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { MARKETS } from "@/lib/markets";
import { setMarketAction } from "@/app/(consumer)/marketActions";
import { AcquisitionModal } from "./acquisition/AcquisitionModal";
import { ContactUsModalContent } from "./acquisition/ContactUsModalContent";
import { AddVenueModalContent } from "./acquisition/AddVenueModalContent";

/**
 * The permanent global footer for the public website (Business Funnel —
 * Final Global Footer task; darkened in the follow-up visual-polish pass).
 * Rendered once by (website)/layout.tsx, so it appears on every public page
 * without any per-page wiring.
 *
 * Reuses, rather than reinvents:
 *   - MARKETS (markets.ts) + setMarketAction (the exact market-switch
 *     mechanism WebsiteLocationSwitcher already uses) for the Markets
 *     column — there is no direct /{market-slug} route (the public
 *     Homepage is resolved from the hhc_market cookie, not the URL), so
 *     "linking" to a market homepage means setting that cookie and then
 *     navigating to `/`, exactly like the header's location switcher does.
 *   - AcquisitionModal + ContactUsModalContent / AddVenueModalContent — the
 *     same acquisition flows already wired into the header and the venue
 *     detail page, not new forms.
 *   - bg-gray-900 as the dark background — the same near-black already used
 *     for dark surfaces elsewhere on the site (e.g. the Collection CTA
 *     buttons), not a new color introduced for this footer.
 *
 * Brand mark: neither full logo file (hhc-logo-horizontal-header.png,
 * logo.png) has a transparent background — both are opaque RGB PNGs that
 * render as a plain white rectangle on a dark surface. Only hhc-icon.png is
 * true RGBA with a transparent canvas. Rather than force one of the boxed
 * lockups onto a dark background (or add a decorative light plate behind
 * it, which the brief rules out), the brand block pairs the transparent
 * icon with a real text wordmark styled directly in the site's own type/
 * color system — the same "icon + styled text" shape the very first
 * version of this footer used, just larger and recolored for a dark
 * surface. This keeps brand recognition and guarantees contrast without
 * fabricating a new image asset.
 *
 * "Claim Your Venue" now points at /claim-your-venue (see that route's
 * page.tsx) instead of straight into search — an instructional landing
 * page explaining the existing venue-specific claim flow, not a new claim
 * workflow.
 *
 * "For Businesses" (/business), "Careers" (/careers), and "About"
 * (/about) all point at real pages now — the last of the three
 * forward-looking placeholders this footer originally shipped with. This
 * footer is the permanent structure; the pages it points to are each
 * their own task.
 */

function FooterColumnHeading({ children }: { children: ReactNode }) {
  return (
    <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-4">
      {children}
    </p>
  );
}

const FOOTER_LINK_CLASS =
  "text-sm text-gray-300 hover:text-white transition-colors rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400";

function FooterLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className={FOOTER_LINK_CLASS}>
      {children}
    </Link>
  );
}

/** Small diagonal arrow — the understated, icon-only signal that a link opens in a new tab (no added copy). */
function ExternalLinkIcon() {
  return (
    <svg
      className="w-3 h-3 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M7 17L17 7M7 7h10v10" />
    </svg>
  );
}

function FooterButton({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`${FOOTER_LINK_CLASS} text-left disabled:opacity-50 disabled:cursor-default`}
    >
      {children}
    </button>
  );
}

export function WebsiteFooter() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [contactOpen, setContactOpen] = useState(false);
  const [addVenueOpen, setAddVenueOpen] = useState(false);

  function goToMarketHomepage(marketId: string) {
    startTransition(async () => {
      await setMarketAction(marketId);
      router.push("/");
      // The homepage renders off the hhc_market cookie we just set, but a
      // push to "/" when already on "/" (or within the client Router
      // Cache's staleTime for a recent visit) can serve the previously
      // cached RSC payload instead of refetching — same issue
      // WebsiteLocationSwitcher solves with refresh(). Calling both
      // unconditionally covers every starting route without needing to
      // special-case "already on the homepage".
      router.refresh();
    });
  }

  return (
    <>
      <footer className="bg-gray-900">
        <div className="max-w-7xl mx-auto px-6 lg:px-10 py-14 md:py-16">
          <div className="flex flex-col gap-10 lg:flex-row lg:gap-16">
            {/* Brand block */}
            <div className="lg:w-72 lg:shrink-0">
              <Link
                href="/"
                aria-label="Happy Hour Compass — Home"
                className="inline-flex items-center gap-3 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
              >
                <Image
                  src="/hhc-icon.png"
                  alt=""
                  width={271}
                  height={345}
                  className="h-10 w-auto shrink-0"
                />
                <span className="text-2xl font-bold tracking-tight leading-none">
                  <span className="text-amber-400">Happy Hour</span>{" "}
                  <span className="text-white">Compass</span>
                </span>
              </Link>
              <p className="mt-5 text-sm text-gray-400 leading-relaxed max-w-[230px] text-balance">
                &ldquo;Never ask &lsquo;Where should we go?&rsquo; again.&rdquo;
              </p>
            </div>

            {/* Navigation columns */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-8 gap-y-9 flex-1">
              {/* Markets */}
              <div>
                <FooterColumnHeading>Markets</FooterColumnHeading>
                <ul className="space-y-3">
                  {MARKETS.map((market) => (
                    <li key={market.id}>
                      {market.status === "active" ? (
                        <FooterButton
                          onClick={() => goToMarketHomepage(market.id)}
                          disabled={isPending}
                        >
                          {market.name}
                        </FooterButton>
                      ) : (
                        <span className="inline-flex items-center gap-2 text-sm text-gray-400">
                          {market.name}
                          <span className="text-[10px] bg-gray-800 text-gray-400 border border-gray-700 rounded-md px-1.5 py-0.5 font-semibold leading-none">
                            Soon
                          </span>
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>

              {/* For Businesses */}
              <div>
                <FooterColumnHeading>For Businesses</FooterColumnHeading>
                <ul className="space-y-3">
                  <li>
                    <FooterLink href="/business">For Businesses</FooterLink>
                  </li>
                  <li>
                    <FooterLink href="/claim-your-venue">Claim Your Venue</FooterLink>
                  </li>
                  <li>
                    <FooterButton onClick={() => setAddVenueOpen(true)}>Add Your Venue</FooterButton>
                  </li>
                  <li>
                    <Link
                      href="/login"
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label="Business Login (opens in a new tab)"
                      className={`${FOOTER_LINK_CLASS} inline-flex items-center gap-1.5`}
                    >
                      Business Login
                      <ExternalLinkIcon />
                    </Link>
                  </li>
                </ul>
              </div>

              {/* Company */}
              <div>
                <FooterColumnHeading>Company</FooterColumnHeading>
                <ul className="space-y-3">
                  <li>
                    <FooterLink href="/about">About</FooterLink>
                  </li>
                  <li>
                    <FooterButton onClick={() => setContactOpen(true)}>Contact</FooterButton>
                  </li>
                  <li>
                    <FooterLink href="/careers">Careers</FooterLink>
                  </li>
                </ul>
              </div>

              {/* Legal */}
              <div>
                <FooterColumnHeading>Legal</FooterColumnHeading>
                <ul className="space-y-3">
                  <li>
                    <FooterLink href="/privacy">Privacy Policy</FooterLink>
                  </li>
                  <li>
                    <FooterLink href="/terms">Terms of Service</FooterLink>
                  </li>
                </ul>
              </div>
            </div>
          </div>

          {/* Bottom legal row */}
          <div className="mt-12 pt-6 border-t border-gray-800 flex flex-col-reverse sm:flex-row items-center justify-between gap-3">
            <p className="text-xs text-gray-400">
              © {new Date().getFullYear()} Happy Hour Compass. All rights reserved.
            </p>
            <p className="text-xs text-gray-400">Powered by Yellow Lab Software.</p>
          </div>
        </div>
      </footer>

      <AcquisitionModal
        open={contactOpen}
        onClose={() => setContactOpen(false)}
        title="Contact Us"
        description="Have a question or feedback? We'd love to hear from you."
      >
        <ContactUsModalContent onDone={() => setContactOpen(false)} />
      </AcquisitionModal>

      <AcquisitionModal
        open={addVenueOpen}
        onClose={() => setAddVenueOpen(false)}
        title="Add Your Venue"
        description="List your restaurant or bar on Happy Hour Compass and reach people looking for great happy hours."
      >
        <AddVenueModalContent onDone={() => setAddVenueOpen(false)} />
      </AcquisitionModal>
    </>
  );
}
