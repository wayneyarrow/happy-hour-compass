import type { ReactNode } from "react";

/**
 * Shared article-page shell: title + one-sentence summary + optional
 * "Internal preview" badge for placeholder content, wrapping a single
 * content card. Used by the Standard How-To renderer; Getting Started uses
 * its own slightly more prominent header (see getting-started/page.tsx) but
 * reuses the same card treatment for consistency.
 */
export default function HelpArticleLayout({
  title,
  summary,
  isPlaceholder,
  children,
}: {
  title: string;
  summary: string;
  isPlaceholder?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
          {isPlaceholder && (
            <span className="text-[10px] font-medium text-gray-400 bg-gray-100 rounded-full px-2 py-0.5 shrink-0">
              Internal preview
            </span>
          )}
        </div>
        <p className="text-sm text-gray-500">{summary}</p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-resting p-6">
        {children}
      </div>
    </div>
  );
}
