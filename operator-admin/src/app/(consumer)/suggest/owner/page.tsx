import Link from "next/link";

export const metadata = { title: "List Your Venue" };

/**
 * Phase 2 stub — operator submission flow is not yet implemented.
 * This page holds the space for the future business-owner intake flow.
 */
export default function OwnerStubPage() {
  return (
    <main className="bg-white">
      {/* Page header */}
      <div className="sticky top-0 z-10 bg-white border-b border-gray-200 flex items-center px-5 py-4">
        <Link
          href="/suggest"
          className="text-blue-500 text-[24px] font-bold leading-none mr-3"
          aria-label="Back"
        >
          ‹
        </Link>
        <h1 className="flex-1 text-[18px] font-bold text-gray-900 truncate">
          List Your Venue
        </h1>
      </div>

      <div className="px-5 pt-12 pb-12 flex flex-col items-center text-center">
        <span className="text-5xl mb-6">🏠</span>
        <h2 className="text-[20px] font-bold text-gray-900 mb-3">
          Coming soon
        </h2>
        <p className="text-[15px] text-gray-500 leading-relaxed max-w-[280px] mb-8">
          We&rsquo;re building the operator signup flow. Check back soon — or
          reach out directly if you want to get listed now.
        </p>
        <Link
          href="/suggest"
          className="text-[14px] font-medium text-blue-500 hover:text-blue-600 transition-colors"
        >
          ← Back
        </Link>
      </div>
    </main>
  );
}
