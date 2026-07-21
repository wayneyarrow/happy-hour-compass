"use client";

import Script from "next/script";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: HTMLElement,
        options: {
          sitekey: string;
          callback: (token: string) => void;
          "expired-callback"?: () => void;
          "error-callback"?: () => void;
          "timeout-callback"?: () => void;
          size?: "normal" | "compact" | "flexible";
        }
      ) => string;
      reset: (widgetId?: string) => void;
      remove: (widgetId?: string) => void;
    };
  }
}

export type TurnstileHandle = {
  /** Clears the current token and re-renders a fresh challenge. Call this
   *  after the server reports the token as failed, expired, or reused. */
  reset: () => void;
};

type TurnstileProps = {
  /** Called with a fresh token whenever the widget completes the challenge. */
  onVerify: (token: string) => void;
  /** Called when the token expires, errors out, or times out. Clear any
   *  stored token in response — a stale token must not be submitted. */
  onExpire?: () => void;
  className?: string;
};

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js";

/**
 * Shared Cloudflare Turnstile widget for every unauthenticated public form.
 *
 * Widget completion here is a UI gate only — it is never sufficient on its
 * own. The resulting token must be verified server-side via
 * verifyTurnstileToken() (src/lib/turnstile.ts) before any submission side
 * effect. See CLAUDE.md's Turnstile section.
 *
 * Uses explicit rendering (window.turnstile.render) rather than the
 * implicit data-sitekey div so the parent form can reset the widget
 * imperatively via the forwarded ref after a failed submission.
 */
export const Turnstile = forwardRef<TurnstileHandle, TurnstileProps>(function Turnstile(
  { onVerify, onExpire, className },
  ref
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const [scriptReady, setScriptReady] = useState(false);

  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

  // Refs so the render effect below doesn't need onVerify/onExpire in its
  // dependency array — those are typically new closures on every render.
  const onVerifyRef = useRef(onVerify);
  const onExpireRef = useRef(onExpire);
  useEffect(() => {
    onVerifyRef.current = onVerify;
    onExpireRef.current = onExpire;
  });

  useImperativeHandle(
    ref,
    () => ({
      reset: () => {
        if (window.turnstile && widgetIdRef.current) {
          window.turnstile.reset(widgetIdRef.current);
        }
      },
    }),
    []
  );

  useEffect(() => {
    if (!scriptReady || !siteKey || !containerRef.current) return;
    if (!window.turnstile) return;
    if (widgetIdRef.current) return; // Already rendered for this mount.

    const container = containerRef.current;
    const widgetId = window.turnstile.render(container, {
      sitekey: siteKey,
      callback: (token) => onVerifyRef.current(token),
      "expired-callback": () => onExpireRef.current?.(),
      "error-callback": () => onExpireRef.current?.(),
      "timeout-callback": () => onExpireRef.current?.(),
      size: "flexible",
    });
    widgetIdRef.current = widgetId;

    return () => {
      if (window.turnstile) {
        window.turnstile.remove(widgetId);
      }
      widgetIdRef.current = null;
    };
  }, [scriptReady, siteKey]);

  if (!siteKey) {
    if (process.env.NODE_ENV !== "production") {
      console.error("[Turnstile] NEXT_PUBLIC_TURNSTILE_SITE_KEY is not set.");
    }
    return null;
  }

  return (
    <>
      <Script
        src={SCRIPT_SRC}
        strategy="afterInteractive"
        onReady={() => setScriptReady(true)}
      />
      <div ref={containerRef} className={className} />
    </>
  );
});
