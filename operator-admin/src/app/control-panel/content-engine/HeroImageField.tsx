"use client";

import { useRef, useState } from "react";
import { createClient } from "@/lib/supabase/browser";
import {
  processImageFile,
  ImageTooLargeError,
  InvalidImageTypeError,
} from "@/lib/imageProcessing";

/**
 * Hero image upload for the Content Engine guide form (Card 2 touch-up).
 *
 * Reuses the existing "venue-images" Supabase Storage bucket and the same
 * client-side resize/compress → upload flow as EventForm
 * (src/app/admin/events/EventForm.tsx), under a guides/ path prefix.
 *
 * Unlike EventForm — which writes image_url straight to the DB row on
 * upload — content_guides has no authenticated RLS policy (admin-only via
 * createAdminClient()), so a browser client can never write to it directly.
 * This component only uploads the file to storage and lifts the resulting
 * public URL up to GuideForm's `heroImageUrl` state via onChange. The single
 * source of truth for persistence stays the existing hero_image_url text
 * field, submitted through the normal form action exactly as before —
 * upload only changes how that value gets populated, not how it's saved.
 */

const BUCKET = "venue-images";

const labelCls = "block text-sm font-medium text-gray-700 mb-1";
const hintCls = "mt-1 text-xs text-gray-400";
const errorCls = "mt-1 text-xs text-red-600";
const inputCls =
  "w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-400 focus:border-transparent focus:outline-none disabled:bg-gray-50 disabled:text-gray-400";

type Props = {
  value: string;
  onChange: (url: string) => void;
  disabled?: boolean;
};

export default function HeroImageField({ value, onChange, disabled }: Props) {
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFileSelected(file: File) {
    setUploadError(null);
    setIsUploading(true);
    if (fileInputRef.current) fileInputRef.current.value = "";

    let blob: Blob;
    try {
      blob = await processImageFile(file, {
        maxWidth: 1600,
        maxSizeBytes: 1.5 * 1024 * 1024,
      });
    } catch (err) {
      if (err instanceof InvalidImageTypeError) {
        setUploadError("Please upload a valid image file.");
      } else if (err instanceof ImageTooLargeError) {
        setUploadError("This image is too large even after compression. Please choose a smaller image.");
      } else {
        setUploadError("Failed to process image. Please try again.");
      }
      setIsUploading(false);
      return;
    }

    const supabase = createClient();
    const path = `guides/${crypto.randomUUID()}.jpg`;

    // 1 year — safe because every upload gets a brand-new crypto.randomUUID()
    // path (upsert: false above), so a URL's content can never change after
    // it's created; "replacing" a photo always means a new URL, never an
    // overwrite. Existing objects uploaded before this change keep their
    // prior 1-hour cache-control until a separate, deliberate migration
    // re-uploads them (out of scope here).
    const { error: uploadErr } = await supabase.storage
      .from(BUCKET)
      .upload(path, blob, { cacheControl: "31536000", upsert: false, contentType: "image/jpeg" });

    if (uploadErr) {
      console.error("[HeroImageField] Upload failed:", uploadErr);
      setUploadError(`Upload failed: ${uploadErr.message}`);
      setIsUploading(false);
      return;
    }

    const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
    onChange(data.publicUrl);
    setIsUploading(false);
  }

  async function handleRemove() {
    // Best-effort: delete the stored file too. Never blocks clearing the field —
    // the guide's hero_image_url is what actually matters on save.
    if (value) {
      try {
        const urlObj = new URL(value);
        const match = urlObj.pathname.match(/\/public\/[^/]+\/(.+)$/);
        if (match?.[1]) {
          const supabase = createClient();
          await supabase.storage.from(BUCKET).remove([match[1]]);
        }
      } catch {
        // Non-fatal — likely a manually-pasted URL that isn't a storage object.
      }
    }
    onChange("");
  }

  const busy = isUploading || disabled;

  return (
    <div className="space-y-3">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        disabled={busy}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFileSelected(file);
        }}
      />

      {value ? (
        <div className="flex items-start gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={value}
            alt="Hero preview"
            className="w-40 h-28 rounded-lg object-cover border border-gray-200 shrink-0"
          />
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={busy}
              className="text-sm px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
            >
              {isUploading ? "Uploading…" : "Replace image"}
            </button>
            <button
              type="button"
              onClick={handleRemove}
              disabled={busy}
              className="text-sm px-3 py-1.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
            >
              Remove
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={busy}
          className="w-40 h-28 rounded-lg border-2 border-dashed border-gray-300 text-gray-400 hover:border-amber-400 hover:text-amber-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex flex-col items-center justify-center gap-1 text-xs font-medium"
        >
          <span aria-hidden="true" className="text-lg leading-none">+</span>
          {isUploading ? "Uploading…" : "Upload image"}
        </button>
      )}

      {uploadError && <p className={errorCls}>{uploadError}</p>}

      <div>
        <label className={labelCls} htmlFor="hero_image_url">
          Image URL <span className="text-gray-400 font-normal">(auto-filled on upload, or paste one directly)</span>
        </label>
        <input
          id="hero_image_url"
          name="hero_image_url"
          type="url"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="https://…"
          disabled={disabled}
          className={inputCls}
        />
        <p className={hintCls}>Reused for card, social, and thumbnail.</p>
      </div>
    </div>
  );
}
