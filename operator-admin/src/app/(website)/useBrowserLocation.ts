"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Deferred browser location for the public website.
 *
 * Never shows a permission prompt on its own. On mount it only reads the
 * position when the Permissions API already reports "granted" (no prompt is
 * possible in that state), so returning visitors who allowed location keep
 * distances and Nearest sorting. Everyone else gets a position only after
 * calling `request()` from an explicit action (Near Me, choosing Nearest,
 * "Use my location").
 *
 * Browsers without the Permissions API, or without a geolocation permission
 * descriptor (older iOS Safari, some in-app browsers), simply stay "idle"
 * until an explicit request — they never fall back to prompting on load.
 *
 * Status:
 *   idle        — nothing requested yet, or permission not yet decided
 *   requesting  — a getCurrentPosition() call is in flight
 *   granted     — coords available
 *   denied      — permission denied (now or previously)
 *   unavailable — permission allowed but no position; `unavailableReason`
 *                 says whether the browser timed out or reported that no
 *                 position could be determined
 *   unsupported — no navigator.geolocation at all
 *
 * request() resolves with the outcome of the attempt it ends up waiting on.
 * A call made while another attempt is in flight joins it (no duplicate
 * browser request) — except that an explicit request joining the silent
 * mount-time read gets a fresh attempt of its own if that read fails, so a
 * tap never fails early just because it arrived late in the silent read's
 * timeout window.
 */
export type BrowserLocationStatus =
  | "idle"
  | "requesting"
  | "granted"
  | "denied"
  | "unavailable"
  | "unsupported";

export type BrowserCoords = { lat: number; lng: number };

export type BrowserLocationUnavailableReason = "timeout" | "position_unavailable";

export function useBrowserLocation({ timeoutMs = 8000 }: { timeoutMs?: number } = {}) {
  const [coords, setCoords] = useState<BrowserCoords | null>(null);
  const [status, setStatus] = useState<BrowserLocationStatus>("idle");
  const [unavailableReason, setUnavailableReason] = useState<BrowserLocationUnavailableReason | null>(null);
  const inFlightRef = useRef<{ promise: Promise<BrowserLocationStatus>; silent: boolean } | null>(null);
  const mountedRef = useRef(false);

  const start = useCallback(
    (silent: boolean): Promise<BrowserLocationStatus> => {
      setStatus("requesting");
      const attempt = { promise: null as unknown as Promise<BrowserLocationStatus>, silent };
      attempt.promise = new Promise((resolve) => {
        navigator.geolocation.getCurrentPosition(
          ({ coords: c }) => {
            if (inFlightRef.current === attempt) inFlightRef.current = null;
            if (mountedRef.current) {
              setCoords({ lat: c.latitude, lng: c.longitude });
              setStatus("granted");
              setUnavailableReason(null);
            }
            resolve("granted");
          },
          (err) => {
            if (inFlightRef.current === attempt) inFlightRef.current = null;
            const next: BrowserLocationStatus =
              err.code === err.PERMISSION_DENIED ? "denied" : "unavailable";
            if (mountedRef.current) {
              setStatus(next);
              setUnavailableReason(
                next !== "unavailable" ? null : err.code === err.TIMEOUT ? "timeout" : "position_unavailable"
              );
            }
            resolve(next);
          },
          { timeout: timeoutMs, maximumAge: 60_000 }
        );
      });
      inFlightRef.current = attempt;
      return attempt.promise;
    },
    [timeoutMs]
  );

  const request = useCallback(
    ({ silent = false }: { silent?: boolean } = {}): Promise<BrowserLocationStatus> => {
      if (typeof navigator === "undefined" || !navigator.geolocation) {
        setStatus("unsupported");
        return Promise.resolve("unsupported");
      }
      const current = inFlightRef.current;
      if (!current) return start(silent);
      if (silent || !current.silent) return current.promise;
      // Explicit request joining the silent read: if that read fails, make
      // this request's own attempt rather than reporting its failure.
      return current.promise.then((s) =>
        s === "granted" ? s : inFlightRef.current ? inFlightRef.current.promise : start(false)
      );
    },
    [start]
  );

  useEffect(() => {
    mountedRef.current = true;
    let cancelled = false;
    const permissions = typeof navigator !== "undefined" ? navigator.permissions : undefined;
    if (navigator.geolocation && permissions?.query) {
      permissions
        .query({ name: "geolocation" })
        .then((result) => {
          if (cancelled) return;
          if (result.state === "granted") void request({ silent: true });
          else if (result.state === "denied") setStatus("denied");
        })
        .catch(() => {
          // Descriptor unsupported — stay idle until an explicit request.
        });
    }
    return () => {
      cancelled = true;
      mountedRef.current = false;
    };
  }, [request]);

  return { coords, status, unavailableReason, request };
}
