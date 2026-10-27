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
 *   unavailable — permission allowed but no position (timeout, no fix)
 *   unsupported — no navigator.geolocation at all
 */
export type BrowserLocationStatus =
  | "idle"
  | "requesting"
  | "granted"
  | "denied"
  | "unavailable"
  | "unsupported";

export type BrowserCoords = { lat: number; lng: number };

export function useBrowserLocation({ timeoutMs = 8000 }: { timeoutMs?: number } = {}) {
  const [coords, setCoords] = useState<BrowserCoords | null>(null);
  const [status, setStatus] = useState<BrowserLocationStatus>("idle");
  const inFlightRef = useRef(false);
  const mountedRef = useRef(false);

  const request = useCallback((): Promise<BrowserLocationStatus> => {
    return new Promise((resolve) => {
      if (typeof navigator === "undefined" || !navigator.geolocation) {
        setStatus("unsupported");
        resolve("unsupported");
        return;
      }
      if (inFlightRef.current) {
        resolve("requesting");
        return;
      }
      inFlightRef.current = true;
      setStatus("requesting");
      navigator.geolocation.getCurrentPosition(
        ({ coords: c }) => {
          inFlightRef.current = false;
          if (mountedRef.current) {
            setCoords({ lat: c.latitude, lng: c.longitude });
            setStatus("granted");
          }
          resolve("granted");
        },
        (err) => {
          inFlightRef.current = false;
          const next: BrowserLocationStatus =
            err.code === err.PERMISSION_DENIED ? "denied" : "unavailable";
          if (mountedRef.current) setStatus(next);
          resolve(next);
        },
        { timeout: timeoutMs, maximumAge: 60_000 }
      );
    });
  }, [timeoutMs]);

  useEffect(() => {
    mountedRef.current = true;
    let cancelled = false;
    const permissions = typeof navigator !== "undefined" ? navigator.permissions : undefined;
    if (navigator.geolocation && permissions?.query) {
      permissions
        .query({ name: "geolocation" })
        .then((result) => {
          if (cancelled) return;
          if (result.state === "granted") void request();
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

  return { coords, status, request };
}
