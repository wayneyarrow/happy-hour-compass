"use client";

import { useActionState } from "react";
import {
  qaPublishImportedVenuesAction,
  type QaPublishState,
} from "./actions";

const INITIAL_STATE: QaPublishState = {};

/**
 * Control Panel panel for publishing pipeline-imported venues by city.
 * Only affects venues with no linked operator (created_by_operator_id IS NULL)
 * that are currently unpublished — operator-created and claimed venues are
 * never touched.
 */
export function QaPublishPanel() {
  const [state, formAction, pending] = useActionState(
    qaPublishImportedVenuesAction,
    INITIAL_STATE
  );

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <h2 className="text-base font-semibold text-slate-900 mb-1">
        QA: Publish Imported Venues
      </h2>
      <p className="text-sm text-gray-500 mb-1">
        Publishes pipeline-imported venues for a specific city so they appear
        in the consumer app for internal QA.
      </p>
      <p className="text-xs text-gray-400 mb-4">
        Only venues where{" "}
        <code className="bg-gray-100 px-1 rounded">
          created_by_operator_id IS NULL
        </code>{" "}
        and{" "}
        <code className="bg-gray-100 px-1 rounded">is_published = false</code>{" "}
        are affected. Operator-created and claimed venues are never touched.
      </p>

      <form action={formAction} className="flex items-end gap-3">
        <div className="flex-1 max-w-xs">
          <label
            htmlFor="qa-publish-city"
            className="block text-xs font-medium text-gray-700 mb-1"
          >
            City (case-insensitive, partial match OK)
          </label>
          <input
            id="qa-publish-city"
            name="city"
            type="text"
            required
            placeholder="e.g. Kelowna"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-400 focus:outline-none"
          />
        </div>
        <button
          type="submit"
          disabled={pending}
          className="px-4 py-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white font-semibold rounded-lg text-sm whitespace-nowrap"
        >
          {pending ? "Publishing…" : "Publish"}
        </button>
      </form>

      {state.error && (
        <p className="mt-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {state.error}
        </p>
      )}

      {state.published !== undefined && !state.error && (
        <p className="mt-3 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
          {state.published === 0
            ? `No unpublished imported venues found in "${state.city}". Check the city name or verify venues exist in the DB.`
            : `✓ Published ${state.published} imported venue${state.published !== 1 ? "s" : ""} in "${state.city}".`}
        </p>
      )}
    </div>
  );
}
