"use client";

import { useActionState, useEffect, useState, useTransition, type FormEvent } from "react";
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

/** Six-dot drag handle icon (2 columns × 3 rows of circles). */
function DragHandle() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className="w-3.5 h-3.5"
      fill="currentColor"
      viewBox="0 0 16 16"
      aria-hidden="true"
    >
      <circle cx="5" cy="3.5" r="1.2" />
      <circle cx="11" cy="3.5" r="1.2" />
      <circle cx="5" cy="8" r="1.2" />
      <circle cx="11" cy="8" r="1.2" />
      <circle cx="5" cy="12.5" r="1.2" />
      <circle cx="11" cy="12.5" r="1.2" />
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

  // ── Drag-and-drop state ─────────────────────────────────────────────────────

  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<number | null>(null);
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
    // Clear the error for the edited field immediately
    setRowErrors((prev) =>
      prev.map((err, i) =>
        i === index && err ? { ...err, [field]: undefined } : err
      )
    );
  }

  // ── Drag-and-drop handlers ──────────────────────────────────────────────────

  function handleDragStart(e: React.DragEvent, index: number) {
    setDragIndex(index);
    e.dataTransfer.effectAllowed = "move";
  }

  function handleDragOver(e: React.DragEvent, index: number) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDropTarget(index);
  }

  function handleDrop(e: React.DragEvent, toIndex: number) {
    e.preventDefault();
    if (dragIndex === null || dragIndex === toIndex) {
      setDragIndex(null);
      setDropTarget(null);
      return;
    }
    // Reorder items array
    const newItems = [...items];
    const [moved] = newItems.splice(dragIndex, 1);
    newItems.splice(toIndex, 0, moved);
    setItems(newItems);
    // Keep row errors in sync with the new order
    const newErrors = [...rowErrors];
    const [movedErr] = newErrors.splice(dragIndex, 1);
    newErrors.splice(toIndex, 0, movedErr);
    setRowErrors(newErrors);
    setDragIndex(null);
    setDropTarget(null);
    // Auto-save immediately after reorder
    autoSaveItems(newItems);
  }

  function handleDragEnd() {
    setDragIndex(null);
    setDropTarget(null);
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

      {/* Column headers — 5-col grid: handle | name | price | notes | delete */}
      {items.length > 0 && (
        <div className="grid grid-cols-[20px_1fr_80px_1fr_28px] gap-2 px-0.5">
          <span />
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
          const isDragging = dragIndex === i;
          const isTarget =
            dropTarget === i && dragIndex !== null && dragIndex !== i;

          return (
            <div
              key={i}
              onDragOver={(e) => handleDragOver(e, i)}
              onDrop={(e) => handleDrop(e, i)}
              onDragLeave={() => setDropTarget(null)}
              className={`rounded-lg transition-all ${
                isDragging ? "opacity-40" : ""
              } ${
                isTarget
                  ? "ring-2 ring-amber-400 ring-inset"
                  : ""
              }`}
            >
              <div className="grid grid-cols-[20px_1fr_80px_1fr_28px] gap-2 items-start">
                {/* Drag handle — the draggable affordance for the row */}
                <div
                  draggable
                  onDragStart={(e) => handleDragStart(e, i)}
                  onDragEnd={handleDragEnd}
                  className="mt-2.5 cursor-grab active:cursor-grabbing text-gray-300 hover:text-gray-500 select-none transition-colors"
                  aria-label={`Drag to reorder row ${i + 1}`}
                >
                  <DragHandle />
                </div>

                {/* Name */}
                <div>
                  <input
                    type="text"
                    value={item.name}
                    onChange={(e) => updateItem(i, "name", e.target.value)}
                    maxLength={60}
                    disabled={isPending}
                    placeholder={namePlaceholder}
                    draggable={false}
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
                    draggable={false}
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
                    draggable={false}
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
                  draggable={false}
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
