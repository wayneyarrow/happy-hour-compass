"use client";

import { useState, useTransition } from "react";
import { submitArticleFeedback } from "./actions";

type Props = {
  articleUrl: string;
  articleTitle: string;
  sourceName: string;
  publishedAt: string;
  excerpt?: string;
  thumbsUp: number;
  thumbsDown: number;
  lastAt: string | null;
};

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

export default function ArticleReviewCard({
  articleUrl,
  articleTitle,
  sourceName,
  publishedAt,
  excerpt,
  thumbsUp,
  thumbsDown,
  lastAt,
}: Props) {
  const [voted, setVoted] = useState<"up" | "down" | null>(null);
  const [isPending, startTransition] = useTransition();

  function vote(type: "up" | "down") {
    setVoted(type);
    startTransition(async () => {
      await submitArticleFeedback(
        articleUrl,
        articleTitle,
        type === "up" ? "thumbs_up" : "thumbs_down"
      );
    });
  }

  const hasFeedback = thumbsUp > 0 || thumbsDown > 0;
  const relPub = formatRelativeTime(publishedAt);
  const relLast = lastAt ? formatRelativeTime(lastAt) : null;

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 hover:border-gray-300 transition-colors">
      <div className="flex items-start gap-4">
        {/* ── Article info ── */}
        <div className="flex-1 min-w-0">
          <a
            href={articleUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="group inline-block mb-1"
          >
            <p className="text-sm font-semibold text-slate-900 leading-snug group-hover:text-amber-700 transition-colors line-clamp-2">
              {articleTitle}
            </p>
          </a>
          {excerpt && (
            <p className="text-xs text-gray-400 mt-1 mb-1.5 leading-relaxed line-clamp-2">
              {excerpt}
            </p>
          )}
          <p className="text-xs text-gray-500">
            <span className="text-amber-600 font-medium">{sourceName}</span>
            <span className="mx-1.5 text-gray-300" aria-hidden="true">·</span>
            {relPub}
            <span className="mx-1.5 text-gray-300" aria-hidden="true">·</span>
            <a
              href={articleUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-gray-400 hover:text-amber-600 transition-colors"
            >
              Open ↗
            </a>
          </p>

          {/* Feedback history */}
          {hasFeedback && (
            <p className="text-xs text-gray-400 mt-2">
              {thumbsUp > 0 && (
                <span className="text-green-600 font-medium">👍 {thumbsUp}</span>
              )}
              {thumbsUp > 0 && thumbsDown > 0 && (
                <span className="mx-1.5 text-gray-300" aria-hidden="true">·</span>
              )}
              {thumbsDown > 0 && (
                <span className="text-red-500 font-medium">👎 {thumbsDown}</span>
              )}
              {relLast && (
                <>
                  <span className="mx-1.5 text-gray-300" aria-hidden="true">·</span>
                  <span>Last rated {relLast}</span>
                </>
              )}
            </p>
          )}
        </div>

        {/* ── Rating buttons ── */}
        <div className="shrink-0 flex items-center gap-2">
          {voted !== null ? (
            <span
              className={`text-xs font-medium px-3 py-1.5 rounded-lg ${
                voted === "up"
                  ? "bg-green-50 text-green-700 border border-green-200"
                  : "bg-red-50 text-red-600 border border-red-200"
              }`}
            >
              {voted === "up" ? "✓ Relevant" : "✕ Not relevant"}
            </span>
          ) : (
            <>
              <button
                onClick={() => vote("up")}
                disabled={isPending}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-xs font-medium text-gray-600 hover:border-green-300 hover:text-green-700 hover:bg-green-50 transition-colors disabled:opacity-50"
                aria-label="Mark as relevant"
              >
                👍 <span>Relevant</span>
              </button>
              <button
                onClick={() => vote("down")}
                disabled={isPending}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-xs font-medium text-gray-600 hover:border-red-300 hover:text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50"
                aria-label="Mark as not relevant"
              >
                👎 <span>Not relevant</span>
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
