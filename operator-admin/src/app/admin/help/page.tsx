export const metadata = { title: "Help" };

import Link from "next/link";
import { HOW_TO_ARTICLES, articleUrl } from "@/lib/helpCenter/articles";
import HelpNeedSupport from "./components/HelpNeedSupport";

// Lightweight grouping for landing-page navigation only — not part of the
// URL structure. V1 intentionally does not define a real category taxonomy;
// articles without a category fall into "Articles". See articles.ts header
// comment — the real inventory/categories are a follow-up task.
function groupArticlesByCategory() {
  const groups = new Map<string, typeof HOW_TO_ARTICLES>();
  for (const article of HOW_TO_ARTICLES) {
    const key = article.category ?? "Articles";
    const existing = groups.get(key);
    if (existing) existing.push(article);
    else groups.set(key, [article]);
  }
  return groups;
}

export default function AdminHelpPage() {
  const groups = groupArticlesByCategory();

  return (
    <div className="max-w-2xl">

      {/* ── Page heading ──────────────────────────────────────────────────── */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">Help Center</h1>
        <p className="text-sm text-gray-500">
          Guides, how-tos, and support to help you get the most from your Happy Hour Compass listing.
        </p>
      </div>

      {/* ── Getting Started — prominent entry ────────────────────────────── */}
      <Link
        href="/admin/help/getting-started"
        className="group block bg-white rounded-xl border border-gray-200 shadow-resting hover:shadow-hover hover:border-amber-200 transition-all p-6 mb-8"
      >
        <div className="flex items-center gap-4">
          <div className="w-11 h-11 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-semibold text-gray-900">Getting Started</h2>
            <p className="text-sm text-gray-500 mt-0.5">
              New here? Start with the essentials for getting your listing live.
            </p>
          </div>
          <svg
            className="w-4 h-4 text-gray-300 shrink-0 group-hover:text-amber-500 transition-colors"
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </div>
      </Link>

      {/* ── Article groups ────────────────────────────────────────────────── */}
      {[...groups.entries()].map(([category, articles]) => (
        <div key={category} className="mb-8">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2.5">
            {category}
          </h2>
          {category === "Internal Preview" && (
            <p className="text-xs text-gray-400 mb-2.5">
              Sample content for engineering QA only — this proves the article renderer works
              and will be replaced by the approved Help Center article inventory.
            </p>
          )}
          <div className="bg-white rounded-xl border border-gray-200 shadow-resting divide-y divide-gray-50">
            {articles.map((article) => (
              <Link
                key={article.slug}
                href={articleUrl(article.slug)}
                className="flex items-center justify-between gap-4 px-6 py-4 hover:bg-gray-50 transition-colors"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-gray-800 truncate">{article.title}</p>
                    {article.isPlaceholder && (
                      <span className="text-[10px] font-medium text-gray-400 bg-gray-100 rounded-full px-2 py-0.5 shrink-0">
                        Internal preview
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5 truncate">{article.summary}</p>
                </div>
                <svg
                  className="w-4 h-4 text-gray-300 shrink-0"
                  fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </Link>
            ))}
          </div>
        </div>
      ))}

      {/* ── Support ───────────────────────────────────────────────────────── */}
      <HelpNeedSupport />

    </div>
  );
}
