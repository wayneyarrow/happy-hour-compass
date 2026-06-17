"use client";

const SESSION_KEY = "hhc_session_id";

/**
 * Retrieves or creates an anonymous browser session ID stored in sessionStorage.
 * The same ID is reused for all tracking events within a browser session.
 * Falls back to a one-off UUID if sessionStorage is unavailable.
 *
 * Must only be called from client components ("use client").
 */
export function getSessionId(): string {
  try {
    const existing = sessionStorage.getItem(SESSION_KEY);
    if (existing) return existing;
    const id = crypto.randomUUID();
    sessionStorage.setItem(SESSION_KEY, id);
    return id;
  } catch {
    return crypto.randomUUID();
  }
}
