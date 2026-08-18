import type { ReactNode } from "react";
import { GoogleAnalytics } from "@next/third-parties/google";

// Wraps auth/confirm/page.tsx only — auth/callback/route.ts is a Route
// Handler, not a page, and route handlers are never part of the layout
// tree, so this has no effect on it.
//
// Without this, consumer_email_confirmed (fired from auth/confirm/page.tsx)
// would never actually reach GA4 in any environment: this route lives
// directly under the root layout (src/app/layout.tsx), which intentionally
// does not mount <GoogleAnalytics> — only (website)/layout.tsx does, and
// this segment isn't nested under that route group either. Same env var,
// same gate, same Operator-Admin/Founder-Control-Panel exclusion as
// (website)/layout.tsx and (consumer-auth)/layout.tsx.
const GA_MEASUREMENT_ID = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      {GA_MEASUREMENT_ID && <GoogleAnalytics gaId={GA_MEASUREMENT_ID} />}
    </>
  );
}
