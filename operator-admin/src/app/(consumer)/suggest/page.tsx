import Link from "next/link";

/**
 * Add a Happy Hour — chooser screen.
 * First step: user selects whether they are a customer or a business owner.
 * In Phase 2 only the customer path is fully implemented.
 */
export default function SuggestChooserPage() {
  return (
    <main className="px-5 pt-8 pb-12">
      <h1 className="text-[22px] font-bold text-gray-900 mb-1">
        Add a Happy Hour
      </h1>
      <p className="text-[14px] text-gray-500 mb-8">
        Which best describes you?
      </p>

      <div className="flex flex-col gap-3">
        {/* Customer path — fully implemented */}
        <Link
          href="/suggest/customer"
          className="flex items-center gap-4 p-5 rounded-xl border border-gray-200 hover:bg-gray-50 active:bg-gray-100 transition-colors"
        >
          <span className="text-2xl shrink-0">🍺</span>
          <div className="flex-1 min-w-0">
            <p className="text-[16px] font-semibold text-gray-900">
              I&rsquo;m a customer
            </p>
            <p className="text-[13px] text-gray-500 mt-0.5">
              Suggest your favourite happy hour
            </p>
          </div>
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="w-4 h-4 text-gray-300 shrink-0"
          >
            <path d="m9 18 6-6-6-6" />
          </svg>
        </Link>

        {/* Business owner path — stub only in Phase 2 */}
        <Link
          href="/suggest/owner"
          className="flex items-center gap-4 p-5 rounded-xl border border-gray-200 hover:bg-gray-50 active:bg-gray-100 transition-colors"
        >
          <span className="text-2xl shrink-0">🍽️</span>
          <div className="flex-1 min-w-0">
            <p className="text-[16px] font-semibold text-gray-900">
              I&rsquo;m a business owner
            </p>
            <p className="text-[13px] text-gray-500 mt-0.5">
              Add your restaurant or bar
            </p>
          </div>
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="w-4 h-4 text-gray-300 shrink-0"
          >
            <path d="m9 18 6-6-6-6" />
          </svg>
        </Link>
      </div>
    </main>
  );
}
