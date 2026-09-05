import { notFound } from "next/navigation";
import type { Metadata } from "next";
import {
  getArticleBySlug,
  getAllArticleSlugs,
  getRelatedArticles,
} from "@/lib/helpCenter/articles";
import HelpBreadcrumbs from "../components/HelpBreadcrumbs";
import HelpArticleLayout from "../components/HelpArticleLayout";
import HelpInfoSection from "../components/HelpInfoSection";
import HelpSteps from "../components/HelpSteps";
import HelpSection from "../components/HelpSection";
import HelpRelatedArticles from "../components/HelpRelatedArticles";
import HelpNeedSupport from "../components/HelpNeedSupport";
import HelpViewTracker from "../HelpViewTracker";

// Content is static, code-defined data (see src/lib/helpCenter/articles.ts) —
// every known slug can be prerendered at build time. Adding a new article to
// the registry is enough for it to get a static page; no route changes needed.
export function generateStaticParams() {
  return getAllArticleSlugs().map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const article = getArticleBySlug(slug);
  return { title: article?.title ?? "Help" };
}

/** Standard How-To Article renderer — the single route every How-To article shares. */
export default async function HelpArticlePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const article = getArticleBySlug(slug);
  if (!article) notFound();

  const related = getRelatedArticles(article);

  return (
    <div>
      <HelpViewTracker articleSlug={article.slug} />
      <HelpBreadcrumbs current={article.title} />

      <HelpArticleLayout
        title={article.title}
        summary={article.summary}
        isPlaceholder={article.isPlaceholder}
      >
        <HelpInfoSection heading="Before you start" items={article.beforeYouStart} />

        <div className={article.beforeYouStart?.length ? "mt-6" : ""}>
          <HelpSteps steps={article.steps} />
        </div>

        {article.closingSection && (
          <div className="border-t border-gray-100 pt-5 mt-6">
            <HelpSection section={article.closingSection} />
          </div>
        )}

        <HelpInfoSection heading="What happens next?" paragraph={article.whatHappensNext} />
        <HelpInfoSection heading="Good to know" items={article.goodToKnow} />
        <HelpRelatedArticles articles={related} />
      </HelpArticleLayout>

      <div className="max-w-2xl mt-6">
        <HelpNeedSupport />
      </div>
    </div>
  );
}
