"use client";

import { useState, useEffect, useRef } from "react";
import { isEventSaved, saveEvent, unsaveEvent } from "@/lib/consumer/savedItems";
import { dbSaveEvent, dbUnsaveEvent } from "@/lib/consumer/savedSync";
import { createClient } from "@/lib/supabase/browser";
import { useConsumerId } from "./ConsumerAuthProvider";

type Props = {
  eventId: string;
  variant?: "list" | "detail";
};

const HEART_PATH =
  "M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z";

export function SaveEventButton({ eventId, variant = "list" }: Props) {
  const consumerId = useConsumerId();
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);
  const [saved, setSaved] = useState(false);

  function getSupabase() {
    if (!supabaseRef.current) supabaseRef.current = createClient();
    return supabaseRef.current;
  }

  useEffect(() => {
    setSaved(isEventSaved(eventId));

    function onChanged() {
      setSaved(isEventSaved(eventId));
    }
    window.addEventListener("hhc:savedChanged", onChanged);
    return () => window.removeEventListener("hhc:savedChanged", onChanged);
  }, [eventId]);

  function toggle(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (saved) {
      unsaveEvent(eventId);
      setSaved(false);
      if (consumerId) {
        dbUnsaveEvent(getSupabase(), consumerId, eventId).catch(() => {});
      }
    } else {
      saveEvent(eventId);
      setSaved(true);
      if (consumerId) {
        dbSaveEvent(getSupabase(), consumerId, eventId).catch(() => {});
      }
    }
  }

  const isDetail = variant === "detail";

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={saved ? "Remove saved event" : "Save event"}
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
