import { DISCOVERY_MODES, DISCOVERY_MODE_ORDER } from "@/lib/homepageDiscoveryModes";

/**
 * Sitewide discovery links shared by WebsiteHeader (desktop nav + mobile
 * menu) and WebsiteFooter (Explore column). Happy Hours / Daily Specials /
 * Events reuse the Homepage Hero's own destinations and labels
 * (DISCOVERY_MODES), so the nav can never point somewhere the Hero doesn't.
 * Guides is the market's Featured Guides collection, resolved per request by
 * getFeaturedGuidesNavHref() — omitted entirely when that is null (the
 * collection page would 404), never pointed at the dormant Guides Library.
 */
export type SiteDiscoveryLink = { href: string; label: string };

export function buildSiteDiscoveryLinks(featuredGuidesHref: string | null | undefined): SiteDiscoveryLink[] {
  const links: SiteDiscoveryLink[] = DISCOVERY_MODE_ORDER.map((mode) => ({
    href: DISCOVERY_MODES[mode].destination,
    label: DISCOVERY_MODES[mode].label,
  }));
  if (featuredGuidesHref) links.push({ href: featuredGuidesHref, label: "Guides" });
  return links;
}
