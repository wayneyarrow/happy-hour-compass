import Link from "next/link";

/**
 * Collection Landing Page breadcrumb: Home > {Collection Name}. Ports the
 * exact inline breadcrumb markup already used by the venue detail page
 * ((website)/[market]/[city]/[slug]/page.tsx) and the Guide detail view
 * (GuideDetailView.tsx) rather than inventing new styling — same wrapper
 * classes, same hand-drawn chevron SVG, same truncation on the final
 * (current-page) segment so long Collection names don't wrap on narrow
 * screens. No separate mobile layout: the single flex row already stays
 * compact at every width via `truncate min-w-0` on the last segment.
 *
 * "Home" always links to `/` — exactly what the venue page's breadcrumb
 * does today, since the public site's `/` already resolves to "the
 * applicable Market homepage" for the current session (see the Homepage
 * Public Integration task). No "Collections" level: there is no general
 * Collections index page to link to, and a plain-text, non-clickable
 * "Collections" label reads as a broken link — see Beta Feedback Roadmap
 * item #5. Revisit only if a real Collections index page is built.
 */

function BreadcrumbChevron() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="w-3.5 h-3.5 shrink-0 text-gray-300"
      aria-hidden="true"
    >
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

type Props = {
  collectionName: string;
  /**
   * Trims the standalone-hero vertical padding for embedding inside another
   * component's own padded container (e.g. the Happy Hour search context
   * header slot — see CollectionTypeContent.tsx's CollectionSearchContextHeader),
   * which already provides top/bottom spacing of its own.
   */
  compact?: boolean;
};

export function CollectionBreadcrumb({ collectionName, compact = false }: Props) {
  return (
    <nav
      aria-label="Breadcrumb"
      className={`flex items-center gap-1.5 text-sm text-gray-500 min-w-0 ${
        compact ? "pb-1" : "pt-5 pb-4"
      }`}
    >
      <Link
        href="/"
        className="hover:text-gray-900 transition-colors shrink-0 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
      >
        Home
      </Link>
      <BreadcrumbChevron />
      <span className="text-gray-900 font-medium truncate min-w-0">{collectionName}</span>
    </nav>
  );
}
