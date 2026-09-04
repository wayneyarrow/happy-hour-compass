"use client";

import { useEffect, useRef, useState } from "react";

// ── CopyButton ────────────────────────────────────────────────────────────────

/**
 * Small inline "copy to clipboard" affordance for a single value (email,
 * phone, etc.) shown in a CPanel table cell — lets an admin copy without
 * manually selecting the text. Shows a brief "Copied" confirmation;
 * clipboard failures (permissions, insecure context, unsupported browser)
 * are caught silently, matching the public site's ShareButton pattern
 * ((website)/ShareButton.tsx) — a copy action must never surface a visible
 * error.
 *
 * Table rows in this codebase are frequently click-to-navigate
 * (onClick={() => router.push(...)}) — stopPropagation() on the button's
 * click keeps "copy" from also triggering a row navigation.
 */
export function CopyButton({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  async function handleCopy(e: { stopPropagation: () => void }) {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can fail — never surface a visible error for a copy action.
    }
  }

  return (
    <span className="relative inline-flex shrink-0">
      <button
        type="button"
        onClick={handleCopy}
        aria-label={label ?? `Copy ${value}`}
        title={copied ? "Copied!" : "Copy"}
        className="inline-flex items-center justify-center shrink-0 w-5 h-5 rounded text-gray-300 hover:text-gray-600 hover:bg-gray-100 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
      >
        {copied ? (
          <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="w-3.5 h-3.5 text-emerald-600">
            <path fillRule="evenodd" d="M16.704 5.29a1 1 0 010 1.415l-7.4 7.4a1 1 0 01-1.414 0l-3.6-3.6a1 1 0 111.415-1.413L8.6 11.984l6.69-6.69a1 1 0 011.414-.004z" clipRule="evenodd" />
          </svg>
        ) : (
          <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="w-3.5 h-3.5">
            <path d="M7 2a2 2 0 00-2 2v1a1 1 0 000 2v7a2 2 0 002 2h6a2 2 0 002-2V7a1 1 0 000-2V4a2 2 0 00-2-2H7zm0 3V4h6v1H7zM7 7h6v7H7V7z" />
          </svg>
        )}
      </button>
      {copied && (
        <span
          role="status"
          aria-live="polite"
          className="absolute -top-7 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md bg-gray-900 px-1.5 py-0.5 text-[10px] font-medium text-white shadow-sm z-10"
        >
          Copied
        </span>
      )}
    </span>
  );
}

// ── SortIcon ──────────────────────────────────────────────────────────────────

export function SortIcon({
  active,
  dir,
}: {
  active: boolean;
  dir: "asc" | "desc";
}) {
  if (!active) {
    return (
      <span className="ml-1 inline-block text-gray-300 text-[10px] leading-none select-none">
        ↕
      </span>
    );
  }
  return (
    <span className="ml-1 inline-block text-amber-600 text-[10px] leading-none select-none">
      {dir === "asc" ? "↑" : "↓"}
    </span>
  );
}

// ── Pagination ────────────────────────────────────────────────────────────────

export function Pagination({
  page,
  totalPages,
  onPage,
}: {
  page: number;
  totalPages: number;
  onPage: (p: number) => void;
}) {
  if (totalPages <= 1) return null;

  const btnCls =
    "px-3 py-1.5 text-sm rounded-lg border border-gray-200 text-gray-600 " +
    "hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors";

  return (
    <div className="flex items-center justify-between mt-4">
      <button
        type="button"
        onClick={() => onPage(page - 1)}
        disabled={page <= 1}
        className={btnCls}
      >
        Previous
      </button>
      <span className="text-sm text-gray-500">
        Page {page} of {totalPages}
      </span>
      <button
        type="button"
        onClick={() => onPage(page + 1)}
        disabled={page >= totalPages}
        className={btnCls}
      >
        Next
      </button>
    </div>
  );
}
