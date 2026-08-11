export const metadata = { title: "Help" };

import Link from "next/link";
import { getArticleBySlug, articleUrl } from "@/lib/helpCenter/articles";
import type { HowToArticle } from "@/lib/helpCenter/types";
import HelpNeedSupport from "./components/HelpNeedSupport";

/**
 * Landing-page-only presentation grouping for the approved V1 How-To
 * article inventory. Deliberately separate from `article.category` (every
 * real article's own data still says "Managing Your Venue", used nowhere
 * else — see articles.ts) — this is purely how the landing page chooses to
 * group and order the same approved articles into three scannable sets as
 * the inventory has grown, without introducing a real category taxonomy or
 * touching approved article content. Titles/slugs below must match
 * articles.ts exactly; a slug with no matching article is silently skipped
 * (resolveGroups filters undefined) rather than breaking the page.
 *
 * The two Internal Preview sample articles (sample-article-renderer-check,
 * sample-article-minimal) are intentionally omitted from every group here —
 * see their entries in articles.ts for why they're retained in the registry
 * (renderer coverage for `list`/`afterList`/`beforeYouStart`/
 * `whatHappensNext`/`goodToKnow`, which no real article currently exercises)
 * despite no longer appearing anywhere in this user-facing navigation.
 */
const ARTICLE_GROUPS: { heading: string; slugs: string[] }[] = [
  {
    heading: "Set Up Your Venue",
    slugs: ["manage-venue-information", "manage-venue-images", "publish-unpublish-venue"],
  },
  {
    heading: "Happy Hours & Events",
    slugs: ["manage-happy-hours", "create-event", "manage-events"],
  },
  {
    heading: "Account & Growth",
    slugs: [
      "understand-subscriptions-and-limits",
      "manage-users",
      "understand-analytics",
      "manage-search-tags",
    ],
  },
];

function resolveGroups(): { heading: string; articles: HowToArticle[] }[] {
  return ARTICLE_GROUPS.map(({ heading, slugs }) => ({
    heading,
    articles: slugs
      .map((slug) => getArticleBySlug(slug))
      .filter((a): a is HowToArticle => !!a),
  }));
}

export default function AdminHelpPage() {
  const groups = resolveGroups();

  return (
    <div className="max-w-4xl">

      {/* ── Page heading ──────────────────────────────────────────────────── */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">Help Center</h1>
        <p className="text-sm text-gray-500">
          Guides, how-tos, and support to help you get the most from your Happy Hour Compass listing.
        </p>
      </div>

      {/* ── Top area: Getting Started (larger) + Need help? (compact) ───────
          lg:grid-cols-[2fr_1fr] mirrors the same asymmetric-split idiom
          already used for the Events editor (EventsManager.tsx) — stacks to
          a single column below lg so Getting Started and Need help? land
          next to each other only once there's genuinely enough width for a
          balanced 2/1 split; both simply stack in document order otherwise. */}
      <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-4 mb-8">
        <Link
          href="/admin/help/getting-started"
          className="group block bg-white rounded-xl border border-gray-200 shadow-resting hover:shadow-hover hover:border-amber-200 transition-all p-6"
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

        <HelpNeedSupport compact />
      </div>

      {/* ── Article groups ────────────────────────────────────────────────── */}
      {groups.map((group) => (
        <div key={group.heading} className="mb-8">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2.5">
            {group.heading}
          </h2>
          <div className="bg-white rounded-xl border border-gray-200 shadow-resting divide-y divide-gray-50">
            {group.articles.map((article) => (
              <Link
                key={article.slug}
                href={articleUrl(article.slug)}
                className="flex items-center justify-between gap-4 px-6 py-4 hover:bg-gray-50 transition-colors"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">{article.title}</p>
                  <p className="text-xs text-gray-400 mt-0.5 leading-relaxed line-clamp-2">
                    {article.summary}
                  </p>
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

    </div>
  );
}
