"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { updateSearchTagsAction } from "./searchTagsActions";
import { SEARCH_TAG_GROUPS } from "@/lib/searchTags";
import type { SearchTagsState } from "./types";
import type { OperatorPlan } from "@/lib/plans";

const UPSELL_EXAMPLE_TAGS = ["Patio", "Wings", "Craft Beer", "Live Music", "Cocktails"];

type Props = {
  venueId: string;
  initialTags: string[];
  plan: OperatorPlan;
  tagLimit: number;
};

const initialState: SearchTagsState = {};

export default function SearchTagsForm({
  venueId,
  initialTags,
  plan,
  tagLimit,
}: Props) {
  const router = useRouter();
  const boundAction = updateSearchTagsAction.bind(null, venueId);
  const [state, formAction, isPending] = useActionState(boundAction, initialState);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(initialTags));
  const [saved, setSaved] = useState(false);
  const hasHydrated = useRef(false);

  // One-shot hydration from fresh DB data. Latch prevents post-save router.refresh()
  // from resetting the form (same pattern as HhTimesForm).
  useEffect(() => {
    if (!hasHydrated.current) {
      hasHydrated.current = true;
      setSelected(new Set(initialTags));
    }
  }, [initialTags]);

  useEffect(() => {
    if (state.success) {
      router.refresh();
      setSaved(true);
      if (state.values?.tags) {
        setSelected(new Set(state.values.tags));
      }
      const timer = setTimeout(() => setSaved(false), 4000);
      return () => clearTimeout(timer);
    }
  }, [state, router]);

  // ── Free plan upsell ────────────────────────────────────────────────────────

  if (plan === "free") {
    return (
      <div>
        <p className="text-sm text-gray-600 mb-4">
          Help customers discover your venue based on what makes it special.
        </p>

        <div className="mb-5">
          <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">
            Example tags
          </p>
          <div className="flex flex-wrap gap-2">
            {UPSELL_EXAMPLE_TAGS.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center px-3 py-1.5 rounded-full border border-gray-200 bg-gray-50 text-sm text-gray-400 select-none"
              >
                {tag}
              </span>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-4">
          <p className="text-sm font-semibold text-amber-800 mb-1">
            Available with Pro and Premium plans
          </p>
          <p className="text-sm text-amber-700 mb-2">
            Add search tags to help customers find your venue when searching for
            &ldquo;patio&rdquo;, &ldquo;wings&rdquo;, &ldquo;dog friendly&rdquo;,
            and more.
          </p>
          <Link
            href="/admin/billing"
            className="text-xs font-semibold text-amber-800 underline underline-offset-2 hover:text-amber-900 transition-colors"
          >
            View Plan Options
          </Link>
        </div>
      </div>
    );
  }

  // ── Paid plan tag picker ────────────────────────────────────────────────────

  const isUnlimited = tagLimit === Infinity;
  const atLimit = !isUnlimited && selected.size >= tagLimit;

  function toggle(tag: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) {
        next.delete(tag);
      } else {
        if (!isUnlimited && next.size >= tagLimit) return prev;
        next.add(tag);
      }
      return next;
    });
  }

  return (
    <form action={formAction} className="space-y-5">
      {/* Hidden field carries the serialised tag array to the server action */}
      <input
        type="hidden"
        name="search_tags"
        value={JSON.stringify([...selected])}
      />

      {/* Error banners */}
      {state.errors?.form && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
          <strong>Error:</strong> {state.errors.form}
        </div>
      )}
      {state.errors?.tags && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
          {state.errors.tags}
        </div>
      )}

      {/* Selected count + limit indicator */}
      <div className="flex items-center gap-2 flex-wrap">
        <p className="text-sm text-gray-600">
          Selected tags:{" "}
          <strong className={atLimit ? "text-amber-700" : "text-gray-900"}>
            {isUnlimited
              ? `${selected.size} used`
              : `${selected.size} / ${tagLimit} used`}
          </strong>
        </p>
        {atLimit && (
          <span className="text-xs text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-md font-medium">
            Limit reached — remove a tag to add another
          </span>
        )}
      </div>

      {/* Tag groups */}
      <div className="space-y-5">
        {SEARCH_TAG_GROUPS.map((group) => (
          <div key={group.label}>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
              {group.label}
            </p>
            <div className="flex flex-wrap gap-2">
              {group.tags.map((tag) => {
                const isSelected = selected.has(tag);
                const isDisabled = !isSelected && atLimit;
                return (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => toggle(tag)}
                    disabled={isPending || isDisabled}
                    aria-pressed={isSelected}
                    className={[
                      "inline-flex items-center px-3 py-1.5 rounded-full text-sm font-medium border transition-colors",
                      isSelected
                        ? "bg-amber-500 text-white border-amber-500 hover:bg-amber-600 hover:border-amber-600"
                        : isDisabled
                        ? "bg-gray-50 text-gray-300 border-gray-200 cursor-not-allowed"
                        : "bg-white text-gray-700 border-gray-300 hover:border-amber-400 hover:text-amber-700",
                      isPending ? "opacity-60 cursor-not-allowed" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    {tag}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* At-limit upsell — shown on paid plans that have used all their tags */}
      {atLimit && (
        <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2.5 text-sm text-amber-800">
          You&apos;ve reached the search tag limit for your plan.
          {plan === "pro" && (
            <> Upgrade to Premium to use up to 10 search tags and improve discoverability.</>
          )}{" "}
          <Link
            href="/admin/billing"
            className="font-semibold underline underline-offset-2 hover:text-amber-900 transition-colors"
          >
            View Plan Options
          </Link>
        </div>
      )}

      {/* Save row */}
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={isPending}
          className="px-5 py-2 bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-white font-semibold rounded-lg text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isPending ? "Saving…" : "Save tags"}
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
