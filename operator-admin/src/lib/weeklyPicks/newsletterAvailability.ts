import { isNewsletterSignupEnabledForMarket } from "@/lib/brevo/config";
import { getNewsletterMarket, type NewsletterMarket } from "./newsletterMarkets";

/**
 * Server-only: which market's newsletter signup is offered in THIS
 * deployment. The one gate for every signup surface — homepage bands, the
 * desktop and mobile header "Newsletter" links (passed down as an href),
 * guide footers, the /{market}/newsletter pages, the sitemap — and for the
 * signup action itself, so a switched-off market is never shown and never
 * accepted. Reads environment variables, so it must never run in a Client
 * Component.
 */
export function getAvailableNewsletterMarket(marketId: string | null | undefined): NewsletterMarket | null {
  if (!marketId) return null;
  const market = getNewsletterMarket(marketId);
  return market && isNewsletterSignupEnabledForMarket(marketId) ? market : null;
}

/** The market's signup page, or null when its newsletter isn't offered here. */
export function getNewsletterSignupHref(marketId: string | null | undefined): string | null {
  return getAvailableNewsletterMarket(marketId)?.signupPath ?? null;
}
