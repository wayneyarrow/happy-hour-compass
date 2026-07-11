export const dynamic = "force-dynamic";
export const metadata = { title: "New Homepage — Homepages" };

import Link from "next/link";
import { getHomepageFormGeography, getHomepages } from "@/lib/data/homepages";
import HomepageForm from "../HomepageForm";

export default async function NewHomepagePage() {
  const [{ markets, cities }, existingHomepages] = await Promise.all([
    getHomepageFormGeography(),
    // Unfiltered — both Draft and Published Homepages reserve their
    // geography, so the Market/City selects need the full set to grey out
    // already-taken destinations.
    getHomepages(),
  ]);

  return (
    <div className="max-w-5xl">
      <div className="mb-6">
        <Link
          href="/control-panel/homepages"
          className="text-xs text-gray-400 hover:text-gray-600 transition-colors mb-3 inline-block"
        >
          ← Homepages
        </Link>
        <h1 className="text-2xl font-bold text-slate-900">New Homepage</h1>
        <p className="mt-1 text-sm text-gray-500">
          Choose the geography this Homepage represents, then Continue — you&apos;ll build Sections,
          SEO, and Status next.
        </p>
      </div>

      <HomepageForm mode="create" markets={markets} cities={cities} existingHomepages={existingHomepages} />
    </div>
  );
}
