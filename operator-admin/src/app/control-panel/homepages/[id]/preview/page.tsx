import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getHomepagePreviewData } from "@/lib/data/homepagePreview";
import { HomepageDiscoveryShell } from "@/app/(website)/homepage/HomepageDiscoveryShell";
import { HomepageSectionsRenderer } from "@/app/(website)/homepage/HomepageSectionsRenderer";
import { WebsiteFooter } from "@/app/(website)/WebsiteFooter";
import { HomepagePreviewBanner } from "./HomepagePreviewBanner";

/**
 * Admin-safe Homepage preview (Build Homepage Preview task).
 *
 * Mirrors the Content Guide preview route's pattern exactly
 * (control-panel/content-engine/[id]/preview/page.tsx):
 *   - looked up by id, not a public geography route — works for Draft AND
 *     Published, Market AND City Homepages alike, with no dependency on the
 *     Homepage being publicly reachable.
 *   - protection is inherited, not bespoke: every /control-panel/* route is
 *     already auth-gated (control-panel/layout.tsx) and /control-panel is
 *     already disallowed in robots.ts; the `robots` metadata below is
 *     defense-in-depth only.
 *
 * All data resolution (Collection algorithm/manual/boost/limit resolution,
 * Feature content eligibility, Guide publish-window checks) happens in
 * getHomepagePreviewData (lib/data/homepagePreview.ts) — this page only
 * renders what that loader already decided is renderable.
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Preview Homepage — Control Panel",
  robots: { index: false, follow: false },
};

export default async function HomepagePreviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const data = await getHomepagePreviewData(id);
  if (!data) notFound();

  const geographyLabel = data.cityName ? `${data.cityName}, ${data.marketName}` : data.marketName;

  return (
    // Negative margin cancels the Control Panel shell's own p-6/md:p-8 so the
    // preview reads edge-to-edge, like the real public site — everything
    // below this point is deliberately NOT boxed/bordered (unlike the Guide
    // preview's bordered card) because WebsiteHeader is `position: sticky`;
    // wrapping it in an overflow-hidden card would break that stickiness.
    //
    // stickyTopClassName below undoes a side effect of that same -m-6/-m-8
    // trick: position:sticky's `top` is measured from control-panel/
    // layout.tsx's <main> PADDING edge (i.e. p-6/p-8 further down than its
    // actual top border), regardless of the negative margin. Left at the
    // default `top-0`, the banner+header block only sits flush at rest —
    // the instant you scroll, it snaps to that padding-inset position,
    // opening a 24px/32px gap above it that Homepage content (the Hero)
    // visibly scrolls through. Matching the offset to the exact negative
    // margin (-top-6 md:-top-8) makes it clamp flush with <main>'s true top
    // instead — verified empirically (a plain viewport-relative mental model
    // doesn't surface this; it only shows up once you scroll a padded,
    // overflow-y-auto ancestor).
    <div className="-m-6 md:-m-8">
      <div className="bg-white">
        <HomepageDiscoveryShell
          market={data.discoveryShell.market}
          cityName={data.discoveryShell.cityName}
          cities={data.discoveryShell.cities}
          stickyTopClassName="-top-6 md:-top-8"
          banner={
            <HomepagePreviewBanner
              homepageName={data.name}
              geographyLabel={geographyLabel}
              status={data.status}
              editHref={`/control-panel/homepages/${data.id}/edit`}
            />
          }
        />
        <HomepageSectionsRenderer sections={data.sections} />
        <WebsiteFooter />
      </div>
    </div>
  );
}
