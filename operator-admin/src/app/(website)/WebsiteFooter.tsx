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
 * Brand mark: images/branding/logo-white.png is the official white lockup
 * for dark surfaces (the counterpart to hhc-icon.png/logo.png, which are
 * opaque and render as a plain white rectangle here) — a true RGBA PNG
 * (colorType 6) with fully transparent corners, replacing the icon +
 * styled-text substitute the footer used before this asset existed.
 *
 * Social links: Instagram/Facebook URLs have no existing centralized
 * config (organization.ts's Organization JSON-LD explicitly omits `sameAs`
 * pending real profiles — see that file), so they're plain local
 * constants here, matching how other fixed external URLs in this codebase
 * are declared inline rather than routed through a shared config module.
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

const INSTAGRAM_URL = "https://www.instagram.com/happyhourcompass/";
const FACEBOOK_URL = "https://www.facebook.com/happyhourcompass";

const SOCIAL_ICON_LINK_CLASS =
  "text-white hover:text-white/80 transition-colors rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400";

/** Feather Icons' instagram glyph — kept as inline SVG since no icon library is installed. */
function InstagramIcon() {
  return (
    <svg
      className="w-5 h-5"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
      <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
      <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
    </svg>
  );
}

/** Feather Icons' facebook glyph — inline SVG, matching InstagramIcon's shape. */
function FacebookIcon() {
  return (
    <svg
      className="w-5 h-5"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" />
    </svg>
  );
}

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

  // Launch config: with only one active market, switching to it from itself
  // is a no-op — render it as the current live market label instead of a
  // clickable link. If a second market goes active, both become links again.
  const activeMarketCount = MARKETS.filter((m) => m.status === "active").length;

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
                className="inline-flex items-center rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
              >
                <Image
                  src="/images/branding/logo-white.png"
                  alt="Happy Hour Compass"
                  width={889}
                  height={325}
                  className="h-14 md:h-16 w-auto shrink-0"
                />
              </Link>
              <div className="mt-4 flex items-center gap-4">
                <Link
                  href={INSTAGRAM_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Happy Hour Compass on Instagram (opens in a new tab)"
                  className={SOCIAL_ICON_LINK_CLASS}
                >
                  <InstagramIcon />
                </Link>
                <Link
                  href={FACEBOOK_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Happy Hour Compass on Facebook (opens in a new tab)"
                  className={SOCIAL_ICON_LINK_CLASS}
                >
                  <FacebookIcon />
                </Link>
              </div>
              <p className="mt-5 text-sm text-gray-400 leading-relaxed max-w-[230px]">
                Never ask
                <br />
                &ldquo;Where should we go?&rdquo;
                <br />
                again.
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
                        activeMarketCount > 1 ? (
                          <FooterButton
                            onClick={() => goToMarketHomepage(market.id)}
                            disabled={isPending}
                          >
                            {market.name}
                          </FooterButton>
                        ) : (
                          <span className="text-sm text-gray-300">{market.name}</span>
                        )
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
                    <FooterLink href="/login">Business Login</FooterLink>
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
