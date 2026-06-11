import * as Sentry from "@sentry/nextjs";

// Next.js instrumentation hook — loads Sentry before the first request is handled.
// This file is intentionally at src/ root so Next.js picks it up automatically.
// See: https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("../sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("../sentry.edge.config");
  }
}

// Capture errors from nested React Server Components and Route Handlers.
export const onRequestError = Sentry.captureRequestError;
