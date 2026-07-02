export const dynamic = "force-dynamic";
export const metadata = { title: "Edit Guide — Content Engine" };

import Link from "next/link";
import { notFound } from "next/navigation";
import { getContentGuideById, getGuideFormGeography } from "@/lib/data/contentGuides";
import {
  getGuideVenueAttachments,
  getGuideEventAttachments,
} from "@/lib/data/contentGuideAttachments";
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

  const initialAttachments =
    guide.guide_type === "event_guide"
      ? await getGuideEventAttachments(guide.id)
      : await getGuideVenueAttachments(guide.id);

  return (
    <div className="max-w-5xl">
      <div className="mb-6">
        <Link
          href="/control-panel/content-engine"
          className="text-xs text-gray-400 hover:text-gray-600 transition-colors mb-3 inline-block"
        >
          ← Content Engine
        </Link>
        <h1 className="text-2xl font-bold text-slate-900">Edit Guide</h1>
        <p className="mt-1 text-sm text-gray-500">{guide.title}</p>
      </div>

      <GuideForm
        mode="edit"
        initialGuide={guide}
        initialAttachments={initialAttachments}
        markets={markets}
        cities={cities}
        neighbourhoods={neighbourhoods}
      />
    </div>
  );
}
