"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
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

// Minute values recognised when parsing legacy/free-text hh_times strings —
// unchanged from before this redesign. Any minute not in this list is
// snapped to "00", exactly as the previous six-select UI already did
// (it could never produce a minute outside this list in the first place).
const LEGACY_MINUTES = ["00", "15", "30", "45"];

// ── Time-entry step (minutes) ────────────────────────────────────────────────
//
// The task that requested this redesign stated the "existing" increment rule
// as 30 minutes. The actual current UI (the six-select version this file
// replaces) offers 15-minute granularity — see LEGACY_MINUTES above, which
// mirrors the original MINUTES = ["00","15","30","45"] list verbatim. Per
// "do not silently change current business rules," this redesign preserves
// the REAL current increment (15 minutes) rather than the 30-minute figure
// named in that task, since defaulting to 30 would silently narrow what
// operators can already select today. If 30-minute increments are genuinely
// the intended target (not just a mismatched assumption about the current
// UI), change STEP_MINUTES to 30 — every other part of this file (the native
// input's `step`, the increment-validation message, the mobile audit) reads
// from this one constant.
const STEP_MINUTES = 15;
const STEP_SECONDS = STEP_MINUTES * 60;

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

// ── Types ─────────────────────────────────────────────────────────────────────

// Native <input type="time"> value format: 24-hour "HH:MM". Replaces the
// previous { startHour, startMinute, startPeriod, endHour, endMinute,
// endPeriod } shape — the stored hh_times text format (12-hour AM/PM) is
// unchanged; only this in-memory UI representation is simpler now, since a
// single 24-hour string is exactly what the native time input already binds
// to and needs no AM/PM bookkeeping of its own.
type TimeBlock = {
  start: string; // "HH:MM"
  end: string;   // "HH:MM"
};

type DayState = {
  noHappyHour: boolean;
  block1: TimeBlock;
  block2: TimeBlock | null;
};

const DEFAULT_BLOCK: TimeBlock = { start: "16:00", end: "18:00" }; // 4:00 PM – 6:00 PM, same default as before

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

// ── 12-hour ⇄ 24-hour conversion ─────────────────────────────────────────────
//
// The stored hh_times text format is unchanged (12-hour "H[:MM] AM/PM"
// tokens joined with an en dash, one line per day) — these two helpers are
// the only place that format is produced or consumed, converting to/from the
// 24-hour "HH:MM" strings the UI and native time inputs now use internally.

/** Stored 12-hour components → native <input type="time"> value ("HH:MM"). */
function to24HourString(hour: string, minute: string, period: "AM" | "PM"): string {
  let h = parseInt(hour, 10) % 12; // "12" -> 0
  if (period === "PM") h += 12;
  return `${String(h).padStart(2, "0")}:${minute}`;
}

/** Native <input type="time"> value ("HH:MM") → stored 12-hour token, e.g. "4 PM" / "4:30 PM". Mirrors the previous formatTime()'s exact output shape. */
function to12HourToken(time24: string): string {
  const [hStr, mStr] = time24.split(":");
  const h24 = parseInt(hStr, 10);
  const period: "AM" | "PM" = h24 >= 12 ? "PM" : "AM";
  const h12raw = h24 % 12;
  const h12 = h12raw === 0 ? 12 : h12raw;
  return mStr === "00" ? `${h12} ${period}` : `${h12}:${mStr} ${period}`;
}

// ── Parser ────────────────────────────────────────────────────────────────────

// EN DASH (U+2013) — used as the separator in generated hh_times strings.
const EN_DASH = "–";

function parseTimeStr(
  s: string
): { hour: string; minute: string; period: "AM" | "PM" } | null {
  const trimmed = s.trim().toLowerCase();

  // Gracefully handle "close" / "closing" token from manually-entered data.
  if (trimmed === "close" || trimmed === "closing") {
    return { hour: "11", minute: "00", period: "PM" };
  }

  const m = s.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/i);
  if (!m) return null;

  const raw = (m[2] ?? "0").padStart(2, "0");
  const minute = LEGACY_MINUTES.includes(raw) ? raw : "00";

  return {
    hour: m[1],
    minute,
    period: m[3].toUpperCase() as "AM" | "PM",
  };
}

function parseTimeRange(range: string): TimeBlock | null {
  // Dashes are already normalized to hyphen-minus by parseHhTimes.
  const parts = range.trim().split(/\s*-\s*/);
  if (parts.length < 2) return null;
  const end = parseTimeStr(parts[parts.length - 1]);
  if (!end) return null;
  // Trailing-period notation from imports: "3:00 - 5:00 PM" — only the end
  // carries AM/PM; inherit it for the start when parseTimeStr would otherwise fail.
  let start = parseTimeStr(parts[0]);
  if (!start) {
    const p = parts[parts.length - 1].match(/\s*(am|pm)\s*$/i)?.[1];
    if (p) start = parseTimeStr(`${parts[0].trim()} ${p}`);
  }
  if (!start) return null;
  return {
    start: to24HourString(start.hour, start.minute, start.period),
    end: to24HourString(end.hour, end.minute, end.period),
  };
}

/**
 * Expands a day-part string (already dash-normalised) into the individual Day
 * values it covers. Handles:
 *   • Single day:   "Monday"
 *   • Range:        "Monday - Thursday"  (wraps if end < start, e.g. "Friday - Sunday")
 *   • "Daily" / "Everyday"  → all 7 days
 *   • "Weekdays"             → Monday – Friday
 *
 * Returns [] if the input cannot be resolved, so the caller can skip the line.
 */
function parseDayRange(rawDayPart: string): Day[] {
  const dayPart = rawDayPart.trim();

  // "Daily" / "Everyday" → all 7 days
  if (/^(daily|everyday)$/i.test(dayPart)) return [...DAYS];

  // "Weekdays" → Monday – Friday
  if (/^weekdays$/i.test(dayPart)) {
    return DAYS.filter((d) => d !== "Saturday" && d !== "Sunday");
  }

  // "Monday - Thursday" → range of consecutive days.
  // After normalisation the separator is always hyphen-minus.
  const dashIdx = dayPart.indexOf("-");
  if (dashIdx !== -1) {
    const startName = dayPart.slice(0, dashIdx).trim();
    const endName   = dayPart.slice(dashIdx + 1).trim();
    const si = (DAYS as readonly string[]).indexOf(startName);
    const ei = (DAYS as readonly string[]).indexOf(endName);
    if (si !== -1 && ei !== -1) {
      if (si <= ei) return DAYS.slice(si, ei + 1) as Day[];
      // Range wraps past Saturday back to Sunday (e.g. "Friday - Sunday")
      return [...DAYS.slice(si), ...DAYS.slice(0, ei + 1)] as Day[];
    }
  }

  // Single day name
  if ((DAYS as readonly string[]).includes(dayPart)) return [dayPart as Day];

  return [];
}

function parseHhTimes(text: string | null | undefined): Record<Day, DayState> {
  const states = getDefaultDayStates();
  if (!text?.trim()) return states;

  // Normalize all dash variants to plain hyphen-minus:
  //   U+2013 en dash, U+2014 em dash, U+2212 minus sign.
  const normalized = text.replace(/[–—−]/g, "-");

  // If stored in pipe-delimited import format (no newlines, pipe-separated day
  // blocks), expand to one line per day so the loop below handles it normally.
  // Format: "Monday: 3:00 - 5:00 PM | Tuesday: 3:00 - 5:00 PM | ..."
  // Compact-pipe (no day labels, e.g. "2pm - 5pm | 9pm - close") expands to
  // lines with no colon → they are skipped by the colonIdx check below, so
  // compact-pipe venues still show "No happy hour" (correct: days unknown).
  const textToSplit =
    !normalized.trim().includes("\n") && normalized.includes("|")
      ? normalized
          .trim()
          .split("|")
          .map((b) => b.trim())
          .filter(Boolean)
          .join("\n")
      : normalized;

  // Accumulate time blocks per day so multiple lines that cover the same day
  // (e.g. "Daily: 2 PM - 6 PM" followed by "Daily: 9 PM - Close") stack
  // correctly into block1 / block2 rather than overwriting each other.
  const dayBlocks: Partial<Record<Day, TimeBlock[]>> = {};

  for (const rawLine of textToSplit.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;

    // Split on the FIRST colon only so that "H:MM AM" in the value is preserved.
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;

    const dayPart = line.slice(0, colonIdx).trim();
    const value   = line.slice(colonIdx + 1).trim();

    const days = parseDayRange(dayPart);
    if (days.length === 0) continue;

    if (/^no happy hour$/i.test(value)) {
      // Explicit close — clear any previously accumulated blocks for these days.
      for (const day of days) dayBlocks[day] = [];
      continue;
    }

    // Parse up to two comma-separated time ranges per line.
    const timeBlocks: TimeBlock[] = [];
    for (const part of value.split(",")) {
      const tb = parseTimeRange(part.trim());
      if (tb) timeBlocks.push(tb);
    }

    if (timeBlocks.length > 0) {
      for (const day of days) {
        if (!dayBlocks[day]) dayBlocks[day] = [];
        dayBlocks[day]!.push(...timeBlocks);
      }
    }
  }

  // Apply accumulated blocks to the final states map.
  for (const [day, blocks] of Object.entries(dayBlocks) as [Day, TimeBlock[]][]) {
    if (!blocks || blocks.length === 0) {
      states[day].noHappyHour = true;
    } else {
      states[day].noHappyHour = false;
      states[day].block1 = blocks[0];
      states[day].block2 = blocks[1] ?? null;
    }
  }

  return states;
}

// ── Generator ─────────────────────────────────────────────────────────────────

function formatBlock(b: TimeBlock): string {
  return `${to12HourToken(b.start)}${EN_DASH}${to12HourToken(b.end)}`;
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

// ── Client-side validation ───────────────────────────────────────────────────
//
// The previous six-select UI had no explicit validation logic anywhere (in
// this file or in updateHhTimesAction) — it simply couldn't produce an
// "invalid" value, since every field was a closed dropdown with a always-set
// default. A native <input type="time"> CAN be left empty or hand-typed
// off-step, so real validation is added here to cover exactly the new
// failure modes the input change introduces, plus the categories the task
// asked to preserve/improve. This runs client-side only, on submit — it does
// not touch updateHhTimesAction (server-side still saves whatever valid text
// is generated, unchanged), and it never runs against already-saved data on
// load, only against the operator's current in-progress edits.

type BlockErrors = { block1?: string; block2?: string };
type ClientErrors = Partial<Record<Day, BlockErrors>>;

function minutesSinceMidnight(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function isOnStep(hhmm: string): boolean {
  return minutesSinceMidnight(hhmm) % STEP_MINUTES === 0;
}

/**
 * [start, end) in minutes-since-midnight, with end pushed past midnight
 * (+1440) when it's numerically before start — i.e. treated as an overnight
 * span (e.g. 9 PM–2 AM). Overnight spans aren't specially handled anywhere
 * in the previous free-text format (nothing validated start/end order at
 * all), so they're treated here as a legitimate, ordinary case rather than
 * an error — only used for the overlap check below, never for storage.
 */
function normalizedRange(b: TimeBlock): [number, number] {
  const start = minutesSinceMidnight(b.start);
  let end = minutesSinceMidnight(b.end);
  if (end <= start) end += 24 * 60;
  return [start, end];
}

function overlaps1D(a: [number, number], b: [number, number]): boolean {
  return a[0] < b[1] && b[0] < a[1];
}

/**
 * Two normalizedRange() outputs both live in a [0, 2880) window anchored to
 * the same calendar day, but only one of them may have been pushed past
 * midnight (+1440) to represent an overnight span — e.g. block1 = 9 PM–2 AM
 * ([1260, 1560]) and block2 = 1 AM–3 AM ([60, 180]) are the same early
 * morning, but a direct comparison of those two ranges as given doesn't see
 * that, since block2 was never shifted. Checking b against a ±1440 shift
 * (equivalent to checking a against a ∓1440 shift of itself) covers that
 * case without needing a fully general modular-interval implementation.
 */
function rangesOverlap(a: [number, number], b: [number, number]): boolean {
  const DAY = 24 * 60;
  return (
    overlaps1D(a, b) ||
    overlaps1D(a, [b[0] + DAY, b[1] + DAY]) ||
    overlaps1D(a, [b[0] - DAY, b[1] - DAY])
  );
}

function validateBlock(b: TimeBlock): string | null {
  if (!b.start || !b.end) return "Start and end time are required.";
  if (!TIME_RE.test(b.start) || !TIME_RE.test(b.end)) return "Enter a valid time.";
  if (b.start === b.end) return "Start and end time can't be the same.";
  if (!isOnStep(b.start) || !isOnStep(b.end)) {
    return `Times must be in ${STEP_MINUTES}-minute increments.`;
  }
  return null;
}

function validateDayState(ds: DayState): BlockErrors {
  if (ds.noHappyHour) return {};

  const errors: BlockErrors = {};
  const e1 = validateBlock(ds.block1);
  if (e1) errors.block1 = e1;

  if (ds.block2) {
    const e2 = validateBlock(ds.block2);
    if (e2) errors.block2 = e2;

    if (!e1 && !e2) {
      if (ds.block1.start === ds.block2.start && ds.block1.end === ds.block2.end) {
        errors.block2 = "This time block duplicates the first one.";
      } else if (rangesOverlap(normalizedRange(ds.block1), normalizedRange(ds.block2))) {
        errors.block2 = "This time block overlaps with the first one.";
      }
    }
  }

  return errors;
}

// ── Styling ───────────────────────────────────────────────────────────────────

function timeInputCls(hasError: boolean): string {
  return (
    "w-full px-2.5 py-2.5 border rounded-md text-sm bg-white " +
    "focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent " +
    "disabled:opacity-50 disabled:cursor-not-allowed " +
    (hasError ? "border-red-400" : "border-gray-300")
  );
}

// ── TimeBlockInputs ───────────────────────────────────────────────────────────

function TimeBlockInputs({
  idPrefix,
  dayLabel,
  blockSuffix,
  block,
  disabled,
  onChange,
  error,
}: {
  /** Unique id prefix for this block's start/end inputs, e.g. "hh-Monday-block1" or "hh-bulk-block". */
  idPrefix: string;
  /** Day name (or null for the bulk-apply panel, which isn't tied to one day) — used only to build a fuller accessible name, not shown visually here. */
  dayLabel: string | null;
  /** e.g. ", second time block" — appended to the accessible name only. */
  blockSuffix?: string;
  block: TimeBlock;
  disabled: boolean;
  onChange: (b: TimeBlock) => void;
  error?: string;
}) {
  const startId = `${idPrefix}-start`;
  const endId = `${idPrefix}-end`;
  const errorId = `${idPrefix}-error`;
  const context = dayLabel ? `${dayLabel} ` : "";

  return (
    <div>
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr] gap-2 sm:items-end">
        <div>
          <label htmlFor={startId} className="block text-xs font-medium text-gray-500 mb-1">
            Start time
          </label>
          <input
            id={startId}
            type="time"
            step={STEP_SECONDS}
            value={block.start}
            onChange={(e) => onChange({ ...block, start: e.target.value })}
            disabled={disabled}
            aria-label={`${context}start time${blockSuffix ?? ""}`}
            aria-describedby={error ? errorId : undefined}
            aria-invalid={error ? true : undefined}
            className={timeInputCls(Boolean(error))}
          />
        </div>

        <div className="text-gray-400 text-sm text-center sm:pb-2.5" aria-hidden="true">
          to
        </div>

        <div>
          <label htmlFor={endId} className="block text-xs font-medium text-gray-500 mb-1">
            End time
          </label>
          <input
            id={endId}
            type="time"
            step={STEP_SECONDS}
            value={block.end}
            onChange={(e) => onChange({ ...block, end: e.target.value })}
            disabled={disabled}
            aria-label={`${context}end time${blockSuffix ?? ""}`}
            aria-describedby={error ? errorId : undefined}
            aria-invalid={error ? true : undefined}
            className={timeInputCls(Boolean(error))}
          />
        </div>
      </div>

      {error && (
        <p id={errorId} role="alert" className="mt-1 text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}

// ── HhDayRow ──────────────────────────────────────────────────────────────────

function HhDayRow({
  day,
  dayState,
  isPending,
  onChange,
  onCopyPrev,
  prevDayName,
  errors,
}: {
  day: Day;
  dayState: DayState;
  isPending: boolean;
  onChange: (s: DayState) => void;
  onCopyPrev?: () => void;
  prevDayName?: Day;
  errors?: BlockErrors;
}) {
  return (
    <div className="py-3 border-b border-gray-100 last:border-0">
      {/*
        Mobile (below sm:): a plain vertical stack. The day-label+checkbox
        group renders as its own full-width top row (flex row internally),
        and the time-blocks group — a flex-col child here — gets the full
        row width for free via the default flex align-items:stretch, with
        no flex-grow/shrink involved on this axis at all.

        Desktop (sm: and up): flex-row + flex-wrap, matching the layout
        exactly as it was before this fix. The day-label+checkbox wrapper
        switches to `sm:contents`, which removes it from the box model at
        that breakpoint so its two children rejoin this row as direct flex
        items — reproducing the original three-sibling (label | checkbox |
        time-blocks) arrangement byte-for-byte, not just visually.
      */}
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-start sm:gap-x-4 sm:gap-y-2">
        {/* Day label + "No happy hour" — grouped together on mobile; this
            wrapper itself disappears from layout at sm: (see comment above). */}
        <div className="flex items-start gap-4 sm:contents">
          {/* Day label + copy-prev */}
          <div className="w-24 shrink-0 flex flex-col pt-1.5 gap-0.5">
            <span className="text-sm font-medium text-gray-700">{day}</span>
            {onCopyPrev && (
              <button
                type="button"
                onClick={onCopyPrev}
                disabled={isPending}
                className="text-left text-xs text-gray-400 hover:text-amber-600 transition-colors disabled:opacity-50"
                aria-label={`Copy ${prevDayName} schedule to ${day}`}
              >
                ↑ Copy {prevDayName?.slice(0, 3)}
              </button>
            )}
          </div>

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
        </div>

        {/* Time blocks — hidden when noHappyHour. Full width on mobile (no
            flex-grow/shrink needed there — see the outer comment); on
            desktop, sm:min-w-0 sm:flex-1 lets it share the row safely with
            the two items above without overflowing. This is the same pair
            of classes that previously caused the mobile compression bug —
            they're scoped to sm: now specifically so they can never again
            apply while the day-row is stacked. */}
        {!dayState.noHappyHour && (
          <div className="flex flex-col gap-2 sm:min-w-0 sm:flex-1">
            {/* Block 1 */}
            <TimeBlockInputs
              idPrefix={`hh-${day}-block1`}
              dayLabel={day}
              block={dayState.block1}
              disabled={isPending}
              onChange={(b) => onChange({ ...dayState, block1: b })}
              error={errors?.block1}
            />

            {/* Block 2 (optional) */}
            {dayState.block2 ? (
              <div className="flex flex-col gap-1.5">
                <TimeBlockInputs
                  idPrefix={`hh-${day}-block2`}
                  dayLabel={day}
                  blockSuffix=", second time block"
                  block={dayState.block2}
                  disabled={isPending}
                  onChange={(b) => onChange({ ...dayState, block2: b })}
                  error={errors?.block2}
                />
                <button
                  type="button"
                  onClick={() => onChange({ ...dayState, block2: null })}
                  disabled={isPending}
                  className="self-start text-xs text-gray-400 hover:text-red-500 transition-colors disabled:opacity-50"
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

// ── BulkApplyPanel ────────────────────────────────────────────────────────────

const DAY_ABBREVS: Record<Day, string> = {
  Sunday: "Sun",
  Monday: "Mon",
  Tuesday: "Tue",
  Wednesday: "Wed",
  Thursday: "Thu",
  Friday: "Fri",
  Saturday: "Sat",
};

const WEEKDAYS: Day[] = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
const WEEKEND_DAYS: Day[] = ["Saturday", "Sunday"];

function BulkApplyPanel({
  onApply,
  isPending,
}: {
  onApply: (days: Day[], state: DayState) => void;
  isPending: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [selectedDays, setSelectedDays] = useState<Set<Day>>(new Set());
  const [noHappyHour, setNoHappyHour] = useState(false);
  const [block, setBlock] = useState<TimeBlock>({ ...DEFAULT_BLOCK });

  function toggleDay(day: Day) {
    setSelectedDays((prev) => {
      const next = new Set(prev);
      if (next.has(day)) next.delete(day);
      else next.add(day);
      return next;
    });
  }

  function selectPreset(preset: "all" | "weekdays" | "weekends") {
    if (preset === "all") setSelectedDays(new Set(DAYS));
    else if (preset === "weekdays") setSelectedDays(new Set(WEEKDAYS));
    else setSelectedDays(new Set(WEEKEND_DAYS));
  }

  function handleApply() {
    if (selectedDays.size === 0) return;
    onApply([...selectedDays], { noHappyHour, block1: { ...block }, block2: null });
  }

  return (
    <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-sm font-medium text-amber-800 hover:bg-amber-100 transition-colors"
      >
        <span>Apply schedule to multiple days</span>
        <svg
          className={`w-4 h-4 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3 border-t border-amber-200">
          {/* Day picker */}
          <div className="pt-3">
            <div className="flex gap-1.5 flex-wrap">
              {DAYS.map((day) => (
                <button
                  key={day}
                  type="button"
                  onClick={() => toggleDay(day)}
                  disabled={isPending}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                    selectedDays.has(day)
                      ? "bg-amber-500 text-white"
                      : "bg-white border border-gray-300 text-gray-600 hover:border-amber-400"
                  }`}
                >
                  {DAY_ABBREVS[day]}
                </button>
              ))}
            </div>
            <div className="flex gap-3 mt-2">
              {(["all", "weekdays", "weekends"] as const).map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => selectPreset(preset)}
                  disabled={isPending}
                  className="text-xs text-amber-700 hover:text-amber-900 hover:underline"
                >
                  {preset === "all"
                    ? "All days"
                    : preset.charAt(0).toUpperCase() + preset.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {/* No HH toggle */}
          <label className="flex items-center gap-1.5 text-sm text-gray-600 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={noHappyHour}
              onChange={(e) => setNoHappyHour(e.target.checked)}
              disabled={isPending}
              className="h-4 w-4 rounded border-gray-300 accent-amber-500"
            />
            No happy hour
          </label>

          {/* Time inputs */}
          {!noHappyHour && (
            <TimeBlockInputs
              idPrefix="hh-bulk-block"
              dayLabel={null}
              block={block}
              disabled={isPending}
              onChange={setBlock}
            />
          )}

          {/* Apply button */}
          <button
            type="button"
            onClick={handleApply}
            disabled={isPending || selectedDays.size === 0}
            className="px-4 py-1.5 bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-white font-semibold rounded-lg text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {selectedDays.size > 0
              ? `Apply to ${selectedDays.size} day${selectedDays.size !== 1 ? "s" : ""}`
              : "Select days to apply"}
          </button>
        </div>
      )}
    </div>
  );
}

// ── HhTimesForm ───────────────────────────────────────────────────────────────

type Props = {
  venueId: string;
  initialHhTimes: string | null;
  /**
   * Optional server action to use instead of the default updateHhTimesAction.
   * Used by the Control Panel Fix panel so it can run CP-specific auth +
   * publish eligibility logic without duplicating the editor UI.
   */
  actionOverride?: (
    prevState: HhTimesState,
    formData: FormData
  ) => Promise<HhTimesState>;
  /**
   * Called after a successful save when provided. Replaces the default
   * router.refresh() + Saved badge behaviour (e.g., to close a panel).
   */
  onSuccess?: () => void;
};

const initialState: HhTimesState = {};

export default function HhTimesForm({
  venueId,
  initialHhTimes,
  actionOverride,
  onSuccess,
}: Props) {
  const router = useRouter();
  const [state, formAction, isPending] = useActionState(
    actionOverride ?? updateHhTimesAction.bind(null, venueId),
    initialState
  );
  const [saved, setSaved] = useState(false);
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);

  // Default to all-"No happy hour". The effect below hydrates from the prop
  // as soon as a real string is available.
  const [dayStates, setDayStates] = useState<Record<Day, DayState>>(
    getDefaultDayStates
  );

  // Prop-driven sync — no guards, no "already hydrated" flag.
  // Runs whenever initialHhTimes changes. Skips on falsy to avoid wiping
  // visible state during a transient null (e.g. in-flight router refresh).
  // While the user edits, initialHhTimes is stable so this never fires.
  // After Save + router.refresh(), the prop updates to the new DB string and
  // this runs once, keeping local state aligned with what was just saved.
  useEffect(() => {
    if (!initialHhTimes?.trim()) return;
    setDayStates(parseHhTimes(initialHhTimes));
  }, [initialHhTimes]);

  // On successful save: if an onSuccess callback is provided (e.g., CP Fix panel),
  // call it so the panel can close itself. Otherwise use the default behaviour:
  // refresh the router so initialHhTimes reflects the new DB value and show a
  // 4 s Saved badge.
  useEffect(() => {
    if (state.success) {
      if (onSuccess) {
        onSuccess();
      } else {
        router.refresh();
        setSaved(true);
        const timer = setTimeout(() => setSaved(false), 4000);
        return () => clearTimeout(timer);
      }
    }
  }, [state, router, onSuccess]);

  // Derive the serialized schedule string from current UI state.
  const generatedText = useMemo(
    () => generateHhTimesText(dayStates),
    [dayStates]
  );

  // Client-side validation — see the "Client-side validation" section above
  // for why this exists and what it does (and doesn't) cover.
  const clientErrors: ClientErrors = useMemo(() => {
    const result: ClientErrors = {};
    for (const day of DAYS) {
      const errs = validateDayState(dayStates[day]);
      if (errs.block1 || errs.block2) result[day] = errs;
    }
    return result;
  }, [dayStates]);

  const hasClientErrors = Object.keys(clientErrors).length > 0;

  function updateDay(day: Day, ds: DayState) {
    setDayStates((prev) => ({ ...prev, [day]: ds }));
  }

  function applyToDays(days: Day[], ds: DayState) {
    setDayStates((prev) => {
      const next = { ...prev };
      for (const day of days) next[day] = { ...ds };
      return next;
    });
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    setHasAttemptedSubmit(true);
    if (hasClientErrors) {
      e.preventDefault();
    }
  }

  return (
    <form action={formAction} onSubmit={handleSubmit} noValidate>
        {/* Hidden input carries the serialized weekly schedule */}
        <input type="hidden" name="hh_times" value={generatedText} readOnly />

        {state.errors?.form && (
          <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-3 mb-4">
            <strong>Error:</strong> {state.errors.form}
          </div>
        )}

        {hasAttemptedSubmit && hasClientErrors && (
          <div role="alert" className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-3 mb-4">
            Please fix the highlighted time{Object.keys(clientErrors).length !== 1 ? "s" : ""} below before saving.
          </div>
        )}

        <p className="text-xs text-gray-400 mb-1">
          Set your happy hour times for each day. You can add up to two time
          ranges per day.
        </p>
        <p className="text-xs text-gray-400 mb-3">
          Depending on your browser or device, times may appear in either
          12-hour (5:00 PM) or 24-hour (17:00) format. Both display the same
          saved time.
        </p>

        <BulkApplyPanel onApply={applyToDays} isPending={isPending} />

        <div className="mt-2">
          {DAYS.map((day, i) => (
            <HhDayRow
              key={day}
              day={day}
              dayState={dayStates[day]}
              isPending={isPending}
              onChange={(ds) => updateDay(day, ds)}
              onCopyPrev={i > 0 ? () => updateDay(day, { ...dayStates[DAYS[i - 1]] }) : undefined}
              prevDayName={i > 0 ? DAYS[i - 1] : undefined}
              errors={hasAttemptedSubmit ? clientErrors[day] : undefined}
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
