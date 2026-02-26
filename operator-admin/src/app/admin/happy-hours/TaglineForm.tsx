"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { updateTaglineAction } from "./actions";
import type { TaglineState } from "./types";

type Props = {
  venueId: string;
  initialTagline: string;
};

const initialState: TaglineState = {};

const inputCls =
  "w-full px-3 py-2 border border-gray-300 rounded-lg text-sm " +
  "focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent " +
  "disabled:opacity-60";

const labelCls = "block text-sm font-medium text-gray-700 mb-1";

export default function TaglineForm({ venueId, initialTagline }: Props) {
  const router = useRouter();
  const boundAction = updateTaglineAction.bind(null, venueId);
  const [state, formAction, isPending] = useActionState(boundAction, initialState);
  const [saved, setSaved] = useState(false);
  const [charCount, setCharCount] = useState(initialTagline.length);

  // Fire on every new state object — handles repeated saves correctly
  useEffect(() => {
    if (state.success) {
      router.refresh();
      setSaved(true);
      const timer = setTimeout(() => setSaved(false), 4000);
      return () => clearTimeout(timer);
    }
  }, [state, router]);

  // On failed submit, restore user's last input; on first render, use DB value.
  const currentTagline = state.values?.hh_tagline ?? initialTagline;

  return (
    <form action={formAction} className="space-y-4">
      {state.errors?.form && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
          <strong>Error:</strong> {state.errors.form}
        </div>
      )}

      <div>
        <label htmlFor="hh-tagline" className={labelCls}>
          Tagline{" "}
          <span className="text-gray-400 font-normal">(optional)</span>
        </label>
        <input
          id="hh-tagline"
          name="hh_tagline"
          type="text"
          maxLength={80}
          disabled={isPending}
          defaultValue={currentTagline}
          onChange={(e) => setCharCount(e.target.value.length)}
          placeholder="e.g. Half-price apps and pints, every weekday!"
          className={inputCls}
        />
        <div className="flex items-start justify-between mt-1 gap-2">
          <p className="text-xs text-gray-400">
            Short summary shown at the top of your happy hour.
          </p>
          <span
            className={`text-xs shrink-0 tabular-nums ${
              charCount > 80 ? "text-red-500" : "text-gray-400"
            }`}
          >
            {charCount} / 80
          </span>
        </div>
        {state.errors?.hh_tagline && (
          <p className="mt-1 text-xs text-red-600" role="alert">
            {state.errors.hh_tagline}
          </p>
        )}
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={isPending}
          className="px-5 py-2 bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-white font-semibold rounded-lg text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isPending ? "Saving…" : "Save tagline"}
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
