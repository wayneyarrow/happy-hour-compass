import type { EmailCodeVerificationStatus } from "@/lib/activation/emailCodeVerificationTypes";

/**
 * Pure, client-safe helpers for the /operator/verify screen — kept out of
 * the component so they're unit-testable without a DOM.
 */

/**
 * Keeps digits only, max six — so typing, a pasted "123 456" / "123-456",
 * or a mobile one-time-code autofill all land as exactly the code.
 */
export function normalizeCodeInput(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, 6);
}

/** "m:ss" for a countdown, or "h:mm:ss" once it's an hour or more (the daily limit). */
export function formatCountdown(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const ss = String(seconds).padStart(2, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${ss}` : `${minutes}:${ss}`;
}

/** Clock time, with the weekday when it isn't today (the daily limit can free up tomorrow). */
export function formatClockTime(iso: string, now: Date = new Date()): string {
  const at = new Date(iso);
  const time = at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return at.toDateString() === now.toDateString()
    ? time
    : `${at.toLocaleDateString([], { weekday: "long" })} at ${time}`;
}

/** Plain, non-technical copy for every outcome the server can return. */
export function messageForStatus(status: EmailCodeVerificationStatus, resendAvailableAt?: string | null): string {
  switch (status) {
    case "code_sent":
      return "We sent you a new code. Codes expire after 10 minutes.";
    case "invalid_code":
      return "That code isn’t right. Check the email and try again.";
    case "invalid_format":
      return "Enter the 6-digit code from your email.";
    case "expired":
      return "That code has expired. Request a new code to continue.";
    case "attempts_exhausted":
      return "Too many incorrect attempts. Request a new code to continue.";
    case "resend_cooldown":
      return "A code was just sent. You can request another in a moment.";
    case "rate_limited": {
      // Shared by the hourly send cap and the daily lifecycle limit.
      if (!resendAvailableAt) return "For your security, please wait before trying again.";
      const when = formatClockTime(resendAvailableAt);
      return `For your security, please wait before trying again. You can request a new code ${when.includes(" at ") ? "on" : "at"} ${when}.`;
    }
    case "send_failed":
      return "We couldn’t send the code. Please try again in a minute.";
    case "verified":
      return "Email verified.";
    case "unavailable":
      return "Something went wrong. Please refresh the page and try again.";
  }
}
