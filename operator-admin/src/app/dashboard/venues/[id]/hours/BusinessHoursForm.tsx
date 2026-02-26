"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  updateBusinessHoursAction,
  type UpdateBusinessHoursState,
} from "./actions";
import { DAYS_OF_WEEK, DAY_LABELS, to12h } from "../../_shared/hoursUtils";
import type { BusinessHours, DayHours, DayOfWeek } from "../../_shared/types";

type Props = {
  venueId: string;
  /** Current hours from the DB (empty object when none saved yet). */
  initialHours: BusinessHours;
};

const initialState: UpdateBusinessHoursState = {};

// ── Styling constants ──────────────────────────────────────────────────────
const selectCls =
  "px-2 py-1.5 border border-gray-300 rounded-md text-sm bg-white " +
  "focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent " +
  "disabled:opacity-50 disabled:cursor-not-allowed";

const HOURS   = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"];
const MINUTES = ["00", "15", "30", "45"];
const PERIODS = ["AM", "PM"] as const;

// ── TimeInputs ─────────────────────────────────────────────────────────────
/**
 * Renders the hour / minute / period select trio for one slot (open or close).
 * Uncontrolled — uses defaultValue so React doesn't fight native form reset.
 */
function TimeInputs({
  day,
  slot,
  defaultHour,
  defaultMinute,
  defaultPeriod,
  disabled,
}: {
  day: DayOfWeek;
  slot: "open" | "close";
  defaultHour: string;
  defaultMinute: string;
  defaultPeriod: "AM" | "PM";
  disabled: boolean;
}) {
  return (
    <div className="flex items-center gap-1">
      <select
        name={`${day}_${slot}_hour`}
        defaultValue={defaultHour}
        disabled={disabled}
        className={selectCls}
        aria-label={`${DAY_LABELS[day]} ${slot} hour`}
      >
        {HOURS.map((h) => (
          <option key={h} value={h}>
            {h}
          </option>
        ))}
      </select>

      <span className="text-gray-400 text-sm font-medium">:</span>

      <select
        name={`${day}_${slot}_minute`}
        defaultValue={defaultMinute}
        disabled={disabled}
        className={selectCls}
        aria-label={`${DAY_LABELS[day]} ${slot} minute`}
      >
        {MINUTES.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>

      <select
        name={`${day}_${slot}_period`}
        defaultValue={defaultPeriod}
        disabled={disabled}
        className={selectCls}
        aria-label={`${DAY_LABELS[day]} ${slot} AM/PM`}
      >
        {PERIODS.map((p) => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
      </select>
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

  // Determine initial time select defaults.
  const openDefaults = defaultDayHours?.open
    ? to12h(defaultDayHours.open)
    : { hour: "9", minute: "00", period: "AM" as const };

  const closeDefaults = defaultDayHours?.close
    ? to12h(defaultDayHours.close)
    : { hour: "10", minute: "00", period: "PM" as const };

  return (
    <div className="py-3 border-b border-gray-100 last:border-0">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {/* Day label */}
        <span className="w-24 shrink-0 text-sm font-medium text-gray-700">
          {DAY_LABELS[day]}
        </span>

        {/* Closed toggle */}
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

        {/* Time inputs — removed from DOM (and FormData) when closed */}
        {!closed && (
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex flex-col gap-0.5">
              <span className="text-[10px] font-medium text-gray-400 uppercase tracking-wide px-1">
                Open
              </span>
              <TimeInputs
                day={day}
                slot="open"
                defaultHour={openDefaults.hour}
                defaultMinute={openDefaults.minute}
                defaultPeriod={openDefaults.period}
                disabled={isPending}
              />
            </div>
            <span className="text-gray-400 text-sm pb-1.5">–</span>
            <div className="flex flex-col gap-0.5">
              <span className="text-[10px] font-medium text-gray-400 uppercase tracking-wide px-1">
                Close
              </span>
              <TimeInputs
                day={day}
                slot="close"
                defaultHour={closeDefaults.hour}
                defaultMinute={closeDefaults.minute}
                defaultPeriod={closeDefaults.period}
                disabled={isPending}
              />
            </div>
          </div>
        )}
      </div>

      {/* Per-day validation error */}
      {error && !closed && (
        <p className="mt-1 ml-28 text-xs text-red-600" role="alert">
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

  useEffect(() => {
    if (state.success) {
      router.refresh();
      setSaved(true);
      const timer = setTimeout(() => setSaved(false), 4000);
      return () => clearTimeout(timer);
    }
  }, [state.success, router]);

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
