"use client";

// Global error boundary for Next.js App Router.
// Catches unhandled errors that bubble past all nested error.tsx boundaries
// (including root layout errors). Must be a Client Component.
// This wraps the entire app — it replaces the root layout, so it must
// include <html> and <body> tags.

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body className="flex min-h-screen items-center justify-center bg-gray-50 p-6">
        <div className="max-w-md text-center">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">
            Something went wrong
          </h1>
          <p className="text-gray-600 mb-6 text-sm">
            An unexpected error occurred. The team has been notified.
          </p>
          <button
            onClick={reset}
            className="px-5 py-2 bg-amber-500 hover:bg-amber-600 text-white font-semibold rounded-lg text-sm"
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
