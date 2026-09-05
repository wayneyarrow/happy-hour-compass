"use client";

import { useEffect, useRef } from "react";
import { recordHelpCenterView } from "@/lib/helpCenter/trackHelpCenterView";

/**
 * Phase 4C — mounts on the Help Center landing page, each How-To article
 * page, and the Getting Started guide; fires exactly one
 * recordHelpCenterView() call per mount, then renders nothing.
 *
 * Being a Client Component boundary embedded in an otherwise static Server
 * Component tree (see src/app/admin/help/[slug]/page.tsx, which is
 * prerendered via generateStaticParams) does not itself force the parent
 * page back into dynamic rendering — the Server Action call happens after
 * hydration in the browser, not during prerendering, so article pages keep
 * their existing static build/render path untouched.
 *
 * The empty effect-dependency array + initialRef one-time snapshot mirrors
 * DiscoveryImpressionTracker's mount-tracking pattern
 * ((website)/discoveryTracking.tsx) — a parent rerender can never re-fire
 * this; only an actual remount (a fresh page load) does, which is exactly
 * the "one settled page load" view semantics this is meant to capture.
 * React StrictMode's double-invoke-in-dev is guarded separately by
 * `firedRef`, so a duplicate call is never issued even across that.
 */
export default function HelpViewTracker({ articleSlug }: { articleSlug: string }) {
  const initialSlugRef = useRef(articleSlug);
  const firedRef = useRef(false);

  useEffect(() => {
    if (firedRef.current) return;
    firedRef.current = true;
    void recordHelpCenterView(initialSlugRef.current);
  }, []);

  return null;
}
