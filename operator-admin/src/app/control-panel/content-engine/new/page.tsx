export const dynamic = "force-dynamic";
export const metadata = { title: "New Guide — Content Engine" };

import Link from "next/link";
import { getContentGuides, getGuideFormGeography } from "@/lib/data/contentGuides";
import { getActiveFaqLibrary } from "@/lib/data/faqLibrary";
import GuideForm from "../GuideForm";

export default async function NewContentGuidePage() {
  const [{ markets, cities, neighbourhoods }, faqLibrary, allGuides] = await Promise.all([
    getGuideFormGeography(),
    getActiveFaqLibrary(),
    getContentGuides(),
  ]);

  // No guide id yet on the create page, so nothing to exclude — a brand new
  // guide can reference any existing guide as a FAQ's related guide.
  const relatedGuideOptions = allGuides.map((g) => ({
    id: g.id,
    title: g.marketName ? `${g.title} — ${g.marketName}` : g.title,
  }));

  return (
    <div className="max-w-5xl">
      <div className="mb-6">
        <Link
          href="/control-panel/content-engine"
          className="text-xs text-gray-400 hover:text-gray-600 transition-colors mb-3 inline-block"
        >
          ← Content Engine
        </Link>
        <h1 className="text-2xl font-bold text-slate-900">New Guide</h1>
        <p className="mt-1 text-sm text-gray-500">
          Create a new Venue Guide or Event Guide.
        </p>
      </div>

      <GuideForm
        mode="create"
        markets={markets}
        cities={cities}
        neighbourhoods={neighbourhoods}
        faqLibrary={faqLibrary}
        relatedGuideOptions={relatedGuideOptions}
      />
    </div>
  );
}
