"use client";

import { useState, useEffect, useRef } from "react";
import { isGuideSaved, saveGuide, unsaveGuide } from "@/lib/consumer/savedItems";
import { dbSaveGuide, dbUnsaveGuide } from "@/lib/consumer/savedSync";
import { createClient } from "@/lib/supabase/browser";
import { useConsumerId } from "./ConsumerAuthProvider";

type Props = {
  guideId: string;
  /**
   * "list"   — compact overlay on a card image: 28×28px button, 18px heart.
   * "detail" — detail page header: 44×44px button, 22px heart, hover bg.
   */
  variant?: "list" | "detail";
};

const HEART_PATH =
  "M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z";

export function SaveGuideButton({ guideId, variant = "list" }: Props) {
  const consumerId = useConsumerId();
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);
  const [saved, setSaved] = useState(false);

  function getSupabase() {
    if (!supabaseRef.current) supabaseRef.current = createClient();
    return supabaseRef.current;
  }

  // Hydrate after mount — avoids SSR mismatch
  useEffect(() => {
    setSaved(isGuideSaved(guideId));

    function onChanged() {
      setSaved(isGuideSaved(guideId));
    }
    window.addEventListener("hhc:savedChanged", onChanged);
    return () => window.removeEventListener("hhc:savedChanged", onChanged);
  }, [guideId]);

  function toggle(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (saved) {
      unsaveGuide(guideId);
      setSaved(false);
      if (consumerId) {
        dbUnsaveGuide(getSupabase(), consumerId, guideId).catch(() => {});
      }
    } else {
      saveGuide(guideId);
      setSaved(true);
      if (consumerId) {
        dbSaveGuide(getSupabase(), consumerId, guideId).catch(() => {});
      }
    }
  }

  const isDetail = variant === "detail";

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={saved ? "Remove saved guide" : "Save guide"}
      aria-pressed={saved}
      className={`flex items-center justify-center shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-1 ${
        isDetail ? "hover:bg-gray-100" : ""
      }`}
      style={
        isDetail
          ? { minWidth: 44, minHeight: 44, padding: 8 }
          : { width: 28, height: 28, padding: 4 }
      }
    >
      <svg
        viewBox="0 0 24 24"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        style={{
          width: isDetail ? 22 : 18,
          height: isDetail ? 22 : 18,
          fill: saved ? "#ef4444" : "none",
          stroke: saved ? "#ef4444" : isDetail ? "#6b7280" : "#9ca3af",
          strokeWidth: 2,
          strokeLinecap: "round",
          strokeLinejoin: "round",
          transition: "fill 0.15s, stroke 0.15s",
        }}
      >
        <path d={HEART_PATH} />
      </svg>
    </button>
  );
}
