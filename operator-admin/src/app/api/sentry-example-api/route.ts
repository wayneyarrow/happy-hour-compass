// ─────────────────────────────────────────────────────────────────────────────
// SENTRY INTEGRATION TEST — REMOVE AFTER VERIFICATION
//
// This route deliberately throws an unhandled error so you can confirm that
// Sentry is receiving events in production.
//
// Usage:
//   curl https://happy-hour-compass.vercel.app/api/sentry-example-api
//
// Only active when SENTRY_TEST_ROUTE_ENABLED=true is set in the environment.
// This env var must NOT be set in production after the initial verification.
//
// After verifying the Sentry alert appears in your dashboard, set the env var
// to false (or remove it), redeploy, and delete this file.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  if (process.env.SENTRY_TEST_ROUTE_ENABLED !== "true") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  throw new Error(
    "[HHC] Sentry integration test — delete /api/sentry-example-api after verifying this appears in Sentry."
  );
}
