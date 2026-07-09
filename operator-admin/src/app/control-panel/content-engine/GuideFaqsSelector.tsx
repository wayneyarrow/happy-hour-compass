"use client";

import { useEffect, useState } from "react";
import type { GuideType } from "@/lib/data/contentGuides";
import { faqAppliesTo, type FaqLibraryItem, type GuideFaqAnswer } from "@/lib/data/faqLibraryTypes";

/**
 * FAQ picker for the Content Engine guide form (Card 2C) — structured
 * question/answer/related-guide rows, replacing the earlier free-form FAQ
 * idea from the product spec. Ordering follows the same up/down-arrow
 * pattern as AttachmentsSelector (Card 3), for the same reason: no drag
 * library dependency, keyboard-accessible, and already familiar to editors
 * from the Related Venues/Events section above this one.
 *
 * The FAQ library (all active questions, both guide types) and the list of
 * existing guides (for the optional Related Guide picker) are both small,
 * fully-loadable tables — unlike venue/event attachments, there is no
 * server-side search action here. Filtering by guide type is purely a
 * client-side computation against the preloaded faqLibrary prop, so it
 * updates immediately if the admin changes the guide type above, with no
 * round trip.
 *
 * Rows are serialized into one hidden JSON input ("guide_faqs") read by
 * createGuideAction/updateGuideAction in actions.ts, which parse it and
 * hand it to saveGuideFaqs() (src/lib/data/faqLibrary.ts) — that function
 * silently drops any row missing a question or answer and de-dupes by
 * faqId, so a slightly messy submission (e.g. a row left blank) can never
 * fail the whole guide save.
 */

type Row = {
  key: string;
  faqId: string;
  answer: string;
  relatedGuideId: string;
};

type RelatedGuideOption = {
  id: string;
  title: string;
};

type Props = {
  guideType: GuideType | "";
  faqLibrary: FaqLibraryItem[];
  relatedGuideOptions: RelatedGuideOption[];
  initialFaqs: GuideFaqAnswer[];
  /** Reports the current rows (question id + answer only) up to GuideForm on
   * every change, for the Guide Completeness checklist's "Frequently Asked
   * Questions" item — same pattern as AttachmentsSelector's
   * onSelectionChange. Doesn't affect saving; the hidden "guide_faqs" input
   * below is still what's actually submitted. */
  onFaqsChange?: (faqs: { faqId: string; answer: string }[]) => void;
};

let keySeq = 0;
function nextKey(): string {
  keySeq += 1;
  return `row-${keySeq}`;
}

export default function GuideFaqsSelector({
  guideType,
  faqLibrary,
  relatedGuideOptions,
  initialFaqs,
  onFaqsChange,
}: Props) {
  const [rows, setRows] = useState<Row[]>(() =>
    initialFaqs.map((f) => ({
      key: nextKey(),
      faqId: f.faqId,
      answer: f.answer,
      relatedGuideId: f.relatedGuideId ?? "",
    }))
  );

  // Reports the live count on every change (including the initial mount) —
  // safe to include onFaqsChange in deps since GuideForm passes its raw
  // useState setter, which React guarantees is referentially stable.
  useEffect(() => {
    onFaqsChange?.(rows.map((r) => ({ faqId: r.faqId, answer: r.answer })));
  }, [rows, onFaqsChange]);

  const availableFaqs = guideType
    ? faqLibrary.filter((f) => faqAppliesTo(guideType, f.applies_to))
    : faqLibrary;

  const usedFaqIds = new Set(rows.map((r) => r.faqId).filter(Boolean));

  function addRow() {
    setRows((prev) => [...prev, { key: nextKey(), faqId: "", answer: "", relatedGuideId: "" }]);
  }

  function removeRow(key: string) {
    setRows((prev) => prev.filter((r) => r.key !== key));
  }

  function updateRow(key: string, patch: Partial<Row>) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function moveRow(index: number, direction: -1 | 1) {
    setRows((prev) => {
      const target = index + direction;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  const serialized = JSON.stringify(
    rows.map((r) => ({
      faqId: r.faqId,
      answer: r.answer,
      relatedGuideId: r.relatedGuideId || null,
    }))
  );

  return (
    <div className="space-y-4">
      <input type="hidden" name="guide_faqs" value={serialized} />

      {rows.length === 0 && (
        <p className="text-sm text-gray-400">No FAQs added yet.</p>
      )}

      {rows.map((row, index) => (
        <div key={row.key} className="p-4 border border-gray-200 rounded-lg space-y-3">
          <div className="flex items-start gap-2">
            <div className="flex-1 min-w-0">
              <label className="block text-xs font-medium text-gray-500 mb-1">Question</label>
              <select
                value={row.faqId}
                onChange={(e) => updateRow(row.key, { faqId: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-400 focus:border-transparent focus:outline-none"
              >
                <option value="">Select a question…</option>
                {availableFaqs.map((f) => (
                  <option
                    key={f.id}
                    value={f.id}
                    disabled={usedFaqIds.has(f.id) && f.id !== row.faqId}
                  >
                    {f.question}
                  </option>
                ))}
              </select>
              {availableFaqs.length === 0 && (
                <p className="mt-1 text-xs text-gray-400">
                  No active FAQ Library questions apply to this guide type yet.
                </p>
              )}
            </div>
            <div className="flex items-center gap-1 shrink-0 pt-6">
              <button
                type="button"
                onClick={() => moveRow(index, -1)}
                disabled={index === 0}
                className="w-6 h-6 flex items-center justify-center text-gray-400 hover:text-slate-700 disabled:opacity-30 disabled:cursor-not-allowed"
                aria-label="Move FAQ up"
              >
                ↑
              </button>
              <button
                type="button"
                onClick={() => moveRow(index, 1)}
                disabled={index === rows.length - 1}
                className="w-6 h-6 flex items-center justify-center text-gray-400 hover:text-slate-700 disabled:opacity-30 disabled:cursor-not-allowed"
                aria-label="Move FAQ down"
              >
                ↓
              </button>
              <button
                type="button"
                onClick={() => removeRow(row.key)}
                className="ml-1 text-xs text-red-500 hover:text-red-700 whitespace-nowrap"
              >
                Remove
              </button>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Answer</label>
            <textarea
              value={row.answer}
              onChange={(e) => updateRow(row.key, { answer: e.target.value })}
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-400 focus:border-transparent focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">
              Related Guide <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <select
              value={row.relatedGuideId}
              onChange={(e) => updateRow(row.key, { relatedGuideId: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-400 focus:border-transparent focus:outline-none"
            >
              <option value="">None</option>
              {relatedGuideOptions.map((g) => (
                <option key={g.id} value={g.id}>{g.title}</option>
              ))}
            </select>
          </div>
        </div>
      ))}

      <button
        type="button"
        onClick={addRow}
        className="text-sm px-4 py-2 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
      >
        + Add FAQ
      </button>
    </div>
  );
}
