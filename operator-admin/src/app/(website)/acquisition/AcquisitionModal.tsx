"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";

type Props = {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
};

/**
 * Branded acquisition modal shell — reusable for Suggest a Venue,
 * Submit Your Venue, Claim Venue, Contact Us, and any future flow.
 *
 * Desktop: centered overlay panel (max-w-lg).
 * Mobile: full-screen dialog.
 *
 * Uses createPortal so it always renders on document.body,
 * escaping any ancestor stacking contexts (e.g. sticky header z-index).
 */
export function AcquisitionModal({ open, onClose, title, description, children }: Props) {
  const [mounted, setMounted] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // Wait for hydration before rendering portal.
  useEffect(() => setMounted(true), []);

  // Body scroll lock while open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // ESC key to close.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Move focus into the panel when it opens.
  useEffect(() => {
    if (!open || !mounted) return;
    panelRef.current?.focus({ preventScroll: true });
  }, [open, mounted]);

  if (!mounted || !open) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="acquisition-modal-title"
      className="fixed inset-0 z-[80] flex flex-col items-stretch md:items-center md:justify-center"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel — full screen on mobile, centered card on desktop */}
      <div
        ref={panelRef}
        tabIndex={-1}
        className={[
          "relative z-10 flex flex-col bg-white outline-none",
          // Mobile: fill viewport
          "w-full h-full",
          // Desktop: centered card
          "md:h-auto md:max-w-lg md:max-h-[90vh] md:rounded-2xl",
          "md:shadow-[0_24px_64px_rgba(0,0,0,0.14),0_4px_16px_rgba(0,0,0,0.08)]",
          "overflow-hidden",
        ].join(" ")}
      >
        {/* Modal header: logo + title + close */}
        <div className="flex items-start gap-3 px-6 py-5 border-b border-gray-100 flex-shrink-0">
          <Image
            src="/hhc-icon.png"
            alt=""
            width={32}
            height={41}
            className="h-8 w-auto flex-shrink-0 mt-0.5"
          />
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-bold text-amber-500 uppercase tracking-widest mb-0.5">
              Happy Hour Compass
            </p>
            <h2
              id="acquisition-modal-title"
              className="text-[18px] font-bold text-gray-900 leading-tight"
            >
              {title}
            </h2>
            {description && (
              <p className="mt-1 text-[13px] text-gray-500 leading-relaxed">
                {description}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex-shrink-0 p-1.5 -mr-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-colors mt-0.5"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Scrollable content area */}
        <div className="flex-1 overflow-y-auto">
          {children}
        </div>
      </div>
    </div>,
    document.body
  );
}
