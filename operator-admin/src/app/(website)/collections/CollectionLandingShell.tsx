import type { ReactNode } from "react";
import { CollectionBreadcrumb } from "./CollectionBreadcrumb";
import type { PublicCollectionModel } from "@/lib/data/collectionPublic";

/**
 * Shared Collection Landing Page shell (Collection Landing Pages — Shared
 * Public Infrastructure task). Hero placement is type-specific:
 *
 *   - Guide Collections keep the standalone editorial hero rendered here —
 *     breadcrumb, title, optional Public Intro, and the resolved item count,
 *     above `children` — matching the Content Engine's editorial layout.
 *     Container width (max-w-5xl) and typography (large extrabold title,
 *     amber-accented eyebrow-style count line) intentionally mirror
 *     GuideDetailView's own hero (see [market]/guides/[slug]/GuideDetailView.tsx)
 *     rather than the plainer venue/event search chrome, so the Guide
 *     Collection page reads as a magazine landing page, not a directory.
 *   - Venue and Event Collections render no hero at all here. Those
 *     renderers reuse the existing Happy Hour / Event search experience
 *     wholesale (see CollectionTypeContent.tsx), including its own
 *     context/header slot, so the shell simply hands off to `children` with
 *     zero wrapping — the search experience's filter bar ends up directly
 *     below the public website header, exactly like the unrestricted search
 *     pages. This avoids rendering breadcrumb / title / Public Intro / count
 *     in two places.
 *
 * Public Intro has no fallback to Internal Description: when `publicIntro`
 * is null, the intro paragraph is simply omitted, exactly as the product
 * spec requires. The Collection's internal Description is never read here
 * (or anywhere in the public Collection renderers) — only `publicIntro`.
 */

type Props = {
  model: PublicCollectionModel;
  children?: ReactNode;
};

/** "Curated collection • 1 guide" / "Curated collection • 12 guides" — the Guide-hero-specific count wording (distinct from formatCollectionItemCount's "N curated venues" phrasing used by the search-first Venue/Event renderers). */
function formatGuideCollectionCount(count: number): string {
  return `Curated collection • ${count} ${count === 1 ? "guide" : "guides"}`;
}

export function CollectionLandingShell({ model, children }: Props) {
  if (model.kind !== "guide") {
    return <>{children}</>;
  }

  return (
    <div className="bg-white pb-16">
      {/* mb-14/20 lets the hero breathe before the Lead Guide feature (visual polish pass) —
          whitespace only, no added background/decoration. */}
      <div className="max-w-5xl mx-auto px-6 lg:px-10 mb-14 md:mb-20">
        <CollectionBreadcrumb collectionName={model.name} />

        <h1 className="mt-1 text-4xl sm:text-5xl font-extrabold text-gray-900 tracking-tight leading-[1.08]">
          {model.name}
        </h1>

        {model.publicIntro && (
          <p className="mt-5 text-xl md:text-2xl font-medium text-gray-700 leading-relaxed max-w-2xl">
            {model.publicIntro}
          </p>
        )}

        <p className="mt-6 text-xs font-semibold uppercase tracking-[0.15em] text-gray-400">
          {formatGuideCollectionCount(model.itemCount)}
        </p>
      </div>

      {children}
    </div>
  );
}
