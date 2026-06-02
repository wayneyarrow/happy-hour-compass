"use client";

import { useRouter } from "next/navigation";

type Props = { title: string };

/**
 * Sticky navigation header for collection views.
 *
 * Layout matches the venue/event detail page header:
 *   - same height (px-5 py-4) and border treatment
 *   - ← Back button floats left in blue
 *   - title is absolutely centred in the full header width so it reads as
 *     intentionally placed rather than jammed next to the button
 *   - pointer-events:none on the title lets taps pass through to the button
 */
export function CollectionHeader({ title }: Props) {
  const router = useRouter();

  function handleBack() {
    if (window.history.length > 1) {
      router.back();
    } else {
      router.push("/");
    }
  }

  return (
    <div
      className="sticky top-0 z-10 bg-white border-b border-gray-200"
      style={{ position: "relative" }}
    >
      <div className="flex items-center px-5 py-4">
        {/* Back button — matches BackButton style on venue/event detail pages */}
        <button
          type="button"
          onClick={handleBack}
          className="shrink-0 flex items-center gap-1 text-blue-500 font-medium leading-none"
          style={{ fontSize: 15 }}
          aria-label="Back"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ width: 18, height: 18, flexShrink: 0 }}
          >
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Back
        </button>
      </div>

      {/* Title — absolutely centred over the full header width */}
      <h1
        className="absolute inset-0 flex items-center justify-center"
        style={{
          fontSize: 17,
          fontWeight: 700,
          color: "#111827",
          margin: 0,
          pointerEvents: "none",
          paddingLeft: 80,
          paddingRight: 80,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {title}
      </h1>
    </div>
  );
}
