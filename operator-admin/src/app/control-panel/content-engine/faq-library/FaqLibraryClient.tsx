"use client";

import { useEffect, useState } from "react";
import { useActionState } from "react";
import { useRouter } from "next/navigation";
import type { FaqAppliesTo, FaqLibraryItem } from "@/lib/data/faqLibraryTypes";
import {
  createFaqAction,
  updateFaqAction,
  setFaqActiveAction,
  deleteFaqAction,
  type FaqFormState,
} from "./actions";

/**
 * FAQ Library Control Panel client (Card 2C) — create form + editable table.
 * Mirrors the create-form + per-row-action-form pattern already used by
 * PlatformAdminsClient: each row action (edit save, enable/disable, delete)
 * is its own useActionState-bound server action, refreshing the page's
 * server data via router.refresh() on success rather than holding a second
 * copy of the list in client state.
 */

const inputCls =
  "w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-400 focus:border-transparent focus:outline-none";
const labelCls = "block text-xs font-medium text-gray-500 mb-1";

const APPLIES_TO_OPTIONS: { value: FaqAppliesTo; label: string }[] = [
  { value: "both", label: "Both" },
  { value: "venue", label: "Venue" },
  { value: "event", label: "Event" },
];

function AppliesToBadge({ value }: { value: FaqAppliesTo }) {
  const styles: Record<FaqAppliesTo, string> = {
    both: "bg-gray-100 text-gray-600",
    venue: "bg-sky-50 text-sky-700",
    event: "bg-violet-50 text-violet-700",
  };
  const labels: Record<FaqAppliesTo, string> = { both: "Both", venue: "Venue", event: "Event" };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${styles[value]}`}>
      {labels[value]}
    </span>
  );
}

function StatusBadge({ active }: { active: boolean }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
        active ? "bg-green-50 text-green-700 border border-green-200" : "bg-gray-100 text-gray-500 border border-gray-200"
      }`}
    >
      {active ? "Active" : "Inactive"}
    </span>
  );
}

// ── Create form ────────────────────────────────────────────────────────────────

function CreateFaqForm() {
  const [state, formAction, isPending] = useActionState<FaqFormState, FormData>(createFaqAction, {});
  const router = useRouter();
  const [resetKey, setResetKey] = useState(0);

  useEffect(() => {
    if (state.success) {
      setResetKey((k) => k + 1); // clears uncontrolled inputs via key remount
      router.refresh();
    }
  }, [state.success, router]);

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <h2 className="text-base font-semibold text-gray-900 mb-4">Add a question</h2>
      <form key={resetKey} action={formAction} className="grid grid-cols-1 sm:grid-cols-[2fr_1fr_120px_100px_auto] gap-3 items-end">
        <div>
          <label className={labelCls} htmlFor="new_question">Question</label>
          <input id="new_question" name="question" type="text" required placeholder="e.g. Is parking available nearby?" className={inputCls} />
        </div>
        <div>
          <label className={labelCls} htmlFor="new_category">Category</label>
          <input id="new_category" name="category" type="text" placeholder="e.g. Parking" className={inputCls} />
        </div>
        <div>
          <label className={labelCls} htmlFor="new_applies_to">Applies To</label>
          <select id="new_applies_to" name="applies_to" defaultValue="both" className={inputCls}>
            {APPLIES_TO_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls} htmlFor="new_sort_order">Sort Order</label>
          <input id="new_sort_order" name="sort_order" type="number" defaultValue={0} className={inputCls} />
        </div>
        <button
          type="submit"
          disabled={isPending}
          className="px-5 py-2 bg-amber-500 hover:bg-amber-600 text-white font-semibold rounded-lg text-sm disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
        >
          {isPending ? "Adding…" : "+ Add FAQ"}
        </button>
      </form>
      {state.error && <p className="mt-2 text-xs text-red-600">{state.error}</p>}
    </div>
  );
}

// ── Row ────────────────────────────────────────────────────────────────────────

function FaqRow({ faq }: { faq: FaqLibraryItem }) {
  const [isEditing, setIsEditing] = useState(false);
  const router = useRouter();

  const boundUpdate = updateFaqAction.bind(null, faq.id);
  const [updateState, updateFormAction, isUpdatePending] = useActionState<FaqFormState, FormData>(boundUpdate, {});

  const boundToggle = setFaqActiveAction.bind(null, faq.id, !faq.active);
  const [toggleState, toggleFormAction, isTogglePending] = useActionState<FaqFormState, FormData>(boundToggle, {});

  const boundDelete = deleteFaqAction.bind(null, faq.id);
  const [deleteState, deleteFormAction, isDeletePending] = useActionState<FaqFormState, FormData>(boundDelete, {});

  useEffect(() => {
    if (updateState.success) {
      setIsEditing(false);
      router.refresh();
    }
  }, [updateState.success, router]);

  useEffect(() => {
    if (toggleState.success) router.refresh();
  }, [toggleState.success, router]);

  useEffect(() => {
    if (deleteState.success) router.refresh();
  }, [deleteState.success, router]);

  if (isEditing) {
    return (
      <tr className="bg-amber-50/50">
        <td colSpan={6} className="px-4 py-4">
          <form action={updateFormAction} className="grid grid-cols-1 sm:grid-cols-[2fr_1fr_120px_100px] gap-3">
            <div>
              <label className={labelCls} htmlFor={`question_${faq.id}`}>Question</label>
              <input id={`question_${faq.id}`} name="question" type="text" required defaultValue={faq.question} className={inputCls} />
            </div>
            <div>
              <label className={labelCls} htmlFor={`category_${faq.id}`}>Category</label>
              <input id={`category_${faq.id}`} name="category" type="text" defaultValue={faq.category ?? ""} className={inputCls} />
            </div>
            <div>
              <label className={labelCls} htmlFor={`applies_to_${faq.id}`}>Applies To</label>
              <select id={`applies_to_${faq.id}`} name="applies_to" defaultValue={faq.applies_to} className={inputCls}>
                {APPLIES_TO_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls} htmlFor={`sort_order_${faq.id}`}>Sort Order</label>
              <input id={`sort_order_${faq.id}`} name="sort_order" type="number" defaultValue={faq.sort_order} className={inputCls} />
            </div>
            {updateState.error && (
              <p className="sm:col-span-4 text-xs text-red-600">{updateState.error}</p>
            )}
            <div className="sm:col-span-4 flex gap-2">
              <button
                type="submit"
                disabled={isUpdatePending}
                className="px-4 py-1.5 bg-amber-500 hover:bg-amber-600 text-white font-semibold rounded-lg text-xs disabled:opacity-50 transition-colors"
              >
                {isUpdatePending ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                onClick={() => setIsEditing(false)}
                className="px-4 py-1.5 text-gray-600 hover:text-gray-900 text-xs font-medium transition-colors"
              >
                Cancel
              </button>
            </div>
          </form>
        </td>
      </tr>
    );
  }

  return (
    <tr className="hover:bg-gray-50 transition-colors">
      <td className="px-4 py-3 text-gray-900 max-w-md">{faq.question}</td>
      <td className="px-4 py-3 text-gray-500 hidden sm:table-cell">{faq.category ?? <span className="text-gray-300">—</span>}</td>
      <td className="px-4 py-3"><AppliesToBadge value={faq.applies_to} /></td>
      <td className="px-4 py-3"><StatusBadge active={faq.active} /></td>
      <td className="px-4 py-3 text-gray-500 hidden md:table-cell">{faq.sort_order}</td>
      <td className="px-4 py-3">
        <div className="flex items-center justify-end gap-3 whitespace-nowrap">
          <button type="button" onClick={() => setIsEditing(true)} className="text-xs font-medium text-gray-600 hover:text-gray-900 transition-colors">
            Edit
          </button>
          <form action={toggleFormAction}>
            <button
              type="submit"
              disabled={isTogglePending}
              className="text-xs font-medium text-gray-600 hover:text-gray-900 disabled:opacity-50 transition-colors"
            >
              {faq.active ? "Disable" : "Enable"}
            </button>
          </form>
          <form
            action={deleteFormAction}
            onSubmit={(e) => {
              if (!confirm(`Delete "${faq.question}"? This can't be undone.`)) e.preventDefault();
            }}
          >
            <button
              type="submit"
              disabled={isDeletePending}
              className="text-xs font-medium text-red-600 hover:text-red-700 disabled:opacity-50 transition-colors"
            >
              Delete
            </button>
          </form>
        </div>
        {deleteState.error && <p className="mt-1 text-xs text-red-600 text-right">{deleteState.error}</p>}
      </td>
    </tr>
  );
}

// ── Table ──────────────────────────────────────────────────────────────────────

function FaqTable({ faqs }: { faqs: FaqLibraryItem[] }) {
  if (faqs.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-sm text-gray-400">
        No FAQ Library questions yet.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200">
      <table className="min-w-full bg-white text-sm">
        <thead>
          <tr className="bg-gray-50 border-b border-gray-200">
            <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Question</th>
            <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide hidden sm:table-cell">Category</th>
            <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Applies To</th>
            <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
            <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide hidden md:table-cell">Sort</th>
            <th className="px-4 py-3"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {faqs.map((faq) => (
            <FaqRow key={faq.id} faq={faq} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

export default function FaqLibraryClient({ faqs }: { faqs: FaqLibraryItem[] }) {
  return (
    <div className="space-y-6">
      <CreateFaqForm />
      <FaqTable faqs={faqs} />
    </div>
  );
}
