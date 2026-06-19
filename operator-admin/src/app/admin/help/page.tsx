export const metadata = { title: "Help" };

import Link from "next/link";

const HELP_LINKS = [
  {
    label: "Getting Started Guide",
    description: "Set up your venue profile and publish your first listing.",
  },
  {
    label: "How to Add Specials",
    description: "Add food and drink specials to attract guests during happy hour.",
  },
  {
    label: "Contact Support",
    description: "Reach our team directly — we typically respond within one business day.",
  },
] as const;

export default function AdminHelpPage() {
  return (
    <div className="max-w-2xl">

      {/* Page heading */}
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900 mb-1">Help</h2>
        <p className="text-sm text-gray-500">
          Guides, FAQs, and support to help you get the most from your Happy Hour Compass listing.
        </p>
      </div>

      {/* Help links */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-resting divide-y divide-gray-50 mb-6">
        {HELP_LINKS.map(({ label, description }) => (
          <div
            key={label}
            className="flex items-center justify-between gap-4 px-6 py-4"
          >
            <div>
              <p className="text-sm font-medium text-gray-800">{label}</p>
              <p className="text-xs text-gray-400 mt-0.5">{description}</p>
            </div>
            <svg
              className="w-4 h-4 text-gray-300 shrink-0"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </div>
        ))}
      </div>

      {/* Coming soon notice */}
      <p className="text-xs text-gray-400 text-center">
        More help content coming soon.
      </p>

    </div>
  );
}
