"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";

// ── Types ─────────────────────────────────────────────────────────────────────

type Props = {
  venueId: string;
  operatorId: string;
  initialIsPublished: boolean;
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function VenuePublishSection({
  venueId,
  operatorId,
  initialIsPublished,
}: Props) {
  const router = useRouter();
  const [isPublished, setIsPublished] = useState(initialIsPublished);
  /** null = still loading the initial count */
  const [imageCount, setImageCount] = useState<number | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load the venue's image count on mount so we can show a hint.
  useEffect(() => {
    const supabase = createClient();
    supabase
      .from("media")
      .select("id", { count: "exact", head: true })
      .eq("venue_id", venueId)
      .eq("type", "venue_image")
      .then(({ count }) => setImageCount(count ?? 0));
  }, [venueId]);

  const handleToggle = () => {
    if (isSaving) return;
    setPublishError(null);
    setIsPublished((prev) => !prev);
  };

  const handleSave = async () => {
    setPublishError(null);

    // When publishing, do a fresh image count check — VenueImagesSection
    // manages its own state, so we re-query here to get the latest truth.
    if (isPublished) {
      const supabase = createClient();
      const { count } = await supabase
        .from("media")
        .select("id", { count: "exact", head: true })
        .eq("venue_id", venueId)
        .eq("type", "venue_image");

      const freshCount = count ?? 0;
      setImageCount(freshCount); // keep local hint in sync

      if (freshCount === 0) {
        setPublishError(
          "You must upload at least one venue image before publishing."
        );
        return;
      }
    }

    setIsSaving(true);
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current);

    const supabase = createClient();
    const { error } = await supabase
      .from("venues")
      .update({ is_published: isPublished })
      .eq("id", venueId)
      .eq("created_by_operator_id", operatorId);

    if (error) {
      console.error("[VenuePublishSection] Update failed:", error);
      setPublishError(`Failed to save: ${error.message}`);
      setIsSaving(false);
      return;
    }

    setIsSaving(false);
    setSaved(true);
    savedTimerRef.current = setTimeout(() => setSaved(false), 4000);
    router.refresh();
  };

  const noImages = imageCount !== null && imageCount === 0;

  return (
    <div className="space-y-4">
      {/* Toggle row */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          role="switch"
          aria-checked={isPublished}
          onClick={handleToggle}
          disabled={isSaving}
          className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-amber-400 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed ${
            isPublished ? "bg-amber-500" : "bg-gray-200"
          }`}
        >
          <span
            className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
              isPublished ? "translate-x-5" : "translate-x-0"
            }`}
          />
        </button>
        <span className="text-sm font-medium text-gray-700">
          {isPublished ? "Published" : "Unpublished"}
        </span>
        {!isPublished && (
          <span className="text-xs text-gray-400">
            Visible only to you until published.
          </span>
        )}
      </div>

      {/* Hint: no images yet (shown while unpublished and count loaded) */}
      {!isPublished && noImages && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          At least one venue image is required before you can publish.
        </p>
      )}

      {/* Publish error (shown when save is blocked) */}
      {publishError && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
          {publishError}
        </div>
      )}

      {/* Save button */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={isSaving}
          className="px-5 py-2 bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-white font-semibold rounded-lg text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSaving ? "Saving…" : "Save"}
        </button>
        {saved && (
          <span
            className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-semibold bg-green-100 text-green-700"
            role="status"
          >
            Saved
          </span>
        )}
      </div>
    </div>
  );
}
