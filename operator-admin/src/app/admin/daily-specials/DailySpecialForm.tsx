"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import {
  canCreateRecurringDailySpecialInSupportMode,
  canManageGrandfatheredRecurringDailySpecial,
  type OperatorPlan,
} from "@/lib/plans";
import {
  DESCRIPTION_MAX_LENGTH,
  OFFER_TYPES,
  OFFER_TYPE_LABELS,
  SHORT_SUMMARY_MAX_LENGTH,
  WEEKDAY_LABELS_LONG,
  type Weekday,
} from "@/lib/dailySpecialTypes";
import {
  validateDailySpecialContent,
  validateDailySpecialSchedule,
  validateDailySpecialTime,
} from "@/lib/dailySpecialSchedule";
import { saveDailySpecialAction } from "./actions";
import {
  EMPTY_FORM_STATE,
  hydrateFormState,
  buildSavePayload,
  enterSpecificHours,
  toggleWeekday,
  type DailySpecialFormState,
  type DailySpecialRow,
} from "./formState";

export type { DailySpecialRow };

type Props = {
  initialSpecial?: DailySpecialRow | null;
  venueId: string;
  operatorPlan: OperatorPlan;
  /** Whether the current user is the account owner (controls upgrade CTA wording). */
  isOwner: boolean;
  /** True only for founder impersonation of an unclaimed venue (Case B — see saveDailySpecialAction). */
  isUnclaimedVenueSupportMode: boolean;
  onSaved?: (specialId: string) => void;
  onCancel?: () => void;
};

// ── Weekday UI order — Monday-first, distinct from the 0=Sunday..6=Saturday
// storage order (WEEKDAY_LABELS_LONG's own indexing). Purely a display
// choice; the underlying 0-6 values sent to the server are unaffected.
const WEEKDAY_UI_ORDER: Weekday[] = [1, 2, 3, 4, 5, 6, 0];

// ── Style constants — mirrors src/app/admin/events/EventForm.tsx exactly ────

const inputCls =
  "w-full px-3 py-2 border border-gray-300 rounded-lg text-sm " +
  "focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent " +
  "disabled:opacity-60";

const labelCls = "block text-sm font-medium text-gray-700 mb-1";
const sectionHeadingCls = "text-xs font-semibold text-gray-500 uppercase tracking-wider";

// Live character counter — visually secondary (small, muted, right-aligned),
// concise "N / MAX" formatting per the Phase 2 correction task. Shared by
// Short Summary and Description rather than a new top-level component,
// since it's two call sites in the same file.
//
// Turns red only when length exceeds max — the one way this is reachable
// is an existing saved value that was over the limit before this task's
// limits existed (hydration never truncates it, see formState.ts's
// hydrateFormState) — the operator sees exactly how far over they are and
// must trim it before the save can succeed (server-enforced), rather than
// content being silently clipped.
function CharCounter({ length, max }: { length: number; max: number }) {
  const overLimit = length > max;
  return (
    <p
      className={`mt-1 text-xs text-right tabular-nums ${overLimit ? "text-red-600 font-medium" : "text-gray-400"}`}
    >
      {length} / {max}
    </p>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────
//
// Progressive creation, matching the established Events/Collections pattern
// (src/app/admin/events/EventForm.tsx): a brand new Daily Special (no id
// yet) shows only the fields needed to safely create an unpublished draft —
// Title, Type, and Schedule — behind a "Continue" action. Once the draft
// exists (currentSpecialId is set, whether from a fresh Continue or because
// an existing Daily Special was opened for editing), the full editor
// renders — every other field is either nullable or has a safe server-side
// default, so nothing else blocks draft creation.
//
// No image management anywhere in this form (create or edit) — Daily
// Specials is a text-first product surface (correction task). The
// underlying `image_url` column, imageActions.ts server actions, and the
// venue-images Storage bucket path are all deliberately left in place
// (schema/low-level code, no product benefit to removing them, and no
// consumer surface renders image_url anymore) — this form simply never
// exposes controls for it.
//
// Unlike Events, whose Continue branch also calls onSaved() (relying on
// EventsManager's handleSaved flipping `mode` from "creating" to "editing"
// as a side effect to stop the SECOND save from re-triggering
// "just finished creating" behaviour), Daily Specials' Continue branch
// deliberately does NOT call onSaved — see its own comment in handleSubmit
// below for why that would be wrong here specifically.
//
// Opening an EXISTING Daily Special (initialSpecial provided) always
// hydrates currentSpecialId immediately (see the effect below), so Edit
// never reaches the Step 1 branch — it goes straight to the full editor,
// completely unchanged from before this task.
export default function DailySpecialForm({
  initialSpecial,
  venueId,
  operatorPlan,
  isOwner,
  isUnclaimedVenueSupportMode,
  onSaved,
  onCancel,
}: Props) {
  const [formState, setFormState] = useState<DailySpecialFormState>(EMPTY_FORM_STATE);
  const [currentSpecialId, setCurrentSpecialId] = useState<string | null>(initialSpecial?.id ?? null);
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [titleError, setTitleError] = useState<string | null>(null);
  const [scheduleUpsellVisible, setScheduleUpsellVisible] = useState(false);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const submittingRef = useRef(false);

  // Grandfathered exception: a platform-seeded Daily Special that is
  // CURRENTLY weekly may still be fully managed on a Free plan. Derived
  // from initialSpecial (the row's state as loaded from the database),
  // never from in-session formState edits — mirrors EventForm's identical
  // isSeededAndCurrentlyRecurring derivation exactly.
  const isSeededAndCurrentlyRecurring =
    !!initialSpecial?.is_seeded_special && initialSpecial?.schedule_type === "weekly";
  const canRecur =
    canManageGrandfatheredRecurringDailySpecial(operatorPlan, isSeededAndCurrentlyRecurring) ||
    canCreateRecurringDailySpecialInSupportMode(isUnclaimedVenueSupportMode);

  // Hydrate from server-loaded row.
  useEffect(() => {
    if (!initialSpecial) return;
    setFormState(hydrateFormState(initialSpecial));
    setCurrentSpecialId(initialSpecial.id);
  }, [initialSpecial]);

  function update<K extends keyof DailySpecialFormState>(key: K, value: DailySpecialFormState[K]) {
    setFormState((prev) => ({ ...prev, [key]: value }));
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submittingRef.current) return;
    setError(null);
    setTitleError(null);

    // ── Step 1: Continue — create the draft ─────────────────────────────
    // Only reachable for a brand-new creation (currentSpecialId is null);
    // opening an existing row always hydrates currentSpecialId immediately
    // (see the effect above), so an Edit session never reaches this branch.
    // Validates only Title, Type, and Schedule — the fields Step 1 shows —
    // and sends safe, valid defaults for everything else. isPublished is
    // hard-coded false — Continue must never publish.
    //
    // Deliberately does NOT call onSaved() here, unlike EventForm's
    // otherwise-identical Continue branch. Events' onSaved-on-Continue only
    // works there because EventsManager's handleSaved flips `mode` from
    // "creating" to "editing" as a side effect of that first call — that's
    // what stops the SECOND (full-editor) save from also being treated as
    // "just finished creating." Daily Specials' manager has no such
    // mode-flip step: resolveAfterSave() maps wasCreating=true straight to
    // the neutral idle state with a success toast. Calling onSaved here
    // would fire that neutral-return + toast after Continue — one step too
    // early, and exactly the silent-looking-done-when-it-isn't behaviour
    // this task exists to avoid. Keeping `mode` as "creating" throughout
    // both Step 1 and Step 2 and firing onSaved only from the true final
    // save (below) is simpler than mirroring Events' side effect.
    if (!currentSpecialId) {
      if (!formState.title.trim()) {
        const msg = "Please enter a title.";
        setError(msg);
        setTitleError(msg);
        return;
      }
      if (!formState.offerType) {
        setError("Please select a type (Food, Drink, or Food & Drink).");
        return;
      }

      const scheduleResult = validateDailySpecialSchedule({
        scheduleType: formState.scheduleType,
        oneTimeDate: formState.scheduleType === "one_time" ? formState.oneTimeDate || null : null,
        daysOfWeek: formState.scheduleType === "weekly" ? formState.daysOfWeek : null,
        recurrenceStartDate: formState.scheduleType === "weekly" ? formState.recurrenceStartDate || null : null,
        recurrenceEndDate: formState.scheduleType === "weekly" ? formState.recurrenceEndDate || null : null,
      });
      if (!scheduleResult.valid) {
        setError(scheduleResult.errors[0]);
        return;
      }

      submittingRef.current = true;
      setIsSaving(true);

      const result = await saveDailySpecialAction(
        {
          venueId,
          title: formState.title.trim(),
          offerType: formState.offerType,
          shortSummary: null,
          description: null,
          conditions: null,
          scheduleType: formState.scheduleType,
          oneTimeDate: formState.scheduleType === "one_time" ? (formState.oneTimeDate || null) : null,
          daysOfWeek: formState.scheduleType === "one_time" ? null : formState.daysOfWeek,
          recurrenceStartDate:
            formState.scheduleType === "one_time" ? null : (formState.recurrenceStartDate || null),
          recurrenceEndDate:
            formState.scheduleType === "one_time" ? null : (formState.recurrenceEndDate || null),
          timeMode: "unspecified",
          startTime: null,
          endMode: "unspecified",
          endTime: null,
          isPublished: false,
        },
        null
      );

      submittingRef.current = false;

      if ("error" in result) {
        setError(result.error);
        setIsSaving(false);
        return;
      }

      setCurrentSpecialId(result.savedId);
      setIsSaving(false);
      return;
    }

    // ── Step 2 (new creation, past Continue) / single-stage Edit: full save ──
    // ── Client-side validation — same Phase 1 pure validators the server
    // uses, so client and server can never disagree. This is convenience
    // only; saveDailySpecialAction re-validates authoritatively.
    if (!formState.title.trim()) {
      const msg = "Please enter a title.";
      setError(msg);
      setTitleError(msg);
      return;
    }
    if (!formState.offerType) {
      setError("Please select a type (Food, Drink, or Food & Drink).");
      return;
    }

    const scheduleResult = validateDailySpecialSchedule({
      scheduleType: formState.scheduleType,
      oneTimeDate: formState.scheduleType === "one_time" ? formState.oneTimeDate || null : null,
      daysOfWeek: formState.scheduleType === "weekly" ? formState.daysOfWeek : null,
      recurrenceStartDate: formState.scheduleType === "weekly" ? formState.recurrenceStartDate || null : null,
      recurrenceEndDate: formState.scheduleType === "weekly" ? formState.recurrenceEndDate || null : null,
    });
    if (!scheduleResult.valid) {
      setError(scheduleResult.errors[0]);
      return;
    }

    const timeResult = validateDailySpecialTime({
      timeMode: formState.timeMode,
      startTime: formState.timeMode === "timed" ? formState.startTime || null : null,
      endMode: formState.timeMode === "timed" ? formState.endMode : "unspecified",
      endTime: formState.timeMode === "timed" && formState.endMode === "time" ? formState.endTime || null : null,
    });
    if (!timeResult.valid) {
      setError(timeResult.errors[0]);
      return;
    }

    const contentResult = validateDailySpecialContent({
      shortSummary: formState.shortSummary || null,
      description: formState.description || null,
    });
    if (!contentResult.valid) {
      setError(contentResult.errors[0]);
      return;
    }

    submittingRef.current = true;
    setIsSaving(true);
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current);

    const result = await saveDailySpecialAction(
      buildSavePayload(formState, venueId),
      currentSpecialId
    );

    submittingRef.current = false;

    if ("error" in result) {
      setError(result.error);
      setIsSaving(false);
      return;
    }

    setCurrentSpecialId(result.savedId);
    setIsSaving(false);
    setSaved(true);
    savedTimerRef.current = setTimeout(() => setSaved(false), 4000);
    onSaved?.(result.savedId);
  };

  // ── Shared field blocks — rendered from both the Step 1 (Continue) return
  // and the full editor return below, so Title/Type/Schedule are defined
  // exactly once rather than drifting between two copies.

  const titleAndTypeFields = (
    <>
      {/* Title */}
      <div>
        <label htmlFor="special-title" className={labelCls}>Title</label>
        <input
          id="special-title"
          type="text"
          value={formState.title}
          onChange={(e) => {
            update("title", e.target.value);
            if (titleError) setTitleError(null);
          }}
          placeholder="e.g. Wing Wednesday"
          disabled={isSaving}
          aria-invalid={!!titleError}
          className={inputCls}
        />
        {titleError && <p className="mt-1 text-xs text-red-600">{titleError}</p>}
      </div>

      {/* Type */}
      <div>
        <label className={labelCls}>Type</label>
        <div className="flex flex-wrap gap-2">
          {OFFER_TYPES.map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => update("offerType", type)}
              disabled={isSaving}
              aria-pressed={formState.offerType === type}
              className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                formState.offerType === type
                  ? "bg-amber-500 border-amber-500 text-white"
                  : "bg-white border-gray-300 text-gray-600 hover:bg-gray-50"
              }`}
            >
              {OFFER_TYPE_LABELS[type]}
            </button>
          ))}
        </div>
      </div>
    </>
  );

  const scheduleSection = (
    <div className="pt-5 border-t border-gray-100 space-y-4">
      <h3 className={sectionHeadingCls}>Schedule</h3>

      <div>
        <label className={labelCls}>How often does this special run?</label>
        <div className="flex gap-4">
          <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
            <input
              type="radio"
              name="schedule-type"
              checked={formState.scheduleType === "one_time"}
              onChange={() => {
                setScheduleUpsellVisible(false);
                update("scheduleType", "one_time");
              }}
              disabled={isSaving}
              className="text-amber-500 focus:ring-amber-400"
            />
            One time
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
            <input
              type="radio"
              name="schedule-type"
              checked={formState.scheduleType === "weekly"}
              onChange={() => {
                if (!canRecur) {
                  setScheduleUpsellVisible(true);
                  return;
                }
                setScheduleUpsellVisible(false);
                update("scheduleType", "weekly");
              }}
              disabled={isSaving}
              className="text-amber-500 focus:ring-amber-400"
            />
            Every week {!canRecur && <span className="text-gray-400">(Pro+)</span>}
          </label>
        </div>

        {/* Downgrade notice: existing recurring special on a Free plan */}
        {!canRecur && initialSpecial && formState.scheduleType === "weekly" && (
          <div className="mt-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2.5 text-sm text-amber-800">
            This Daily Special has a recurring schedule from a previous plan. To edit
            the schedule, upgrade to Pro or switch to &ldquo;One time&rdquo; to save other changes.{" "}
            {isOwner ? (
              <Link href="/admin/subscription" className="font-semibold underline underline-offset-2 hover:text-amber-900 transition-colors">
                Change your plan →
              </Link>
            ) : (
              <span className="text-amber-700">Ask the admin to change the plan.</span>
            )}
          </div>
        )}

        {scheduleUpsellVisible && (
          <div className="mt-2 rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 space-y-1.5">
            <p className="text-sm font-semibold text-amber-900">Recurring Daily Specials</p>
            <p className="text-sm text-amber-800 leading-snug">
              Create a Daily Special once and automatically repeat it every week — no
              re-entering details each time.
            </p>
            <p className="text-xs font-medium text-amber-800 pt-0.5">
              Available on Pro and Premium plans.{" "}
              {isOwner ? (
                <Link href="/admin/subscription" className="font-semibold underline underline-offset-2 hover:text-amber-900 transition-colors">
                  Change your plan →
                </Link>
              ) : (
                <span className="text-amber-700">Ask the admin to change the plan.</span>
              )}
            </p>
          </div>
        )}
      </div>

      {formState.scheduleType === "one_time" ? (
        <div>
          <label htmlFor="special-one-time-date" className={labelCls}>Date</label>
          <input
            id="special-one-time-date"
            type="date"
            value={formState.oneTimeDate}
            onChange={(e) => update("oneTimeDate", e.target.value)}
            disabled={isSaving}
            className={inputCls}
          />
        </div>
      ) : (
        <>
          <div>
            <label className={labelCls}>Days of the week</label>
            <div className="flex flex-wrap gap-2">
              {WEEKDAY_UI_ORDER.map((day) => {
                const selected = formState.daysOfWeek.includes(day);
                return (
                  <button
                    key={day}
                    type="button"
                    onClick={() => update("daysOfWeek", toggleWeekday(formState.daysOfWeek, day))}
                    disabled={isSaving}
                    aria-pressed={selected}
                    className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                      selected
                        ? "bg-amber-500 border-amber-500 text-white"
                        : "bg-white border-gray-300 text-gray-600 hover:bg-gray-50"
                    }`}
                  >
                    {WEEKDAY_LABELS_LONG[day]}
                  </button>
                );
              })}
            </div>
            <p className="mt-1 text-xs text-gray-400">Select one or more days — e.g. Monday-Friday, or Saturday and Sunday.</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="special-recurrence-start" className={labelCls}>
                Starts <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <input
                id="special-recurrence-start"
                type="date"
                value={formState.recurrenceStartDate}
                onChange={(e) => update("recurrenceStartDate", e.target.value)}
                disabled={isSaving}
                className={inputCls}
              />
              <p className="mt-1 text-xs text-gray-400">Leave blank if already active.</p>
            </div>
            <div>
              <label htmlFor="special-recurrence-end" className={labelCls}>
                Ends <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <input
                id="special-recurrence-end"
                type="date"
                value={formState.recurrenceEndDate}
                onChange={(e) => update("recurrenceEndDate", e.target.value)}
                disabled={isSaving}
                className={inputCls}
              />
              <p className="mt-1 text-xs text-gray-400">
                Leave blank if it continues until you change or remove it.
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  );

  // ── Step 1: only Title, Type, Schedule — behind Continue ────────────────
  // Not reachable for Edit (see the component doc comment above).
  if (!currentSpecialId) {
    return (
      <form onSubmit={handleSubmit} className="space-y-6">
        {error && (
          <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
            <strong>Error:</strong> {error}
          </div>
        )}

        <p className="text-sm text-gray-500">
          Start with the title, type, and schedule. You&rsquo;ll add a summary,
          description, and publishing status next.
        </p>

        <div className="space-y-4">{titleAndTypeFields}</div>

        {scheduleSection}

        <div className="flex items-center gap-3 pt-1">
          <button
            type="submit"
            disabled={isSaving}
            className="px-5 py-2 bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-white font-semibold rounded-lg text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSaving ? "Creating…" : "Continue"}
          </button>
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              disabled={isSaving}
              className="text-sm font-medium text-gray-500 hover:text-gray-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Cancel
            </button>
          )}
        </div>

        <p className="text-xs text-gray-400">
          This Daily Special is created as a draft — you&rsquo;ll add the rest of the
          details and choose whether to publish it next.
        </p>
      </form>
    );
  }

  // ── Step 2 (new creation, past Continue) / single-stage Edit: full editor ──
  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
          <strong>Error:</strong> {error}
        </div>
      )}

      {/* ── Section 1: Content ───────────────────────────────────────────── */}
      <div className="space-y-4">
        <h3 className={sectionHeadingCls}>Daily Special</h3>

        {titleAndTypeFields}

        {/* Short summary */}
        <div>
          <label htmlFor="special-short-summary" className={labelCls}>
            Short summary <span className="text-gray-400 font-normal">(optional)</span>
          </label>
          <input
            id="special-short-summary"
            type="text"
            value={formState.shortSummary}
            onChange={(e) => update("shortSummary", e.target.value.slice(0, SHORT_SUMMARY_MAX_LENGTH))}
            maxLength={SHORT_SUMMARY_MAX_LENGTH}
            placeholder="$12 wings plus featured beer and cocktail specials."
            disabled={isSaving}
            className={inputCls}
          />
          <p className="mt-1 text-xs text-gray-400">
            A short version of the offer used on Daily Specials cards. Maximum {SHORT_SUMMARY_MAX_LENGTH} characters.
          </p>
          <CharCounter length={formState.shortSummary.length} max={SHORT_SUMMARY_MAX_LENGTH} />
        </div>

        {/* Description */}
        <div>
          <label htmlFor="special-description" className={labelCls}>
            Description <span className="text-gray-400 font-normal">(optional)</span>
          </label>
          <textarea
            id="special-description"
            rows={3}
            value={formState.description}
            onChange={(e) => update("description", e.target.value.slice(0, DESCRIPTION_MAX_LENGTH))}
            maxLength={DESCRIPTION_MAX_LENGTH}
            placeholder="Wings $12. Race Rocks Amber $6. Long Island Iced Tea $8."
            disabled={isSaving}
            className={inputCls + " resize-none"}
          />
          <CharCounter length={formState.description.length} max={DESCRIPTION_MAX_LENGTH} />
        </div>

        {/* Conditions */}
        <div>
          <label htmlFor="special-conditions" className={labelCls}>
            Conditions / additional details <span className="text-gray-400 font-normal">(optional)</span>
          </label>
          <textarea
            id="special-conditions"
            rows={2}
            value={formState.conditions}
            onChange={(e) => update("conditions", e.target.value)}
            placeholder="Dine-in only. Beverage purchase required."
            disabled={isSaving}
            className={inputCls + " resize-none"}
          />
          <p className="mt-1 text-xs text-gray-400">
            e.g. Dine-in only · Beverage purchase required · While quantities last · Reservation required
          </p>
        </div>
      </div>

      {/* ── Section 2: Schedule ──────────────────────────────────────────── */}
      {scheduleSection}

      {/* ── Section 3: Time ──────────────────────────────────────────────── */}
      <div className="pt-5 border-t border-gray-100 space-y-4">
        <h3 className={sectionHeadingCls}>Time</h3>

        <div>
          <label className={labelCls}>When is this special available?</label>
          <div className="flex flex-col gap-2">
            {(
              [
                ["unspecified", "No specific time"],
                ["all_day", "All day"],
                ["timed", "Specific hours"],
              ] as const
            ).map(([mode, label]) => (
              <label key={mode} className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                <input
                  type="radio"
                  name="time-mode"
                  checked={formState.timeMode === mode}
                  onChange={() => {
                    if (mode === "timed") {
                      // See enterSpecificHours()'s own doc comment in
                      // formState.ts for why this is safe against edit
                      // hydration.
                      setFormState(enterSpecificHours);
                      return;
                    }
                    update("timeMode", mode);
                  }}
                  disabled={isSaving}
                  className="text-amber-500 focus:ring-amber-400"
                />
                {label}
              </label>
            ))}
          </div>
        </div>

        {formState.timeMode === "timed" && (
          <div className="space-y-4 pl-1 border-l-2 border-gray-100 ml-1">
            <div>
              <label htmlFor="special-start-time" className={labelCls}>
                Start <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <input
                id="special-start-time"
                type="time"
                step={900}
                value={formState.startTime}
                onChange={(e) => update("startTime", e.target.value)}
                disabled={isSaving}
                className={inputCls}
              />
            </div>

            <div>
              <label className={labelCls}>End</label>
              <div className="flex flex-wrap gap-4 mb-2">
                {(
                  [
                    ["unspecified", "No end time"],
                    ["time", "Specific time"],
                    ["close", "Close"],
                  ] as const
                ).map(([mode, label]) => (
                  <label key={mode} className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                    <input
                      type="radio"
                      name="end-mode"
                      checked={formState.endMode === mode}
                      onChange={() => update("endMode", mode)}
                      disabled={isSaving}
                      className="text-amber-500 focus:ring-amber-400"
                    />
                    {label}
                  </label>
                ))}
              </div>
              {formState.endMode === "time" && (
                <input
                  id="special-end-time"
                  type="time"
                  step={900}
                  value={formState.endTime}
                  onChange={(e) => update("endTime", e.target.value)}
                  disabled={isSaving}
                  className={inputCls}
                />
              )}
              {formState.endMode === "close" && (
                <p className="text-xs text-gray-400">
                  Guests will see &ldquo;Until Close.&rdquo;
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Section 4: Publishing ────────────────────────────────────────── */}
      <div className="pt-5 border-t border-gray-100 space-y-4">
        <h3 className={sectionHeadingCls}>Publishing</h3>

        <div className="flex items-center gap-3">
          <button
            type="button"
            role="switch"
            aria-checked={formState.isPublished}
            onClick={() => update("isPublished", !formState.isPublished)}
            disabled={isSaving}
            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-amber-400 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed ${
              formState.isPublished ? "bg-amber-500" : "bg-gray-200"
            }`}
          >
            <span
              className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                formState.isPublished ? "translate-x-5" : "translate-x-0"
              }`}
            />
          </button>
          <span className="text-sm font-medium text-gray-700">
            {formState.isPublished ? "Published" : "Draft"}
          </span>
          {!formState.isPublished && (
            <span className="text-xs text-gray-400">Visible only to you until published.</span>
          )}
        </div>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={isSaving}
            className="px-5 py-2 bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-white font-semibold rounded-lg text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {/* initialSpecial (not currentSpecialId) decides the label:
                currentSpecialId is always set on this branch, including for
                a brand-new creation's Step 2 (set by Continue) — the label
                must still read "Create Daily Special" there, since this is
                the action that finishes creating a NEW row, just as an
                UPDATE to the same draft row rather than a second insert. */}
            {isSaving ? "Saving…" : initialSpecial ? "Save changes" : "Create Daily Special"}
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
      </div>
    </form>
  );
}
