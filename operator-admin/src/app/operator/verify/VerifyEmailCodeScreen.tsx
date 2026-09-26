"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  continueAfterVerificationAction,
  requestVerificationCodeAction,
  verifyCodeAction,
} from "./actions";
import type {
  EmailCodeActionResult,
  VerificationPageView,
} from "@/lib/activation/emailCodeVerificationTypes";
import { normalizeCodeInput, messageForStatus, formatCountdown } from "./verifyScreenLogic";

type Props = { token: string; initialView: VerificationPageView };

type Message = { tone: "error" | "info"; text: string } | null;

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-50 px-4 py-10">
      <div className="w-full max-w-md">
        <div className="flex justify-center mb-8">
          <Image src="/logo.png" alt="Happy Hour Compass" width={80} height={80} className="rounded-xl" />
        </div>
        <div className="bg-white p-6 sm:p-8 rounded-xl shadow-md">{children}</div>
      </div>
    </main>
  );
}

function Notice({ title, body, link }: { title: string; body: string; link?: { href: string; label: string } }) {
  return (
    <Shell>
      <div className="text-center">
        <h1 className="text-xl font-bold text-gray-900 mb-2">{title}</h1>
        <p className="text-sm text-gray-500 mb-5 leading-relaxed">{body}</p>
        {link &&
          (link.href.startsWith("/") ? (
            <Link href={link.href} className="text-sm text-amber-600 hover:text-amber-700 font-medium">
              {link.label}
            </Link>
          ) : (
            <a href={link.href} className="text-sm text-amber-600 hover:text-amber-700 font-medium">
              {link.label}
            </a>
          ))}
      </div>
    </Shell>
  );
}

/** Ticks once a second while `target` is in the future; returns ms remaining (0 when passed/absent). */
function useRemainingMs(target: string | null): number {
  const [now, setNow] = useState(() => Date.now());
  const targetMs = target ? new Date(target).getTime() : 0;
  useEffect(() => {
    if (!targetMs || targetMs <= Date.now()) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [targetMs]);
  return targetMs ? Math.max(0, targetMs - now) : 0;
}

const primaryButton =
  "w-full py-2.5 px-4 bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-white font-semibold rounded-lg text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed";

export default function VerifyEmailCodeScreen({ token, initialView }: Props) {
  const router = useRouter();
  const [view, setView] = useState<VerificationPageView>(initialView);
  const [code, setCode] = useState("");
  const [message, setMessage] = useState<Message>(null);
  const [busy, setBusy] = useState<"verify" | "send" | "continue" | null>(null);
  const [continueFailed, setContinueFailed] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // Synchronous guards — a double click / Enter / auto-submit can't fire a
  // second request before the disabled re-render lands. The server is safe
  // regardless (the database serializes issuance and consumption); these
  // just keep the UI from showing a spurious second outcome.
  const inFlightRef = useRef(false);

  const pending = view.view === "pending" ? view : null;
  const resendRemainingMs = useRemainingMs(pending?.resendAvailableAt ?? null);
  const expiryRemainingMs = useRemainingMs(pending?.hasCurrentCode ? pending.expiresAt : null);
  const codeLapsed = !!pending?.hasCurrentCode && !!pending.expiresAt && expiryRemainingMs === 0;
  const showCodeForm = !!pending?.hasCurrentCode && !codeLapsed;

  useEffect(() => {
    if (showCodeForm) inputRef.current?.focus();
  }, [showCodeForm]);

  function applyPending(result: EmailCodeActionResult, patch: Partial<Extract<VerificationPageView, { view: "pending" }>>) {
    setView((current) =>
      current.view === "pending"
        ? {
            ...current,
            ...patch,
            resendAvailableAt: result.resendAvailableAt !== undefined ? result.resendAvailableAt : current.resendAvailableAt,
          }
        : current
    );
  }

  function handleVerified(result: EmailCodeActionResult) {
    if (result.next) {
      setMessage({ tone: "info", text: "Email verified. Taking you to create your password…" });
      // Full navigation so the new session cookies are sent with the request.
      window.location.assign(result.next);
      return;
    }
    const maskedEmail = view.view === "pending" || view.view === "verified" ? view.maskedEmail : "";
    setView({ view: "verified", maskedEmail, continueVia: "proof" });
    setMessage(null);
  }

  async function sendCode() {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setBusy("send");
    setMessage(null);
    try {
      const result = await requestVerificationCodeAction(token);
      if (result.status === "code_sent") {
        applyPending(result, { hasCurrentCode: true, notice: null, expiresAt: result.expiresAt ?? null });
        setCode("");
        setMessage({ tone: "info", text: messageForStatus("code_sent", null, { isResend: result.isResend === true }) });
      } else if (result.status === "verified") {
        router.refresh();
      } else if (result.status === "send_failed") {
        // A code was issued but its email didn't go out (the server records
        // this against that code). Whatever code form was showing is now
        // stale, so switch to the same "send a new code" state a reload shows.
        applyPending(result, { hasCurrentCode: false, notice: "delivery_failed", expiresAt: null });
        setCode("");
      } else {
        applyPending(result, {});
        setMessage({ tone: "error", text: messageForStatus(result.status, result.resendAvailableAt) });
        if (result.status === "unavailable") router.refresh();
      }
    } catch {
      setMessage({ tone: "error", text: messageForStatus("unavailable") });
    } finally {
      inFlightRef.current = false;
      setBusy(null);
    }
  }

  async function submitCode(value: string) {
    if (inFlightRef.current) return;
    if (value.length !== 6) {
      setMessage({ tone: "error", text: messageForStatus("invalid_format") });
      return;
    }
    inFlightRef.current = true;
    setBusy("verify");
    setMessage(null);
    try {
      const result = await verifyCodeAction(token, value);
      if (result.status === "verified") {
        handleVerified(result);
        return;
      }
      if (result.status === "rate_limited") {
        applyPending(result, { hasCurrentCode: false, notice: "rate_limited", expiresAt: null });
        setCode("");
        setMessage(null);
        return;
      }
      if (result.status === "expired" || result.status === "attempts_exhausted") {
        applyPending(result, {
          hasCurrentCode: false,
          notice: result.status === "expired" ? "expired" : "attempts_exhausted",
          expiresAt: null,
        });
      }
      setCode("");
      setMessage({ tone: "error", text: messageForStatus(result.status) });
      if (result.status === "unavailable") router.refresh();
      else inputRef.current?.focus();
    } catch {
      setMessage({ tone: "error", text: messageForStatus("unavailable") });
    } finally {
      inFlightRef.current = false;
      setBusy(null);
    }
  }

  async function continueSetup() {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setBusy("continue");
    try {
      const result = await continueAfterVerificationAction(token);
      if (result.status === "verified" && result.next) {
        window.location.assign(result.next);
        return;
      }
      setContinueFailed(true);
    } catch {
      setContinueFailed(true);
    } finally {
      inFlightRef.current = false;
      setBusy(null);
    }
  }

  // ── Terminal states ────────────────────────────────────────────────────────

  if (view.view === "unavailable") {
    return (
      <Notice
        title="This link isn’t available"
        body="This setup link isn’t valid or can’t be used right now. If you were setting up your venue account, contact us and we’ll help you finish."
        link={{ href: "mailto:hello@happyhourcompass.com", label: "Contact hello@happyhourcompass.com →" }}
      />
    );
  }
  if (view.view === "closed") {
    return (
      <Notice
        title="This setup link has expired"
        body="The window to finish setting up this account has closed. Contact us and we’ll get you set up."
        link={{ href: "mailto:hello@happyhourcompass.com", label: "Contact hello@happyhourcompass.com →" }}
      />
    );
  }
  if (view.view === "activated") {
    return (
      <Notice
        title="Your account is already set up"
        body="Sign in to manage your venue on Happy Hour Compass."
        link={{ href: "/login", label: "Sign in →" }}
      />
    );
  }

  if (view.view === "verified") {
    const canContinue = view.continueVia !== null && !continueFailed;
    return (
      <Shell>
        <div className="text-center">
          <h1 className="text-xl font-bold text-gray-900 mb-2">Email verified</h1>
          {canContinue ? (
            <>
              <p className="text-sm text-gray-500 mb-5 leading-relaxed">
                Next, create a password for your Happy Hour Compass Business account.
              </p>
              {view.continueVia === "session" ? (
                <Link href="/operator/create-password" className={`${primaryButton} inline-block`}>
                  Continue to create password
                </Link>
              ) : (
                <button type="button" onClick={continueSetup} disabled={busy !== null} className={primaryButton}>
                  {busy === "continue" ? "Continuing…" : "Continue to create password"}
                </button>
              )}
            </>
          ) : (
            <>
              <p className="text-sm text-gray-500 mb-5 leading-relaxed">
                Your email is already verified. To create your password on this device, request a sign-in link
                {view.maskedEmail ? ` sent to ${view.maskedEmail}` : ""}.
              </p>
              <Link href="/forgot-password" className="text-sm text-amber-600 hover:text-amber-700 font-medium">
                Request a sign-in link →
              </Link>
            </>
          )}
        </div>
      </Shell>
    );
  }

  // ── Pending verification ───────────────────────────────────────────────────

  const resendLocked = resendRemainingMs > 0;
  const sendLabel = showCodeForm ? "Resend code" : pending?.notice || codeLapsed ? "Send a new code" : "Send code";
  const lapsedNotice = codeLapsed
    ? messageForStatus("expired")
    : pending?.notice
      ? messageForStatus(pending.notice === "delivery_failed" ? "send_failed" : pending.notice, pending.resendAvailableAt)
      : null;

  return (
    <Shell>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Verify your email</h1>
        <p className="text-sm text-gray-500 mt-1 leading-relaxed">
          {showCodeForm ? (
            <>
              We sent a 6-digit code to <span className="font-medium text-gray-700">{view.maskedEmail}</span>. Enter it
              below to continue setting up your venue account.
            </>
          ) : (
            <>
              To continue setting up your venue account, we’ll send a 6-digit code to{" "}
              <span className="font-medium text-gray-700">{view.maskedEmail}</span>.
            </>
          )}
        </p>
      </div>

      {showCodeForm && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submitCode(code);
          }}
          className="space-y-4"
          noValidate
        >
          <div>
            <label htmlFor="verification-code" className="block text-sm font-medium text-gray-700 mb-1">
              Verification code
            </label>
            <input
              ref={inputRef}
              id="verification-code"
              name="code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              // No maxLength: the browser would truncate a pasted "123 456"
              // to "123 45" before normalization. normalizeCodeInput() caps
              // the value at six digits instead.
              value={code}
              disabled={busy === "verify"}
              aria-describedby="verification-code-help"
              aria-invalid={message?.tone === "error" ? true : undefined}
              onChange={(e) => {
                const next = normalizeCodeInput(e.target.value);
                setCode(next);
                if (next.length === 6 && code.length !== 6) void submitCode(next);
              }}
              onPaste={(e) => {
                // A pasted full code ("123456", "123 456", "Code: 123-456")
                // replaces whatever was typed and submits right away.
                const pasted = normalizeCodeInput(e.clipboardData.getData("text"));
                if (!pasted) return;
                e.preventDefault();
                setCode(pasted);
                if (pasted.length === 6) void submitCode(pasted);
              }}
              className="w-full px-3 py-3 border border-gray-300 rounded-lg text-center text-2xl font-semibold tracking-[0.5em] font-mono focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent disabled:bg-gray-50"
            />
            <p id="verification-code-help" className="text-xs text-gray-400 mt-1.5">
              {expiryRemainingMs > 0 ? `Code expires in ${formatCountdown(expiryRemainingMs)}.` : "Codes expire after 10 minutes."}
            </p>
          </div>
          <button type="submit" disabled={busy !== null || code.length !== 6} className={primaryButton}>
            {busy === "verify" ? "Verifying…" : "Verify email"}
          </button>
        </form>
      )}

      {!showCodeForm && lapsedNotice && (
        <p className="text-sm text-gray-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-4">{lapsedNotice}</p>
      )}

      <div role="status" aria-live="polite" className="min-h-[1.25rem] mt-4">
        {message && (
          <p className={`text-sm ${message.tone === "error" ? "text-red-600" : "text-gray-600"}`}>{message.text}</p>
        )}
      </div>

      <div className={showCodeForm ? "mt-4 pt-4 border-t border-gray-100 text-center" : "mt-2"}>
        {showCodeForm ? (
          <p className="text-sm text-gray-500">
            Didn’t get it? Check your spam folder, or{" "}
            {resendLocked ? (
              <span className="text-gray-400">resend in {formatCountdown(resendRemainingMs)}</span>
            ) : (
              <button
                type="button"
                onClick={sendCode}
                disabled={busy !== null}
                className="text-amber-600 hover:text-amber-700 font-medium disabled:opacity-50"
              >
                {busy === "send" ? "sending…" : "resend the code"}
              </button>
            )}
            .
          </p>
        ) : (
          <button type="button" onClick={sendCode} disabled={busy !== null || resendLocked} className={primaryButton}>
            {busy === "send"
              ? "Sending…"
              : resendLocked
                ? `${sendLabel} in ${formatCountdown(resendRemainingMs)}`
                : sendLabel}
          </button>
        )}
      </div>
    </Shell>
  );
}
