import type { ReactNode } from "react";
import { CollectionBreadcrumb } from "./CollectionBreadcrumb";
import { formatCollectionItemCount, type PublicCollectionModel } from "@/lib/data/collectionPublic";

/**
 * Shared Collection Landing Page shell (Collection Landing Pages — Shared
 * Public Infrastructure task). Renders everything common to Venue, Event,
 * and Guide Collections — breadcrumb, title, optional Public Intro, and the
 * resolved item count — then hands off to `children` for the type-specific
 * presentation a future task will build (see CollectionTypeContent.tsx).
 *
 * `children` is rendered completely bare (no wrapping element of its own)
 * so that today's empty type-specific region (every branch of
 * CollectionTypeContent currently returns null) produces zero DOM output
 * and therefore zero visible blank space — there is nothing here for a
 * future task to have to first "undo."
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
