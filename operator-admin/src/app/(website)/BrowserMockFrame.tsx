import Image from "next/image";
import type { ReactNode } from "react";

/**
 * Browser-chrome frame for presenting a product screenshot (or, until real
 * screenshots exist, a schematic placeholder). Used by the business page's
 * hero and ProductTour.
 *
 * Deliberately renders an abstract placeholder rather than a fabricated
 * "fake screenshot" when no image is supplied — per the Business Funnel
 * Blueprint's Visual Asset Types note, this section must eventually use
 * genuine product UI, and a schematic placeholder is honest about not
 * being that yet. Swap in a real `image` once a screenshot is captured.
 *
 * The content area is a fixed square — tall enough to show portrait
 * Operator Admin screenshots (forms, lists) near-native scale via
 * object-cover, while still being wide enough that a landscape screenshot
 * (object-contain, `fit: "contain"`) reads as a deliberately framed inset
 * rather than an awkward sliver. Same frame for every ProductTour slide,
 * so switching tabs never shifts layout — only `fit` and `image` change.
 * `children`, when supplied, replaces the single-image content entirely
 * (used for the multi-screenshot composite slide) but keeps the same
 * chrome bar and aspect-square footprint.
 */

type Props = {
  image?: { src: string; alt: string; fit?: "cover" | "contain" } | null;
  /** Shown inside the placeholder frame when no image and no children are supplied. */
  placeholderLabel?: string;
  children?: ReactNode;
};

export function BrowserMockFrame({ image, placeholderLabel, children }: Props) {
  return (
    <div className="w-full rounded-2xl border border-gray-200 bg-white shadow-[0_24px_64px_rgba(0,0,0,0.10),0_4px_16px_rgba(0,0,0,0.06)] overflow-hidden">
      {/* Chrome bar */}
      <div className="flex items-center gap-1.5 px-4 py-3 border-b border-gray-100 bg-gray-50" aria-hidden="true">
        <span className="w-2.5 h-2.5 rounded-full bg-gray-300" />
        <span className="w-2.5 h-2.5 rounded-full bg-gray-300" />
        <span className="w-2.5 h-2.5 rounded-full bg-gray-300" />
      </div>

      <div className="relative aspect-square bg-gradient-to-br from-amber-50 to-gray-50">
        {children ? (
          children
        ) : image ? (
          <Image
            src={image.src}
            alt={image.alt}
            fill
            className={image.fit === "contain" ? "object-contain" : "object-cover"}
          />
        ) : (
          <PlaceholderContent label={placeholderLabel} />
        )}
      </div>
    </div>
  );
}

function PlaceholderContent({ label }: { label?: string }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-8 text-center">
      <IllustrationIcon />
      {label && (
        <p className="text-xs font-semibold text-amber-700/70 uppercase tracking-widest">
          {label}
        </p>
      )}
    </div>
  );
}

function IllustrationIcon(): ReactNode {
  return (
    <svg
      className="w-14 h-14 text-amber-300"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      aria-hidden="true"
    >
      <rect x="3" y="4" width="18" height="14" rx="2" />
      <path strokeLinecap="round" d="M3 9h18" />
      <path strokeLinecap="round" d="M7 13h6M7 15.5h4" />
    </svg>
  );
}
