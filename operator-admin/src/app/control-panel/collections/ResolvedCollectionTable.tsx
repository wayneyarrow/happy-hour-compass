"use client";

import { useEffect, useState, useTransition } from "react";
import type { AttachmentCandidate } from "@/lib/data/contentGuideAttachments";
import type { CollectionPreviewItem, CollectionPreviewResult } from "@/lib/data/collectionsPreview";
import type { AlgorithmKey } from "@/lib/data/collectionsShared";
import {
  searchCollectionVenueCandidatesAction,
  searchCollectionEventCandidatesAction,
  generateCollectionResultAction,
  type CollectionCandidateSearchInput,
} from "./actions";

/**
 * The Collection editor's single "Resolved Collection" working area for
 * Venue and Event Collections — replaces the earlier separate
 * CollectionMembershipPicker (manual overrides) + CollectionPreview
 * (read-only algorithm preview) split, which browser QA found confusing
 * (algorithm results, manual overrides, and preview were disconnected).
 *
 * Manual Collections: this IS the membership list — search, add, remove,
 * reorder. No algorithm, no boost, no Source/Exclude concepts (would only
 * add confusing surface area for a mode that doesn't use them).
 *
 * Algorithmic Collections: "Generate Collection" resolves the algorithm
 * against the Collection's *current* market/city/algorithm/item-limit and
 * override state — including unsaved changes, via generateCollectionResultAction,
 * which is read-only and needs no prior Save (see that action's docstring).
 * The resolved table merges algorithm-selected rows ("Algorithm") and
 * manually-added rows ("Added"); excluding, boosting, adding, removing, or
 * reordering a row updates the underlying override rows (what actually gets
 * saved) and immediately re-runs Generate so the table stays in sync — no
 * separate "preview" step. Changing Market/City/Algorithm/Item Limit marks
 * the last-generated result stale until Generate is run again, since only
 * the server can re-resolve a changed candidate pool.
 *
 * Ordering note: an algorithmic Collection's own ranking is authoritative;
 * explicit order here is a secondary tie-break that only applies to rows
 * with an override entry (see collectionsPreview.ts's "Explicit ordering
 * note"). Moving a pure algorithm row up/down first "promotes" it to an
 * override (boost 0) so it becomes explicitly positionable.
 */

export type MembershipRow = {
  id: string;
  primaryLabel: string;
  secondaryLabel: string | null;
  action: "include" | "exclude";
  boost: number;
};

type Kind = "venue" | "event";

type Props = {
  kind: Kind;
  fieldName: string; // "venue_overrides" | "event_overrides"
  algorithmic: boolean;
  marketId: string;
  cityId: string | null;
  algorithmKey: AlgorithmKey | null;
  itemLimit: number | null;
  initialOverrideRows: MembershipRow[];
};

type GeneratedSettings = {
  marketId: string;
  cityId: string | null;
  algorithmKey: AlgorithmKey | null;
  itemLimit: number | null;
};

const SEARCH_ACTION: Record<Kind, (input: CollectionCandidateSearchInput) => Promise<AttachmentCandidate[]>> = {
  venue: searchCollectionVenueCandidatesAction,
  event: searchCollectionEventCandidatesAction,
};

const SOURCE_LABEL: Record<CollectionPreviewItem["origin"], string> = {
  algorithm: "Algorithm",
  "manual-include": "Added",
};

// ── Boost cell — local editable number, committed on blur ───────────────────

function BoostInput({ value, onCommit, disabled }: { value: number; onCommit: (v: number) => void; disabled: boolean }) {
  const [boost, setBoost] = useState(value);
  useEffect(() => setBoost(value), [value]);

  return (
    <input
      type="number"
      min={0}
      max={100}
      value={boost}
      disabled={disabled}
      onChange={(e) => setBoost(Number(e.target.value))}
      onBlur={() => {
        const clamped = Math.max(0, Math.min(100, Number.isFinite(boost) ? boost : 0));
        if (clamped !== value) onCommit(clamped);
        else setBoost(value);
      }}
      className={`w-16 px-2 py-1 border rounded text-xs text-center focus:outline-none focus:ring-1 focus:ring-amber-400 disabled:opacity-50 ${
        boost > 0 ? "border-amber-300 bg-amber-50 text-amber-800 font-semibold" : "border-gray-300"
      }`}
    />
  );
}

export default function ResolvedCollectionTable({
  kind,
  fieldName,
  algorithmic,
  marketId,
  cityId,
  algorithmKey,
  itemLimit,
  initialOverrideRows,
}: Props) {
  const label = kind === "venue" ? "venue" : "event";
  const labelCap = kind === "venue" ? "Venue" : "Event";

  const [overrideRows, setOverrideRows] = useState<MembershipRow[]>(initialOverrideRows);
  const [generated, setGenerated] = useState<CollectionPreviewResult | null>(null);
  const [generatedSettings, setGeneratedSettings] = useState<GeneratedSettings | null>(null);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<AttachmentCandidate[]>([]);
  const [isSearching, startSearch] = useTransition();
  const [hasSearched, setHasSearched] = useState(false);

  const searchAction = SEARCH_ACTION[kind];

  const isStale =
    generated !== null &&
    generatedSettings !== null &&
    (generatedSettings.marketId !== marketId ||
      generatedSettings.cityId !== cityId ||
      generatedSettings.algorithmKey !== algorithmKey ||
      generatedSettings.itemLimit !== itemLimit);

  function regenerate(rows: MembershipRow[]) {
    if (!marketId) return;
    setGenerateError(null);
    startTransition(async () => {
      const result = await generateCollectionResultAction({
        collectionType: kind,
        marketId,
        cityId,
        algorithmKey,
        itemLimit,
        overrides: rows.map((r) => ({ id: r.id, action: r.action, boost: r.boost })),
      });
      if (!result.success) {
        setGenerateError(result.error);
        return;
      }
      setGenerated(result.preview);
      setGeneratedSettings({ marketId, cityId, algorithmKey, itemLimit });
    });
  }

  // ── Search (add content) ──────────────────────────────────────────────────

  useEffect(() => {
    if (!marketId) {
      setResults([]);
      return;
    }
    const excludeIds = [
      ...overrideRows.map((r) => r.id),
      ...(generated?.items.map((i) => i.id) ?? []),
    ];
    const handle = setTimeout(
      () => {
        startSearch(async () => {
          const res = await searchAction({ marketId, cityId, query, excludeIds });
          setResults(res);
          setHasSearched(true);
        });
      },
      query.trim() ? 250 : 0
    );
    return () => clearTimeout(handle);
  }, [marketId, cityId, query, overrideRows, generated, searchAction]);

  function addCandidate(candidate: AttachmentCandidate) {
    const next: MembershipRow[] = [
      ...overrideRows,
      { id: candidate.id, primaryLabel: candidate.primaryLabel, secondaryLabel: candidate.secondaryLabel, action: "include", boost: 0 },
    ];
    setOverrideRows(next);
    setQuery("");
    if (algorithmic) regenerate(next);
  }

  // ── Manual mode row actions ───────────────────────────────────────────────

  function moveManualRow(index: number, direction: -1 | 1) {
    setOverrideRows((prev) => {
      const target = index + direction;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function removeManualRow(id: string) {
    setOverrideRows((prev) => prev.filter((r) => r.id !== id));
  }

  // ── Algorithmic mode row actions ──────────────────────────────────────────

  function promote(rows: MembershipRow[], item: CollectionPreviewItem): MembershipRow[] {
    if (rows.some((r) => r.id === item.id)) return rows;
    return [...rows, { id: item.id, primaryLabel: item.primaryLabel, secondaryLabel: item.secondaryLabel, action: "include", boost: 0 }];
  }

  function excludeItem(item: CollectionPreviewItem) {
    const without = overrideRows.filter((r) => r.id !== item.id);
    const next: MembershipRow[] = [
      ...without,
      { id: item.id, primaryLabel: item.primaryLabel, secondaryLabel: item.secondaryLabel, action: "exclude", boost: 0 },
    ];
    setOverrideRows(next);
    regenerate(next);
  }

  function restoreExcluded(id: string) {
    const next = overrideRows.filter((r) => r.id !== id);
    setOverrideRows(next);
    regenerate(next);
  }

  function removeAdded(id: string) {
    const next = overrideRows.filter((r) => r.id !== id);
    setOverrideRows(next);
    regenerate(next);
  }

  function updateBoost(item: CollectionPreviewItem, boost: number) {
    const existing = overrideRows.find((r) => r.id === item.id);
    const next: MembershipRow[] = existing
      ? overrideRows.map((r) => (r.id === item.id ? { ...r, boost, action: "include" } : r))
      : [...overrideRows, { id: item.id, primaryLabel: item.primaryLabel, secondaryLabel: item.secondaryLabel, action: "include", boost }];
    setOverrideRows(next);
    regenerate(next);
  }

  function moveGeneratedItem(item: CollectionPreviewItem, direction: -1 | 1) {
    if (!generated) return;
    const order = generated.items.map((i) => i.id);
    const currentIndex = order.indexOf(item.id);
    const targetIndex = currentIndex + direction;
    if (targetIndex < 0 || targetIndex >= order.length) return;
    const targetItem = generated.items[targetIndex];

    let rows = promote(overrideRows, item);
    rows = promote(rows, targetItem);
    const idxA = rows.findIndex((r) => r.id === item.id);
    const idxB = rows.findIndex((r) => r.id === targetItem.id);
    const next = [...rows];
    [next[idxA], next[idxB]] = [next[idxB], next[idxA]];

    setOverrideRows(next);
    regenerate(next);
  }

  const excludedRows = overrideRows.filter((r) => r.action === "exclude");
  const serialized = JSON.stringify(overrideRows.map((r) => ({ id: r.id, action: r.action, boost: r.boost })));

  const btnCls =
    "text-xs px-2.5 py-1 rounded border font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed";
  const arrowBtnCls =
    "w-6 h-6 flex items-center justify-center text-gray-400 hover:text-slate-700 disabled:opacity-30 disabled:cursor-not-allowed";

  if (!marketId) {
    return <p className="text-sm text-gray-400">Set this Collection&apos;s Market above to manage {label} content.</p>;
  }

  // ── Manual mode ────────────────────────────────────────────────────────────

  if (!algorithmic) {
    const hasQuery = query.trim().length > 0;
    return (
      <div className="space-y-4">
        <input type="hidden" name={fieldName} value={serialized} />

        {overrideRows.length === 0 ? (
          <div className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-6 text-center">
            <p className="text-sm text-gray-500">
              No {label}s have been added yet. Add {label}s to build this Collection.
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {overrideRows.map((row, index) => (
              <li
                key={row.id}
                className="flex items-center justify-between gap-3 px-3 py-2 bg-white border border-gray-200 rounded-lg"
              >
                <div className="min-w-0 flex-1">
                  <span className="text-sm font-medium text-slate-800 block truncate">{row.primaryLabel}</span>
                  {row.secondaryLabel && <span className="text-xs text-gray-400 block truncate">{row.secondaryLabel}</span>}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button type="button" onClick={() => moveManualRow(index, -1)} disabled={index === 0} className={arrowBtnCls} aria-label={`Move ${row.primaryLabel} up`}>↑</button>
                  <button type="button" onClick={() => moveManualRow(index, 1)} disabled={index === overrideRows.length - 1} className={arrowBtnCls} aria-label={`Move ${row.primaryLabel} down`}>↓</button>
                  <button type="button" onClick={() => removeManualRow(row.id)} className="ml-1 text-xs text-red-500 hover:text-red-700 whitespace-nowrap">
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Add {labelCap}</label>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${label}s by name…`}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-400 focus:border-transparent focus:outline-none"
          />
          <p className="mt-1.5 text-xs text-gray-400">
            {cityId ? `Showing published ${label}s in this city.` : `Showing published ${label}s in this market.`}
          </p>
          {isSearching && <p className="mt-1 text-xs text-gray-400">Searching…</p>}
          {!isSearching && hasSearched && results.length === 0 && (
            <p className="mt-1 text-xs text-gray-400">
              {hasQuery ? `No matching ${label}s found in this geography.` : `No more ${label}s available in this geography.`}
            </p>
          )}
          {!isSearching && results.length > 0 && (
            <ul className="mt-1 bg-white border border-gray-200 rounded-lg divide-y divide-gray-100 shadow-resting max-h-64 overflow-y-auto">
              {results.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => addCandidate(r)}
                    className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-amber-50 transition-colors"
                  >
                    <div className="min-w-0 flex-1">
                      <span className="font-medium text-slate-800 block truncate">{r.primaryLabel}</span>
                      {r.secondaryLabel && <span className="text-xs text-gray-400 block truncate">{r.secondaryLabel}</span>}
                    </div>
                    <span className="text-xs font-medium text-amber-600 shrink-0">+ Add {labelCap}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    );
  }

  // ── Algorithmic mode ─────────────────────────────────────────────────────

  const hasQuery = query.trim().length > 0;

  return (
    <div className="space-y-4">
      <input type="hidden" name={fieldName} value={serialized} />

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <button
          type="button"
          onClick={() => regenerate(overrideRows)}
          disabled={isPending || !algorithmKey}
          className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white font-semibold rounded-lg text-sm disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isPending ? "Generating…" : generated ? "Regenerate Collection" : "Generate Collection"}
        </button>
        {generated && !isStale && (
          <span className="text-xs text-gray-400">
            {generated.items.length} {label}{generated.items.length === 1 ? "" : "s"} resolved
          </span>
        )}
        {!algorithmKey && <span className="text-xs text-gray-400">Select an algorithm above first.</span>}
      </div>

      {isStale && (
        <p className="text-xs text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2.5">
          Collection settings changed. Generate again to refresh the results.
        </p>
      )}
      {generateError && <p className="text-xs text-red-600">{generateError}</p>}

      {!generated && (
        <div className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-6 text-center">
          <p className="text-sm text-gray-500">
            Choose an algorithm and generate the Collection to see eligible {label}s.
          </p>
        </div>
      )}

      {generated && (
        <div className={isStale ? "opacity-60" : ""}>
          {generated.items.length === 0 ? (
            <div className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-6 text-center">
              <p className="text-sm text-gray-500">{generated.emptyReason}</p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-gray-200">
              <table className="min-w-full divide-y divide-gray-200 bg-white text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">{labelCap}</th>
                    {kind === "event" && (
                      <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Venue</th>
                    )}
                    <th className="px-3 py-2 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">Source</th>
                    <th className="px-3 py-2 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">Boost</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {generated.items.map((item, index) => (
                    <tr key={item.id}>
                      <td className="px-3 py-2 font-medium text-slate-800 max-w-xs">
                        <span className="block truncate">{item.primaryLabel}</span>
                        {kind === "venue" && item.secondaryLabel && (
                          <span className="text-xs text-gray-400 block truncate font-normal">{item.secondaryLabel}</span>
                        )}
                      </td>
                      {kind === "event" && (
                        <td className="px-3 py-2 text-gray-600 max-w-xs">
                          <span className="block truncate">{item.secondaryLabel}</span>
                        </td>
                      )}
                      <td className="px-3 py-2 text-center">
                        <span
                          className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                            item.origin === "manual-include"
                              ? "bg-emerald-100 text-emerald-700 border border-emerald-300"
                              : "bg-slate-100 text-slate-600 border border-slate-300"
                          }`}
                        >
                          {SOURCE_LABEL[item.origin]}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-center">
                        <BoostInput
                          value={overrideRows.find((r) => r.id === item.id)?.boost ?? 0}
                          onCommit={(v) => updateBoost(item, v)}
                          disabled={isPending}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center justify-end gap-1">
                          <button type="button" onClick={() => moveGeneratedItem(item, -1)} disabled={index === 0 || isPending} className={arrowBtnCls} aria-label={`Move ${item.primaryLabel} up`}>↑</button>
                          <button type="button" onClick={() => moveGeneratedItem(item, 1)} disabled={index === generated.items.length - 1 || isPending} className={arrowBtnCls} aria-label={`Move ${item.primaryLabel} down`}>↓</button>
                          {item.origin === "manual-include" ? (
                            <button type="button" onClick={() => removeAdded(item.id)} disabled={isPending} className={`${btnCls} ml-1 bg-white border-gray-200 text-gray-600 hover:bg-gray-50`}>
                              Remove
                            </button>
                          ) : (
                            <button type="button" onClick={() => excludeItem(item)} disabled={isPending} className={`${btnCls} ml-1 bg-white border-red-200 text-red-600 hover:bg-red-50`}>
                              Exclude
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {excludedRows.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-sm font-medium text-gray-500 hover:text-gray-700 select-none">
            Excluded Items ({excludedRows.length})
          </summary>
          <ul className="mt-2 bg-white rounded-xl border border-red-100 divide-y divide-red-50">
            {excludedRows.map((row) => (
              <li key={row.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <div className="min-w-0">
                  <span className="text-sm text-slate-700 block truncate">{row.primaryLabel}</span>
                  {row.secondaryLabel && <span className="text-xs text-gray-400 block truncate">{row.secondaryLabel}</span>}
                </div>
                <button
                  type="button"
                  onClick={() => restoreExcluded(row.id)}
                  disabled={isPending}
                  className={`${btnCls} shrink-0 bg-white border-gray-200 text-gray-600 hover:bg-gray-50`}
                >
                  Restore
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}

      {/* Add content search */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Add {labelCap}</label>
        <p className="mt-0.5 mb-1.5 text-xs text-gray-400">
          Manually adding a {label} pins it in the resolved list even if the algorithm wouldn&apos;t otherwise select it.
        </p>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Search ${label}s by name…`}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-400 focus:border-transparent focus:outline-none"
        />
        <p className="mt-1.5 text-xs text-gray-400">
          {cityId ? `Showing published ${label}s in this city.` : `Showing published ${label}s in this market.`}
        </p>
        {isSearching && <p className="mt-1 text-xs text-gray-400">Searching…</p>}
        {!isSearching && hasSearched && results.length === 0 && (
          <p className="mt-1 text-xs text-gray-400">
            {hasQuery ? `No matching ${label}s found in this geography.` : `No more ${label}s available in this geography.`}
          </p>
        )}
        {!isSearching && results.length > 0 && (
          <ul className="mt-1 bg-white border border-gray-200 rounded-lg divide-y divide-gray-100 shadow-resting max-h-64 overflow-y-auto">
            {results.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => addCandidate(r)}
                  className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-amber-50 transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <span className="font-medium text-slate-800 block truncate">{r.primaryLabel}</span>
                    {r.secondaryLabel && <span className="text-xs text-gray-400 block truncate">{r.secondaryLabel}</span>}
                  </div>
                  <span className="text-xs font-medium text-amber-600 shrink-0">+ Add {labelCap}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
