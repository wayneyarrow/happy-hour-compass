"use client";

import { useState, useTransition } from "react";
import { dismissV2IntroAction } from "./actions";

export default function V2IntroBanner() {
  // Hide immediately on click; the server action persists the state and
  // revalidates the page so the banner stays gone on next navigation too.
  const [dismissed, setDismissed] = useState(false);
  const [, startTransition] = useTransition();

  function dismiss() {
    setDismissed(true);
    startTransition(async () => {
      await dismissV2IntroAction();
    });
  }

  if (dismissed) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="mb-6 bg-gradient-to-br from-amber-50 to-orange-50 border border-amber-200 rounded-xl p-5 shadow-sm"
    >
      <div className="flex items-start gap-3">
        <span className="text-xl shrink-0 mt-0.5" aria-hidden="true">🎉</span>

        <div className="flex-1 min-w-0">
          <h3 className="text-base font-semibold text-gray-900 mb-0.5 leading-snug">
            Your venue is now customer-ready
          </h3>
          <p className="text-sm text-gray-600 mb-3">
            Your listing is live and onboarding is complete.
          </p>
          <p className="text-sm text-gray-700 mb-2">
            Welcome to <span className="font-semibold">Venue HQ</span> — a place to help
            improve your listing, discover opportunities, and grow your business.
          </p>
          <p className="text-xs text-gray-500 mb-2">You&apos;ll now see:</p>
          <ul className="space-y-1.5 mb-4">
            {[
              "Suggested next steps",
              "Venue health",
              "Venue snapshots",
              "Industry resources",
            ].map((item) => (
              <li key={item} className="flex items-center gap-2 text-sm text-gray-700">
                <svg
                  className="w-4 h-4 text-green-500 shrink-0"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                  aria-hidden="true"
                >
                  <path
                    fillRule="evenodd"
                    d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                    clipRule="evenodd"
                  />
                </svg>
                {item}
              </li>
            ))}
          </ul>

          <div className="flex items-center gap-3 flex-wrap">
            {/* Tour is a future feature; both buttons dismiss for now */}
            <button
              onClick={dismiss}
              className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white font-semibold rounded-lg text-sm transition-colors"
            >
              Take a quick tour
            </button>
            <button
              onClick={dismiss}
              className="px-4 py-2 bg-white hover:bg-gray-50 border border-gray-200 text-gray-700 font-medium rounded-lg text-sm transition-colors"
            >
              Got it
            </button>
          </div>
        </div>

        <button
          onClick={dismiss}
          className="shrink-0 text-gray-400 hover:text-gray-600 mt-0.5 transition-colors"
          aria-label="Dismiss welcome message"
        >
          <svg
            className="w-5 h-5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}
