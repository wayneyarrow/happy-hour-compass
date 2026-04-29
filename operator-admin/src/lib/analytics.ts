/**
 * Lightweight analytics helper — wraps @vercel/analytics track().
 *
 * Rules:
 *  - Client-safe: guard against SSR context via typeof window check.
 *  - Never throws: all errors are swallowed so tracking can never break the app.
 *  - No personal data: callers must not pass email, name, phone, or free-text fields.
 *  - Non-blocking: returns void synchronously; Vercel batches sends internally.
 *
 * Swap the provider later by editing the try-block only.
 */

import { track } from "@vercel/analytics";

type Properties = Record<string, string | number | boolean | null | undefined>;

export function trackEvent(name: string, properties?: Properties): void {
  if (typeof window === "undefined") return;
  try {
    track(name, properties);
  } catch {
    // Intentionally swallowed — tracking must never affect app behaviour.
  }
}
