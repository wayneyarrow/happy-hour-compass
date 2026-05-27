import { Suspense } from "react";
import { getIndustryReads } from "@/lib/industryReads";
import type { IndustryArticle } from "@/lib/industryReads";

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatRelativeTime(isoString: string): string {
  const diffMs = Date.now() - new Date(isoString).getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);
  if (diffMins < 2) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return "1 day ago";
  if (diffDays < 30) return `${diffDays} days ago`;
  return `${Math.floor(diffDays / 30)}mo ago`;
}

// ── Article card ──────────────────────────────────────────────────────────────

function ArticleCard({ article }: { article: IndustryArticle }) {
  const relTime = formatRelativeTime(article.publishedAt);
  return (
    <a
      href={article.url}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex items-start gap-3 py-3 hover:opacity-90 transition-opacity"
    >
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-800 group-hover:text-gray-900 leading-snug line-clamp-2 mb-1 transition-colors">
          {article.title}
        </p>
        <p className="text-[11px] text-gray-400">
          <span className="text-amber-600 font-semibold">{article.sourceName}</span>
          <span className="mx-1.5" aria-hidden="true">·</span>
          {relTime}
        </p>
      </div>
      <svg
        className="w-3.5 h-3.5 text-gray-300 group-hover:text-amber-400 shrink-0 mt-0.5 transition-colors"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
        aria-hidden="true"
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
      </svg>
    </a>
  );
}

// ── Loading skeleton ──────────────────────────────────────────────────────────

function ArticleListSkeleton() {
  return (
    <div className="divide-y divide-gray-100">
      {[0, 1, 2].map((i) => (
        <div key={i} className="py-3 animate-pulse">
          <div className="h-3.5 bg-gray-100 rounded w-4/5 mb-1.5" />
          <div className="h-3.5 bg-gray-100 rounded w-3/5 mb-2" />
          <div className="h-3 bg-gray-100 rounded w-2/5" />
        </div>
      ))}
    </div>
  );
}

// ── Async article list (suspendable) ──────────────────────────────────────────

async function ArticleList() {
  const articles = await getIndustryReads();
  const displayed = articles.slice(0, 3);

  if (displayed.length === 0) {
    return (
      <p className="text-xs text-gray-400 py-2 leading-relaxed">
        Industry content is currently unavailable. Check back soon.
      </p>
    );
  }

  return (
    <div className="divide-y divide-gray-100">
      {displayed.map((article) => (
        <ArticleCard key={article.url} article={article} />
      ))}
    </div>
  );
}

// ── Module ────────────────────────────────────────────────────────────────────

export default function IndustryReadsModule() {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
      {/* Header — renders immediately, never waits for articles */}
      <div className="flex items-center gap-3 mb-3">
        <div className="w-8 h-8 rounded-lg bg-orange-50 flex items-center justify-center shrink-0">
          <svg
            className="w-4 h-4 text-orange-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z"
            />
          </svg>
        </div>
        <h3 className="text-sm font-semibold text-gray-900">Industry Reads</h3>
      </div>

      {/* Article list — streams in independently; skeleton shown on cache miss */}
      <Suspense fallback={<ArticleListSkeleton />}>
        <ArticleList />
      </Suspense>
    </div>
  );
}
