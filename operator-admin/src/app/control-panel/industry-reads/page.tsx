export const dynamic = "force-dynamic";
export const metadata = { title: "Industry Reads" };

import { getIndustryReads, IndustryArticle } from "@/lib/industryReads";
import { createAdminClient } from "@/lib/supabase/server";
import ArticleReviewCard from "./ArticleReviewCard";

// ── Types ─────────────────────────────────────────────────────────────────────

type FeedbackRow = {
  article_url: string;
  feedback: "thumbs_up" | "thumbs_down";
  created_at: string;
};

type FeedbackSummary = {
  thumbsUp: number;
  thumbsDown: number;
  lastAt: string | null;
};

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

function buildFeedbackMap(rows: FeedbackRow[]): Map<string, FeedbackSummary> {
  const map = new Map<string, FeedbackSummary>();
  for (const row of rows) {
    const existing = map.get(row.article_url) ?? { thumbsUp: 0, thumbsDown: 0, lastAt: null };
    if (row.feedback === "thumbs_up") existing.thumbsUp++;
    else existing.thumbsDown++;
    if (!existing.lastAt || row.created_at > existing.lastAt) existing.lastAt = row.created_at;
    map.set(row.article_url, existing);
  }
  return map;
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function IndustryReadsPage() {
  // Fetch articles and feedback history in parallel.
  // Uses service-role (createAdminClient) — RLS policies on this table were
  // dropped in migration 039; access is internal-only via the CP admin gate.
  const supabase = createAdminClient();

  const [articles, feedbackResult] = await Promise.all([
    getIndustryReads(),
    supabase
      .from("industry_reads_feedback")
      .select("article_url, feedback, created_at")
      .order("created_at", { ascending: false }),
  ]);

  const feedbackRows = (feedbackResult.data ?? []) as FeedbackRow[];
  const feedbackMap = buildFeedbackMap(feedbackRows);

  const totalThumbsUp = feedbackRows.filter((r) => r.feedback === "thumbs_up").length;
  const totalThumbsDown = feedbackRows.filter((r) => r.feedback === "thumbs_down").length;
  const mostRecentAt = feedbackRows[0]?.created_at ?? null;

  return (
    <div className="max-w-4xl">
      {/* ── Page header ── */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Industry Reads</h1>
        <p className="mt-1 text-sm text-gray-500">
          Review article relevance to help improve what operators see in Venue HQ.
          Rate quickly — thumbs up for useful operator insight, thumbs down for noise or fluff.
        </p>
      </div>

      {/* ── Feedback summary ── only shown once any feedback exists */}
      {(totalThumbsUp > 0 || totalThumbsDown > 0) && (
        <div className="mb-6 bg-white rounded-xl border border-gray-200 px-5 py-3.5 flex flex-wrap items-center gap-5 text-sm">
          <span className="font-medium text-green-700">
            👍 {totalThumbsUp} relevant
          </span>
          <span className="font-medium text-red-600">
            👎 {totalThumbsDown} not relevant
          </span>
          {mostRecentAt && (
            <span className="text-gray-400 text-xs">
              Last rated {formatRelativeTime(mostRecentAt)}
            </span>
          )}
          <span className="text-gray-300 text-xs ml-auto">
            {feedbackRows.length} total{" "}
            {feedbackRows.length === 1 ? "rating" : "ratings"}
          </span>
        </div>
      )}

      {/* ── Article list ── */}
      {articles.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-10 text-center">
          <p className="text-sm font-medium text-slate-700 mb-1">No articles available</p>
          <p className="text-xs text-gray-400">
            The Industry Reads feed is currently empty or all sources timed out. Check back
            soon — articles refresh every 6 hours.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {articles.map((article: IndustryArticle) => {
            const fb = feedbackMap.get(article.url);
            return (
              <ArticleReviewCard
                key={article.url}
                articleUrl={article.url}
                articleTitle={article.title}
                sourceName={article.sourceName}
                publishedAt={article.publishedAt}
                excerpt={article.excerpt}
                thumbsUp={fb?.thumbsUp ?? 0}
                thumbsDown={fb?.thumbsDown ?? 0}
                lastAt={fb?.lastAt ?? null}
              />
            );
          })}
        </div>
      )}

      {/* ── Context note ── */}
      <p className="mt-6 text-xs text-gray-400 leading-relaxed">
        Articles are pulled from industry RSS feeds every 6 hours and ranked by operator
        relevance. Thumbs up signals a useful source; thumbs down flags noise. Ratings
        accumulate over time and will inform future content tuning.
      </p>
    </div>
  );
}
