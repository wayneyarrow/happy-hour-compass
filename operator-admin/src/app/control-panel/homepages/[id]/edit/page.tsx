export const dynamic = "force-dynamic";
export const metadata = { title: "Edit Homepage — Homepages" };

import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getHomepageById,
  getHomepageFormGeography,
  getHomepages,
  getAssignableCollectionsForSection,
  getAssignableGuidesForFeatureSection,
} from "@/lib/data/homepages";
import HomepageForm from "../../HomepageForm";

export default async function EditHomepagePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ success?: string }>;
}) {
  const { id } = await params;
  const [
    homepage,
    { markets, cities },
    existingHomepages,
    venueCollections,
    eventCollections,
    guideCollections,
    guideFeatures,
    { success },
  ] = await Promise.all([
    getHomepageById(id),
    getHomepageFormGeography(),
    // Unfiltered, same as the create page — HomepageForm excludes this
    // Homepage's own id from the "taken" set so its current geography
    // stays selectable.
    getHomepages(),
    // Homepage Sections editor content candidates — small, geography-scoped
    // lists loaded once up front (unlike Venue/Event Feature search, which
    // is live and server-driven — see SectionEditorPanel.tsx).
    getAssignableCollectionsForSection(id, "venue"),
    getAssignableCollectionsForSection(id, "event"),
    getAssignableCollectionsForSection(id, "guide"),
    getAssignableGuidesForFeatureSection(id),
    searchParams,
  ]);

  if (!homepage) notFound();

  const successMessage =
    success === "created" ? "Homepage created." : success === "updated" ? "Homepage saved." : null;

  return (
    <div className="max-w-5xl">
      <div className="mb-6">
        <Link
          href="/control-panel/homepages"
          className="text-xs text-gray-400 hover:text-gray-600 transition-colors mb-3 inline-block"
        >
          ← Homepages
        </Link>
        <h1 className="text-2xl font-bold text-slate-900">Edit Homepage</h1>
        <p className="mt-1 text-sm text-gray-500">{homepage.name}</p>
      </div>

      {successMessage && (
        <div className="mb-4 bg-green-50 border border-green-200 rounded-xl px-5 py-3 text-sm text-green-700">
          {successMessage}
        </div>
      )}

      <HomepageForm
        mode="edit"
        initialHomepage={homepage}
        markets={markets}
        cities={cities}
        existingHomepages={existingHomepages}
        // Only right after a fresh create-and-redirect — see HomepageForm's
        // module docstring for the smooth-scroll behavior this triggers.
        scrollToSectionsOnMount={success === "created"}
        assignableCollections={{ venue: venueCollections, event: eventCollections, guide: guideCollections }}
        assignableGuideFeatures={guideFeatures}
      />
    </div>
  );
}
