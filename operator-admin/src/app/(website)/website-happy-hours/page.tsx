import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Happy Hour Search — Happy Hour Compass",
  robots: { index: false },
};

export default function HappyHoursSearchPage() {
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
              d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"
            />
          </svg>
        </div>
        <h1 className="text-2xl font-bold text-gray-900 tracking-tight">
          Happy Hour Search
        </h1>
        <p className="mt-3 text-base text-gray-500 leading-relaxed">
          The search results experience is coming soon — map, filters, and rich venue cards designed to help you confidently decide where to go.
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
