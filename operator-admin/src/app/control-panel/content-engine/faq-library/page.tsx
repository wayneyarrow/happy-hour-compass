import Link from "next/link";
import { getFaqLibrary } from "@/lib/data/faqLibrary";
import FaqLibraryClient from "./FaqLibraryClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "FAQ Library — Content Engine" };

export default async function FaqLibraryPage() {
  const faqs = await getFaqLibrary();

  return (
    <div className="max-w-5xl">
      <div className="mb-6">
        <Link
          href="/control-panel/content-engine"
          className="text-xs text-gray-400 hover:text-gray-600 transition-colors mb-3 inline-block"
        >
          ← Content Engine
        </Link>
        <h1 className="text-2xl font-bold text-slate-900">FAQ Library</h1>
        <p className="mt-1 text-sm text-gray-500">
          Reusable questions guides can answer from. Disable a question to hide it from the guide
          editor without affecting guides already using it; a question in use can&apos;t be deleted.
        </p>
      </div>

      <FaqLibraryClient faqs={faqs} />
    </div>
  );
}
