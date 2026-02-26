"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  updateFoodSpecialsAction,
  updateDrinkSpecialsAction,
} from "./actions";
import type { HhItem, SpecialsState } from "./types";

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
};

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_ITEMS = 3;

const EXAMPLE_ROW: Record<"food" | "drink", ItemRow> = {
  food: { name: "Smash Burger", price: "13", notes: "GF" },
  drink: { name: "House Pint", price: "5", notes: "" },
};

const initialState: SpecialsState = {};

// ── Styling ───────────────────────────────────────────────────────────────────

const inputCls =
  "w-full px-3 py-2 border border-gray-300 rounded-lg text-sm " +
  "focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent " +
  "disabled:opacity-60";

const inputErrCls =
  "w-full px-3 py-2 border border-red-400 rounded-lg text-sm " +
  "focus:outline-none focus:ring-2 focus:ring-red-400 focus:border-transparent " +
  "disabled:opacity-60";

// ── TrashIcon ─────────────────────────────────────────────────────────────────

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

export default function SpecialsForm({ venueId, type, initialItems }: Props) {
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

  // Initialise from props; fall back to example row when there's no saved data
  const [items, setItems] = useState<ItemRow[]>(() => {
    if (initialItems.length === 0) return [{ ...EXAMPLE_ROW[type] }];
    return initialItems.map((item) => ({
      name: item.name,
      price: item.price ?? "",
      notes: item.notes ?? "",
    }));
  });

  // Per-row validation errors (parallel array to items)
  const [rowErrors, setRowErrors] = useState<(RowError | null)[]>([]);

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
    if (items.length >= MAX_ITEMS) return;
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
    // Clear error for the edited field immediately
    setRowErrors((prev) =>
      prev.map((err, i) =>
        i === index && err ? { ...err, [field]: undefined } : err
      )
    );
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

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    if (!validate()) {
      e.preventDefault();
    }
  }

  // ── Payload ─────────────────────────────────────────────────────────────────

  // Build the JSON payload that the hidden input carries to the server action.
  // Completely empty rows are filtered out here as well as on the server.
  const payload = JSON.stringify(
    items
      .filter((item) => item.name.trim() || item.price.trim() || item.notes.trim())
      .map((item) => ({
        name: item.name.trim(),
        ...(item.price.trim() ? { price: item.price.trim() } : {}),
        ...(item.notes.trim() ? { notes: item.notes.trim() } : {}),
      }))
  );

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
  const maxHelperText =
    type === "food"
      ? "You can add up to 3 food specials."
      : "You can add up to 3 drink specials.";
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

      {/* Column headers */}
      {items.length > 0 && (
        <div className="grid grid-cols-[1fr_80px_1fr_28px] gap-2 px-0.5">
          <span className="text-xs font-medium text-gray-500">Item name</span>
          <span className="text-xs font-medium text-gray-500">Price</span>
          <span className="text-xs font-medium text-gray-500">Notes</span>
          <span />
        </div>
      )}

      {/* Item rows */}
      <div className="space-y-2">
        {items.map((item, i) => {
          const err = rowErrors[i] ?? null;
          return (
            <div key={i}>
              <div className="grid grid-cols-[1fr_80px_1fr_28px] gap-2 items-start">
                {/* Name */}
                <div>
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

                {/* Price */}
                <div>
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

                {/* Notes */}
                <div>
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

                {/* Delete */}
                <button
                  type="button"
                  onClick={() => removeItem(i)}
                  disabled={isPending}
                  className="mt-2 text-gray-400 hover:text-red-500 transition-colors disabled:opacity-50"
                  aria-label={`Remove row ${i + 1}`}
                >
                  <TrashIcon />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Add item button */}
      {items.length < MAX_ITEMS && (
        <button
          type="button"
          onClick={addItem}
          disabled={isPending}
          className="text-sm text-amber-600 hover:text-amber-700 font-medium transition-colors disabled:opacity-50"
        >
          {addLabel}
        </button>
      )}

      <p className="text-xs text-gray-400">{maxHelperText}</p>

      <div className="flex items-center gap-3 pt-1">
        <button
          type="submit"
          disabled={isPending}
          className="px-5 py-2 bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-white font-semibold rounded-lg text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isPending ? "Saving…" : saveLabel}
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
