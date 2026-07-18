"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  updateBusinessHoursAction,
  type UpdateBusinessHoursState,
} from "./actions";
import { DAYS_OF_WEEK, DAY_LABELS, HOURS_STEP_SECONDS } from "../../_shared/hoursUtils";
import type { BusinessHours, DayHours, DayOfWeek } from "../../_shared/types";

type Props = {
  venueId: string;
  /** Current hours from the DB (empty object when none saved yet). */
  initialHours: BusinessHours;
};

const initialState: UpdateBusinessHoursState = {};

// ── Styling constants ──────────────────────────────────────────────────────
// Matches the native time-input treatment established in HhTimesForm.tsx
// (Happy Hours) — same breakpoint, same input styling, same responsive
// day-row shape — reused here as a pattern, not as shared imported code
// (this file has no dependency on HhTimesForm.tsx; see hoursUtils.ts for why
// the step constant is intentionally its own copy, not a shared import).
const timeInputCls =
  "w-full px-2.5 py-2.5 border border-gray-300 rounded-md text-sm bg-white " +
  "focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent " +
  "disabled:opacity-50 disabled:cursor-not-allowed";

// ── TimeInputs ─────────────────────────────────────────────────────────────
/**
 * Native Open / Close time-entry pair for one day. Uncontrolled — uses
 * defaultValue, matching the form's existing "read raw fields from FormData
 * on submit" architecture (there is no client-side generated JSON payload
 * here, unlike Happy Hours' HhTimesForm). Replaces the previous three-select
 * (hour/minute/AM-PM) trio per slot with one <input type="time"> per slot —
 * the stored value is already a 24-hour "HH:MM" string, exactly what a
 * native time input's value already is, so no 12h/24h conversion is needed
 * anywhere in this component anymore.
 */
function TimeInputs({
  day,
  openDefault,
  closeDefault,
  disabled,
}: {
  day: DayOfWeek;
  openDefault: string;
  closeDefault: string;
  disabled: boolean;
}) {
  const openId = `${day}-open`;
  const closeId = `${day}-close`;

  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto_1fr] sm:items-end sm:min-w-0 sm:flex-1">
      <div>
        <label htmlFor={openId} className="block text-xs font-medium text-gray-500 mb-1">
          Open
        </label>
        <input
          id={openId}
          type="time"
          name={`${day}_open`}
          step={HOURS_STEP_SECONDS}
          defaultValue={openDefault}
          disabled={disabled}
          aria-label={`${DAY_LABELS[day]} open time`}
          className={timeInputCls}
        />
      </div>

      <div className="text-gray-400 text-sm text-center sm:pb-2.5" aria-hidden="true">
        –
      </div>

      <div>
        <label htmlFor={closeId} className="block text-xs font-medium text-gray-500 mb-1">
          Close
        </label>
        <input
          id={closeId}
          type="time"
          name={`${day}_close`}
          step={HOURS_STEP_SECONDS}
          defaultValue={closeDefault}
          disabled={disabled}
          aria-label={`${DAY_LABELS[day]} close time`}
          className={timeInputCls}
        />
      </div>
    </div>
  );
}

// ── DayRow ─────────────────────────────────────────────────────────────────
/**
 * One row in the business-hours form.
 *
 * `defaultDayHours` drives the initial "closed" toggle and default time values.
 * Because this component owns its own `useState`, it should be remounted
 * (via a parent `key` change) whenever the data source changes — e.g. after
 * a failed server action returns updated hours.
 *
 * Responsive layout matches HhTimesForm.tsx's HhDayRow exactly (same
 * breakpoint, same technique): below sm:, the day label + "Closed" control
 * render as their own real top row, and the time-entry group gets a full
 * width row of its own beneath them, since it's a plain flex-column at that
 * width with no flex-grow/shrink involved. At sm: and up, the day-label +
 * "Closed" wrapper switches to `sm:contents`, removing it from the box
 * model so its two children rejoin the outer row as direct flex items —
 * reproducing the original single-row desktop layout exactly.
 */
function DayRow({
  day,
  defaultDayHours,
  error,
  isPending,
}: {
  day: DayOfWeek;
  /** null / undefined = closed; DayHours = open with specific times. */
  defaultDayHours: DayHours | null | undefined;
  error?: string;
  isPending: boolean;
}) {
  const isClosed = defaultDayHours == null;
  const [closed, setClosed] = useState(isClosed);

  const openDefault = defaultDayHours?.open ?? "09:00";
  const closeDefault = defaultDayHours?.close ?? "22:00";

  return (
    <div className="py-3 border-b border-gray-100 last:border-0">
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-start sm:gap-x-4 sm:gap-y-2">
        {/* Day label + "Closed" — grouped together on mobile; this wrapper
            disappears from layout at sm: (see comment above DayRow). */}
        <div className="flex items-center gap-4 sm:contents">
          <span className="w-24 shrink-0 text-sm font-medium text-gray-700">
            {DAY_LABELS[day]}
          </span>

          <label className="flex items-center gap-1.5 text-sm text-gray-600 cursor-pointer select-none shrink-0">
            <input
              type="checkbox"
              name={`${day}_closed`}
              checked={closed}
              onChange={(e) => setClosed(e.target.checked)}
              disabled={isPending}
              className="h-4 w-4 rounded border-gray-300 accent-amber-500"
            />
            Closed
          </label>
        </div>

        {/* Time inputs — removed from DOM (and FormData) when closed */}
        {!closed && (
          <TimeInputs
            day={day}
            openDefault={openDefault}
            closeDefault={closeDefault}
            disabled={isPending}
          />
        )}
      </div>

      {/* Per-day validation error */}
      {error && !closed && (
        <p className="mt-1 sm:ml-28 text-xs text-red-600" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

// ── DaysList ───────────────────────────────────────────────────────────────
/**
 * Renders all seven DayRow components.
 *
 * Accepts a `key` prop (from parent) so the entire list — and every DayRow's
 * local state — remounts whenever `hours` changes after a failed submit.
 */
function DaysList({
  hours,
  errors,
  isPending,
}: {
  hours: BusinessHours;
  errors?: UpdateBusinessHoursState["errors"];
  isPending: boolean;
}) {
  return (
    <div>
      {DAYS_OF_WEEK.map((day) => (
        <DayRow
          key={day}
          day={day}
          defaultDayHours={hours[day]}
          error={errors?.[day]}
          isPending={isPending}
        />
      ))}
    </div>
  );
}

// ── BusinessHoursForm ──────────────────────────────────────────────────────
export default function BusinessHoursForm({ venueId, initialHours }: Props) {
  const router = useRouter();
  const boundAction = updateBusinessHoursAction.bind(null, venueId);
  const [state, formAction, isPending] = useActionState(boundAction, initialState);
  const [saved, setSaved] = useState(false);

  // Depend on `state` (the object reference) rather than `state.success` (the
  // boolean value). `useActionState` replaces the state object on every form
  // submission, so this fires on every save — even when two consecutive saves
  // both return success: true and the boolean value itself doesn't change.
  useEffect(() => {
    if (state.success) {
      router.refresh();
      setSaved(true);
      const timer = setTimeout(() => setSaved(false), 4000);
      return () => clearTimeout(timer);
    }
  }, [state, router]);

  // After a failed submit, use the hours the user submitted so their
  // selections are preserved. On first render, use the DB values.
  const activeHours = state.hours ?? initialHours;

  return (
    <form action={formAction}>
      {/* Form-level error (auth, DB, ownership) */}
      {state.errors?.form && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-3 mb-4">
          <strong>Error:</strong> {state.errors.form}
        </div>
      )}

      <p className="text-xs text-gray-400 mb-3">
        Depending on your browser or device, times may appear in either
        12-hour (5:00 PM) or 24-hour (17:00) format. Both display the same
        saved time.
      </p>

      {/* Day rows — keyed on activeHours so DayRow states remount on new data */}
      <DaysList
        key={JSON.stringify(activeHours)}
        hours={activeHours}
        errors={state.errors}
        isPending={isPending}
      />

      {/* Submit + Saved indicator */}
      <div className="flex items-center gap-3 pt-5">
        <button
          type="submit"
          disabled={isPending}
          className="px-5 py-2 bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-white font-semibold rounded-lg text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isPending ? "Saving…" : "Save hours"}
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
