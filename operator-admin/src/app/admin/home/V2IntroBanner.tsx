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
          <h3 className="text-base font-semibold text-gray-900 mb-1 leading-snug">
            You&apos;re live — guests can find you now.
          </h3>
          <p className="text-sm text-gray-600 mb-4 leading-relaxed">
            Venue HQ is your home base for keeping your listing sharp, attracting
            more guests, and growing your venue over time.
          </p>
          <button
            onClick={dismiss}
            className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white font-semibold rounded-lg text-sm transition-colors"
          >
            Let&apos;s go
          </button>
        </div>

        <button
          onClick={dismiss}
          className="shrink-0 text-gray-400 hover:text-gray-600 mt-0.5 transition-colors"
          aria-label="Dismiss"
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
