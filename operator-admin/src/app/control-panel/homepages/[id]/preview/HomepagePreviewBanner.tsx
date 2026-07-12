import Link from "next/link";
import type { HomepageStatus } from "@/lib/data/homepagesShared";

/**
 * Preview-only control bar — deliberately NOT part of (website)/homepage/'s
 * reusable renderer (see that folder's docstrings): a future public
 * Homepage route must never render this. Visually distinct from the public
 * design (flat colored bar, small badges/link) so an editor can never
 * mistake the preview chrome for the real site.
 */

type Props = {
  homepageName: string;
  geographyLabel: string;
  status: HomepageStatus;
  editHref: string;
};

export function HomepagePreviewBanner({ homepageName, geographyLabel, status, editHref }: Props) {
  const isPublished = status === "published";

  return (
    <div
      className={`px-4 py-3 flex flex-wrap items-center justify-between gap-3 border-b ${
        isPublished ? "bg-green-50 border-green-200" : "bg-amber-50 border-amber-200"
      }`}
    >
      <div className="flex flex-wrap items-center gap-2.5 text-sm">
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wide bg-gray-900 text-white">
          Preview
        </span>
        <span className="font-semibold text-gray-800">{homepageName}</span>
        <span className="text-gray-400">·</span>
        <span className="text-gray-600">{geographyLabel}</span>
        <span
          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${
            isPublished ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"
          }`}
        >
          {isPublished ? "Published" : "Draft"}
        </span>
        <span className="text-gray-500">
          {isPublished ? "Live at its public URL." : "Not yet visible to the public."} Showing the last saved version.
        </span>
      </div>
      <Link
        href={editHref}
        className="shrink-0 text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors"
      >
        ← Back to Edit
      </Link>
    </div>
  );
}
