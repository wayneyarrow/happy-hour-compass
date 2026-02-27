"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { updateHhTimesAction } from "./actions";
import type { HhTimesState } from "./types";

// ── Day constants ─────────────────────────────────────────────────────────────

const DAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

type Day = (typeof DAYS)[number];

const HOURS = [
  "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12",
];
const MINUTES = ["00", "15", "30", "45"];
const PERIODS = ["AM", "PM"] as const;

// ── Types ─────────────────────────────────────────────────────────────────────

type TimeBlock = {
  startHour: string;
  startMinute: string;
  startPeriod: "AM" | "PM";
  endHour: string;
  endMinute: string;
  endPeriod: "AM" | "PM";
};

type DayState = {
  noHappyHour: boolean;
  block1: TimeBlock;
  block2: TimeBlock | null;
};

const DEFAULT_BLOCK: TimeBlock = {
  startHour: "4",
  startMinute: "00",
  startPeriod: "PM",
  endHour: "6",
  endMinute: "00",
  endPeriod: "PM",
};

function getDefaultDayStates(): Record<Day, DayState> {
  const result = {} as Record<Day, DayState>;
  for (const day of DAYS) {
    result[day] = {
      noHappyHour: true,
      block1: { ...DEFAULT_BLOCK },
      block2: null,
    };
  }
  return result;
}

// ── Parser ────────────────────────────────────────────────────────────────────

// EN DASH (U+2013) — used as the separator in generated hh_times strings.
const EN_DASH = "\u2013";

function parseTimeStr(
  s: string
): { hour: string; minute: string; period: "AM" | "PM" } | null {
  const trimmed = s.trim().toLowerCase();

  // Gracefully handle "close" / "closing" token from manually-entered data.
  // Map to 11 PM — a reasonable happy-hour end time in the absence of a
  // native "close" option in the time selects.
  if (trimmed === "close" || trimmed === "closing") {
    return { hour: "11", minute: "00", period: "PM" };
  }

  const m = s.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/i);
  if (!m) return null;

  // Pad minute to 2 digits and snap to the nearest valid select option.
  const raw = (m[2] ?? "0").padStart(2, "0");
  const minute = (MINUTES as readonly string[]).includes(raw) ? raw : "00";

  return {
    hour: m[1],
    minute,
    period: m[3].toUpperCase() as "AM" | "PM",
  };
}

function parseTimeRange(range: string): TimeBlock | null {
  // Split on en-dash (U+2013) or regular hyphen-minus.
  // Using explicit Unicode escape avoids any source-file encoding ambiguity.
  const parts = range.trim().split(/\s*[\u2013-]\s*/);
  if (parts.length < 2) return null;
  const start = parseTimeStr(parts[0]);
  const end = parseTimeStr(parts[parts.length - 1]);
  if (!start || !end) return null;
  return {
    startHour: start.hour,
    startMinute: start.minute,
    startPeriod: start.period,
    endHour: end.hour,
    endMinute: end.minute,
    endPeriod: end.period,
  };
}

function parseHhTimes(text: string | null | undefined): Record<Day, DayState> {
  const states = getDefaultDayStates();
  if (!text?.trim()) return states;

  for (const line of text.trim().split("\n")) {
    const m = line.match(
      /^(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday):\s*(.+)$/
    );
    if (!m) continue;

    const day = m[1] as Day;
    const content = m[2].trim();

    if (content === "No happy hour") {
      states[day] = { ...states[day], noHappyHour: true };
      continue;
    }

    states[day].noHappyHour = false;
    const blocks = content.split(", ");
    const block1 = parseTimeRange(blocks[0]);
    if (block1) states[day].block1 = block1;
    if (blocks[1]) {
      states[day].block2 = parseTimeRange(blocks[1]) ?? null;
    }
  }

  return states;
}

// ── Generator ─────────────────────────────────────────────────────────────────

function formatTime(hour: string, minute: string, period: string): string {
  return minute === "00" ? `${hour} ${period}` : `${hour}:${minute} ${period}`;
}

function formatBlock(b: TimeBlock): string {
  const start = formatTime(b.startHour, b.startMinute, b.startPeriod);
  const end = formatTime(b.endHour, b.endMinute, b.endPeriod);
  // Use the same EN_DASH constant the parser targets so round-trips are exact.
  return `${start}${EN_DASH}${end}`;
}

function generateHhTimesText(days: Record<Day, DayState>): string {
  return DAYS.map((day) => {
    const s = days[day];
    if (s.noHappyHour) return `${day}: No happy hour`;
    const blocks = [formatBlock(s.block1)];
    if (s.block2) blocks.push(formatBlock(s.block2));
    return `${day}: ${blocks.join(", ")}`;
  }).join("\n");
}

// ── Styling ───────────────────────────────────────────────────────────────────

const selectCls =
  "px-2 py-1.5 border border-gray-300 rounded-md text-sm bg-white " +
  "focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent " +
  "disabled:opacity-50 disabled:cursor-not-allowed";

// ── TimeBlockInputs ───────────────────────────────────────────────────────────

function TimeBlockInputs({
  block,
  disabled,
  onChange,
}: {
  block: TimeBlock;
  disabled: boolean;
  onChange: (b: TimeBlock) => void;
}) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {/* Start time */}
      <div className="flex items-center gap-1">
        <select
          value={block.startHour}
          onChange={(e) => onChange({ ...block, startHour: e.target.value })}
          disabled={disabled}
          className={selectCls}
          aria-label="Start hour"
        >
          {HOURS.map((h) => (
            <option key={h} value={h}>
              {h}
            </option>
          ))}
        </select>
        <span className="text-gray-400 text-sm font-medium">:</span>
        <select
          value={block.startMinute}
          onChange={(e) => onChange({ ...block, startMinute: e.target.value })}
          disabled={disabled}
          className={selectCls}
          aria-label="Start minute"
        >
          {MINUTES.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <select
          value={block.startPeriod}
          onChange={(e) =>
            onChange({ ...block, startPeriod: e.target.value as "AM" | "PM" })
          }
          disabled={disabled}
          className={selectCls}
          aria-label="Start AM/PM"
        >
          {PERIODS.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </div>

      <span className="text-gray-400 text-sm px-0.5">to</span>

      {/* End time */}
      <div className="flex items-center gap-1">
        <select
          value={block.endHour}
          onChange={(e) => onChange({ ...block, endHour: e.target.value })}
          disabled={disabled}
          className={selectCls}
          aria-label="End hour"
        >
          {HOURS.map((h) => (
            <option key={h} value={h}>
              {h}
            </option>
          ))}
        </select>
        <span className="text-gray-400 text-sm font-medium">:</span>
        <select
          value={block.endMinute}
          onChange={(e) => onChange({ ...block, endMinute: e.target.value })}
          disabled={disabled}
          className={selectCls}
          aria-label="End minute"
        >
          {MINUTES.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <select
          value={block.endPeriod}
          onChange={(e) =>
            onChange({ ...block, endPeriod: e.target.value as "AM" | "PM" })
          }
          disabled={disabled}
          className={selectCls}
          aria-label="End AM/PM"
        >
          {PERIODS.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

// ── HhDayRow ──────────────────────────────────────────────────────────────────

function HhDayRow({
  day,
  dayState,
  isPending,
  onChange,
}: {
  day: Day;
  dayState: DayState;
  isPending: boolean;
  onChange: (s: DayState) => void;
}) {
  return (
    <div className="py-3 border-b border-gray-100 last:border-0">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
        {/* Day label */}
        <span className="w-24 shrink-0 text-sm font-medium text-gray-700 pt-1.5">
          {day}
        </span>

        {/* "No happy hour" checkbox */}
        <label className="flex items-center gap-1.5 text-sm text-gray-600 cursor-pointer select-none shrink-0 pt-1.5">
          <input
            type="checkbox"
            checked={dayState.noHappyHour}
            onChange={(e) =>
              onChange({ ...dayState, noHappyHour: e.target.checked })
            }
            disabled={isPending}
            className="h-4 w-4 rounded border-gray-300 accent-amber-500"
          />
          No happy hour
        </label>

        {/* Time blocks — hidden when noHappyHour */}
        {!dayState.noHappyHour && (
          <div className="flex flex-col gap-2">
            {/* Block 1 */}
            <TimeBlockInputs
              block={dayState.block1}
              disabled={isPending}
              onChange={(b) => onChange({ ...dayState, block1: b })}
            />

            {/* Block 2 (optional) */}
            {dayState.block2 ? (
              <div className="flex items-center gap-3 flex-wrap">
                <TimeBlockInputs
                  block={dayState.block2}
                  disabled={isPending}
                  onChange={(b) => onChange({ ...dayState, block2: b })}
                />
                <button
                  type="button"
                  onClick={() => onChange({ ...dayState, block2: null })}
                  disabled={isPending}
                  className="text-xs text-gray-400 hover:text-red-500 transition-colors disabled:opacity-50"
                  aria-label={`Remove second time block for ${day}`}
                >
                  Remove
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() =>
                  onChange({ ...dayState, block2: { ...DEFAULT_BLOCK } })
                }
                disabled={isPending}
                className="self-start text-xs text-amber-600 hover:text-amber-700 font-medium transition-colors disabled:opacity-50"
              >
                + Add second time
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── HhTimesForm ───────────────────────────────────────────────────────────────

type Props = {
  venueId: string;
  initialHhTimes: string | null;
};

const initialState: HhTimesState = {};

export default function HhTimesForm({ venueId, initialHhTimes }: Props) {
  const router = useRouter();
  const boundAction = updateHhTimesAction.bind(null, venueId);
  const [state, formAction, isPending] = useActionState(boundAction, initialState);
  const [saved, setSaved] = useState(false);

  const [dayStates, setDayStates] = useState<Record<Day, DayState>>(() =>
    parseHhTimes(initialHhTimes)
  );

  // One-shot hydration latch. Starts false on every mount (including after
  // navigation away and back, which fully remounts the component tree).
  // Set to true only when a concrete initialHhTimes value is actually parsed
  // into state. Once locked, prop changes no longer overwrite user edits.
  // Never reset — saves do not need to re-hydrate because the form's current
  // state already reflects exactly what was just saved.
  const hasHydrated = useRef(false);

  // Hydrate internal state from the server-delivered prop.
  // Runs on mount and on every initialHhTimes change, but applies at most
  // once per component lifetime:
  //   • skips if already hydrated (preserves user edits after first load)
  //   • skips if prop is null/empty (prevents clearing the form on a
  //     transient null delivered during router.refresh())
  useEffect(() => {
    if (!hasHydrated.current && initialHhTimes != null) {
      setDayStates(parseHhTimes(initialHhTimes));
      hasHydrated.current = true;
    }
  }, [initialHhTimes]);

  // Fire on every new state object — handles repeated saves correctly
  useEffect(() => {
    if (state.success) {
      router.refresh();
      setSaved(true);
      const timer = setTimeout(() => setSaved(false), 4000);
      return () => clearTimeout(timer);
    }
  }, [state, router]);

  // Derive the serialized schedule string from current UI state
  const generatedText = useMemo(
    () => generateHhTimesText(dayStates),
    [dayStates]
  );

  function updateDay(day: Day, ds: DayState) {
    setDayStates((prev) => ({ ...prev, [day]: ds }));
  }

  return (
    <form action={formAction}>
      {/* Hidden input carries the serialized weekly schedule */}
      <input type="hidden" name="hh_times" value={generatedText} readOnly />

      {state.errors?.form && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-3 mb-4">
          <strong>Error:</strong> {state.errors.form}
        </div>
      )}

      <p className="text-xs text-gray-400 mb-1">
        Set your happy hour times for each day. You can add up to two time
        ranges per day.
      </p>

      <div className="mt-2">
        {DAYS.map((day) => (
          <HhDayRow
            key={day}
            day={day}
            dayState={dayStates[day]}
            isPending={isPending}
            onChange={(ds) => updateDay(day, ds)}
          />
        ))}
      </div>

      <div className="flex items-center gap-3 pt-4">
        <button
          type="submit"
          disabled={isPending}
          className="px-5 py-2 bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-white font-semibold rounded-lg text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isPending ? "Saving…" : "Save times"}
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
