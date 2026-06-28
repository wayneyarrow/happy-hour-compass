"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { updateAboutVenueAction } from "./actions";
import { ABOUT_VENUE_MAX_CHARS, type AboutVenueState } from "./types";

type Props = {
  venueId: string;
  venueName: string;
  initialAboutYourVenue: string;
};

const initialState: AboutVenueState = {};

const textareaCls =
  "w-full px-3 py-2 border border-gray-300 rounded-lg text-sm resize-none " +
  "focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent " +
  "disabled:opacity-60";

const labelCls = "block text-sm font-medium text-gray-700 mb-1";

export default function AboutVenueForm({ venueId, venueName, initialAboutYourVenue }: Props) {
  const router = useRouter();
  const boundAction = updateAboutVenueAction.bind(null, venueId);
  const [state, formAction, isPending] = useActionState(boundAction, initialState);
  const [saved, setSaved] = useState(false);
  const [charCount, setCharCount] = useState(initialAboutYourVenue.length);
  const [liveText, setLiveText] = useState(initialAboutYourVenue);

  // One-shot hydration latch: re-sync from DB on navigation (full remount),
  // but don't reset user edits mid-session after router.refresh().
  const hasHydrated = useRef(false);
  useEffect(() => {
    if (!hasHydrated.current) {
      setLiveText(initialAboutYourVenue);
      setCharCount(initialAboutYourVenue.length);
      hasHydrated.current = true;
    }
  }, [initialAboutYourVenue]);

  useEffect(() => {
    if (state.success) {
      router.refresh();
      setSaved(true);
      const timer = setTimeout(() => setSaved(false), 4000);
      return () => clearTimeout(timer);
    }
  }, [state, router]);

  const currentText = state.values?.about_your_venue ?? liveText;
  const isOverLimit = charCount > ABOUT_VENUE_MAX_CHARS;

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setLiveText(e.target.value);
    setCharCount(e.target.value.length);
  }

  return (
    <form action={formAction} className="space-y-5">
      {state.errors?.form && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
          <strong>Error:</strong> {state.errors.form}
        </div>
      )}

      <div>
        <label htmlFor="about-your-venue" className={labelCls}>
          About your venue{" "}
          <span className="text-gray-400 font-normal">(optional)</span>
        </label>
        <textarea
          id="about-your-venue"
          name="about_your_venue"
          rows={5}
          maxLength={ABOUT_VENUE_MAX_CHARS}
          disabled={isPending}
          value={currentText}
          onChange={handleChange}
          placeholder="Tell customers what makes your venue special. Highlight your atmosphere, patio, signature dishes, live entertainment, history, or anything else that makes people want to visit."
          className={textareaCls}
        />
        <div className="flex items-start justify-between mt-1 gap-2">
          <p className="text-xs text-gray-400">
            Shown on your public Venue Detail page. Leave blank to hide the section.
          </p>
          <span
            className={`text-xs shrink-0 tabular-nums ${
              isOverLimit ? "text-red-500 font-medium" : "text-gray-400"
            }`}
          >
            {charCount} / {ABOUT_VENUE_MAX_CHARS}
          </span>
        </div>
        {state.errors?.about_your_venue && (
          <p className="mt-1 text-xs text-red-600" role="alert">
            {state.errors.about_your_venue}
          </p>
        )}
      </div>

      {/* Live preview — updates as operator types */}
      {currentText.trim() && (
        <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-4">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 mb-2">
            Preview — how it may appear on your venue page
          </p>
          <p className="text-sm font-semibold text-gray-900 mb-1">{venueName}</p>
          <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-wrap">
            {currentText.trim()}
          </p>
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={isPending || isOverLimit}
          className="px-5 py-2 bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-white font-semibold rounded-lg text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isPending ? "Saving…" : "Save"}
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
    </form>
  );
}
