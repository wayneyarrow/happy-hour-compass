import Link from "next/link";

/**
 * Add a Happy Hour — chooser screen.
 * First step: user selects whether they are a customer or a business owner.
 */
export default function SuggestChooserPage() {
  return (
    <main className="px-5 pt-8 pb-12">
      <h1 className="text-[23px] font-bold text-gray-900 mb-1 tracking-tight">
        Add a Happy Hour
      </h1>
      <p className="text-[14px] text-gray-500 mb-8">
        Which best describes you?
      </p>

      <div className="flex flex-col gap-3">
        {/* Customer path */}
        <Link
          href="/suggest/customer"
          className="flex items-center gap-4 p-5 rounded-2xl bg-white hover:shadow-[0_6px_20px_rgba(0,0,0,0.12)] active:scale-[0.99] transition-all duration-150"
          style={{ boxShadow: "0 2px 10px rgba(0,0,0,0.08)", border: "1px solid #f0f0f0" }}
        >
          {/* Icon circle — amber */}
          <div className="w-12 h-12 rounded-2xl bg-amber-50 flex items-center justify-center shrink-0 text-2xl border border-amber-100">
            🍺
          </div>
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
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="w-4 h-4 text-gray-300 shrink-0"
          >
            <path d="m9 18 6-6-6-6" />
          </svg>
        </Link>

        {/* Owner path */}
        <Link
          href="/suggest/owner"
          className="flex items-center gap-4 p-5 rounded-2xl bg-white hover:shadow-[0_6px_20px_rgba(0,0,0,0.12)] active:scale-[0.99] transition-all duration-150"
          style={{ boxShadow: "0 2px 10px rgba(0,0,0,0.08)", border: "1px solid #f0f0f0" }}
        >
          {/* Icon circle — blue */}
          <div className="w-12 h-12 rounded-2xl bg-blue-50 flex items-center justify-center shrink-0 text-2xl border border-blue-100">
            🍽️
          </div>
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
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="w-4 h-4 text-gray-300 shrink-0"
          >
            <path d="m9 18 6-6-6-6" />
          </svg>
        </Link>

        {/* Contact Us */}
        <Link
          href="/contact"
          className="flex items-center gap-4 p-5 rounded-2xl bg-white hover:shadow-[0_6px_20px_rgba(0,0,0,0.08)] active:scale-[0.99] transition-all duration-150"
          style={{ boxShadow: "0 1px 6px rgba(0,0,0,0.06)", border: "1px solid #f5f5f5" }}
        >
          {/* Icon circle — gray */}
          <div className="w-12 h-12 rounded-2xl bg-gray-50 flex items-center justify-center shrink-0 text-2xl border border-gray-100">
            ✉️
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[16px] font-semibold text-gray-900">
              Contact Us
            </p>
            <p className="text-[13px] text-gray-500 mt-0.5">
              Get in touch with the Happy Hour Compass team
            </p>
          </div>
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="w-4 h-4 text-gray-300 shrink-0"
          >
            <path d="m9 18 6-6-6-6" />
          </svg>
        </Link>
      </div>

      {/* Legal links */}
      <div className="mt-10 pt-6 border-t border-gray-100 flex items-center justify-center gap-5">
        <a href="/terms" className="text-[12px] text-gray-400 hover:text-gray-600 transition-colors">
          Terms of Service
        </a>
        <span className="text-gray-300 text-[12px]">·</span>
        <a href="/privacy" className="text-[12px] text-gray-400 hover:text-gray-600 transition-colors">
          Privacy Policy
        </a>
      </div>
    </main>
  );
}
