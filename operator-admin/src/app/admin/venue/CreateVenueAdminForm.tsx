"use client";

import { useActionState } from "react";
import { createVenueAdminAction } from "./actions";
import { type CreateVenueAdminState } from "./types";

const initialState: CreateVenueAdminState = {};

const inputCls =
  "w-full px-3 py-2 border border-gray-300 rounded-lg text-sm " +
  "focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent " +
  "disabled:opacity-60";

export default function CreateVenueAdminForm() {
  const [state, formAction, isPending] = useActionState(
    createVenueAdminAction,
    initialState
  );

  return (
    <form action={formAction} className="space-y-4">
      {state.errors?.form && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
          <strong>Error:</strong> {state.errors.form}
        </div>
      )}

      <div>
        <label
          htmlFor="create-venue-name"
          className="block text-sm font-medium text-gray-700 mb-1"
        >
          Venue name{" "}
          <span className="text-red-500" aria-hidden="true">
            *
          </span>
        </label>
        <input
          id="create-venue-name"
          name="name"
          type="text"
          required
          disabled={isPending}
          defaultValue={state.values?.name ?? ""}
          placeholder="e.g. The Rusty Anchor"
          className={inputCls}
        />
        {state.errors?.name && (
          <p className="mt-1 text-xs text-red-600" role="alert">
            {state.errors.name}
          </p>
        )}
      </div>

      <button
        type="submit"
        disabled={isPending}
        className="px-5 py-2 bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-white font-semibold rounded-lg text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isPending ? "Creating…" : "Create venue"}
      </button>
    </form>
  );
}
