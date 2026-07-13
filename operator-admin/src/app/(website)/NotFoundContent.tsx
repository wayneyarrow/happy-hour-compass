import Link from "next/link";

/**
 * Shared public website 404 content, rendered by the shared not-found.tsx
 * boundary for every route nested under (website).
 *
 * Deliberately owns no location/market logic of any kind: the public
 * homepage (`/`) already owns location personalization and market
 * selection (see the Homepage Public Integration task) — this page must
 * never infer, read, or mutate any of that state merely because a broken
 * link was followed. Both CTAs are plain, static links with no client-side
 * behavior, which is also why this component needs no "use client" — there
 * are no hooks or browser APIs here.
 */
export function NotFoundContent() {
  const primaryCtaCls =
    "inline-flex items-center justify-center px-6 py-3 bg-amber-500 hover:bg-amber-600 text-white font-semibold rounded-full text-sm transition-colors";

  return (
    <div className="min-h-[70vh] flex items-center justify-center">
      <div className="max-w-xl mx-auto px-6 lg:px-10 py-16 text-center">
        <h1 className="text-3xl md:text-4xl font-bold text-gray-900 tracking-tight">
          Oops, we couldn&apos;t find that page.
        </h1>
        <p className="mt-4 text-base text-gray-500 max-w-md mx-auto">
          The page may have moved, been unpublished, or the link may be incorrect.
        </p>
        <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link href="/" className={primaryCtaCls}>
            Go to the Homepage
          </Link>
          <Link
            href="/website-happy-hours"
            className="inline-flex items-center justify-center px-6 py-3 border border-gray-200 text-gray-700 hover:bg-gray-50 font-semibold rounded-full text-sm transition-colors"
          >
            Browse Happy Hours
          </Link>
        </div>
      </div>
    </div>
  );
}
