export const dynamic = "force-dynamic";
export const metadata = { title: "Edit Guide — Content Engine" };

import Link from "next/link";
import { notFound } from "next/navigation";
import { getContentGuideById, getContentGuides, getGuideFormGeography } from "@/lib/data/contentGuides";
import {
  getGuideVenueAttachments,
  getGuideEventAttachments,
} from "@/lib/data/contentGuideAttachments";
import { getGuideChannels } from "@/lib/data/contentGuideDistribution";
import { getActiveFaqLibrary, getGuideFaqs } from "@/lib/data/faqLibrary";
import GuideForm from "../../GuideForm";

export default async function EditContentGuidePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [guide, { markets, cities, neighbourhoods }] = await Promise.all([
    getContentGuideById(id),
    getGuideFormGeography(),
  ]);

  if (!guide) notFound();

  const [initialAttachments, initialChannels, initialFaqs, faqLibrary, allGuides] = await Promise.all([
    guide.guide_type === "event_guide"
      ? getGuideEventAttachments(guide.id)
      : getGuideVenueAttachments(guide.id),
    getGuideChannels(guide.id),
    getGuideFaqs(guide.id),
    getActiveFaqLibrary(),
    getContentGuides(),
  ]);

  // A guide can't be its own "related guide" — exclude self from the picker.
  const relatedGuideOptions = allGuides
    .filter((g) => g.id !== guide.id)
    .map((g) => ({
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
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Edit Guide</h1>
            <p className="mt-1 text-sm text-gray-500">{guide.title}</p>
          </div>
          {/* Always enabled — the preview route renders Draft and Published
              guides alike (getGuideForPreview), so there's no status to gate on. */}
          <a
            href={`/control-panel/content-engine/${guide.id}/preview`}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors whitespace-nowrap"
          >
            Preview Guide
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </a>
        </div>
      </div>

      <GuideForm
        mode="edit"
        initialGuide={guide}
        initialAttachments={initialAttachments}
        initialChannels={initialChannels}
        initialFaqs={initialFaqs}
        markets={markets}
        cities={cities}
        neighbourhoods={neighbourhoods}
        faqLibrary={faqLibrary}
        relatedGuideOptions={relatedGuideOptions}
      />
    </div>
  );
}
