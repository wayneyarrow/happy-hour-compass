"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { updateLinksAction } from "./actions";
import { type LinksState } from "./types";

type Props = {
  venueId: string;
  initialValues: { website_url: string; menu_url: string };
};

const initialState: LinksState = {};

const inputCls =
  "w-full px-3 py-2 border border-gray-300 rounded-lg text-sm " +
  "focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent " +
  "disabled:opacity-60";

const labelCls = "block text-sm font-medium text-gray-700 mb-1";

export default function LinksForm({ venueId, initialValues }: Props) {
  const router = useRouter();
  const boundAction = updateLinksAction.bind(null, venueId);
  const [state, formAction, isPending] = useActionState(
    boundAction,
    initialState
  );
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (state.success) {
      router.refresh();
      setSaved(true);
      const timer = setTimeout(() => setSaved(false), 3000);
      return () => clearTimeout(timer);
    }
  }, [state.success, router]);

  const v = state.values ?? initialValues;

  return (
    <form action={formAction} className="space-y-5">
      {state.errors?.form && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
          <strong>Error:</strong> {state.errors.form}
        </div>
      )}

      {/* Website URL */}
      <div>
        <label htmlFor="link-website" className={labelCls}>
          Website URL{" "}
          <span className="text-gray-400 font-normal">(optional)</span>
        </label>
        <input
          id="link-website"
          name="website_url"
          type="url"
          disabled={isPending}
          defaultValue={v.website_url}
          placeholder="https://example.com"
          className={inputCls}
        />
        {state.errors?.website_url && (
          <p className="mt-1 text-xs text-red-600" role="alert">
            {state.errors.website_url}
          </p>
        )}
      </div>

      {/* Menu URL */}
      <div>
        <label htmlFor="link-menu" className={labelCls}>
          Menu URL{" "}
          <span className="text-gray-400 font-normal">(optional)</span>
        </label>
        <input
          id="link-menu"
          name="menu_url"
          type="url"
          disabled={isPending}
          defaultValue={v.menu_url}
          placeholder="https://example.com/menu"
          className={inputCls}
        />
        {state.errors?.menu_url && (
          <p className="mt-1 text-xs text-red-600" role="alert">
            {state.errors.menu_url}
          </p>
        )}
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={isPending}
          className="px-5 py-2 bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-white font-semibold rounded-lg text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isPending ? "Saving…" : "Save links"}
        </button>
        {saved && (
          <span className="text-sm font-medium text-green-600" role="status">
            Saved
          </span>
        )}
      </div>
    </form>
  );
}
