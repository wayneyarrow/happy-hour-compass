"use client";

import { useActionState, useEffect, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  updateFoodSpecialsAction,
  updateDrinkSpecialsAction,
} from "./actions";
import type { HhItem, SpecialsState } from "./types";
import { foodSpecialsNudge, drinkSpecialsNudge } from "@/lib/planNudges";
import type { OperatorPlan } from "@/lib/plans";

// ── Types ─────────────────────────────────────────────────────────────────────

type ItemRow = {
  name: string;
  price: string;
  notes: string;
};

type RowError = {
  name?: string;
  price?: string;
  notes?: string;
};

type Props = {
  venueId: string;
  /** "food" binds to hh_food_details; "drink" binds to hh_drink_details */
  type: "food" | "drink";
  initialItems: HhItem[];
  /** Maximum number of items allowed on this operator's plan. */
  itemLimit: number;
  /** Current operator plan — used for plan-aware upgrade nudges. */
  plan: OperatorPlan;
  /** Whether the current user is the account owner (controls CTA wording). */
  isOwner: boolean;
};

const initialState: SpecialsState = {};

// ── Styling ───────────────────────────────────────────────────────────────────

const inputCls =
  "w-full px-3 py-2 border border-gray-300 rounded-lg text-sm " +
  "focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent " +
  "placeholder:text-gray-300 disabled:opacity-60";

const inputErrCls =
  "w-full px-3 py-2 border border-red-400 rounded-lg text-sm " +
  "focus:outline-none focus:ring-2 focus:ring-red-400 focus:border-transparent " +
  "placeholder:text-gray-300 disabled:opacity-60";

// Reorder / delete controls share one size — 32px square, larger than the
// 24px precedent in VenueImagesSection.tsx (adapted up, per this task's own
// "comfortable touch targets" requirement) without the glyphs themselves
// growing at all.
const controlBtnCls =
  "w-8 h-8 flex items-center justify-center rounded border text-sm " +
  "disabled:opacity-30 disabled:cursor-not-allowed transition-colors";
const moveBtnCls = `${controlBtnCls} border-gray-200 text-gray-500 hover:bg-gray-50`;
const deleteBtnCls = `${controlBtnCls} border-red-200 text-red-500 hover:bg-red-50 disabled:hover:bg-transparent`;

// ── Icons ─────────────────────────────────────────────────────────────────────

function TrashIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className="w-4 h-4"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
      />
    </svg>
  );
}

// ── SpecialsForm ──────────────────────────────────────────────────────────────

export default function SpecialsForm({ venueId, type, initialItems, itemLimit, plan, isOwner }: Props) {
  const router = useRouter();

  // Select the correct server action based on type
  const boundAction =
    type === "food"
      ? updateFoodSpecialsAction.bind(null, venueId)
      : updateDrinkSpecialsAction.bind(null, venueId);

  const [state, formAction, isPending] = useActionState(
    boundAction,
    initialState
  );
  const [saved, setSaved] = useState(false);

  // Initialise from saved items. If there is no saved data, start with one
  // empty row so the placeholder text is visible — NOT pre-filled example values.
  const [items, setItems] = useState<ItemRow[]>(() => {
    if (initialItems.length === 0) return [{ name: "", price: "", notes: "" }];
    return initialItems.map((item) => ({
      name: item.name,
      price: item.price ?? "",
      notes: item.notes ?? "",
    }));
  });

  // Per-row validation errors (parallel array to items)
  const [rowErrors, setRowErrors] = useState<(RowError | null)[]>([]);

  const [isAutoSaving, startAutoSave] = useTransition();
  const [reorderError, setReorderError] = useState<string | null>(null);

  // Fire on every new state object — handles repeated saves correctly
  useEffect(() => {
    if (state.success) {
      router.refresh();
      setSaved(true);
      const timer = setTimeout(() => setSaved(false), 4000);
      return () => clearTimeout(timer);
    }
  }, [state, router]);

  // ── Item helpers ────────────────────────────────────────────────────────────

  function addItem() {
    if (items.length >= itemLimit) return;
    setItems((prev) => [...prev, { name: "", price: "", notes: "" }]);
    setRowErrors((prev) => [...prev, null]);
  }

  function removeItem(index: number) {
    setItems((prev) => prev.filter((_, i) => i !== index));
    setRowErrors((prev) => prev.filter((_, i) => i !== index));
  }

  function updateItem(index: number, field: keyof ItemRow, value: string) {
    setItems((prev) =>
      prev.map((item, i) => (i === index ? { ...item, [field]: value } : item))
    );
    // Clear the error for the edited field immediately
    setRowErrors((prev) =>
      prev.map((err, i) =>
        i === index && err ? { ...err, [field]: undefined } : err
      )
    );
  }

  // ── Reorder — explicit move controls (replaces HTML5 drag-and-drop) ─────────
  //
  // Same swap-adjacent-element approach as VenueImagesSection.tsx's
  // handleMoveLeft/handleMoveRight, adapted to vertical Up/Down semantics
  // since specials render as a vertical list rather than a thumbnail grid.
  // Auto-saves immediately after the swap, exactly matching the previous
  // drag-and-drop implementation's own auto-save-on-drop behaviour — this
  // isn't new behavior, just the same persistence triggered by a different
  // interaction.

  function moveItem(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= items.length) return;

    const newItems = [...items];
    [newItems[index], newItems[target]] = [newItems[target], newItems[index]];
    setItems(newItems);

    const newErrors = [...rowErrors];
    [newErrors[index], newErrors[target]] = [newErrors[target], newErrors[index]];
    setRowErrors(newErrors);

    autoSaveItems(newItems);
  }

  // ── Auto-save helpers ────────────────────────────────────────────────────────

  function buildPayload(itemsArr: ItemRow[]): string {
    return JSON.stringify(
      itemsArr
        .filter((item) => item.name.trim() || item.price.trim() || item.notes.trim())
        .map((item) => ({
          name: item.name.trim(),
          ...(item.price.trim() ? { price: item.price.trim() } : {}),
          ...(item.notes.trim() ? { notes: item.notes.trim() } : {}),
        }))
    );
  }

  function autoSaveItems(itemsToSave: ItemRow[]) {
    const fd = new FormData();
    fd.set(
      type === "food" ? "hh_food_details" : "hh_drink_details",
      buildPayload(itemsToSave)
    );
    startAutoSave(async () => {
      const result = await boundAction({} as SpecialsState, fd);
      if (result.success) {
        setReorderError(null);
        router.refresh();
      } else {
        setReorderError(
          result.errors?.form ?? "Auto-save failed. Please save manually."
        );
      }
    });
  }

  // ── Client-side validation ──────────────────────────────────────────────────

  function validate(): boolean {
    const errors: (RowError | null)[] = items.map((item) => {
      const name = item.name.trim();
      const price = item.price.trim();
      const notes = item.notes.trim();

      // Completely empty rows will be filtered on save — no error required
      if (!name && !price && !notes) return null;

      const err: RowError = {};
      if (!name) err.name = "Item name is required.";
      else if (name.length > 60) err.name = "Must be 60 characters or fewer.";
      if (price.length > 10) err.price = "Must be 10 characters or fewer.";
      if (notes.length > 40) err.notes = "Must be 40 characters or fewer.";

      return Object.keys(err).length > 0 ? err : null;
    });

    setRowErrors(errors);
    return errors.every((e) => e === null);
  }

  // ── Form submit handler ─────────────────────────────────────────────────────

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    if (!validate()) {
      e.preventDefault();
    }
  }

  // ── Payload ─────────────────────────────────────────────────────────────────

  // Derive the JSON payload the hidden input carries to the server action.
  const payload = buildPayload(items);

  const fieldName =
    type === "food" ? "hh_food_details" : "hh_drink_details";

  // ── Labels ──────────────────────────────────────────────────────────────────

  const addLabel = type === "food" ? "+ Add food item" : "+ Add drink item";
  const saveLabel =
    type === "food" ? "Save food specials" : "Save drink specials";
  const helperText =
    type === "food"
      ? "Add one food special per row. These will appear as bullet points in your listing."
      : "Add one drink special per row. These will appear as bullet points in your listing.";
  const filledCount = items.filter(
    (item) => item.name.trim() || item.price.trim() || item.notes.trim()
  ).length;
  const atLimit = items.length >= itemLimit;
  const namePlaceholder = type === "food" ? "Smash Burger" : "House Pint";

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <form action={formAction} onSubmit={handleSubmit} className="space-y-4">
      {/* Hidden input carries the JSON payload */}
      <input type="hidden" name={fieldName} value={payload} readOnly />

      {state.errors?.form && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
          <strong>Error:</strong> {state.errors.form}
        </div>
      )}

      <p className="text-xs text-gray-400">{helperText}</p>

      {/* Column headers — desktop only. On mobile each field carries its own
          visible label instead (see per-field spans below), since fields no
          longer align under these columns once the row layout stacks. */}
      {items.length > 0 && (
        <div className="hidden sm:grid sm:grid-cols-[1fr_80px_1fr_auto] gap-2 px-0.5">
          <span className="text-xs font-medium text-gray-500">Item name</span>
          <span className="text-xs font-medium text-gray-500">Price</span>
          <span className="text-xs font-medium text-gray-500">
            Notes (optional)
          </span>
          <span />
        </div>
      )}

      {/* Item rows */}
      <div className="space-y-2">
        {items.map((item, i) => {
          const err = rowErrors[i] ?? null;
          const itemLabel = item.name.trim() || `item ${i + 1}`;

          return (
            <div
              key={i}
              className="rounded-lg border border-gray-100 p-3 sm:border-0 sm:p-0"
            >
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_80px_1fr_auto] sm:items-start">
                {/* Name — its own row on mobile, its own column on desktop */}
                <div>
                  <span
                    aria-hidden="true"
                    className="sm:hidden block text-[11px] font-medium text-gray-500 mb-1"
                  >
                    Item name
                  </span>
                  <input
                    type="text"
                    value={item.name}
                    onChange={(e) => updateItem(i, "name", e.target.value)}
                    maxLength={60}
                    disabled={isPending}
                    placeholder={namePlaceholder}
                    className={err?.name ? inputErrCls : inputCls}
                    aria-label="Item name"
                  />
                  {err?.name && (
                    <p className="mt-0.5 text-xs text-red-600" role="alert">
                      {err.name}
                    </p>
                  )}
                </div>

                {/* Price + Notes — grouped together on mobile (their own row,
                    side by side, since both are short fields); on desktop
                    this wrapper disappears (display:contents) so Price and
                    Notes rejoin the outer grid as their own separate
                    columns, reproducing the original row layout exactly. */}
                <div className="grid grid-cols-2 gap-2 sm:contents">
                  <div>
                    <span
                      aria-hidden="true"
                      className="sm:hidden block text-[11px] font-medium text-gray-500 mb-1"
                    >
                      Price
                    </span>
                    <input
                      type="text"
                      value={item.price}
                      onChange={(e) => updateItem(i, "price", e.target.value)}
                      maxLength={10}
                      disabled={isPending}
                      placeholder="13"
                      className={err?.price ? inputErrCls : inputCls}
                      aria-label="Price"
                    />
                    {err?.price && (
                      <p className="mt-0.5 text-xs text-red-600" role="alert">
                        {err.price}
                      </p>
                    )}
                  </div>

                  <div>
                    <span
                      aria-hidden="true"
                      className="sm:hidden block text-[11px] font-medium text-gray-500 mb-1"
                    >
                      Notes (optional)
                    </span>
                    <input
                      type="text"
                      value={item.notes}
                      onChange={(e) => updateItem(i, "notes", e.target.value)}
                      maxLength={40}
                      disabled={isPending}
                      placeholder="GF, Vegan, 12 oz"
                      className={err?.notes ? inputErrCls : inputCls}
                      aria-label="Notes"
                    />
                    {err?.notes && (
                      <p className="mt-0.5 text-xs text-red-600" role="alert">
                        {err.notes}
                      </p>
                    )}
                  </div>
                </div>

                {/* Actions — move up / move down / delete. Right-aligned on
                    mobile (its own full-width row); natural width on
                    desktop (its own trailing column). */}
                <div className="flex items-center justify-end gap-1.5 sm:justify-start sm:pt-0.5">
                  <button
                    type="button"
                    onClick={() => moveItem(i, -1)}
                    disabled={i === 0 || isPending}
                    aria-label={`Move ${itemLabel} up`}
                    className={moveBtnCls}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => moveItem(i, 1)}
                    disabled={i === items.length - 1 || isPending}
                    aria-label={`Move ${itemLabel} down`}
                    className={moveBtnCls}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    onClick={() => removeItem(i)}
                    disabled={isPending}
                    aria-label={`Remove ${itemLabel}`}
                    className={`${deleteBtnCls} ml-1`}
                  >
                    <TrashIcon />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Add item button + count badge */}
      <div className="flex items-center gap-3">
        {!atLimit && (
          <button
            type="button"
            onClick={addItem}
            disabled={isPending}
            className="text-sm text-amber-600 hover:text-amber-700 font-medium transition-colors disabled:opacity-50"
          >
            {addLabel}
          </button>
        )}
        <span className={`text-xs tabular-nums ${filledCount >= itemLimit ? "font-semibold text-amber-700" : "text-gray-400"}`}>
          {filledCount} / {itemLimit} used
        </span>
      </div>

      {/* At-limit nudge */}
      {atLimit && (() => {
        const { atLimitMsg, upgradeSuggestion } =
          type === "food" ? foodSpecialsNudge(plan) : drinkSpecialsNudge(plan);
        return (
          <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2.5 text-sm text-amber-800">
            {atLimitMsg}
            {upgradeSuggestion && <> {upgradeSuggestion}</>}
            {upgradeSuggestion && (
              <>
                {" "}
                {isOwner ? (
                  <Link
                    href="/admin/subscription"
                    className="font-semibold underline underline-offset-2 hover:text-amber-900 transition-colors"
                  >
                    Change your plan →
                  </Link>
                ) : (
                  <span className="text-amber-700">Ask the account owner to change the plan.</span>
                )}
              </>
            )}
          </div>
        );
      })()}

      {reorderError && (
        <p className="text-xs text-red-600" role="alert">
          {reorderError}
        </p>
      )}

      <div className="flex items-center gap-3 pt-1">
        <button
          type="submit"
          disabled={isPending || isAutoSaving}
          className="px-5 py-2 bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-white font-semibold rounded-lg text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isPending || isAutoSaving ? "Saving…" : saveLabel}
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
