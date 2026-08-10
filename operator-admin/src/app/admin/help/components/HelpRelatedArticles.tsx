import Link from "next/link";
import type { HowToArticle } from "@/lib/helpCenter/types";
import { articleUrl } from "@/lib/helpCenter/articles";

/** Related-help links — capped at 3 by getRelatedArticles(); renders nothing when empty. */
export default function HelpRelatedArticles({ articles }: { articles: HowToArticle[] }) {
  if (articles.length === 0) return null;

  return (
    <div className="border-t border-gray-100 pt-5 mt-6">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-3">
        Related Help
      </h3>
      <ul className="space-y-2">
        {articles.map((article) => (
          <li key={article.slug}>
            <Link
              href={articleUrl(article.slug)}
              className="text-sm font-medium text-amber-600 hover:text-amber-700 hover:underline"
            >
              {article.title}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
