import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Events Search — Happy Hour Compass",
  robots: { index: false },
};

export default function EventsSearchPage() {
  return (
    <div className="min-h-[calc(100dvh-72px)] flex flex-col items-center justify-center px-6 text-center">
      <div className="max-w-md">
        <div className="w-14 h-14 rounded-2xl bg-amber-100 flex items-center justify-center mx-auto mb-6">
          <svg
            className="w-7 h-7 text-amber-500"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
            />
          </svg>
        </div>
        <h1 className="text-2xl font-bold text-gray-900 tracking-tight">
          Events Search
        </h1>
        <p className="mt-3 text-base text-gray-500 leading-relaxed">
          The events search experience is coming soon — browse upcoming events by date, filter by type, and find something worth going out for.
        </p>
        <div className="mt-8">
          <Link
            href="/"
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-amber-500 hover:bg-amber-600 text-white font-semibold rounded-full text-sm transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            Back to Home
          </Link>
        </div>
      </div>
    </div>
  );
}
