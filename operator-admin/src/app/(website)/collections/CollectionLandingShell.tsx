import type { ReactNode } from "react";
import { CollectionBreadcrumb } from "./CollectionBreadcrumb";
import { formatCollectionItemCount, type PublicCollectionModel } from "@/lib/data/collectionPublic";

/**
 * Shared Collection Landing Page shell (Collection Landing Pages — Shared
 * Public Infrastructure task). Hero placement is type-specific:
 *
 *   - Guide Collections keep the standalone editorial hero rendered here —
 *     breadcrumb, title, optional Public Intro, and the resolved item count,
 *     above `children` — matching the Content Engine's editorial layout.
 *   - Venue and (future) Event Collections render no hero at all here.
 *     Those renderers reuse the existing Happy Hour / Event search
 *     experience wholesale (see CollectionTypeContent.tsx), including its
 *     own context/header slot, so the shell simply hands off to `children`
 *     with zero wrapping — the search experience's filter bar ends up
 *     directly below the public website header, exactly like the
 *     unrestricted search pages. This avoids rendering breadcrumb / title /
 *     Public Intro / count in two places.
 *
 * Public Intro has no fallback to Internal Description: when `publicIntro`
 * is null, the intro paragraph is simply omitted, exactly as the product
 * spec requires.
 */

type Props = {
  model: PublicCollectionModel;
  children?: ReactNode;
};

export function CollectionLandingShell({ model, children }: Props) {
  if (model.kind !== "guide") {
    return <>{children}</>;
  }

  return (
    <div className="bg-white pb-16">
      <div className="max-w-7xl mx-auto px-6 lg:px-10">
        <CollectionBreadcrumb collectionName={model.name} />

        <h1 className="text-2xl md:text-3xl font-bold text-gray-900 tracking-tight">{model.name}</h1>

        {model.publicIntro && (
          <p className="mt-3 text-base text-gray-600 leading-relaxed max-w-2xl">{model.publicIntro}</p>
        )}

        <p className="mt-2 text-sm text-gray-500">{formatCollectionItemCount(model)}</p>
      </div>

      {children}
    </div>
  );
}
